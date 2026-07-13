# Zenoti/Fresha Enterprise SaaS Roadmap

## Overview
This roadmap is a practical execution plan to evolve the current project into a Zenoti/Fresha-level enterprise SaaS platform while preserving existing functionality and minimizing disruption.

## Phase 1: Stability and Bug Fixes
**Priority:** Immediate (P0–P1)

### Focus
- Stabilize production correctness before feature expansion.
- Eliminate high-impact bugs and inconsistent states.
- Improve observability for faster incident resolution.

### Deliverables
- Triage and fix critical payment, booking, auth, and invoice flow defects end-to-end.
- Consolidate API response/error contracts; remove ambiguous fallbacks.
- Add tenant-aware request guards at API edges for `x-tenant-id`, `x-branch-id`, and role headers.
- Improve retry/idempotency handling for payment, stock, and booking mutations.
- Implement basic monitoring/alerting on error rates, slow queries, and lock contention.
- Add focused regression tests around top 10 customer-impacting flows.

### Exit Criteria
- Reduced production incident frequency for known critical paths.
- No broken core booking/payin flows in smoke checks.
- Clear incident logs and ownership for recurring failures.

---

## Phase 2: Core Salon CRM Completion
**Priority:** High (P1)

### Focus
- Complete the minimum viable salon operational CRM in a stable modular architecture.
- Make salon lifecycle, customers, appointments, and communication coherent and discoverable.

### Deliverables
- Finish customer 360 profile: visit history, services, preferences, notes, tags, communication history.
- Standardize lead and CRM status model: prospects, warm leads, conversions, follow-up cadence.
- Add appointment lifecycle completeness: reschedule, no-show, cancel with policy controls, reminders.
- Improve consent and messaging templates for appointment/customer communication.
- Build unified timeline activity feed per salon entity (customer and branch).
- Add role-based visibility for CRM fields and actions.

### Exit Criteria
- Core CRM pages usable without manual DB/editor intervention.
- Predictable booking and customer lifecycle transitions.
- CRM data can be consumed by ops and service teams consistently.

---

## Phase 3: Staff, Inventory, Billing, Reports
**Priority:** High (P1–P2)

### Focus
- Operationalize core business outcomes: workforce productivity, stock control, end-to-end billing, and finance visibility.

### Deliverables
- Staff module:
  - Shift planning, attendance, workload, target vs actual, and role-based access.
  - Commission and incentive configuration, with audit trail.
- Inventory module:
  - Real-time stock in/out at branch level.
  - Multi-location transfers, cycle counts, expiry/shelf-life control, purchase reconciliation.
  - Alerts for reorder, low stock, and dead stock.
- Billing module:
  - Package/planized services, discounts, tax (GST), settlement rules, and credit-note/debit-note support.
  - Multi-terminal payment states and reconciliation controls.
- Reports module:
  - Daily branch dashboard, service mix, staff productivity, inventory valuation, and tax summaries.
  - Scheduled exports and audit-friendly report versioning.

### Exit Criteria
- Frontline staff, salon owners, and accountants can reconcile operations in one workflow.
- Billing, stock, and staffing states remain consistent across branches.

---

## Phase 4: AI Automation
**Priority:** Medium (P2)

### Focus
- Introduce practical AI to reduce manual work without destabilizing core workflows.
- Start with assisted automation, not autonomous actions.

### Deliverables
- AI-assisted customer follow-up suggestions based on visit patterns and service history.
- Smart no-show prediction and pre-appointment risk nudges.
- Auto-tagging/classification of customer notes and complaints.
- Billing and reporting copilots: anomaly flags, missing fields, likely corrections.
- Rebate/promotional recommendation engine with explainability and owner approval flow.
- Safe human-in-the-loop controls: confidence thresholds, approval queues, override logs.

### Exit Criteria
- AI outputs are reviewed and actionable, with measurable reduction in manual operations time.
- No silent automation; all high-impact AI actions require explicit approval.

---

## Phase 5: Enterprise SaaS Scaling
**Priority:** Medium-High (P2–P3)

### Focus
- Hardening for large multi-tenant scale, compliance, and reliable enterprise onboarding.

### Deliverables
- Multi-tenant hardening:
  - Strong tenant/branch isolation across DB access patterns.
  - Quotas, concurrency controls, bulk import controls, and anomaly alerts.
- Platform reliability:
  - Horizontal scaling runbook, deployment pipelines, zero-downtime release strategy.
  - Advanced indexing strategy and query performance governance.
- Product-grade enterprise features:
  - White-label theming, franchise hierarchy, role federation, advanced permissions.
  - Audit logs, data retention, legal/compliance reporting, and secure exports.
- Operations excellence:
  - SRE-style runbooks, capacity planning, backup/restore drills, disaster recovery.
  - Customer onboarding/offboarding and support workflows with SLAs.
- Finance and monetization:
  - Subscription/billing modules, metered usage tracking, and invoicing integration.

### Exit Criteria
- Platform supports sustained multi-branch, multi-tenant growth with predictable cost and performance.
- Enterprise buyers can trust security/compliance, operations, and supportability.

## Implementation Principles (applies across all phases)
- Preserve backward compatibility and existing UI/API contracts where possible.
- Keep changes additive and wrapper-based around existing services.
- Prioritize tenant isolation, data integrity, and observability in every rollout.
- Ship in small increments with feature flags and rollback pathways.
