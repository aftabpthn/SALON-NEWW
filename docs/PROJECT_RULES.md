# PROJECT_RULES.md — Working Rules for AuraShine

> **Primary AI Role:** Technical Product Manager
> **Status:** Living document. Extend, never rewrite (AGENTS.md Delete Safety Rule).

## 1. Purpose

The operating rules for everyone (humans and AI agents) contributing to AuraShine:
how work is scoped, built, verified, documented and shipped.

## 2. Golden Rules

1. **AGENTS.md invariants are law.** Stack locked, protected files, integer paise, tenant+branch on every table, named SQL params, Delete Safety Rule.
2. **Enhance, never rebuild.** Additive/wrapper changes; one focused change per PR.
3. **Every feature is tenant-safe by construction** — scoping is not a review afterthought.
4. **Money and truth come from ledgers**, not mutable flags/counters.
5. **Docs move with code.** A change that alters behaviour updates the matching `docs/<domain>.md` (and CHANGELOG.md when released).

## 3. Definition of Done

A change is done when:

- [ ] It does exactly what the task asked — nothing speculative added or removed.
- [ ] Layering respected (route → service → repository; SQL only in repositories).
- [ ] Tenant + branch scoping present on every new query and table.
- [ ] Permission mapping added for any new mutation (docs/permissions.md).
- [ ] The matching test suite in `tests/` passes (lean verification — AGENTS.md §4).
- [ ] Audit logging added for protected actions.
- [ ] Relevant domain doc updated if behaviour changed.
- [ ] Committed and pushed (`git push origin HEAD`).

## 4. AI Role Model

Each documentation area has a primary AI role. When an AI agent works on a task,
it should adopt the role of the file(s) it touches:

| File | Primary Role |
| --- | --- |
| AGENTS.md / CLAUDE.md / CODEX.md / CURSOR_RULES.md | Chief Software Architect |
| ARCHITECTURE.md / TENANT_ARCHITECTURE.md | Solution Architect |
| PROJECT_RULES.md / ROADMAP.md | Technical Product Manager |
| SECURITY.md | Security Architect |
| DATABASE.md | Database Architect |
| RBAC.md / docs/permissions.md / docs/audit-log.md / docs/security-hardening.md | Security Engineer |
| API_GUIDELINES.md / docs/integrations-api.md | API Architect |
| UI_UX_GUIDELINES.md | UI/UX Architect |
| PERFORMANCE.md / docs/performance-tuning.md | Performance Architect / Engineer |
| TESTING.md / docs/troubleshooting.md | QA Architect / Engineer |
| DEPLOYMENT.md / docs/deployment.md | DevOps Architect |
| BACKUP_RECOVERY.md / docs/backup.md / docs/restore.md | DevOps Engineer |
| ERROR_HANDLING.md | Backend Architect |
| OBSERVABILITY.md / docs/monitoring.md | Cloud Architect |
| CHANGELOG.md / docs/release-process.md | Release Manager |
| docs/accounting.md / docs/taxation.md | Accounting Domain Expert |
| docs/inventory*.md / docs/products.md / docs/suppliers.md | Inventory Domain Expert |
| docs/appointments.md / docs/clients.md / docs/staff.md / docs/memberships.md / … | Salon Domain Expert |
| docs/ai-features.md | AI/ML Engineer |
| docs/reports.md / docs/analytics.md | Reporting Architect / Data Engineer |
| docs/whatsapp.md / docs/email.md / docs/sms.md / docs/razorpay.md / docs/integrations.md | Integration Engineer |

Full role catalogue: Chief Software Architect, Technical Product Manager, Solution
Architect, Business Analyst, UI/UX Architect, Frontend Architect/Engineer, Backend
Architect/Engineer, Database Architect, Data Engineer, Security Architect/Engineer,
Performance Architect/Engineer, DevOps Architect/Engineer, Cloud Architect, QA
Architect/Engineer, Automation Test Engineer, API Architect, Integration Engineer,
Accounting/Inventory/Salon Domain Experts, AI/ML Engineer, Reporting Architect,
Code Reviewer, Documentation Engineer, Release Manager.

### 4.1 AI Execution Hierarchy (Mandatory)

For every change request:

1. **Project Lead / User (decision owner)** defines scope, acceptance criteria, and
   final priority.
2. **Backend/Full-Stack Owner** owns business rules, DB impact, API contracts,
   validations, permissions, defaults, and error handling.
