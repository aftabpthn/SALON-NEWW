import { randomUUID } from "node:crypto";
import { env } from "../../server/config/env.js";
import { authService } from "../../server/services/auth.service.js";

const originalFetch = globalThis.fetch;
const tokenCache = new Map();
const commonBranchIds = ["branch_hyd", "branch_blr", "branch_aura", "branch_bandra", "branch_pune", "branch_test"];
const publicApiPrefixes = [
  "/api/v1/auth/",
  "/api/auth/",
  "/api/v1/customers/auth/",
  "/api/customers/auth/",
  "/health",
  "/api/health",
  "/api/v1/health"
];

function headerValue(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase()) || "";
}

function normalizedUrl(input) {
  const url = input instanceof Request ? input.url : String(input || "");
  try {
    return new URL(url, "http://127.0.0.1");
  } catch {
    return null;
  }
}

function shouldAttachAuth(url, headers) {
  if (!url || !url.pathname.startsWith("/api")) return false;
  if (headerValue(headers, "authorization")) return false;
  if (!headerValue(headers, "x-user-role")) return false;
  return !publicApiPrefixes.some((prefix) => url.pathname.startsWith(prefix));
}

function tokenFor(headers) {
  const tenantId = headerValue(headers, "x-tenant-id") || "tenant_aura";
  const role = headerValue(headers, "x-user-role") || "owner";
  const requestedBranchId = headerValue(headers, "x-branch-id");
  const branchIds = Array.from(new Set([requestedBranchId, ...commonBranchIds].filter(Boolean)));
  const cacheKey = `${tenantId}:${role}:${requestedBranchId}`;
  if (!tokenCache.has(cacheKey)) {
    tokenCache.set(cacheKey, authService.signJwt({
      iss: "aura-salon-api",
      aud: "aura-mobile",
      typ: "access",
      sub: `test_${role}`,
      tenantId,
      email: `${role}@tests.aurashine.local`,
      loginId: `test_${role}`,
      role,
      staffId: role === "staff" ? "staff_test" : "",
      branchId: requestedBranchId,
      branchIds,
      deviceId: "test-suite",
      jti: `test_jwt_${randomUUID()}`
    }, env.jwtAccessTtlSeconds));
  }
  return tokenCache.get(cacheKey);
}

if (typeof originalFetch === "function") {
  globalThis.fetch = function authenticatedFetch(input, init = undefined) {
    const sourceHeaders = init?.headers || (input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders || {});
    const url = normalizedUrl(input);
    if (shouldAttachAuth(url, headers)) {
      headers.set("authorization", `Bearer ${tokenFor(headers)}`);
    }
    if (input instanceof Request) {
      return originalFetch(new Request(input, { ...init, headers }));
    }
    return originalFetch(input, init ? { ...init, headers } : { headers });
  };
}
