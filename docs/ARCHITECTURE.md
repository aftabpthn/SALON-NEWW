# ARCHITECTURE.md — AuraShine System Architecture

> **Primary AI Role:** Solution Architect
> **Status:** Living document. Extend, never rewrite (AGENTS.md Delete Safety Rule).

## 1. Purpose

Single authoritative description of how AuraShine (Aura Salon CRM/POS) is built:
components, layers, data flow, realtime model and the boundaries every change must respect.

## 2. System Overview

```mermaid
flowchart LR
  subgraph Client
    NG[Angular 20 SPA<br/>src/app/pages]
    BW[Online Booking Widget]
    MOB[Mobile clients /api/v1]
  end
  subgraph Server["Rust + Axum — backend-rust/src/"]
    RT[routes] --> SV[services] --> RP[repositories]
    MW[middleware: auth, tenant, rbac, rate-limit] --> RT
    VW[validation] --> RT
    MQ[Redis]
    WS[WebSocket layer]
  end
  DB[(PostgreSQL<br/>DATABASE_URL)]
  RD[(Redis)]
  ML[ai-service<br/>Python FastAPI]
  EXT[WhatsApp · SMS · Email · Razorpay]

  NG -->|REST /api, /api/v1| MW
  BW --> MW
  MOB --> MW
  RP --> DB
  SV --> ML
  SV --> MQ
  SV --> EXT
  WS --> NG
```

## 3. Components

| Component | Location | Notes |
| --- | --- | --- |
| Angular SPA | `frontend-angular/src/app` | Standalone components, pages under `src/app/pages`, dev on default Angular port with proxy to API |
| Rust + Axum API | `backend-rust/src` | Entry `backend-rust/src/main.rs`; routes in `backend-rust/src/routes` via `build_router` |
| Data layer | `backend-rust/src/repositories` + `backend-rust/migrations` | SQL and schema changes for PostgreSQL |
| Domain services | `backend-rust/src/services` | Business logic |
| HTTP surface | `backend-rust/src/routes` | Route modules compose services; registration is in `backend-rust/src/routes/mod.rs` |
| Cross-cutting | `backend-rust/src/middleware`, `backend-rust/src/infrastructure` | Auth, tenant resolution, RBAC, tracing, CORS, cache/DB client setup |
| Migrations | `backend-rust/migrations` | Sequential, additive-first, applied on startup |
| Realtime | WebSocket handlers in routes/services | Live bookings, dashboards, staff status, notifications, front-desk queue |
| AI service | `ai-service/` | Python FastAPI service for AI recommendations/analytics |
| Tests | `backend-rust/tests` + backend unit modules | Backend verification via Cargo test |

## 4. Layering Rules (enforced)

1. **Route → Service → Repository.** Routes parse/validate/authorize; services hold business logic; repositories own SQL. No SQL in routes or services.
2. **Add-only / wrapper pattern.** New behaviour = new function or wrapper service; never rewrite existing services.
3. **Single registration path** in `backend-rust/src/routes/mod.rs` per route module.
4. **Transactions** wrap every multi-write operation using SQLx transaction scopes.
5. **Workers, not requests,** run long tasks (broadcasts, snapshots, exports).

## 5. Data Architecture

- PostgreSQL is the source database, configured through `DATABASE_URL`.
- Every tenant-owned table carries `tenantId` + `branchId` (camelCase columns).
- Money stored as **integer paise**; dates as ISO strings, business dates in IST.
- Derived truths (payment status, balances, session counts) come from ledger rows, not mutable counters.
- Accounting: `journalEntryLines` is the source of truth; `balanceSheetSnapshots` archival only (see `docs/accounting.md`).
- Full rules: `DATABASE.md`. Tenancy design: `TENANT_ARCHITECTURE.md`.

## 6. Request Lifecycle

1. Request hits Axum with `x-tenant-id`, `x-branch-id`, `x-user-role` + JWT.
2. Middleware: rate limit → auth (JWT/refresh) → tenant resolution (header or verified domain mapping) → RBAC permission check.
3. Validator checks the payload shape at the boundary.
4. Route calls a service; service composes repositories inside a transaction.
5. Envelope response returned (`API_GUIDELINES.md`); relevant WebSocket events broadcast; audit row written for protected actions.

## 7. Key Decisions (ADR summary)

