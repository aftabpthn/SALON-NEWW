import { HttpClient, HttpEventType, HttpHeaders, HttpParams, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, throwError, timeout } from 'rxjs';
import { filter, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthSessionService } from './auth-session.service';
import { AppStateService } from './state/app-state.service';

export type ApiRecord = Record<string, any>;
type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string; details?: unknown } };
type ReadCacheEntry<T> = { value?: T; expiresAt: number; refreshing?: Observable<T> };
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
  private readonly readCache = new Map<string, ReadCacheEntry<unknown>>();
  private refreshReportsOnOpen = true;

  constructor(
    private readonly http: HttpClient,
    private readonly appState: AppStateService,
    private readonly authSession: AuthSessionService
  ) {}

  list<T = ApiRecord[]>(resource: string, params: ApiRecord = {}): Observable<T> {
    const effectiveParams = this.refreshReportsOnOpen && this.isReportResource(resource) ? { ...params, noCache: true } : params;
    const scopedParams = this.withBranchScope(resource, effectiveParams);
    return this.cachedRead(resource, scopedParams, (headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}`, { headers, params: this.toParams(scopedParams) }), this.timeoutFor(resource));
  }

  get<T = ApiRecord>(resource: string, id: string): Observable<T> {
    const path = `${resource}/${id}`;
    const params = this.refreshReportsOnOpen && this.isReportResource(path) ? { noCache: true } : {};
    return this.cachedRead(path, params, (headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, { headers }), this.timeoutFor(resource));
  }

  create<T = ApiRecord>(resource: string, payload: ApiRecord): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}`, this.withBranchScope(resource, payload), { headers: this.headersForMutation(resource, headers) }), this.timeoutFor(resource))
      .pipe(tap(() => this.invalidateCachedReads(resource)));
  }

  update<T = ApiRecord>(resource: string, id: string, payload: ApiRecord): Observable<T> {
    return this.withAuth((headers) => this.http.patch<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}/${id}`, payload, { headers }), this.timeoutFor(resource))
      .pipe(tap(() => this.invalidateCachedReads(resource)));
  }

  delete<T = ApiRecord>(resource: string, id: string): Observable<T> {
    return this.withAuth((headers) => this.http.delete<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}/${id}`, { headers }), this.timeoutFor(resource))
      .pipe(tap(() => this.invalidateCachedReads(resource)));
  }

  post<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, this.withBranchScope(path, payload), { headers: this.headersForMutation(path, headers) }), this.timeoutFor(path))
      .pipe(tap(() => this.invalidateCachedReads(path)));
  }

  postBlob(path: string, payload: ApiRecord = {}): Observable<Blob> {
    return this.withAuth((headers) => this.http.post(`${environment.apiBaseUrl}/${path}`, this.withBranchScope(path, payload), {
      headers: this.headersForMutation(path, headers),
      responseType: 'blob'
    }), this.timeoutFor(path));
  }

  postWithHeaders<T = ApiRecord>(path: string, payload: ApiRecord = {}, extraHeaders: Record<string, string> = {}): Observable<T> {
    return this.withAuth((headers) => {
      let requestHeaders = this.headersForMutation(path, headers);
      for (const [key, value] of Object.entries(extraHeaders)) {
        requestHeaders = requestHeaders.set(key, value);
      }
      return this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers: requestHeaders });
    }).pipe(tap(() => this.invalidateCachedReads(path)));
  }

  postBinary<T = ApiRecord>(path: string, payload: Blob | ArrayBuffer, fileName: string, contentType = 'application/octet-stream'): Observable<T> {
    return this.withAuth((headers) => this.http.post<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, {
      headers: this.headersForMutation(path, headers)
        .set('content-type', contentType)
        .set('x-file-name', fileName)
    }), this.timeoutFor(path)).pipe(tap(() => this.invalidateCachedReads(path)));
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
    }, this.timeoutFor(path)).pipe(tap(() => this.invalidateCachedReads(path)));
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
        reportProgress: true });
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
    }, this.timeoutFor(path)).pipe(tap(() => this.invalidateCachedReads(path)));
  }
  put<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.put<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers }), this.timeoutFor(path))
      .pipe(tap(() => this.invalidateCachedReads(path)));
  }

  patch<T = ApiRecord>(path: string, payload: ApiRecord = {}): Observable<T> {
    return this.withAuth((headers) => this.http.patch<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${path}`, payload, { headers }), this.timeoutFor(path))
      .pipe(tap(() => this.invalidateCachedReads(path)));
  }

  report<T = ApiRecord>(path: string, params: ApiRecord = {}): Observable<T> {
    const resource = `reports/${path}`;
    const scopedParams = this.withBranchScope(resource, this.refreshReportsOnOpen ? { ...params, noCache: true } : params);
    return this.cachedRead(resource, scopedParams, (headers) => this.http.get<ApiEnvelope<T> | T>(`${environment.apiBaseUrl}/${resource}`, { headers, params: this.toParams(scopedParams) }), this.timeoutFor(resource));
  }

  setReportRefreshPolicy(refreshOnOpen: boolean): void {
    this.refreshReportsOnOpen = refreshOnOpen;
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

  private cachedRead<T>(resource: string, params: ApiRecord, request: (headers: HttpHeaders) => Observable<ApiEnvelope<T> | T>, timeoutMs = 15000): Observable<T> {
    const ttlMs = this.cacheTtlFor(resource);
    if (params?.['noCache'] || !ttlMs) return this.withAuth(request, timeoutMs);

    const key = this.cacheKey(resource, params);
    const cached = this.readCache.get(key) as ReadCacheEntry<T> | undefined;
    const now = Date.now();

    if (cached?.value !== undefined && cached.expiresAt > now) {
      return of(this.copyCachedValue(cached.value));
    }

    if (cached?.value !== undefined) {
      this.refreshCachedRead(key, ttlMs, request, timeoutMs, cached);
      return of(this.copyCachedValue(cached.value));
    }

    if (cached?.refreshing) return cached.refreshing;

    const refreshing = this.withAuth(request, timeoutMs).pipe(
      tap((value) => this.readCache.set(key, { value, expiresAt: Date.now() + ttlMs })),
      finalize(() => this.clearRefreshingCacheEntry(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.readCache.set(key, { expiresAt: 0, refreshing });
    return refreshing;
  }

  private refreshCachedRead<T>(
    key: string,
    ttlMs: number,
    request: (headers: HttpHeaders) => Observable<ApiEnvelope<T> | T>,
    timeoutMs: number,
    cached: ReadCacheEntry<T>
  ): void {
    if (cached.refreshing) return;
    const refreshing = this.withAuth(request, timeoutMs).pipe(
      tap((value) => this.readCache.set(key, { value, expiresAt: Date.now() + ttlMs })),
      finalize(() => this.clearRefreshingCacheEntry(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.readCache.set(key, { ...cached, refreshing });
    refreshing.subscribe({ error: () => undefined });
  }

  private clearRefreshingCacheEntry(key: string): void {
    const latest = this.readCache.get(key);
    if (!latest?.refreshing) return;
    this.readCache.set(key, { value: latest.value, expiresAt: latest.expiresAt });
  }

  private cacheTtlFor(resource: string): number {
    const normalized = this.normalizeCacheResource(resource);
    if (normalized === 'branches') return 5 * 60_000;
    if (normalized === 'staff' || normalized.startsWith('staff/') || normalized === 'staff-os/staff') return 2 * 60_000;
    if (normalized === 'services' || normalized.startsWith('services/')) return 5 * 60_000;
    if (normalized === 'permissions' || normalized === 'permission-matrix' || normalized === 'security/permission-matrix') return 5 * 60_000;
    if (normalized === 'tenants' || normalized === 'tenant-profile' || normalized === 'business-profile') return 5 * 60_000;
    if (normalized === 'business-details' || normalized.startsWith('business-details/')) return 5 * 60_000;
    if (normalized === 'dashboard' || normalized.startsWith('dashboard/') || normalized === 'dashboard-summary' || normalized === 'home-dashboard' || normalized === 'reports/dashboard') return 60_000;
    if (normalized.startsWith('reports/')) return 45_000;
    if (normalized === 'clients' || normalized.startsWith('clients/')) return 45_000;
    if (normalized === 'appointments' || normalized.startsWith('appointments/') || normalized.startsWith('enterprise-scheduler/')) return 15_000;
    if (normalized === 'products' || normalized.startsWith('products/') || normalized === 'packages' || normalized.startsWith('packages/') || normalized === 'memberships' || normalized.startsWith('memberships/')) return 2 * 60_000;
    if (normalized === 'inventory' || normalized.startsWith('inventory/') || normalized === 'suppliers' || normalized.startsWith('suppliers/') || normalized === 'inventoryBatches') return 90_000;
    if (normalized === 'localization/preference' || normalized === 'invoice-notifications/profile' || normalized.startsWith('settings/')) return 5 * 60_000;
    if (normalized.endsWith('/summary') || normalized.endsWith('/dashboard') || normalized.endsWith('/overview')) return 45_000;
    return 0;
  }

  private cacheKey(resource: string, params: ApiRecord): string {
    return [
      this.appState.selectedTenantId(),
      this.appState.selectedBranchId(),
      this.appState.userRole(),
      this.normalizeCacheResource(resource),
      this.stableParams(params)
    ].join('|');
  }

  private invalidateCachedReads(resource: string): void {
    const changed = this.normalizeCacheResource(resource);
    for (const key of [...this.readCache.keys()]) {
      const cachedResource = key.split('|')[3] || '';
      if (this.cacheResourcesRelated(cachedResource, changed)) this.readCache.delete(key);
    }
  }

  private cacheResourcesRelated(cachedResource: string, changedResource: string): boolean {
    if (!cachedResource || !changedResource) return false;
    if (cachedResource === changedResource) return true;
    if (cachedResource.startsWith(`${changedResource}/`) || changedResource.startsWith(`${cachedResource}/`)) return true;
    if (cachedResource.startsWith('reports/')) return true;
    if (changedResource === 'staff' || changedResource.startsWith('staff/') || changedResource.startsWith('staff-os/staff')) return cachedResource === 'staff' || cachedResource.startsWith('staff/') || cachedResource === 'staff-os/staff';
    if (changedResource.startsWith('staff-os/')) return cachedResource === 'staff-os/staff';
    if (changedResource.startsWith('branches')) return cachedResource === 'branches';
    if (changedResource.startsWith('services')) return cachedResource === 'services' || cachedResource.startsWith('services/');
    if (changedResource.startsWith('permissions') || changedResource.startsWith('security/permission') || changedResource.startsWith('roles')) return cachedResource === 'permissions' || cachedResource === 'permission-matrix' || cachedResource === 'security/permission-matrix';
    if (changedResource.startsWith('business-details') || changedResource.startsWith('tenants') || changedResource.startsWith('tenant-profile') || changedResource.startsWith('business-profile')) {
      return cachedResource === 'business-details' || cachedResource.startsWith('business-details/') || cachedResource === 'tenants' || cachedResource === 'tenant-profile' || cachedResource === 'business-profile';
    }
    if (changedResource.startsWith('dashboard')) return cachedResource === 'dashboard' || cachedResource.startsWith('dashboard/') || cachedResource === 'dashboard-summary' || cachedResource === 'home-dashboard';
    return false;
  }

  private normalizeCacheResource(resource: string): string {
    return resource.replace(/^\/+/, '').split(/[?#]/)[0].replace(/\/+$/, '');
  }

  private isReportResource(resource: string): boolean {
    const normalized = this.normalizeCacheResource(resource).toLowerCase();
    return normalized.split('/').some((segment) => segment === 'report' || segment === 'reports' || segment === 'analytics' || segment.endsWith('-report') || segment.endsWith('-reports') || segment.endsWith('-analytics'));
  }

  private stableParams(params: ApiRecord): string {
    return JSON.stringify(Object.entries(params || {}).sort(([left], [right]) => left.localeCompare(right)));
  }

  private copyCachedValue<T>(value: T): T {
    if (Array.isArray(value)) return [...value] as T;
    if (value && typeof value === 'object') return { ...(value as ApiRecord) } as T;
    return value;
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
    if (!environment.production) {
      headers = headers.set('x-user-role', this.appState.userRole());
    }
    if (token) {
      headers = headers.set('authorization', `Bearer ${token}`);
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

