import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isCoreApiRequest(request.url)) return next(request);

  const auth = inject(AuthService);
  const router = inject(Router);
  const authenticatedRequest = withSession(request, auth);

  return next(authenticatedRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401 || isSessionEndpoint(request.url)) {
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap(() => next(withSession(request, auth))),
        catchError((refreshError) => {
          auth.clearSession(true);
          void router.navigate(['/login'], {
            queryParams: { returnUrl: router.url },
            replaceUrl: true,
          });
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};

function withSession(request: HttpRequest<unknown>, auth: AuthService): HttpRequest<unknown> {
  let headers: HttpHeaders = request.headers;
  const token = auth.accessToken;
  const tenantId = auth.tenantId;
  const branchId = auth.branchId;

  if (token && !headers.has('Authorization')) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }
  if (tenantId && !headers.has('x-tenant-id')) {
    headers = headers.set('x-tenant-id', tenantId);
  }
  if (branchId && !headers.has('x-branch-id')) {
    headers = headers.set('x-branch-id', branchId);
  }

  return request.clone({ headers, withCredentials: true });
}

function isSessionEndpoint(url: string): boolean {
  return ['/auth/login', '/auth/webauthn/login', '/auth/select-branch', '/auth/switch-branch', '/auth/refresh', '/auth/dev-session', '/auth/mfa/enable', '/auth/mfa/disable']
    .some((path) => url.includes(path));
}

function isCoreApiRequest(url: string): boolean {
  if (url.startsWith('/api/') || url.startsWith('api/')) return true;
  const apiBase = environment.apiBaseUrl.replace(/\/+$/, '');
  return Boolean(apiBase && url.startsWith(apiBase));
}
