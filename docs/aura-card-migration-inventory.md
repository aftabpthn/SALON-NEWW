# Aura Card Migration Inventory

Date: 2026-07-02
Scope: static scan of `src/app` TypeScript and HTML files for legacy card class names. This is a migration baseline, not a visual QA result.

## Current Footprint

| Class | Files | Matches | Migration Direction |
| --- | ---: | ---: | --- |
| `panel` | 186 | 1905 | Leave for later layout-layer split; too broad for card primitive migration. |
| `metric-card` | 74 | 499 | Pair with `aura-card aura-card--type-metric` in visually verified page batches. |
| `action-card` | 34 | 234 | Pair with `aura-card aura-card--type-action` in small batches. |
| `form-panel` | 26 | 127 | Treat as layout/form surface, not a generic card migration target yet. |
| `report-card` | 5 | 60 | Migrate after reports surfaces are visually checked. |
| `score-card` | 9 | 54 | Migrate alongside reporting/score surfaces. |
| `summary-card` | 4 | 18 | Pair with `aura-card` utilities after owner page QA. |
| `client-card` | 2 | 16 | Migrate with CRM page QA. |
| `daily-sheet-card` | 1 | 14 | Migrate with daily sheet workflow QA. |
| `dashboard-hub-card` | 1 | 14 | Already has dashboard-specific visuals; migrate only after dark-mode visual QA. |
| `status-card` | 3 | 9 | Pair with `aura-card--status-*` utilities. |
| `service-card` | 1 | 6 | Migrate with catalog/service page QA. |
| `product-card` | 1 | 2 | Migrate with product/POS page QA. |
| `booking-card` | 0 | 0 | No current `src/app` matches in this scan. |

## Migrated Batches

- Offline support action-card batch: offline-support, offline-readiness, offline-appointment-protection, and offline-billing-protection now pair legacy `action-card` with `aura-card aura-card--type-action` without removing existing classes.
- Status-card readiness/report batch: appointment detail list report and pricing level 6 readiness now pair legacy `status-card` classes with `aura-card` plus status/tone utilities without removing existing classes.
- Summary-card booking/client report batch: booking wizard and client report detail now pair legacy `summary-card` classes with `aura-card` without removing existing classes.
- Client-card engagement rail batch: engagement command center now pairs legacy `client-card` rail panels with `aura-card` without removing existing classes.
- Catalog service/product card batch: booking portal services and product 360 profile now pair legacy `service-card`/`product-card` classes with `aura-card` without removing existing classes.
- Daily-sheet financial report batch: financial summary daily sheet, member comparison, and sales-tax report cards now pair legacy `daily-sheet-card` classes with `aura-card` without removing existing classes.
- Growth report-card batch: growth rank bot report cards now pair legacy `report-card` classes with `aura-card` without removing existing classes.
- Data-migration score-card batch: data migration approval, history, import worker, AI mapping, go-live, overview, and command center score cards now pair legacy `score-card` classes with `aura-card` without removing existing classes.
- Security policy center action-card batch: compliance, policy toggle, privacy, IAM, fraud, and playbook cards now pair legacy `action-card`/`score-card` classes with `aura-card aura-card--type-action` without removing existing classes.
- Two-factor setup action-card batch: 2FA status and recovery-code cards now pair legacy `action-card` classes with `aura-card aura-card--type-action` without removing existing classes.
- PRD action-card batch: role and business-rule cards now pair legacy `action-card` classes with `aura-card aura-card--type-action` without removing existing classes.

## Rules

- Do not remove old classes during first migration; add Aura utility classes beside them.
- Migrate high-volume classes in small, page-owned batches with visual QA.
- Keep `panel` and `form-panel` out of early card migration because they are also layout primitives.
- Use `npm run audit:design-system` after each batch to keep selector, token, and legacy-usage guardrails intact.
- Run `npm run build` after every committed card migration batch.

## Next Batches

1. Shared primitives and low-risk repeated cards.
2. `action-card` batches by feature page, starting with pages that do not redefine `.action-card` locally.
3. Reporting score surfaces after report page visual review.
4. Dashboard-specific cards only after dark-mode and high-contrast visual checks.