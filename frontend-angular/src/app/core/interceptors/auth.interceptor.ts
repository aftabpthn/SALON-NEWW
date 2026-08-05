import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authDeviceId, AuthService } from '../services/auth.service';
import { BillingStateService } from '../services/billing-state.service';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isCoreApiRequest(request.url)) return next(request);

  const auth = inject(AuthService);
  const router = inject(Router);
  const billing = inject(BillingStateService);
  const contextualRequest = withRequestContext(request);
  const authenticatedRequest = withSession(contextualRequest, auth);

  return next(authenticatedRequest).pipe(
    tap((event) => {
      // A write that goes through is the only thing that proves the block is
      // gone. Payment completes on the provider's site, so there is no callback
      // to listen for and no point polling for one.
      if (event instanceof HttpResponse && WRITE_METHODS.includes(request.method)) billing.clear();
    }),
    catchError((error: HttpErrorResponse) => {
      const block = subscriptionBlock(error);
      if (block) billing.report(block);
      if (error.status !== 401 || isSessionEndpoint(request.url)) {
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap(() => next(withSession(contextualRequest, auth))),
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

/**
 * Reads a refusal the backend attributed to the subscription.
 *
 * `entitlement_service` is the only thing that answers with a
 * `subscriptionStatus` detail, so its presence is what identifies these — not
 * the status code, which 403 shares with ordinary permission denials.
 */
function subscriptionBlock(error: HttpErrorResponse): { status: string; readOnly: boolean; message: string } | null {
  if (error.status !== 403) return null;
  const details = error.error?.error?.details;
  const status = typeof details?.subscriptionStatus === 'string' ? details.subscriptionStatus : '';
  if (!status) return null;
  return {
    status,
    readOnly: details?.readOnly === true,
    message: typeof error.error?.error?.message === 'string' ? error.error.error.message : '',
  };
}

function withRequestContext(request: HttpRequest<unknown>): HttpRequest<unknown> {
  let headers = request.headers;
  if (!headers.has('x-device-id')) headers = headers.set('x-device-id', authDeviceId());
  if (!headers.has('x-request-id')) headers = headers.set('x-request-id', crypto.randomUUID());
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !headers.has('Idempotency-Key')) {
    const bodyKey = request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>)['idempotencyKey']
      : undefined;
    headers = headers.set('Idempotency-Key', typeof bodyKey === 'string' && bodyKey.trim() ? bodyKey.trim() : crypto.randomUUID());
  }
  return request.clone({ headers });
}

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
