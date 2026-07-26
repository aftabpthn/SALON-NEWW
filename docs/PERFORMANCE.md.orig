# PERFORMANCE.md — Performance Standards & Budgets

> **Primary AI Role:** Performance Architect
> **Status:** Living document. Hands-on tuning: `docs/performance-tuning.md`.

## 1. Purpose

Performance budgets and the rules that keep AuraShine fast as tenants, branches
and data volumes grow.

## 2. Budgets (p95, reference hardware)

| Flow | Budget |
| --- | --- |
| POS invoice save (full transaction incl. stock + journal) | < 300 ms |
| Calendar day view (200 appointments) | < 500 ms |
| Client search (100k clients, by phone/name) | < 200 ms |
| Standard report (one branch, one month) | < 1.5 s |
| Dashboard load (snapshot-backed) | < 800 ms |
| WebSocket event fan-out to a branch’s sessions | < 250 ms |
| Angular initial bundle | within `angular.json` budgets |

Budgets are contracts: a change that breaks one is a regression even if tests pass.

## 3. Backend Rules

1. **Short transactions.** Prepare all data first; keep PostgreSQL transactions short and focused. Nothing slow (network, ML, rendering) inside a transaction.
2. **No N+1.** Batch with `IN` lists/joins; prepared statements reused at module scope.
3. **Index what you filter.** Every list endpoint’s `(tenantId, branchId, filter)` combination has an index; check `EXPLAIN QUERY PLAN` for new heavy queries.
4. **Paginate by default.** No unbounded list responses.
5. **Snapshots for analytics.** Dashboards/analytics read pre-aggregated snapshot tables built by jobs — never scan OLTP tables per request (`docs/analytics.md`).
6. **Workers for long work.** Broadcasts, exports, imports, AI calls, snapshot builds run in background workers/schedulers, not request handlers.
7. **External calls** (WhatsApp, Razorpay, ml-service) always have timeouts and never sit inside a billing/booking critical path synchronously.

## 4. Frontend Rules

- Lazy routes per feature area; OnPush-style change detection patterns; `trackBy` on large lists (calendar, client lists, reports).
- Virtual scrolling for long tables; debounced search inputs.
- No polling where WebSocket events exist.

## 5. Measurement

- Measure before and after any perf-motivated change; record numbers in the PR.
- `npm run check:server` + targeted timing logs (dev only) for hot paths.
- Watch PostgreSQL query timings and index effectiveness as tenants grow; index review at 10x data growth.

## 6. AI Instructions

- Never “optimize” by caching truth data (payments, stock) in mutable counters — truth stays ledger-derived; cache only derived read models with clear invalidation.
- Don’t add dependencies for performance; use the patterns above first.
- A perf fix without a before/after measurement is not done.

## 7. Acceptance Criteria

- Budgets in §2 are met on reference hardware and re-checked when data volume assumptions change.
- No unpaginated list endpoints; no queries without supporting indexes on hot paths.

## 8. Future Roadmap

- Automated timing checks in `scripts/` for the top 5 hot paths.
- Per-tenant performance telemetry in the super admin console.
