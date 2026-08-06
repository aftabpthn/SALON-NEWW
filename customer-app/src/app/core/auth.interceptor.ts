import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, from, switchMap, throwError } from "rxjs";

const ACCESS_TOKEN_KEY = "auraCustomerAccessToken";
const REFRESH_TOKEN_KEY = "auraCustomerRefreshToken";
const API_ORIGIN_KEY = "auraCustomerApiOrigin";
const DEVICE_ID_KEY = "auraCustomerDeviceId";
const LAST_ROUTE_KEY = "auraCustomerLastRoute";
const SESSION_RETRY_HEADER = "x-aura-session-retry";
const SALON_MODE_KEY = "aura_salon_mode";
const SALON_MODE_CONTEXT_KEY = "aura_salon_mode_context";

// Events let AuthService keep its in-memory signals in sync with token changes the
// interceptor makes directly in localStorage, without creating an HttpClient → AuthService
// dependency cycle.
export const SESSION_REFRESHED_EVENT = "aura-session-refreshed";
export const SESSION_EXPIRED_EVENT = "aura-session-expired";

type CustomerSessionRefresh = {
  accessToken: string;
  refreshToken?: string;
};

class SessionRefreshError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let refreshInFlight: Promise<CustomerSessionRefresh> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  let token: string | null = null;
  try {
    token = localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    token = null;
  }

  const isCustomerRequest = req.url.includes("/customer/");
  const isCustomerAuthRequest = req.url.includes("/customer/auth/");
  const shouldAttachToken = !!token && isCustomerRequest && !isCustomerAuthRequest;
  const request = isCustomerAuthRequest ? req : withCustomerHeaders(req, shouldAttachToken ? token : null);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && isCustomerRequest) {
        if (error.status === 401 && shouldAttachToken && !req.headers.has(SESSION_RETRY_HEADER)) {
          return from(refreshCustomerSessionOnce(req.url)).pipe(
            switchMap((session) => {
              saveCustomerSession(session, req.url);
              return next(withCustomerHeaders(req, session.accessToken, true));
            }),
            catchError((refreshError: unknown) => {
              if (isPermanentAuthFailure(refreshError)) {
                expireCustomerSession();
                void router.navigateByUrl("/login");
                return throwError(() => new Error("Your session expired. Please sign in again."));
              }
              return throwError(() => new Error("Could not reconnect to your session. Please check your connection and retry."));
            })
          );
        }
        const message = friendlyMessage(error);
        return throwError(() => new Error(message));
      }
      return throwError(() => error);
    })
  );
};

function withCustomerHeaders(req: Parameters<HttpInterceptorFn>[0], accessToken: string | null, retried = false) {
  const salonHeaders = salonModeHeaders();
  const setHeaders = {
    ...salonHeaders,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(retried ? { [SESSION_RETRY_HEADER]: "1" } : {})
  };
  return Object.keys(setHeaders).length ? req.clone({ setHeaders }) : req;
}

function salonModeHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SALON_MODE_CONTEXT_KEY);
    if (!raw) return {};
    const context = JSON.parse(raw) as { tenantId?: string; branchId?: string };
    return context.tenantId && context.branchId
      ? { "x-tenant-id": context.tenantId, "x-branch-id": context.branchId, "x-user-role": "customer" }
      : {};
  } catch {
    return {};
  }
}

function refreshCustomerSessionOnce(requestUrl: string): Promise<CustomerSessionRefresh> {
  if (!refreshInFlight) {
    refreshInFlight = refreshCustomerSession(requestUrl).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function refreshCustomerSession(requestUrl: string): Promise<CustomerSessionRefresh> {
  const refreshToken = getStoredValue(REFRESH_TOKEN_KEY);
  if (!refreshToken) throw new SessionRefreshError("Missing refresh token", 401);

  const response = await fetch(refreshUrlFor(requestUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      refreshToken,
      device: deviceInfo()
    })
  });
  const payload = await readJson(response);
  const session = payload?.data || payload;
  if (!response.ok || !session?.accessToken) {
    throw new SessionRefreshError(refreshErrorMessage(payload), response.status);
  }
  return {
    accessToken: String(session.accessToken),
    refreshToken: session.refreshToken ? String(session.refreshToken) : undefined
  };
}

function isPermanentRefreshFailure(error: unknown): boolean {
  return error instanceof SessionRefreshError && [400, 401, 403].includes(error.status);
}

function isPermanentAuthFailure(error: unknown): boolean {
  return isPermanentRefreshFailure(error) || (error instanceof HttpErrorResponse && [401, 403].includes(error.status));
}

function refreshUrlFor(requestUrl: string): string {
  const marker = "/customer/";
  const index = requestUrl.indexOf(marker);
  if (index >= 0) return `${requestUrl.slice(0, index)}${marker}auth/refresh`;
  try {
    return new URL("/api/v1/customer/auth/refresh", requestUrl).toString();
  } catch {
    return "/api/v1/customer/auth/refresh";
  }
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function refreshErrorMessage(payload: any): string {
  const apiError = payload?.error;
  if (typeof apiError === "string") return apiError;
  if (typeof apiError?.message === "string") return apiError.message;
  if (typeof payload?.message === "string") return payload.message;
  return "Refresh failed";
}

function saveCustomerSession(session: CustomerSessionRefresh, requestUrl: string) {
  setStoredValue(ACCESS_TOKEN_KEY, session.accessToken);
  if (session.refreshToken) setStoredValue(REFRESH_TOKEN_KEY, session.refreshToken);
  setStoredValue(API_ORIGIN_KEY, apiOrigin(requestUrl));
  dispatchSessionEvent(SESSION_REFRESHED_EVENT);
}

function expireCustomerSession() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(API_ORIGIN_KEY);
    localStorage.removeItem(LAST_ROUTE_KEY);
    localStorage.removeItem(SALON_MODE_KEY);
    localStorage.removeItem(SALON_MODE_CONTEXT_KEY);
  } catch {
    // Storage may be unavailable; the event below still resets in-memory state.
  }
  dispatchSessionEvent(SESSION_EXPIRED_EVENT);
}

function dispatchSessionEvent(name: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(name));
  }
}

function apiOrigin(requestUrl: string): string {
  try {
    return new URL(requestUrl, window.location.origin).origin;
  } catch {
    return "";
  }
}

function deviceInfo() {
  return {
    deviceId: ensureDeviceId(),
    deviceName: "Customer web browser",
    platform: "web",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : ""
  };
}

function ensureDeviceId(): string {
  const existing = getStoredValue(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `web_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  setStoredValue(DEVICE_ID_KEY, generated);
  return generated;
}

function getStoredValue(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function setStoredValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private or embedded browser contexts.
  }
}

function friendlyMessage(error: HttpErrorResponse): string {
  const apiError = error.error?.error;
  const apiMessage = typeof apiError === "string"
    ? apiError
    : apiError?.message || error.error?.message;
  if (error.status === 401) return apiMessage ? String(apiMessage) : "We could not verify this secure session. Please try again.";
  if (error.status === 0) return "API unavailable. Check your connection and try again.";
  if (apiMessage) return String(apiMessage);
  if (error.status === 400) return "We could not verify those details. Please check and try again.";
  return "Something went wrong. Please try again.";
}
