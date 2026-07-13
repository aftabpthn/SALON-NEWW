# OBSERVABILITY.md — Observability Standards

> **Primary AI Role:** Cloud Architect
> **Status:** Living document. Operational detail: `docs/monitoring.md` (alerts), `docs/logging.md` (logs).

## 1. Purpose

How we see inside AuraShine in production: logs, metrics, health, tracing by
correlation id, and the business signals that matter to a salon SaaS.

## 2. The Three Signals

1. **Logs** — structured JSON (level, timestamp, `requestId`, `tenantId`, route, duration). Redaction list enforced by the logger (docs/logging.md). One error log per failure, at the handling layer.
2. **Metrics** — request rate/latency/error-rate per route group; worker queue depth and job outcomes; WebSocket connection counts; SQLite file size and backup age; per-tenant usage events (SaaS metering).
3. **Health** — `GET /api/health` (liveness + dependency summary); `npm run check:server` for scripted checks; WebSocket connectivity probe.

## 3. Correlation

- Every request gets a `requestId` at the edge; it propagates into service logs, audit rows, queued jobs and outbound webhook deliveries spawned by that request.
- A support ticket with a `requestId` (surfaced in 500 responses) must let an engineer reconstruct the full path from logs alone.

## 4. Business Observability

Salon SaaS dies quietly when tenants stop transacting — watch business signals, not just servers:

- Invoices/day per tenant vs trailing average (billing stopped = incident-grade signal).
- Message delivery failure rates per channel (WhatsApp/SMS/email).
- Booking funnel health (widget requests vs confirmations).
- Backup age, scheduler last-run timestamps, snapshot job freshness.
- KPI monitors and tenant-health views surface in the super admin console.

## 5. Dashboards & Alerts

- Dashboards per audience: platform ops (infra + API), super admin (tenant health), on-call (alert overview).
- Every alert: owner + runbook link + severity (page vs ticket) — rules in `docs/monitoring.md`. No runbook, no alert.
- Weekly alert review prunes noise; an alert that always gets ignored gets fixed or deleted (with approval).

## 6. Retention

- Logs: rotated, bounded disk usage, retention per docs/logging.md.
- Metrics/snapshots: platform analytics snapshots persisted (`platform_analytics_snapshots`) for trend history.
- Audit rows: retention per docs/audit-log.md (compliance-driven, longer than logs).

## 7. AI Instructions

- New feature = new signal check: does it need a metric, a log field, or nothing? Say which in the PR.
- Never add chatty per-row logging inside loops or transactions.
- Never log the fields on the redaction list, even at debug level.

## 8. Acceptance Criteria

- A dead API, stuck worker, failed backup or silent tenant is detectable within 5 minutes from dashboards/alerts.
- Any production error is traceable end-to-end by `requestId`.
- Log volume stays bounded under load.

## 9. Future Roadmap

- OpenTelemetry-compatible export once external tooling is chosen.
- Per-tenant SLO reporting in the super admin console.
