import { env } from "../config/env.js";

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

function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: env.refreshCookieSameSite,
    path: "/",
    maxAge: maxAgeSeconds * 1000
  };
}

export function publicAuthSession(result) {
  if (env.allowRefreshTokenInResponse && !result?.user?.staffId) return result;
  const { refreshToken: _refreshToken, ...safeResult } = result;
  return safeResult;
}

export function setAuthRefreshCookie(res, result) {
  if (result?.refreshToken) {
    res.cookie(env.refreshCookieName, result.refreshToken, cookieOptions(env.jwtRefreshTtlDays * 24 * 60 * 60));
  }
}

export function clearAuthRefreshCookie(res) {
  res.clearCookie(env.refreshCookieName, cookieOptions(0));
}

export function refreshTokenRequest(req) {
  const cookieToken = parseCookies(req)[env.refreshCookieName] || "";
  if (cookieToken) return { token: cookieToken, fromCookie: true };
  return {
    token: env.allowLegacyRefreshTokenBody ? String(req.body?.refreshToken || "") : "",
    fromCookie: false
  };
}
