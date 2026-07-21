# AUDIT_REMEDIATION_PLAN.md - Full Audit Remediation Tracker

> Status: Active. This tracker converts the full audit gaps into phased completion work.

## Audit Pending Summary

- Phase 1 verification is pending until backend `cargo check` completes cleanly without Cargo/rustc lock or timeout issues.
- Frontend build verification must be run by the maintainer with `cd frontend-angular && npm run build` because AI agents must not execute frontend npm scripts in this repository.
- Phase 2 to Phase 9 remediation tasks remain pending and must be completed in order unless a security emergency requires reprioritization.
- Each phase includes acceptance criteria and should not be marked complete until those criteria are met and verified.

## Old Project Port Parity Pending

Reference source: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\New project`.

Frontend pages missing or partial in the current Rust/Angular project:

- `ai-assistant`
- `analytics-engine`
- `smart-booking`
- `customer-360`
- `data-migration-overview`, `data-migration-validation`, `data-migration-approval`, `data-migration-go-live`, `data-migration-history`, `data-migration-assistant`
- `offline-support`, `offline-sync-queue`, `offline-conflict-center`
- `whatsapp-automation` (implemented at `/messaging/whatsapp`)
- `message-template-studio`
- `workflow-engine`
- `white-label`
- `engagement-command-center`
- `lead-management-command-center`
- Full `discount-rules` suite
- `pricing`
- `reputation-management`
- `marketplace-integrations`
- `location-sharing-command-center`
- `supplier-360`, `supplier-settings`
- `product-360`, `product-settings`
- Detailed finance/report pages such as `account-ledger`, `financial-summary-report`, and `staff-sales-report`

Old project tests to port as Rust integration/API tests:

- `tenant-safety.test.js`
- `rbac.test.js`
- `protected-actions.test.js`
- `billing-tenant-isolation.test.js`
- `billing-race-conditions.test.js`
- `billing-paise-hardening.test.js`
- `pos-invoice-payment-truth.test.js`
- `appointments-lifecycle.test.js`
- `waitlist.test.js`
- `staff-enterprise.test.js`
- `inventory-enterprise.test.js`
- `migration.test.js`
- `security-shield.test.js`

Recommended old-project port order:

1. Messaging/WhatsApp automation.
2. Dashboard and command center APIs.
3. AI assistant and AI marketing parity.
4. Settings modules parity.
5. POS terminal, print, Z-report, EOD, and GST workflows.
6. Full data migration UI.
7. Offline/mobile sync.
8. Customer 360 and memory graph.
9. Advanced finance, accounting, and reconciliation.
10. Discount, pricing, reputation, and marketplace modules.

Messaging/WhatsApp automation progress:

- Completed first Rust parity slice for WhatsApp conversation data: `GET /api/v1/whatsapp/summary`, `GET /api/v1/whatsapp/threads`, `GET /api/v1/whatsapp/messages`, and `POST /api/v1/whatsapp/inbound`.
- The slice reads and writes real `client_communications` rows only; it does not create dummy threads or sample messages.
- Existing Notifications/SMS Center UI now exposes WhatsApp as a campaign channel when the provider is configured.
- Completed second WhatsApp parity slice: tenant/branch-scoped rules and handoffs, campaign plans with approval/scheduling, WhatsApp template studio persistence, message-history settings, provider delivery history through `client_communications`, and the dedicated `/messaging/whatsapp` Angular workspace.
- New APIs include `/api/v1/whatsapp/rules`, `/api/v1/whatsapp/handoffs`, `/api/v1/whatsapp-campaign-planner/*`, `/api/v1/message-templates`, and `/api/v1/settings/message-history`.
- Backend `cargo check --message-format short` passes with existing unused-code warnings. Frontend build remains maintainer-run per repository policy.

## Phase 1 - Dev Session Security

Current state: implementation changes are applied, but verification is still pending.

Pending verification:

- Run `cargo check` successfully after clearing Cargo/rustc file locks.
- Confirm no committed frontend source contains a dev-session secret.
- Confirm local dev-session access only works on loopback hosts.
- Ask the maintainer to run `cd frontend-angular && npm run build` because AI agents must not execute frontend npm scripts in this repository.

Implemented in this phase:

- Removed the hardcoded frontend local dev-session secret.
- Disabled frontend local dev-session by default.
- Kept local dev-session as explicit localhost/localStorage opt-in only.
- Added backend loopback checks for `/auth/dev-session`.
- Blocked remote use of dev-admin bearer tokens in auth middleware.
- Bound local Docker API ports to `127.0.0.1`.
- Set `APP_HOST=127.0.0.1` in `backend-rust/.env.example`.

## Phase 2 - CI And Guard Verification

Goal: make regressions visible before more refactors.

Tasks:

- Add CI for `cargo check` and `cargo test`.
- Add frontend build/test verification as a maintainer-run or CI-run step.
- Add secret scanning.
- Add dependency audit checks.
- Add named security/tenant/RBAC guard tests or update docs to match real test names.

Acceptance criteria:

- CI exists and fails on backend compile/test errors.
- Secret scanning catches committed credentials and generated artifact leaks.
- Testing docs match actual commands and project layout.

## Phase 3 - API Envelope Standardization

Goal: all first-party JSON APIs use the documented response envelope.

Tasks:

- Replace custom appointment error responses with the central `ApiResponse` / `AppError` pattern.
- Remove raw JSON success/error responses from normal API routes.
- Document any protocol-specific exceptions, such as webhook challenge responses.
- Add focused tests for success/error envelopes.

Acceptance criteria:

- Normal JSON endpoints return `{ "success": true, "data": ... }` or `{ "success": false, "error": ... }`.
- Error messages do not leak SQL, stack traces, tokens, or secrets.

## Phase 4 - Backend Layering Refactor

Goal: move SQL out of route handlers and services into repositories.

Priority order:

- `backend-rust/src/routes/pos.rs`
- `backend-rust/src/routes/appointments.rs`
- `backend-rust/src/routes/booking_portal_v2.rs`
- `backend-rust/src/routes/invoice_webhooks.rs`

Tasks:

- Extract SQL into existing or new repository functions.
- Keep route handlers thin: parse, validate, authorize, call service, return envelope.
- Wrap multi-write webhook and billing flows in transactions.
- Add idempotency tests for payment/webhook replay paths.

Acceptance criteria:

- No new SQL is added outside `backend-rust/src/repositories`.
- High-risk routes are reduced to thin handlers.
- Multi-write actions use transactions.

## Phase 5 - Tenancy And Scope Contract

Goal: make tenant/branch scoping explicit and testable.

Tasks:

- Decide and document the canonical database naming contract for `tenant_id`/`branch_id` versus `tenantId`/`branchId`.
- Audit tenant-owned tables for missing tenant/branch scope and indexes.
- Add tests for tenant UUID, tenant slug/scope id, and branch scope paths.
- Remove unsafe default tenant/branch fallback from real API paths.

Acceptance criteria:

- Tenant/branch resolution is documented and matches code.
- Missing tenant/branch scope fails tests.
- Real API requests without resolved tenant context are rejected instead of falling back silently.

## Phase 6 - Realtime Auth Hardening

Goal: WebSocket auth must match HTTP auth guarantees.

Tasks:

- Create shared access-token/session/scope validation used by HTTP and WebSocket flows.
- Recheck active session, permission version, branch access, and revoked device state.
- Add tests for revoked session, changed permission version, and removed branch access.

Acceptance criteria:

- A token rejected by HTTP auth is also rejected by WebSocket auth.
- WebSocket connections cannot bypass branch grants or session revocation.

## Phase 7 - Frontend Data And UX Safety

Goal: failed real API loads must not look like successful empty data.

Tasks:

- Replace silent API failure fallbacks with compact error states.
- Keep empty states only for successful empty responses.
- Remove frontend business defaults that can be saved as if returned by backend.
- Standardize API paths toward `/api/v1` unless an endpoint is explicitly legacy/public.
- Add route/action permission metadata where it improves UI hiding/disable behavior.

Acceptance criteria:

- Auth, tenant, or backend failures are visible to users.
- UI does not fabricate business records or settings.
- API path usage is consistent and documented.

## Phase 8 - Frontend Standards Cleanup

Goal: align operational pages with project UI/form rules.

Tasks:

- Replace remaining native/free-text date inputs with the shared app date picker plus explicit time controls.
- Keep numeric create-form inputs empty unless backend returns saved/default values.
- Apply title-case behavior to name/category-style inputs.
- Incrementally align operational pages with the appointments visual baseline.

Acceptance criteria:

- Date display follows `DD/MM/YYYY` where required.
- Create forms do not show fake `0`, `7`, or `30` defaults.
- Operational pages use consistent compact card/control language.

## Phase 9 - Production Operations

Goal: turn deployment, observability, and recovery policy into executable practice.

Tasks:

- Add IaC for ECS/Fargate or the selected AWS runtime, RDS, Redis, secrets, logs, backups, and frontend hosting.
- Add structured JSON logs and request-id correlation in production.
- Add active backup/restore runbooks and backup-age alerts.
- Add container healthchecks, vulnerability scanning, and hardening policy.
- Keep AI service private behind Rust/API networking controls.

Acceptance criteria:

- Production deployment can be recreated from source-controlled infrastructure.
- Backup restore drill is documented and repeatable.
- Logs and alerts are sufficient to debug production incidents.