| Decision | Rationale |
| --- | --- |
| PostgreSQL + SQLx | Typed SQL access and transactional consistency for service boundaries |
| Rust + Axum backend | Strong typed request/response handling with centralized middleware and explicit async boundaries |
| Integer paise | Exact money math, no float drift; matches gateway (Razorpay) native unit |
| Header-based tenancy + server-side scoping | Simple clients; repositories re-enforce scope so forged headers can’t leak data |
| Wrapper/add-only evolution | Protects battle-tested booking/billing cores; keeps diffs reviewable |
| WebSocket for realtime | Front desk and calendar need push, not polling |

## 8. AI Instructions

- Never propose replacing any element of §7 — these decisions are locked (AGENTS.md).
- Place new code by §3’s table; follow §4 rules exactly.
- Diagram new flows in Mermaid within the relevant `docs/<domain>.md`.

## 9. Acceptance Criteria

- Any engineer/AI can locate the right layer for a change using §3–§4 alone.
- No PR introduces SQL outside repositories.
- Architecture drift is corrected by updating this doc in the same PR.

## 10. Future Roadmap

- Add sequence diagrams for POS billing and booking flows.
- Document scaling path (per-tenant instance sharding) as tenant count grows.
- See also `docs/SYSTEM_BLUEPRINT.md` for the extended blueprint.

## 11. Enterprise Module Architecture

| Module | Frontend entry | Backend layer | Data truth | Notes |
| --- | --- | --- | --- | --- |
| Calendar/Appointments | `src/app/pages` calendar/booking pages | booking and appointment routes/services | appointments, booking events | Public booking wraps protected booking services. |
| POS/Billing | POS pages | billing, invoice, payment services | invoices, invoice payments, journal lines | Payment totals are paise. |
| Clients/CRM | client pages | client and customer intelligence services | clients, interactions, segments | PII is role-gated. |
| Staff/Payroll | staff pages | staff intelligence/payroll services | staff, shifts, payroll, statutory rows | Branch access is enforced server-side. |
| Inventory | inventory pages | inventory services/repositories | products, stock movements, transfers | WMA costing and stock ledgers are truth. |
| Accounting | finance pages | balance sheet, ledger, accrual services | `journalEntryLines` | Debit equals credit. |
| Reporting/Analytics | report/dashboard pages | report and analytics services | snapshots and source ledgers | Heavy calculations run as snapshots. |
| AI | AI/command pages | local AI plus provider adapter | `ai_interactions` | Local deterministic fallback stays available. |
| Notifications | engagement pages | WhatsApp/SMS/email/push services | notification rows and provider events | Webhooks are signed and idempotent. |
| SaaS Admin | super admin pages | SaaS/domain/tenant services | tenants, branches, subscriptions | Platform role required. |

## 12. Architecture Diagrams

### Request Flow

```mermaid
sequenceDiagram
  participant UI as Angular Page
  participant API as Axum Route
  participant MW as Middleware
  participant SVC as Service
  participant REPO as Repository
  participant DB as PostgreSQL
  UI->>API: /api/v1 request
  API->>MW: auth + tenant + RBAC + validation
  MW->>SVC: scoped command/query
  SVC->>REPO: transaction or read
  REPO->>DB: SQLx query
  DB-->>REPO: rows
  REPO-->>SVC: domain data
  SVC-->>API: result + events
  API-->>UI: envelope response
```

### Invoice Flow

```mermaid
flowchart LR
  Appointment --> Invoice
  Invoice --> Payment
  Payment --> JournalEntryLines
  Invoice --> StockConsumption
  StockConsumption --> InventoryLedger
  JournalEntryLines --> Reports
```

## 13. Scalability, Caching, Backup, and DR

- Scale by keeping tenants isolated, queries indexed, and long jobs out of
  request paths.
- Cache only derived/read-heavy data with invalidation tied to source writes;
  never cache authorization decisions across users.
- Back up PostgreSQL from the running instance and verify restore/failover.
- Disaster recovery requires latest backup, environment secrets, deployment
  config, and a documented rollback point.

## 14. Integration Architecture

Third-party systems enter through route/service adapters. Webhooks validate
signatures, dedupe by provider event id, write audit/provider rows, then trigger
domain updates inside transactions.

## 15. Architecture Acceptance Criteria

- Every new feature names its owning module from §11.
- Any cross-module write documents the source of truth and transaction boundary.
- New architecture diagrams go in this file or the matching `docs/<domain>.md`.
