import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, from, switchMap, throwError } from "rxjs";

const ACCESS_TOKEN_KEY = "auraCustomerAccessToken";
const REFRESH_TOKEN_KEY = "auraCustomerRefreshToken";
const DEVICE_ID_KEY = "auraCustomerDeviceId";
const SESSION_RETRY_HEADER = "x-aura-session-retry";

// Events let AuthService keep its in-memory signals in sync with token changes the
// interceptor makes directly in localStorage, without creating an HttpClient → AuthService
// dependency cycle.
export const SESSION_REFRESHED_EVENT = "aura-session-refreshed";
export const SESSION_EXPIRED_EVENT = "aura-session-expired";

type CustomerSessionRefresh = {
  accessToken: string;
  refreshToken?: string;
};

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
  const request = token && isCustomerRequest && !isCustomerAuthRequest
    ? withAccessToken(req, token)
    : req;

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && isCustomerRequest) {
        if (error.status === 401 && shouldAttachToken && !req.headers.has(SESSION_RETRY_HEADER)) {
          return from(refreshCustomerSessionOnce(req.url)).pipe(
            switchMap((session) => {
              saveCustomerSession(session);
              return next(withAccessToken(req, session.accessToken, true));
            }),
            catchError(() => {
              // Refresh failed: the session is genuinely expired. Clear it and send the
              // user to login so they are not stuck "authenticated" with a dead token.
              expireCustomerSession();
              void router.navigateByUrl("/login");
              return throwError(() => new Error("Your session expired. Please sign in again."));
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

function withAccessToken(req: Parameters<HttpInterceptorFn>[0], accessToken: string, retried = false) {
  return req.clone({
    setHeaders: {
      Authorization: `Bearer ${accessToken}`,
      ...(retried ? { [SESSION_RETRY_HEADER]: "1" } : {})
    }
  });
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
  if (!refreshToken) throw new Error("Missing refresh token");

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
    throw new Error(refreshErrorMessage(payload));
  }
  return {
    accessToken: String(session.accessToken),
    refreshToken: session.refreshToken ? String(session.refreshToken) : undefined
  };
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

function saveCustomerSession(session: CustomerSessionRefresh) {
  setStoredValue(ACCESS_TOKEN_KEY, session.accessToken);
  if (session.refreshToken) setStoredValue(REFRESH_TOKEN_KEY, session.refreshToken);
  dispatchSessionEvent(SESSION_REFRESHED_EVENT);
}

function expireCustomerSession() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
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
