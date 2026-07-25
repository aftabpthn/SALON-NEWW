import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: any;
  meta?: { page?: number; pageSize?: number; total?: number };
};

type HealthStatus = { status: string; service: string; environment?: string; env?: string };

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Observable<HealthStatus> {
    return this.http.get<ApiEnvelope<HealthStatus> | HealthStatus>(`${environment.apiBaseUrl}/health`).pipe(
      map((response) => {
        const health = (response as ApiEnvelope<HealthStatus>).data;
        return health ?? (response as HealthStatus);
      }),
    );
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(this.url(path));
  }

  getBlob(path: string): Observable<Blob> {
    return this.http.get(this.url(path), { responseType: 'blob' });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(this.url(path), body);
  }

  postWithHeaders<T>(path: string, body: unknown, headers: Record<string, string>): Observable<T> {
    return this.http.post<T>(this.url(path), body, { headers });
  }

  postBytes<T>(path: string, body: Blob, headers: Record<string, string> = {}): Observable<T> {
    return this.http.post<T>(this.url(path), body, {
      headers: { 'Content-Type': body.type || 'application/octet-stream', ...headers },
    });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body);
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(this.url(path), body);
  }

  putBytes<T>(path: string, body: Blob, headers: Record<string, string> = {}): Observable<T> {
    return this.http.put<T>(this.url(path), body, {
      headers: { 'Content-Type': body.type || 'application/octet-stream', ...headers },
    });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.url(path));
  }

  async getAllPages<T>(path: string, pageSize = 200): Promise<T[]> {
    const [pathname, query = ''] = path.split('?', 2);
    const params = new URLSearchParams(query);
    const size = Math.min(Math.max(pageSize, 1), 200);

    const loadPage = async (page: number) => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      pageParams.set('pageSize', String(size));
      const response = await firstValueFrom(this.get<ApiEnvelope<T[]>>(`${pathname}?${pageParams}`));
      if (!response.data) throw new Error('API response did not contain data');
      return response;
    };

    const first = await loadPage(1);
    const rows = [...(first.data ?? [])];
    const total = first.meta?.total;
    if (Number.isFinite(total)) {
      const totalPages = Math.ceil(Math.max(total ?? 0, 0) / size);
      for (let page = 2; page <= totalPages; page += 4) {
        const batch = Array.from(
          { length: Math.min(4, totalPages - page + 1) },
          (_, index) => loadPage(page + index),
        );
        for (const response of await Promise.all(batch)) rows.push(...(response.data ?? []));
      }
      return rows;
    }

    for (let page = 2; first.data?.length === size; page += 1) {
      params.set('page', String(page));
      params.set('pageSize', String(size));
      const response = await firstValueFrom(this.get<ApiEnvelope<T[]>>(`${pathname}?${params}`));
      if (!response.data) throw new Error('API response did not contain data');
      rows.push(...response.data);
      if (response.data.length < size) break;
    }
    return rows;
  }

  private url(path: string) {
    const trimmedPath = path.trim();
    if (/^https?:\/\//i.test(trimmedPath) || trimmedPath.startsWith(environment.apiBaseUrl)) {
      return trimmedPath;
    }

    const apiBase = environment.apiBaseUrl.replace(/\/+$/, '');
    const origin = apiBase.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';
    if (trimmedPath === '/api' || trimmedPath.startsWith('/api/')) {
      return `${origin}${trimmedPath}`;
    }
    if (trimmedPath === 'api' || trimmedPath.startsWith('api/')) {
      return `${origin}/${trimmedPath}`;
    }

    return `${apiBase}${trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`}`;
  }
}
