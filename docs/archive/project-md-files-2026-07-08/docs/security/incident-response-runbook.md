# Incident Response Runbook

## Purpose

Phase 6 keeps a repeatable security incident process and a tamper-evident evidence bundle for audits, launch reviews, and breach triage.

## Severity Levels

| Level | Trigger | Response SLA |
| --- | --- | --- |
| SEV1 | confirmed data exposure, active account takeover, payment secret leak | immediate containment, owner notified within 15 minutes |
| SEV2 | suspicious admin activity, repeated export abuse, webhook signature failure spike | triage within 1 hour |
| SEV3 | dependency advisory, failed CI security gate, suspicious but blocked request pattern | review within 1 business day |

## Containment Checklist

- Rotate affected credentials and revoke active sessions for impacted tenants.
- Disable affected integration keys at the provider first, then update app secrets.
- Keep servers under user/operator control; do not auto-restart from AI tooling.
- Preserve logs, audit entries, backup metadata, and `security-phase-6-evidence` artifact.
- If customer data may be exposed, freeze export features for impacted tenant/branch until review closes.

## Evidence Checklist

- CI run URL and commit SHA.
- `security-phase-6-evidence` artifact from GitHub Actions.
- Security alert IDs, audit log IDs, tenantId, branchId, userId, and affected route.
- Backup drill status and latest encrypted backup checksum.
- Secret rotation timestamps and provider-side revocation confirmation.

## Recovery Checklist

- Run `npm run security:phase6` locally before release.
- Run a backup restore drill when database integrity or rollback is in scope.
- Confirm WAF/CDN rules still block `/api/*` cache and source/config paths.
- Document root cause, blast radius, permanent fix, and follow-up owner.

## Closure Criteria

- No critical CI security gate failures remain.
- Affected credentials are rotated and old credentials revoked.
- Tenant/branch impact is documented.
- Evidence bundle is attached to the incident ticket.
- Owner signs off on customer communication need.