3. **Frontend Owner** handles form/table display, UI integration, reload behavior,
   empty/loading/permission states, and follows backend responses only.
4. **Reviewer/QA** verifies backend and frontend behavior match and the
   feature works end-to-end.

If any conflict appears, route decision back to step 1 before coding that path.
Default design rule remains: frontend sends data-changing requests, backend owns the
decision.

### 4.2 Standard AI Ticket Template

Use this format for every implementation request:

**Title:** `<module>: <short change>`

**Scope:**
- What is changing (files/routes/UI)
- Why now (business reason)
- What should remain unchanged

**Acceptance Criteria:**
- Functional behavior expected
- Edge cases (permissions, validation, empty/error states)
- Backward compatibility boundary

**Backend/Full-Stack Owner:**
- Data model / query impact
- API contract updates
- Validation + defaults + permission checks
- Error contract (`status`, `error_code`, message mapping)

**Frontend Owner:**
- Components/pages affected
- Request/response wiring
- Reload behavior after create/update/delete/action
- Empty/loading/disabled states

**Reviewer/QA:**
- Backend route/service test or smoke check
- API response + UI behavior parity check
- Manual acceptance flow:
  - open path:
  - action path:
  - failure case:

**Done Criteria:**
- `docs/<domain>.md` updated if behavior changed
- Smallest useful verification run
- Exact commit scope only

## 5. Change Control

- **Additive:** proceed, verify lean, push.
- **Behavioural change:** update the domain doc + matching tests in the same change.
- **Destructive (delete/rename/drop):** STOP. List exact files/symbols + reason, get explicit approval first (Delete Safety Rule).
- **Schema:** only via new sequential file in `backend-rust/migrations`; additive-first.
- **Protected files:** never edited; a task that seems to require it gets re-designed as a wrapper.

## 6. Communication Standards

- Commit messages: short imperative summary of what changed.
- PRs: one focused change, what/why, test evidence.
- Docs: English body, concise; each doc keeps its 14-section enterprise structure where applicable (Purpose → Future Roadmap).

## 7. Acceptance Criteria

- Every contributor/AI can answer “where does this change go and what must it satisfy” from this file + ARCHITECTURE.md.
- No merged change violates the Definition of Done checklist.

## 8. Future Roadmap

- Add PR template enforcing the Definition of Done.
- Automate checklist items (lint rules for named params, tenant scoping) — see TESTING.md.

## 9. Enterprise Coding Standards

- Frontend: standalone Angular components, existing route patterns, shared UI
  only when already present or clearly reused.
- Backend: Rust (Axum), route -> validator/middleware -> service ->
  repository.
- Database: PostgreSQL via SQLx, named bind params, tenant/branch scoped
  queries, migrations for schema changes.
- Naming: camelCase columns and JS fields; kebab-case routes; SCREAMING_SNAKE
  error codes; `Paise` suffix for money values.
- Validation: trust boundary is the route; validate payloads before services.
- Errors: return safe API errors; log request id and server details internally.
- Logging: structured, no secrets, no raw PII, include tenant/request context
  where safe.

## 10. Folder and File Rules

- `src/app/pages`: routed Angular screens.
- `src/app/core`: client API/session/state services.
- `src/app/shared`: reusable UI primitives only.
- `backend-rust/src/routes`: HTTP contracts and route composition.
- `backend-rust/src/services`: business workflows and domain orchestration.
- `backend-rust/src/repositories`: SQL and persistence only.
- `backend-rust/migrations`: additive schema evolution.
- `docs`: durable architecture, domain, ops, and audit documentation.

## 11. API, SQL, and Component Rules

- APIs keep envelope responses, explicit pagination, stable error codes, and
  backward compatibility on `/api/v1`.
- SQL never uses positional `?`; all dynamic filters come from named params or
  whitelisted fields.
- Components should keep layout stable, avoid hidden side effects in templates,
  and move shared network calls through existing core services.

## 12. Git, PR, and Review Rules

- One logical change per commit.
- Conventional commit format.
- Stage only the requested scope.
- Do not clean or revert unrelated user changes.
- PRs include summary, files changed, reason, testing, and breaking changes.

## 13. Refactoring and Anti-Patterns

Allowed refactor: removes real duplication in touched code, preserves behavior,
and has a focused check. Blocked refactor: rename/reformat/delete or framework
swap without explicit approval.

Anti-patterns: duplicate services, SQL in routes, money floats, unscoped tenant
queries, hidden auth bypasses, broad builds for doc-only work, and editing
protected files.
