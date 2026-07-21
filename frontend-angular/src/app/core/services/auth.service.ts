import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuthApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: { mfaRequired?: boolean };
  };
}

export interface AuthTokenPair {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in_seconds: number;
  must_change_password: boolean;
  mfa_enrollment_required: boolean;
}

export interface AuthBranchAccess {
  branchId: string;
  branchName: string;
  regionName: string;
  zoneName: string;
  clusterName: string;
  roleId?: string;
  roleName: string;
  permissions: string[];
  isDefault: boolean;
}

export interface BranchSelectionResponse {
  requiresBranchSelection: true;
  selectionToken: string;
  branches: AuthBranchAccess[];
}

export interface AuthProfile {
  tenantId: string;
  branchId?: string;
  branches: AuthBranchAccess[];
}

export type LoginResponse = AuthTokenPair | BranchSelectionResponse;

export interface SsoProviders {
  google: boolean;
  microsoft: boolean;
  saml: boolean;
}

interface AccessClaims {
  sub?: string;
  tenant_id?: string;
  branch_id?: string;
  role?: string;
  role_id?: string;
  permissions?: string[];
  token_type?: string;
  exp?: number;
  mfa_enrollment_required?: boolean;
}

const ACCESS_TOKEN_KEY = 'aurashine_access_token';
const TENANT_ID_KEY = 'aurashine_tenant_id';
const BRANCH_ID_KEY = 'aurashine_branch_id';
const BRANCH_NAME_KEY = 'aurashine_branch_name';
const REFRESH_TOKEN_KEY = 'aurashine_refresh_token';
const MUST_CHANGE_PASSWORD_KEY = 'aurashine_must_change_password';
const DEVICE_ID_KEY = 'aurashine_device_id';

