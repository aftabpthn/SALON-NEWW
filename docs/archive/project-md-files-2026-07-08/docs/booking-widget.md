# Online Booking Widget

> **Primary AI Role:** Frontend Architect
> **Applies to:** AuraShine (Aura Salon CRM/POS) — Angular 20 + Express 5 (ESM) + SQLite (better-sqlite3)
> **Status:** Living document. Extend it — never rewrite or delete sections without approval (see AGENTS.md Delete Safety Rule).

## 1. Purpose

Define the customer-facing booking website/widget: service/staff/slot selection, confirmation, reschedule, cancellation and payment-ready events.

## 2. Scope

- Public booking flow: service → staff → slot → details → confirm
- Reschedule and cancellation self-service
- Tenant/branch resolution from domain mapping
- Deposit collection hooks and event tracking

Out of scope for this document: anything covered by another domain doc — link to it instead of duplicating.

## 3. Responsibilities

- Widget reads only public, tenant-scoped catalog data
- Slot availability shown is always validated again server-side at confirm
- Branding (logo, theme tokens) comes from the tenant white-label profile

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

1. Visitor lands on tenant domain → tenant resolved → catalog loaded
2. Slot picked → held briefly → confirmed via booking-portal service wrapper
3. Confirmation message sent via configured channels

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

- booking-portal.service.js is wrapped, never modified (protected file)
- online-booking-completion.test.js passes
- Widget is responsive and usable on low-end mobile devices

## 14. Future Roadmap

- Deepen this document with concrete schemas, endpoint contracts and worked examples as the domain evolves.
- Add Mermaid diagrams for the main flows described in §6.
- Keep this file in sync with ROADMAP.md milestones that touch this domain.
