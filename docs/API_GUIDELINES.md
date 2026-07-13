# API_GUIDELINES.md — API Design Standards

> **Primary AI Role:** API Architect
> **Status:** Living document. Public/partner API specifics: `docs/integrations-api.md`.

## 1. Purpose

Standards every AuraShine HTTP endpoint follows: URLs, envelopes, errors,
versioning, pagination, headers and realtime conventions.

## 2. Surface

- First-party SPA endpoints: `/api/<area>/...` (e.g. `/api/saas/context`, `/api/ai/chatbot`, `/api/super-admin/overview`).
- Mobile/public versioned endpoints: `/api/v1/...` — **stable contract**; breaking changes only in a new version.
- Health: `GET /api/health` (and `/health` on the backend port).

## 3. Conventions

- **Nouns, plural, kebab-case** paths: `/api/saas/domain-mappings/:id/verify`.
- Methods: GET (read, no side effects), POST (create/action), PATCH (partial update), DELETE (protected, permission-gated).
- Route files in `backend-rust/src/routes`, registered in `backend-rust/src/routes/mod.rs`.
- Validation at the boundary through typed request models and handler-level checks; unknown fields are rejected or validated explicitly.

## 4. Request Headers

| Header | Purpose |
| --- | --- |
| `Authorization: Bearer <jwt>` | Authentication (refresh-token flow for renewal) |
| `x-tenant-id` | Tenant context (validated server-side, never trusted alone) |
| `x-branch-id` | Branch context (role-constrained server-side) |
| `x-user-role` | Role hint; `superAdmin` required for `/api/super-admin/*` |

## 5. Response Envelope

Every JSON response uses the standard envelope:

```json
// success
{ "success": true, "data": { ... }, "meta": { "page": 1, "pageSize": 50, "total": 1234 } }

// error
{ "success": false, "error": { "code": "INVOICE_OVERPAID", "message": "Payment exceeds invoice total", "details": { } } }
```

- `meta` appears on paginated lists; omit when not applicable.
- `error.code` is a stable, SCREAMING_SNAKE machine code; `message` is human-readable and safe (no stack traces, no SQL, no secrets).
- HTTP status mirrors the class: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict/idempotency, 422 business-rule rejection, 429 rate-limited, 500 unexpected (logged with requestId).

## 6. Money, Dates, IDs

- Money fields are **integer paise** and named with the `Paise` suffix (`totalPaise`, `paidPaise`). Clients format to rupees.
- Timestamps ISO-8601; business dates `YYYY-MM-DD` in IST.
- IDs are opaque strings; never expose auto-increment integers as public contract.

## 7. Pagination, Filtering, Sorting

- Lists paginate by default: `?page=1&pageSize=50` (max page size documented per endpoint) + `meta.total`.
- Filters are explicit query params; free-text search uses `?q=`.
- Sorting: `?sort=createdAt&order=desc` from a whitelisted field set.

## 8. Idempotency & Safety

- Webhook handlers and payment/settlement actions deduplicate by event/reference id — replays are 200-no-op or 409, never double writes.
- Mutations that matter are permission-mapped (docs/permissions.md) and audit-logged (docs/audit-log.md).
- Rate limits on all routes; stricter on auth/OTP.

## 9. Realtime (WebSocket)

- Events broadcast into tenant-scoped channels after commit: bookings, dashboards, staff status, notifications, front-desk queue.
- Event payloads carry the same field conventions as REST (`Paise`, ISO dates) plus event `type` and entity ids — enough to refetch, not full documents.

## 10. AI Instructions

- Copy an existing route file in the same area as your template; keep envelope, validation and permission patterns identical.
- Never return raw errors or leak internals in `message`.
- Extend `/api/v1` only additively; anything breaking goes to a design discussion first.

## 11. Acceptance Criteria

- `cargo test` (backend) and focused feature verification passes.
- Every endpoint: validated input, permission mapping, tenant scoping, envelope response.
- No breaking change lands on `/api/v1` without a version bump.

## 12. Future Roadmap

- OpenAPI spec generation for `/api/v1`.
- Postman collection kept in sync per release.

## 13. REST Standards and Versioning

- `/api/v1` is the stable versioned contract.
- Legacy `/api` compatibility remains where existing clients need it.
- New public contracts prefer `/api/v1`.
- Breaking response or request changes require a new version or explicit
  compatibility adapter.

## 14. Request, Response, and Error Catalog

Request bodies are JSON unless the endpoint is explicitly upload/download.
Responses always use the envelope from §5.

Standard error codes:

| Code | Meaning |
| --- | --- |
| `VALIDATION_FAILED` | Payload or query shape is invalid |
| `UNAUTHENTICATED` | Missing or invalid token |
| `FORBIDDEN` | Authenticated but permission denied |
| `NOT_FOUND` | Resource not visible in current tenant/branch scope |
| `CONFLICT` | Duplicate/idempotency/business conflict |
| `RATE_LIMITED` | Request budget exceeded |
| `INTERNAL_ERROR` | Unexpected server error; request id logged |

## 15. Pagination, Filtering, Search, and Sorting Examples

```text
GET /api/v1/clients?page=1&pageSize=50&q=anita&sort=createdAt&order=desc
GET /api/v1/invoices?from=2026-07-01&to=2026-07-31&status=paid
GET /api/v1/inventory/products?category=retail&lowStock=true
```

All filter and sort fields are whitelisted server-side before SQL.

## 16. Bulk, Upload, Download, and Webhook APIs

- Bulk APIs validate every row, return per-row results, and are idempotent by
  import/batch id.
- Upload APIs enforce size/type/ownership and store metadata in tenant-scoped
  tables.
- Download APIs require permission checks and audit protected exports.
- Webhooks verify signatures, dedupe provider event ids, and return safe no-op
  responses for replays.

## 17. OpenAPI Standards

OpenAPI descriptions should include auth headers, tenant/branch headers, request
schema, response envelope, error codes, pagination metadata, and example payloads
with paise money values.

## 18. API Checklist

- Route exists under the right version.
- Auth and RBAC enforced.
- Tenant and branch scoped.
- Validator present.
- Envelope response.
- Stable error codes.
- Pagination for lists.
- Audit log for protected mutations.
- Idempotency for payments, webhooks, imports, and schedulers.
