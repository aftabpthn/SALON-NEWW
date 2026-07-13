# ERROR_HANDLING.md — Error Handling Standards

> **Primary AI Role:** Backend Architect
> **Status:** Living document. Logging rules: `docs/logging.md`.

## 1. Purpose

One consistent way to raise, translate, log and present errors across the
Rust/Axum backend, background workers and the Angular SPA.

## 2. Error Taxonomy

| Class | HTTP | Behaviour |
| --- | --- | --- |
| Validation error (bad payload shape) | 400 | Rejected at the boundary by typed request validation in `backend-rust/src/routes`; field detail in `error.details` |
| Unauthenticated | 401 | Missing/expired JWT; client triggers refresh-token flow once, then re-login |
| Forbidden | 403 | RBAC/permission or branch-scope denial; logged for audit patterns |
| Not found (in tenant scope) | 404 | Row absent *within the caller’s tenant* — cross-tenant rows are 404, never 403 (no existence leak) |
| Conflict / idempotency | 409 | Duplicate webhook/event id, version clash, unique-key violation translated to a business message |
| Business-rule rejection | 422 | Typed rejections: `INVOICE_OVERPAID`, `STOCK_INSUFFICIENT`, `SESSION_BALANCE_EXCEEDED`, `PLAN_LIMIT_REACHED`, … |
| Rate limited | 429 | Standard limiter response with retry hint |
| Unexpected | 500 | Generic message + `requestId`; full detail only in server logs |

All errors leave the API in the standard envelope (`API_GUIDELINES.md §5`) with a
stable SCREAMING_SNAKE `error.code`. New codes are added to this document’s table.

## 3. Backend Rules

1. **Throw typed errors in services**, translate once in a central error middleware — routes never build error responses by hand.
2. **Fail the transaction, not half of it.** Any error inside a PostgreSQL transaction (`sqlx` transaction scope) aborts the write batch; partial state is impossible by construction.
3. **Log once**, at the handling layer, with stack + context + `requestId` — never log-and-rethrow at every level.
4. **Never swallow.** An empty `catch` is a defect; degraded paths (AI down, provider down) must record the failure and follow their documented fallback.
5. **External calls** (WhatsApp, Razorpay, ml-service, SMTP) wrap timeout + retry policy; their failures map to 502-class typed errors and never crash billing/booking flows.
6. **Workers/schedulers** catch per-item: one poison message never kills the queue; failures are persisted with status for retry (docs/notifications.md pattern).
7. **No leaking internals:** messages never contain SQL, stack traces, file paths or secrets.

## 4. Frontend Rules

- A shared API service interprets the envelope: 401 → token refresh → retry once; 403 → friendly “no permission” state; 422 → show `error.message` inline near the action; 5xx → toast + `requestId` for support.
- The global Angular error boundary catches render-time errors — a broken widget never blanks the whole page.
- Optimistic updates (calendar drag, POS cart) roll back visibly on failure with the reason shown.
- Offline flows queue writes and surface sync conflicts explicitly rather than dropping them.

## 5. AI Instructions

- Reuse existing error codes before inventing one; register any new code in §2 in the same change.
- Never convert a typed business rejection into a 500, and never “fix” a failing flow by catching and ignoring.
- Tests assert error codes, not message strings (messages may be reworded).

## 6. Acceptance Criteria

- Every route’s failure paths return enveloped, coded errors — verified by validation/permission tests per feature (TESTING.md §4).
- No raw stack trace or internal detail ever reaches a client.
- Grep for empty catch blocks stays clean.

## 7. Future Roadmap

- Error-code catalogue auto-extracted into the API docs.
- Client-side error telemetry rollup into OBSERVABILITY.md dashboards.
