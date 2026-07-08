import { HttpBackend, HttpClient, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from "rxjs";
import { environment } from "../../environments/environment";

type CsrfPayload = { csrfToken: string; expiresAt: string };
type CsrfResponse = CsrfPayload | { success?: boolean; data?: CsrfPayload };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let csrfToken = "";
let csrfExpiresAt = 0;
let csrfRequest$: Observable<string> | null = null;

function isApiRequest(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl) || url.includes("/api/v1/");
}

function isCsrfEndpoint(url: string): boolean {
  return url.includes("/auth/csrf");
}

function unwrapCsrfResponse(response: CsrfResponse): CsrfPayload {
  if (response && "data" in response && response.data) return response.data;
  return response as CsrfPayload;
}

function currentToken(http: HttpClient): Observable<string> {
  if (csrfToken && csrfExpiresAt > Date.now() + 30_000) return of(csrfToken);
  if (!csrfRequest$) {
    csrfRequest$ = http.get<CsrfResponse>(`${environment.apiBaseUrl}/auth/csrf`, { withCredentials: true }).pipe(
      tap((response) => {
        const payload = unwrapCsrfResponse(response);
        csrfToken = payload.csrfToken || "";
        csrfExpiresAt = Date.parse(payload.expiresAt || "") || Date.now() + 10 * 60_000;
      }),
      map((response) => unwrapCsrfResponse(response).csrfToken || ""),
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        csrfToken = "";
        csrfExpiresAt = 0;
        return throwError(() => error);
      }),
      finalize(() => {
        csrfRequest$ = null;
      })
    );
  }
  return csrfRequest$;
}

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (!MUTATING_METHODS.has(req.method) || !isApiRequest(req.url) || isCsrfEndpoint(req.url)) {
    return next(req);
  }
  const http = new HttpClient(inject(HttpBackend));
  return currentToken(http).pipe(
    switchMap((token) => next(req.clone({
      withCredentials: true,
      setHeaders: token ? { "x-csrf-token": token } : {}
    })))
  );
};
