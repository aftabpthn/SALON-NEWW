import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: any;
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
