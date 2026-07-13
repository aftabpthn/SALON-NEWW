# SECURITY.md — Security Policy & Standards

> **Primary AI Role:** Security Architect
> **Status:** Living document. Extend, never rewrite (AGENTS.md Delete Safety Rule).

## 1. Purpose

Security policy for AuraShine: authentication, authorization, tenant isolation,
data protection, secrets, and vulnerability handling. Operational hardening steps
live in `docs/security-hardening.md`; the live permission matrix in `docs/permissions.md`.

## 2. Authentication

- Password-backed **JWT access tokens + refresh tokens**, plus OAuth where configured; refresh rotation on use.
- Sessions are tracked and revocable (session management tables); logout invalidates refresh tokens.
- Mobile clients authenticate against versioned `/api/v1` endpoints with device registration.
- Password storage: strong adaptive hashing; never log or echo credentials.
- OTP flows are rate-limited and expire quickly.
- Direct Python AI service endpoints require `Authorization: Bearer <AI_SERVICE_TOKEN>` except `/health`; production networking should keep the service private behind the Rust API.

## 3. Authorization

- **Deny by default.** Every endpoint requires an authenticated user and an explicit permission mapping.
- Roles: owner, manager, receptionist, staff, accountant, inventory manager, analyst, plus custom roles; platform-level `superAdmin` for the SaaS console (`x-user-role: superAdmin`).
- Enforcement is server-side middleware; the UI hides forbidden actions but is never the control.
- Protected actions (void/delete invoice, delete client, big discounts, exports, permission changes) require elevated permission **and** an audit log entry.
- Details: `RBAC.md`, `docs/permissions.md`, `docs/audit-log.md`.

## 4. Tenant Isolation (critical)

- Every tenant-owned table has `tenantId`; repositories scope **every** read/write.
- Tenant context: `x-tenant-id` header or verified domain mapping — then re-validated server-side against the authenticated user.
- Branch scoping via `x-branch-id`; staff/front-desk users are restricted to assigned branch ids server-side.
- Cross-tenant access of any kind is a **critical severity** bug. Guard tests: `tenant-safety.test.js`, `billing-tenant-isolation.test.js`.

## 5. Data Protection

- Money integrity: integer paise; payment truth from immutable payment rows.
- PII (phones, addresses, notes, consent forms, biometric captures) is role-gated and redacted from logs (`docs/logging.md`).
- Files stored outside the web root, served only through authorized endpoints (`docs/file-storage.md`).
- Backups are encrypted and never contain plaintext secrets (`BACKUP_RECOVERY.md`).

## 6. Secrets

- Secrets come from environment (`.env`, contract in `.env.example`) or encrypted settings — **never** hard-coded, committed, or logged.
- Tenant-level integration credentials (WhatsApp, Razorpay, SMS/email providers) are stored encrypted and scoped per tenant.
- API keys for the public API are hashed at rest, shown once at creation, rotatable without downtime (`docs/integrations-api.md`).

## 7. Input & Transport

- All input validated at the route boundary (`backend-rust/src/routes` + validation middleware); prepared statements and bind parameters make injection structurally difficult — string-built SQL is forbidden.
- Rate limiting and API protection headers on all routes; stricter budgets on auth and OTP endpoints.
- Webhooks (Razorpay, WhatsApp, delivery reports) must verify signatures and deduplicate by event id before any write.
- HTTPS is mandatory in production; cookies/tokens never sent over plain HTTP.

## 8. Vulnerability Handling

- Report privately to the maintainers (repository owner) — do not open public issues for vulnerabilities.
- Triage SLA: critical 24h, high 72h, medium next release.
- Dependency hygiene: `npm audit` reviewed on a fixed cadence; criticals patched within SLA.

## 9. AI Instructions

- Never weaken an auth/tenancy/validation check to make a test pass.
- New endpoints must ship with auth + permission + validation + tenant scoping in the same change.
- Never print secrets or tokens in code, tests, logs or documentation examples.

## 10. Acceptance Criteria

- `security-shield.test.js`, `protected-actions.test.js`, `rbac.test.js`, `billing-security.test.js`, `billing-webhook-security.test.js` all pass.
- No secret material in the repository history.
- Every mutation endpoint appears in the permission matrix.

## 11. Future Roadmap

- Periodic penetration test checklist.
- Formal data-retention schedule per record class.
- Field-level encryption for the most sensitive PII.

## 12. OWASP Top 10 Coverage

| Risk | AuraShine control |
| --- | --- |
| Broken access control | JWT, RBAC, tenant/branch scope, deny-by-default permissions |
| Cryptographic failures | strong secrets, encrypted integration credentials, HTTPS |
| Injection | validators, named SQL params, no string-built SQL |
| Insecure design | protected-file boundaries, audit logs, approval gates |
| Security misconfiguration | security headers, CORS policy, production env checklist |
| Vulnerable components | dependency review and critical patch SLA |
| Auth failures | refresh rotation, revocation, lockout, rate limits |
| Integrity failures | signed webhooks, idempotency, immutable ledger rows |
| Logging failures | structured security audit logs and request ids |
| SSRF | outbound provider calls only through approved integration adapters |

## 13. Web, API, File, and Payment Security

- XSS: never render untrusted HTML unless sanitized by an approved path.
- CSRF: cookie-backed flows require CSRF protection; bearer-token APIs require
  strict CORS and authorization headers.
- File uploads: validate type, size, ownership, storage path, and download
  authorization.
- Webhooks: verify signatures, timestamp tolerance, replay id, and provider
  account/tenant mapping before writes.
- Payments: verify gateway signatures, store amounts in paise, reconcile
  provider status against local immutable payment rows.

## 14. Secrets, Password, and Encryption Policy

- Secrets live in environment or encrypted tenant settings.
- Passwords are hashed only; never stored, logged, emailed, or exported.
- Tenant integration credentials are rotatable and scoped to the tenant.
- Backup encryption keys are handled outside the repository.

## 15. Incident Response

1. Classify severity: critical, high, medium, low.
2. Preserve logs and affected request ids.
3. Disable affected integration or permission if containment is needed.
4. Patch with the smallest safe change.
5. Verify tenant isolation and regression path.
6. Document impact, fix, and follow-up hardening.

## 16. Security Checklist

- Auth required.
- Permission mapped.
- Tenant and branch scoped.
- Input validated.
- Safe error response.
- Audit event for protected action.
- No secret/PII leakage.
- Rate limit where abuse is possible.
- Webhook/payment actions idempotent.