export function authDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private refreshRequest$?: Observable<string>;

  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  get tenantId(): string | null {
    return localStorage.getItem(TENANT_ID_KEY);
  }

  get branchId(): string | null {
    return localStorage.getItem(BRANCH_ID_KEY);
  }

  get branchName(): string | null {
    return localStorage.getItem(BRANCH_NAME_KEY);
  }

  get userId(): string | null {
    const token = this.accessToken;
    return token ? this.tokenClaims(token)?.sub ?? null : null;
  }

  get mustChangePassword(): boolean {
    return localStorage.getItem(MUST_CHANGE_PASSWORD_KEY) === 'true';
  }

  get mfaEnrollmentRequired(): boolean {
    const claims = this.accessToken ? this.tokenClaims(this.accessToken) : null;
    return claims?.mfa_enrollment_required === true;
  }

  hasRole(...roles: string[]): boolean {
    const role = this.accessToken ? this.tokenClaims(this.accessToken)?.role : null;
    return Boolean(role && roles.some((allowed) => allowed.toLowerCase() === role.toLowerCase()));
  }

  hasPermission(...permissions: string[]): boolean {
    const granted = this.accessToken ? this.tokenClaims(this.accessToken)?.permissions ?? [] : [];
    return permissions.some((required) => granted.includes(required));
  }

  resolveTenantContext(): string | null {
    const metaContext = document
      .querySelector<HTMLMetaElement>('meta[name="aurashine-tenant-context"]')
      ?.content.trim();
    if (metaContext) return metaContext;

    if (environment.tenantContext.trim()) return environment.tenantContext.trim();

    const hostParts = location.hostname.toLowerCase().split('.').filter(Boolean);
    const subdomain = hostParts.length >= 3 ? hostParts[0] : '';
    if (subdomain && !['app', 'crm', 'www'].includes(subdomain)) return subdomain;

    return this.tenantId;
  }

  login(
    tenantContext: string,
    loginId: string,
    password: string,
    mfaCode = '',
  ): Observable<LoginResponse> {
    return this.http
      .post<AuthApiEnvelope<LoginResponse>>(
        `${environment.apiBaseUrl}/auth/login`,
        { loginId: loginId.trim(), password, deviceId: authDeviceId(), ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}) },
        {
          headers: new HttpHeaders({ 'x-tenant-id': tenantContext }),
          withCredentials: true,
        },
      )
      .pipe(map((response) => this.requireData(response, 'Unable to sign in')));
  }

  ssoProviders(tenant = ''): Observable<SsoProviders> {
    const query = tenant.trim() ? `?tenant=${encodeURIComponent(tenant.trim())}` : '';
    return this.http
      .get<AuthApiEnvelope<SsoProviders>>(`${environment.apiBaseUrl}/auth/sso/providers${query}`)
      .pipe(map((response) => this.requireData(response, 'Unable to load SSO providers')));
  }

  ssoStartUrl(provider: 'google' | 'microsoft' | 'saml', tenant: string, returnUri: string): string {
    const query = new URLSearchParams({ tenant, returnUri });
    return `${environment.apiBaseUrl}/auth/sso/${provider}/start?${query.toString()}`;
  }

  exchangeSso(code: string): Observable<LoginResponse> {
    return this.http
      .post<AuthApiEnvelope<LoginResponse>>(
        `${environment.apiBaseUrl}/auth/sso/exchange`,
        { code, deviceId: authDeviceId() },
        { withCredentials: true },
      )
      .pipe(map((response) => this.requireData(response, 'Unable to complete SSO sign-in')));
  }

  selectBranch(
    tenantContext: string,
    selectionToken: string,
    branchId: string,
  ): Observable<AuthTokenPair> {
    return this.http
      .post<AuthApiEnvelope<AuthTokenPair>>(
        `${environment.apiBaseUrl}/auth/select-branch`,
        { selectionToken, branchId, deviceId: authDeviceId() },
        {
          headers: new HttpHeaders({ 'x-tenant-id': tenantContext }),
          withCredentials: true,
        },
      )
      .pipe(map((response) => this.requireData(response, 'Unable to select branch')));
  }

  switchBranch(branchId: string): Observable<AuthTokenPair> {
    return this.http
      .post<AuthApiEnvelope<AuthTokenPair>>(
        `${environment.apiBaseUrl}/auth/switch-branch`,
        { branchId, deviceId: authDeviceId() },
        { withCredentials: true },
      )
      .pipe(map((response) => this.requireData(response, 'Unable to switch branch')));
  }

  acceptTokenPair(tokens: AuthTokenPair, branch?: AuthBranchAccess): void {
    const claims = this.tokenClaims(tokens.access_token);
    if (!claims?.tenant_id || claims.token_type !== 'access') {
      throw new Error('Invalid access token');
    }

    const previousBranchId = this.branchId;
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    localStorage.setItem(TENANT_ID_KEY, claims.tenant_id);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.setItem(MUST_CHANGE_PASSWORD_KEY, String(tokens.must_change_password === true));

    if (claims.branch_id) {
      localStorage.setItem(BRANCH_ID_KEY, claims.branch_id);
    } else {
      localStorage.removeItem(BRANCH_ID_KEY);
    }

    if (branch && branch.branchId === claims.branch_id) {
      localStorage.setItem(BRANCH_NAME_KEY, branch.branchName);
    } else if (previousBranchId !== claims.branch_id) {
      localStorage.removeItem(BRANCH_NAME_KEY);
    }
  }

  hasValidAccessToken(): boolean {
    const token = this.accessToken;
    if (!token) return false;
    const claims = this.tokenClaims(token);
    return Boolean(
      claims?.tenant_id
      && claims.token_type === 'access'
      && Number(claims.exp ?? 0) * 1000 > Date.now(),
    );
  }

  ensureSession(): Observable<boolean> {
    if (this.hasValidAccessToken()) return of(true);

    this.clearAccessScope();
    return this.refreshAccessToken().pipe(
      map(() => true),
      catchError(() => this.tryLocalDevSession()),
    );
  }

  refreshAccessToken(): Observable<string> {
    if (!this.refreshRequest$) {
      this.refreshRequest$ = this.http
        .post<AuthApiEnvelope<AuthTokenPair>>(
          `${environment.apiBaseUrl}/auth/refresh`,
          { deviceId: authDeviceId() },
          { withCredentials: true },
        )
        .pipe(
          map((response) => this.requireData(response, 'Session refresh failed')),
          tap((tokens) => this.acceptTokenPair(tokens)),
          map((tokens) => tokens.access_token),
          finalize(() => {
            this.refreshRequest$ = undefined;
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.refreshRequest$;
  }

  hydrateCurrentBranchName(): Observable<void> {
    if (!this.accessToken || !this.branchId) return of(undefined);
    return this.loadProfile().pipe(
        tap((profile) => {
          const branch = profile.branches.find((item) => item.branchId === profile.branchId);
          if (branch) localStorage.setItem(BRANCH_NAME_KEY, branch.branchName);
        }),
        map(() => undefined),
      );
  }

  loadProfile(): Observable<AuthProfile> {
    return this.http
      .get<AuthApiEnvelope<AuthProfile>>(`${environment.apiBaseUrl}/auth/me`, {
        withCredentials: true,
      })
      .pipe(map((response) => this.requireData(response, 'Unable to load session')));
  }

  changePassword(newPassword: string): Observable<void> {
    return this.http
      .post<AuthApiEnvelope<{ passwordChanged: boolean; reauthenticationRequired: boolean }>>(
        `${environment.apiBaseUrl}/auth/change-password`,
        { newPassword },
        { withCredentials: true },
      )
      .pipe(
        map((response) => this.requireData(response, 'Unable to change password')),
        tap(() => this.clearSession(true)),
        map(() => undefined),
      );
  }

  logout(): Observable<void> {
    return this.http
      .post<AuthApiEnvelope<{ revoked: boolean }>>(
        `${environment.apiBaseUrl}/auth/logout`,
        {},
        { withCredentials: true },
      )
      .pipe(
        catchError(() => of(null)),
        tap(() => this.clearSession(true)),
        map(() => undefined),
      );
  }

  clearSession(preserveTenantContext = false): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    if (!preserveTenantContext) localStorage.removeItem(TENANT_ID_KEY);
    localStorage.removeItem(BRANCH_ID_KEY);
    localStorage.removeItem(BRANCH_NAME_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  }

  private clearAccessScope(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(BRANCH_ID_KEY);
    localStorage.removeItem(BRANCH_NAME_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  }

  private tryLocalDevSession(): Observable<boolean> {
    const devSecret = (localStorage.getItem('aurashine_dev_session_secret') || '').trim();
    const devSessionEnabled = environment.enableLocalDevSession
      || localStorage.getItem('aurashine_enable_dev_session') === 'true';
    const localHost = ['127.0.0.1', 'localhost'].includes(location.hostname);
    if (environment.production || !devSessionEnabled || !localHost || !devSecret) {
      return of(false);
    }

    return this.http
      .post<AuthApiEnvelope<AuthTokenPair>>(
        `${environment.apiBaseUrl}/auth/dev-session`,
        {},
        { headers: new HttpHeaders({ 'x-dev-session-secret': devSecret }) },
      )
      .pipe(
        map((response) => this.requireData(response, 'Local session failed')),
        tap((tokens) => this.acceptTokenPair(tokens)),
        map(() => true),
        catchError(() => of(false)),
      );
  }

  private requireData<T>(response: AuthApiEnvelope<T>, fallback: string): T {
    if (response.success && response.data) return response.data;
    throw new Error(response.error?.message || fallback);
  }

  private tokenClaims(token: string): AccessClaims | null {
    try {
      const segment = token.split('.')[1] ?? '';
      const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(atob(padded)) as AccessClaims;
    } catch {
      return null;
    }
  }
}
