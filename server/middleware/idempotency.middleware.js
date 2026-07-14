import { createHash } from "node:crypto";
import { db } from "../db.js";
import { canonicalJson } from "../utils/canonical-json.js";

export const IDEMPOTENT_REQUIRED = new Set([
  "POST /api/appointments",
  "POST /api/v1/appointments",
  "POST /api/slot-holds",
  "POST /api/v1/slot-holds",
  "POST /api/bills",
  "POST /api/v1/bills",
  "POST /api/payments",
  "POST /api/v1/payments",
  "POST /api/refunds",
  "POST /api/v1/refunds",
  "POST /api/booking-portal/confirm",
  "POST /api/v1/booking-portal/confirm",
  "POST /api/booking-portal/v2/confirm",
  "POST /api/v1/booking-portal/v2/confirm",
  "POST /api/booking-payments/payment-link/create",
  "POST /api/v1/booking-payments/payment-link/create",
  "POST /api/online-booking/confirm",
  "POST /api/v1/online-booking/confirm",
  "POST /api/staff-os/attendance/clock-in",
  "POST /api/v1/staff-os/attendance/clock-in",
  "POST /api/staff-os/attendance/clock-out",
  "POST /api/v1/staff-os/attendance/clock-out",
  "POST /api/staff-os/attendance/break-start",
  "POST /api/v1/staff-os/attendance/break-start",
  "POST /api/staff-os/attendance/break-end",
  "POST /api/v1/staff-os/attendance/break-end",
  "POST /api/staff-os/attendance/correction",
  "POST /api/v1/staff-os/attendance/correction",
  "POST /api/staff-os/tasks",
  "POST /api/v1/staff-os/tasks",
  "POST /api/staff-self/chat/messages",
  "POST /api/v1/staff-self/chat/messages",
  "POST /api/staff-enterprise/training/assign",
  "POST /api/v1/staff-enterprise/training/assign",
  "POST /api/staff-enterprise/approval-request",
  "POST /api/v1/staff-enterprise/approval-request",
  "POST /api/staff-enterprise/approve",
  "POST /api/v1/staff-enterprise/approve",
  "POST /api/staff-enterprise/reject",
  "POST /api/v1/staff-enterprise/reject",
  "POST /api/staff-enterprise/audit-event",
  "POST /api/v1/staff-enterprise/audit-event"
]);

function hashPayload(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function ttl() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function shouldHandle(req) {
  if (req.method !== "POST") return false;
  if (/\/api\/(health|auth|v1\/health)/.test(req.originalUrl)) return false;
  if (/\/realtime\/ticket(?:\?|$)/.test(req.originalUrl)) return false;
  return Boolean(req.get("Idempotency-Key"));
}

function endpointKey(req) {
  return `${req.method} ${String(req.originalUrl || req.path).split("?")[0]}`;
}

export function idempotencyMiddleware(req, res, next) {
  if (req.method !== "POST") return next();
  const key = req.get("Idempotency-Key") || "";
  const requiredKey = endpointKey(req);
  if (!key && IDEMPOTENT_REQUIRED.has(requiredKey)) {
    res.status(400).json({ error: "Idempotency-Key header required", status: 400, requestId: req.requestId });
    return;
  }
  if (!shouldHandle(req)) return next();

  const tenantId = req.access?.tenantId || req.get("x-tenant-id") || "";
  const endpoint = endpointKey(req);
  const requestHash = hashPayload(req.body);
  const existing = db
    .prepare("SELECT * FROM idempotency_keys WHERE key = @key AND tenantId = @tenantId AND endpoint = @endpoint AND expiresAt > @now")
    .get({ key, tenantId, endpoint, now: new Date().toISOString() });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      res.status(422).json({ error: "Idempotency-Key reused with different payload", status: 422, requestId: req.requestId });
      return;
    }
    res.setHeader("x-idempotency-replayed", "true");
    const body = existing.responseBody ? JSON.parse(existing.responseBody) : {};
    res.status(existing.responseStatus || 200).json(body);
    return;
  }

  let responseBody = "";
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body) => {
    responseBody = JSON.stringify(body ?? {});
    return originalJson(body);
  };
  res.send = (body) => {
    if (!responseBody) responseBody = typeof body === "string" ? body : JSON.stringify(body ?? {});
    return originalSend(body);
  };

  res.on("finish", () => {
    if (res.statusCode >= 500) return;
    db.prepare(
      `INSERT OR REPLACE INTO idempotency_keys
       (key, tenantId, endpoint, requestHash, responseStatus, responseBody, expiresAt)
       VALUES (@key, @tenantId, @endpoint, @requestHash, @responseStatus, @responseBody, @expiresAt)`
    ).run({ key, tenantId, endpoint, requestHash, responseStatus: res.statusCode, responseBody: responseBody || "{}", expiresAt: ttl() });
  });

  next();
}

export function requireIdempotencyKey(req, res, next) {
  if (!req.get("Idempotency-Key")) {
    res.status(400).json({ error: "Idempotency-Key header required", status: 400, requestId: req.requestId });
    return;
  }
  idempotencyMiddleware(req, res, next);
}

export function cleanupIdempotencyKeys() {
  return db.prepare("DELETE FROM idempotency_keys WHERE expiresAt < @now").run({ now: new Date().toISOString() }).changes || 0;
}
