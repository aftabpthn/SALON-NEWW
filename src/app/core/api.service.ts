import { HttpClient, HttpEventType, HttpHeaders, HttpParams, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, switchMap, throwError, timeout } from 'rxjs';
import { filter, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthSessionService } from './auth-session.service';
import { AppStateService } from './state/app-state.service';

export type ApiRecord = Record<string, any>;
type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string; details?: unknown } };
const BRANCH_SCOPE_EXCLUDED_PREFIXES = new Set([
  'auth',
  'branches',
  'health',
  'saas',
  'super-admin',
  'tenants'
]);

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly selectedBranchId = this.appState.selectedBranchId;

  constructor(
    private readonly http: HttpClient,
    private readonly appState: AppStateService,
    private readonly authSession: AuthSessionService
  ) {}

  list<T = ApiRecord[]>(resource: string, params: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}`, { headers, params: this.toParams(this.withBranchScope(resource, params)) }), this.timeoutFor(resource));
  }

  get<T = ApiRecord>(resource: string, id: string): Observable<T> {
    return this.withAuth((headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}/${id}`, { headers }), this.timeoutFor(resource));
  }

  create<T = ApiRecord>(resource: string, payload: ApiRecord): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}`, this.withBranchScope(resource, payload), { headers: this.headersForMutation(resource, headers) }), this.timeoutFor(resource));
  }

  update<T = ApiRecord>(resource: string, id: string, payload: ApiRecord): Observable<T> {
    return this.withAuth((headers) => this.http.patch<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}/${id}`, payload, { headers }), this.timeoutFor(resource));
  }

  delete<T = ApiRecord>(resource: string, id: string): Observable<T> {
    return this.withAuth((headers) => this.http.delete<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}/${id}`, { headers }), this.timeoutFor(resource));
  }

  post<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, this.withBranchScope(path, payload), { headers: this.headersForMutation(path, headers) }), this.timeoutFor(path));
  }

  postWithHeaders<T = ApiRecord>(path: string, payload: ApiRecord = {}, extraHeaders: Record<string, string> = {}): Observable<T> {
    return this.withAuth((headers) => {
      let requestHeaders = this.headersForMutation(path, headers);
      for (const [key, value] of Object.entries(extraHeaders)) {
        requestHeaders = requestHeaders.set(key, value);
      }
      return this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers: requestHeaders });
    });
  }

  postBinary<T = ApiRecord>(path: string, payload: Blob | ArrayBuffer, fileName: string, contentType = 'application/octet-stream'): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, {
      headers: this.headersForMutation(path, headers)
        .set('content-type', contentType)
        .set('x-file-name', fileName)
    }), this.timeoutFor(path));
  }

  postBinaryWithHeaders<T = ApiRecord>(path: string, payload: Blob | ArrayBuffer, fileName: string, extraHeaders: Record<string, string> = {}, contentType = 'application/octet-stream'): Observable<T> {
    return this.withAuth((headers) => {
      let reqHeaders = this.headersForMutation(path, headers)
        .set('content-type', contentType)
        .set('x-file-name', fileName);
      for (const [key, value] of Object.entries(extraHeaders)) {
        reqHeaders = reqHeaders.set(key, value);
      }
      return this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers: reqHeaders });
    }, this.timeoutFor(path));
  }

  postBinaryWithProgress<T = ApiRecord>(path: string, payload: Blob | ArrayBuffer, fileName: string, extraHeaders: Record<string, string> = {}, onProgress: (percent: number) => void): Observable<T> {
    return this.withAuth((headers) => {
      let reqHeaders = this.headersForMutation(path, headers)
        .set('content-type', 'application/octet-stream')
        .set('x-file-name', fileName);
      for (const [key, value] of Object.entries(extraHeaders)) {
        reqHeaders = reqHeaders.set(key, value);
      }
      const req = new HttpRequest('POST', `${environment.apiBaseUrl}/${path}`, payload, {
        headers: reqHeaders,
        reportProgress: true,
      });
      return this.http.request(req).pipe(
        tap((event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        }),
        filter((event) => event.type === HttpEventType.Response),
        map((event) => {
          const body = (event as HttpResponse<ApiEnvelope<T> | T>).body;
          if (body && typeof body === 'object' && 'success' in body) {
            const envelope = body as ApiEnvelope<T>;
            if (envelope.success === false) throw new Error(envelope.error?.message || 'API request failed');
            return envelope.data as T;
          }
          return body as T;
        })
      );
    }, this.timeoutFor(path));
  }
  put<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.put<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers }), this.timeoutFor(path));
  }

  patch<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.patch<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers }), this.timeoutFor(path));
  }

  report<T = ApiRecord>(path: string, params: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/reports/${path}`, { headers, params: this.toParams(this.withBranchScope(`reports/${path}`, params)) }), this.timeoutFor(`reports/${path}`));
  }

  errorText(error: unknown, fallback = 'Request failed'): string {
    const err = error as {
      error?: { error?: unknown; message?: unknown };
      message?: unknown;
      status?: number;
    };
    const raw = this.deepMessage(err?.error?.error) || this.deepMessage(err?.error?.message) || this.deepMessage(err?.message);
    if (raw) return raw;
    return err?.status === 401 ? 'Session expired. Please sign in again.' : fallback;
  }

  private withAuth<T>(request: (headers: HttpHeaders) => Observable<ApiEnvelope<T> | T>, timeoutMs = 15000): Observable<T> {
    return this.readyHeaders().pipe(
      switchMap((headers) => this.unwrap(request(headers), timeoutMs).pipe(
        catchError((error) => {
          if (!this.isAuthExpired(error)) return throwError(() => error);
          return this.authSession.refreshSession().pipe(
            switchMap(() => this.unwrap(request(this.headers()), timeoutMs)),
            catchError((refreshError) => {
              this.authSession.clearSession();
              return throwError(() => refreshError);
            })
          );
        })
      )),
      catchError((error) => {
        if (this.isUnauthorized(error)) this.authSession.clearSession();
        return throwError(() => error);
      })
    );
  }

  private readyHeaders(): Observable<HttpHeaders> {
    if (!this.authSession.shouldRefreshAccessToken()) return of(this.headers());
    return this.authSession.refreshSession().pipe(map(() => this.headers()));
  }

  private unwrap<T>(request: Observable<ApiEnvelope<T> | T>, timeoutMs = 15000): Observable<T> {
    return request.pipe(
      timeout({ each: timeoutMs }),
      map((response) => {
        if (response && typeof response === 'object' && 'success' in response) {
          const envelope = response as ApiEnvelope<T>;
          if (envelope.success === false) throw new Error(envelope.error?.message || 'API request failed');
          return envelope.data as T;
        }
        return response as T;
      })
    );
  }

  private headers(): HttpHeaders {
    const token = this.authSession.accessToken();
    let headers = new HttpHeaders({
      'x-tenant-id': this.appState.selectedTenantId(),
      'x-branch-id': this.appState.selectedBranchId(),
      'cache-control': 'no-cache',
      pragma: 'no-cache'
    });
    if (token) {
      headers = headers.set('authorization', `Bearer ${token}`);
    } else if (!environment.production) {
      headers = headers.set('x-user-role', this.appState.userRole());
    }
    return headers;
  }

  private timeoutFor(resource: string): number {
    const normalized = resource.replace(/^\/+/, '').split(/[?#]/)[0];
    if (normalized.startsWith('migration/') || normalized === 'clients/duplicates/merge-all') return 1800000;
    return 15000;
  }

  private headersForMutation(resource: string, headers = this.headers()): HttpHeaders {
    const keyRequired = new Set(['appointments', 'slot-holds', 'bills', 'payments', 'refunds', 'booking-portal/confirm', 'booking-portal/v2/confirm', 'booking-payments/payment-link/create', 'appointment-deposits/multi-service-bookings', 'online-booking/confirm', 'engagement/booking/create']);
    if (!keyRequired.has(resource.replace(/^\/+/, ''))) return headers;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return headers.set('Idempotency-Key', `${resource}-${id}`);
  }

  private isAuthExpired(error: unknown): boolean {
    const message = this.errorText(error, '').toLowerCase();
    return this.isUnauthorized(error) && (message.includes('expired') || message.includes('jwt'));
  }

  private isUnauthorized(error: unknown): boolean {
    return Number((error as { status?: number })?.status || 0) === 401;
  }

  private deepMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const objectValue = value as { message?: unknown; code?: unknown; error?: unknown };
    return this.deepMessage(objectValue.message) || this.deepMessage(objectValue.error) || this.deepMessage(objectValue.code);
  }

  private toParams(params: ApiRecord): HttpParams {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      httpParams = httpParams.set(key, String(value));
    }
    return httpParams;
  }

  private withBranchScope(resource: string, value: ApiRecord = {}): ApiRecord {
    if (this.shouldSkipBranchScope(resource, value)) return value;
    const branchId = this.appState.selectedBranchId();
    if (!branchId || value.branchId || value.branch_id) return value;
    return { ...value, branchId };
  }

  private shouldSkipBranchScope(resource: string, value: ApiRecord): boolean {
    if (value.includeAllBranches === true || value.includeAllBranches === 'true') return true;
    const normalized = resource.replace(/^\/+/, '').split(/[/?#]/)[0];
    const prefix = normalized.split('/')[0];
    return BRANCH_SCOPE_EXCLUDED_PREFIXES.has(prefix);
  }
}

