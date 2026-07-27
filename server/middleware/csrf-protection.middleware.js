import { env } from "../config/env.js";
import { csrfCookieName, verifyCsrfToken } from "../services/csrf-token.service.js";
import { forbidden } from "../utils/app-error.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_BOOTSTRAP_PATHS = new Set([
  "/auth/login",
  "/auth/secure-login",
  "/auth/secure-login/verify",
  "/auth/refresh",
  "/auth/logout",
  "/customer/auth/request-email-code",
  "/customer/auth/verify-email-code",
  "/customer/auth/request-otp",
  "/customer/auth/verify-otp",
  "/customer/auth/firebase",
  "/customer/auth/refresh",
  "/customer/auth/logout"
]);

function normalizedPath(req) {
  return String(req.path || "").replace(/^\/api\/v1/, "").replace(/^\/api/, "");
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const equalsAt = part.indexOf("=");
        const key = equalsAt >= 0 ? part.slice(0, equalsAt) : part;
        const value = equalsAt >= 0 ? part.slice(equalsAt + 1) : "";
        return [decodeURIComponent(key), decodeURIComponent(value)];
      })
  );
}

function hasCookieAuth(cookies) {
  return Boolean(cookies[env.refreshCookieName] || cookies.aura_refresh || cookies["__Host-aura_refresh"]);
}

function hasBearerAuth(req) {
  // Accept both standard Authorization: Bearer and the mobile x-auth-token header.
  // This must stay in sync with bearerToken() in server/middleware/auth.js.
  if (/^Bearer\s+\S+$/i.test(String(req.get("authorization") || ""))) return true;
  if (req.get("x-auth-token")) return true;
  return false;
}

export function csrfProtection(req, _res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  if (AUTH_BOOTSTRAP_PATHS.has(normalizedPath(req))) {
    next();
    return;
  }

  if (hasBearerAuth(req)) {
    next();
    return;
  }

  const cookies = parseCookies(req);
  if (!hasCookieAuth(cookies)) {
    next();
    return;
  }

  const csrfToken = req.get("x-csrf-token") || "";
  if (!verifyCsrfToken(csrfToken, cookies[csrfCookieName])) {
    next(forbidden("CSRF token is required for cookie-authenticated requests"));
    return;
  }
  next();
}
