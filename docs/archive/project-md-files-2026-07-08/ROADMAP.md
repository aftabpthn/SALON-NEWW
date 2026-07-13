# ROADMAP.md — Product & Platform Roadmap

> **Primary AI Role:** Technical Product Manager
> **Status:** Living document, reviewed each release. Milestone detail moves into `docs/<domain>.md` files as work begins.

## 1. Vision

Take AuraShine beyond Zenoti/Fresha feature parity toward SAP/Salesforce-grade
reliability for salon businesses: every rupee accounted, every tenant isolated,
every workflow automatable — while keeping the locked, low-ops stack
(Angular + Express ESM + SQLite) that makes it fast to run and evolve.

## 2. Themes

1. **Financial truth** — accounting engine depth within the approved scope (AGENTS.md §7): ledger drill-down, cost centers, deferred revenue, working capital. Explicitly out of scope: Trading Account, P&L report, Trial Balance/Cash Flow/Forecast/Dashboard tabs.
2. **Documentation-driven AI development** — keep every `docs/<domain>.md` deep enough that any AI agent (Claude/Codex/Cursor) can work a domain correctly from its doc alone; grow each toward full enterprise depth (schemas, contracts, diagrams).
3. **Revenue & retention intelligence** — profit intelligence, churn/CLV/uplift (ml-service), discount leakage, next-best-action.
4. **Channel excellence** — WhatsApp AI agent maturity (RAG quality, handoff), DLT-compliant SMS, email deliverability, Razorpay reconciliation.
5. **Operational hardening** — monitoring with runbooks, restore drills, performance budgets measured (not aspirational), security shield expansion.
6. **Scale readiness** — snapshot-backed analytics everywhere, index audits at data growth milestones, per-tenant telemetry; long-term target of very large tenant counts via instance sharding (design note in ARCHITECTURE.md §10).

## 3. Horizons

| Horizon | Focus |
| --- | --- |
| **Now** | Documentation suite adoption; guard-test coverage (tenant safety, payment truth) kept green; monitoring runbooks; monthly restore drill habit |
| **Next** | Deepen top-traffic domain docs with schemas/contracts; OpenAPI for `/api/v1`; automated hot-path timing checks; discount/loyalty/gift-card liability reporting polish |
| **Later** | Marketplace/plugin ecosystem maturity; per-tenant export/import; WAL shipping for near-zero RPO; browser-level automation smoke tests |

## 4. Working Rules for the Roadmap

- Roadmap items become real only when scoped into a domain doc with acceptance criteria.
- Nothing on this roadmap may violate AGENTS.md invariants (no stack migrations, no protected-file rewrites, additive-first).
- Each release: completed items move to CHANGELOG.md; this file is re-reviewed (docs/release-process.md).

## 5. AI Instructions

- Do not start roadmap work unprompted; the roadmap sets direction, tasks come from the maintainer.
- When a task implements a roadmap item, link the item in the PR and update the relevant domain doc’s Future Roadmap section.
