import { AppError } from "../utils/app-error.js";
import { env } from "../config/env.js";
import { securityService } from "../services/security.service.js";

const windows = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = Math.max(60, Number(env.enterpriseRateLimitMax || 240));

function keyFor(req) {
  const tenantId = req.access?.tenantId || req.get?.("x-tenant-id") || "public";
  const branchId = req.access?.branchId || req.get?.("x-branch-id") || "";
  const userKey = req.access?.userId || req.get?.("x-user-role") || req.ip || "anonymous";
  return [tenantId, branchId, userKey, req.path.split("/").slice(0, 4).join("/")].join(":");
}

export function enterpriseSecurity(req, res, next) {
  const startedAt = Date.now();
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");

  const key = keyFor(req);
  const current = Date.now();
  const bucket = windows.get(key) || { count: 0, resetAt: current + WINDOW_MS };
  if (bucket.resetAt <= current) {
    bucket.count = 0;
    bucket.resetAt = current + WINDOW_MS;
  }
  bucket.count += 1;
  windows.set(key, bucket);
  res.setHeader("x-ratelimit-limit", String(MAX_REQUESTS));
  res.setHeader("x-ratelimit-remaining", String(Math.max(0, MAX_REQUESTS - bucket.count)));
  res.setHeader("x-ratelimit-reset", new Date(bucket.resetAt).toISOString());
  if (bucket.count > MAX_REQUESTS) {
    next(new AppError("Rate limit exceeded", 429, { resetAt: bucket.resetAt }));
    return;
  }

  res.on("finish", () => {
    securityService.recordActivity(req, res.statusCode, Date.now() - startedAt);
  });
  next();
}
