import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { readDevSessionResponse } from '../../core/services/dev-session-response';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('aurashine_access_token');
  if (!token) {
    return next(req);
  }

  const authReq = req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
      'x-tenant-id': localStorage.getItem('aurashine_tenant_id') || '',
      'x-branch-id': localStorage.getItem('aurashine_branch_id') || ''
    },
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (!isInvalidBearer(error) || !canUseLocalDevSession() || req.url.includes('/auth/dev-session')) {
        return throwError(() => error);
      }

      clearAuth();
      const devSecret = localStorage.getItem('aurashine_dev_session_secret') || '';
      return from(fetch('/api/v1/auth/dev-session', {
        method: 'POST',
        headers: { 'x-dev-session-secret': devSecret }
      }).then(readDevSessionResponse)).pipe(
        switchMap((result: any) => {
          const accessToken = result?.data?.access_token;
          const claims = tokenClaims(accessToken || '');
          if (!accessToken || !claims?.tenant_id || !claims?.branch_id) return throwError(() => error);

          localStorage.setItem('aurashine_access_token', accessToken);
          localStorage.setItem('aurashine_refresh_token', result.data.refresh_token || '');
          localStorage.setItem('aurashine_tenant_id', claims.tenant_id);
          localStorage.setItem('aurashine_branch_id', claims.branch_id);

          return next(req.clone({
            setHeaders: {
              Authorization: `Bearer ${accessToken}`,
              'x-tenant-id': claims.tenant_id,
              'x-branch-id': claims.branch_id
            },
          }));
        })
      );
    })
  );
};

function isInvalidBearer(error: HttpErrorResponse): boolean {
  const body = typeof error.error === 'string' ? error.error : error.error?.message ?? error.error?.error;
  return error.status === 401 && String(body || '').toLowerCase().includes('bearer token');
}

function canUseLocalDevSession(): boolean {
  return !environment.production
    && environment.enableLocalDevSession
    && ['127.0.0.1', 'localhost'].includes(location.hostname)
    && Boolean(localStorage.getItem('aurashine_dev_session_secret'));
}

function clearAuth(): void {
  localStorage.removeItem('aurashine_access_token');
  localStorage.removeItem('aurashine_refresh_token');
}

function tokenClaims(token: string): any | null {
  try {
    return JSON.parse(atob(token.split('.')[1] ?? ''));
  } catch {
    return null;
  }
}
