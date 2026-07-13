# POS Billing & Invoicing

> **Primary AI Role:** Backend Architect
> **Applies to:** AuraShine (Aura Salon CRM/POS) — Angular 20 + Express 5 (ESM) + SQLite (better-sqlite3)
> **Status:** Living document. Extend it — never rewrite or delete sections without approval (see AGENTS.md Delete Safety Rule).

## 1. Purpose

Define POS billing: carts, invoices, split payments, settlements, refunds, voids and the payment-truth model that reports rely on.

## 2. Scope

- Invoice creation with services, products, memberships and packages
- Split payments: cash / card / UPI / wallet
- Settlement preview, settlement recap and payment truth
- Refunds, voids, cancelled-invoice reporting
- Race-condition safety and tenant isolation

Out of scope for this document: anything covered by another domain doc — link to it instead of duplicating.

## 3. Responsibilities

- Money is integer paise end to end; rounding happens once, at display
- Invoice numbering is sequential per tenant+branch and gap-audited
- Concurrent billing on the same invoice/stock is serialized (better-sqlite3 transactions)

## 4. Architecture

- **Backend:** routes in `server/routes` → services in `server/services` → repositories in `server/repositories`. No SQL in routes or controllers.
- **Frontend:** Angular pages in `src/app/pages`, standalone components, services for API access.
- **Data:** SQLite via `better-sqlite3`, camelCase columns, **named parameters only**, every table carries `tenantId` + `branchId`.
- **Realtime:** WebSocket layer broadcasts relevant changes to connected sessions.
- **Protected files (never modify, only wrap):** `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`.

## 5. Standards

- Money is **integer paise** everywhere in storage and computation; format to rupees only at the display edge.
- Business dates are IST; timestamps stored as ISO strings.
- Multi-tenancy headers: `x-tenant-id`, `x-branch-id`, `x-user-role`; repositories enforce scope server-side regardless of headers.
- API responses use the standard envelope (see API_GUIDELINES.md); errors are typed, never raw stack traces.
- Add-only / wrapper pattern: enhance existing services with new functions; single registration line in `server/app.js`.

## 6. Workflow

1. Cart built → discounts + GST computed → invoice persisted in one transaction
2. Payments recorded as separate rows summing to invoice total (partial allowed)
3. Settlement recap generated → inventory deducted → commission and journal entries posted

## 7. Coding Rules

- ES Modules only on the backend; no TypeScript on the backend, no new databases or ORMs.
- One focused change per PR; no speculative refactors of untouched code.
- Multi-step writes wrap in a single better-sqlite3 transaction.
- New tables/columns arrive via sequential files in `server/migrations` (additive-first).

## 8. Security Rules

- Deny by default: every endpoint requires auth + permission mapping (docs/permissions.md).
- Validate all input at the route boundary (validators in `server/validators`).
- Never log secrets, tokens, OTPs or raw PII (docs/logging.md redaction list).
- Mutations that matter are audit-logged (docs/audit-log.md).

## 9. Performance Rules

- List endpoints are paginated and indexed on (`tenantId`, `branchId`, primary filter).
- No N+1 query loops — batch with `IN (…)` via named params or a join.
- Long work goes to workers/jobs, never inline in a request.
- Respect the budgets in PERFORMANCE.md and docs/performance-tuning.md.

## 10. Do / Don't

| Do | Don't |
| --- | --- |
| Extend existing services with new functions | Rewrite or delete existing services/files without approval |
| Keep every row tenant + branch scoped | Trust client headers as the only scope check |
| Store money as integer paise | Introduce floats or rupee decimals in storage |
| Derive balances/status from ledger rows | Hand-maintain mutable counters as the source of truth |
| Write/extend tests next to the feature | Ship mutations without a permission mapping |

## 11. Examples

Follow existing patterns in the codebase for this domain — the tests in `tests/` show the expected API shapes and behaviours. When adding examples to this document, use runnable snippets with named parameters, e.g.:

```js
const rows = db.prepare(
  'SELECT * FROM someTable WHERE tenantId = @tenantId AND branchId = @branchId AND createdAt >= @from'
).all({ tenantId, branchId, from });
```

## 12. AI Instructions

For Codex / Claude Code / Cursor / any coding agent working in this domain:

- Read AGENTS.md first; its invariants override anything here if they conflict.
- Assume the stack — do not suggest TypeScript backends, Postgres/Mongo/Redis or framework migrations.
- Work only on the files named in the task; produce minimal diffs, not rewrites.
- Never modify protected files; wrap them.
- Ask before deleting anything (code, routes, schema, tests, docs) — Delete Safety Rule.
- After a working change: commit and push (`git add -A && git commit && git push origin HEAD`).

## 13. Acceptance Criteria

- An invoice can never be paid beyond its total; over-payment is rejected
- Void/cancel requires permission + reason and lands in the audit log
- Billing tests (billing-*.test.js) pass, including race-condition and tenant-isolation suites

## 14. Future Roadmap

- Deepen this document with concrete schemas, endpoint contracts and worked examples as the domain evolves.
- Add Mermaid diagrams for the main flows described in §6.
- Keep this file in sync with ROADMAP.md milestones that touch this domain.
