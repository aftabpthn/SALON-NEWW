# Aura Salon CRM/POS Project Audit Report

## Date
- 2026-07-04

## 1) Folder structure

- Root is a single-repo monolith with Angular frontend and Express backend.
- Key domains:
  - `src/` → Angular app shell, routes, services, shared UI.
  - `server/` → Express API, services, repos, middleware, jobs, migrations, workers.
  - `scripts/`, `migrations/`, `docs/`, `infra/`, `dist/`, `tests/`, `data/` for operational support.
- Important architectural folders:
  - `src/app/core`, `src/app/features`, `src/app/pages`, `src/app/shared`, `src/app/shell`, `src/app/testing`
  - `server/middleware`, `server/routes`, `server/services`, `server/repositories`, `server/workers`, `server/jobs`.

## 2) Frontend architecture

- Angular app is bootstrapped as a standalone standalone-component app.
- Routing is centralized in `src/app/app.routes.ts` with:
  - heavy lazy loading (`loadComponent` / `loadChildren`) for module scaling,
  - command-center style surfaces and many business modules,
  - legacy compatibility aliases and deep navigational structure.
- Shell experience in `src/app/app.component.ts` is feature-dense:
  - workspace switching (tenant/branch),
  - role-aware menu and permission gating,
  - local nav/workspace tabs,
  - command palette + quick navigation.
- API and auth are centralized:
  - `ApiService` (`src/app/core/api.service.ts`) handles headers, cache invalidation, token injection, and refresh fallback.
  - `AuthSessionService` (`src/app/core/auth-session.service.ts`) manages login/refresh/session persistence.
  - Permission guard uses static grants + optional dynamic grants (`src/app/core/permission.guard.ts`).
- Observed pattern: reusable UI + reusable services + centralized policy checks.

## 3) Backend architecture

- Express app factory in `server/app.js` composes:
  - security middleware chain,
  - auth/rate-limit/policy stack,
  - route registration for `/api/v1` and compatibility `/api`.
- Startup entrypoint is `server/index.js`:
  - loads secrets, initializes app,
  - starts HTTP server,
  - attaches WebSocket realtime,
  - starts cron jobs + job worker.
- Route topology:
  - first-class enterprise modules for finance, booking, inventory, AI, security, workflow, loyalty, compliance, marketplace, etc.
  - extensive compatibility layering indicates product evolution with ongoing backward support.
- Background system:
  - in-process periodic jobs in `server/jobs/` and `server/workers/job-worker.js`,
  - in-DB job queue consumed by timer loop.

## 4) Database architecture

- Uses `better-sqlite3` with ESM runtime (`new Database(...)`).
- DB-level defaults and operational settings:
  - `journal_mode = WAL`, `foreign_keys = ON`.
- Multi-tenant architecture enforced through schema columns and scopes:
  - `tenantId`, `branchId` across major operational tables.
- Repository layer:
  - `repository-registry.js` + `base.repository.js` provide generic CRUD abstraction,
  - service/repo wrappers provide domain-specific logic.
- Schema and helper services include seed/migration support and operational indexes.
- Known debt observed:
  - some money columns are `REAL` where integer paise strategy is expected by convention.

## 5) Missing enterprise modules vs Zenoti/Fresha target

- No dedicated external distributed queue/event bus in visible core (only in-DB job queue + worker loop).
- No distributed state backend for auth/session/realtime presence (in-memory maps in process).
- No clearly separated microservice boundary for high-cardinality domains (billing, booking, POS, analytics still co-located).
- Limited native observability pipeline abstraction for enterprise-grade APM/trace correlation across all domains.

## 6) Code quality score

- **Overall: 7.8 / 10**
  - Modularity: 8.0
  - Maintainability: 8.2
  - Performance efficiency: 6.8
  - Security maturity: 7.4
  - Scalability readiness: 6.3

## 7) Performance issues

- SQLite single-file concurrency limits on high write/read fan-out and large multi-tenant workloads.
- Broad route surface in one process increases failure blast radius and startup complexity.
- In-process worker polling loop can create periodic DB contention under heavy job volume.
- Some SQL patterns (column-wide search `LIKE` style scans) can become expensive as row counts grow.
- WebSocket + presence + broadcast in-process state is efficient for single-instance but not horizontally scalable.

## 8) Security issues

- Session token data is persisted in `localStorage` (frontend risk profile higher than HttpOnly cookie-only flows).
- CSP posture is mixed: secure defaults exist but shell/dev relaxations and older compatibility behavior require careful environment control.
- CSRF/session hardening is present for cookie-auth paths, but depends on environment integrity (refresh/csrf settings).
- Security state (rate-limit/store/session/presence) has process-local in-memory components.

## 9) Scalability issues

- Multi-instance deployment requires externalization of:
  - auth/session state,
  - websocket/connected-client state,
  - idempotency/ratelimit/security state,
  - background job claims/leases.
- Compatibility `/api` + `/api/v1` parity adds operational overhead.
- Large route/service corpus in one codebase is feature-rich but needs stronger bounded-context boundaries for team-level scale.

## 10) Roadmap to enterprise (Zenoti/Fresha-level)

### Phase 1 (Priority: P1, 0–3 months)
- Enforce strict financial integrity baseline:
  - convert remaining money columns to integer paise,
  - enforce strict typing + guards on monetary calculations.
- Security hardening closure:
  - tighten CSP and header policy defaults,
  - remove dev-fallback secret dependency in production paths,
  - strengthen CSRF/token lifecycle and audit-critical flows.
- Performance cleanup:
  - profile and optimize top 20 slow SQL paths,
  - reduce unbounded wildcard query scanning.
- API parity governance:
  - keep `/api` compatibility only where required,
  - formalize sunset path for deprecated aliases.

### Phase 2 (Priority: P1, 3–6 months)
- Introduce distributed enterprise infrastructure:
  - external shared session store (for auth/session policy),
  - distributed rate-limit and idempotency backing,
  - durable queue system replacing in-process-only job loop for critical jobs.
- Scale data plane:
  - add read/write workload separation strategy,
  - introduce secondary caching for hot read endpoints.
- Telemetry and operations:
  - standardized request tracing + security event correlation,
  - SLA/SLI dashboards for API latency, queue lag, background failures.

### Phase 3 (Priority: P2, 6–12 months)
- Move from monolith-by-domain to bounded services:
  - split identity/booking/inventory/finance/analytics into deployable modules.
- Upgrade persistence architecture:
  - move from single SQLite to managed multi-tenant database architecture,
  - separate OLTP from BI/reporting data plane.
- Enterprise feature stack:
  - policy-first plugin marketplace,
  - advanced fraud/risk engine,
  - unified channel messaging/CRM pipeline,
  - workflow + event-driven integration bus.

### Phase 4 (Priority: P3, 12+ months)
- Multi-region operations and active-active patterns.
- Zero-downtime migration platform and rollout controls.
- Full resilience hardening: chaos test suite, DR orchestration, failover drills.
