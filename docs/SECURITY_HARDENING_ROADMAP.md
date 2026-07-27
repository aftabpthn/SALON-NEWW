# SECURITY_HARDENING_ROADMAP.md - Rust CRM Gap Tracker

## Purpose

This is the Rust/Axum version of the security gap list. It tracks what remains
to move AuraShine from strong baseline security to production hardening.

Use `docs/SECURITY.md` for policy. Use this file for delivery sequencing.

## P0 - Auth And API Abuse

| Gap | Rust target | Done when |
| --- | --- | --- |
| Refresh token rotation + reuse detection | `backend-rust/src/services/auth_service.rs`, refresh token repository | old refresh token reuse revokes the session family and writes an audit event |
| Login brute-force protection | Axum auth route + Redis limiter | repeated failures lock login for a short window and owner/manager failures can raise alerts |
| Security headers | Axum middleware or edge proxy config | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy present in production responses |
| Central permission matrix hardening | RBAC middleware + `docs/permissions.md` | every write endpoint maps to one server-side permission source |

## P1 - Privileged Access

| Gap | Rust target | Done when |
| --- | --- | --- |
| 2FA for Owner/Manager | MFA services/routes/security UI | TOTP setup, verify, recovery codes, and sensitive action step-up work |
| Session management | `auth_refresh_tokens`, device/session services | idle timeout, active devices, logout all devices, and revoke on password change are enforced |
| Field-level access control | route/service response shaping | salary, medical notes, payment refs, and payroll data are role-gated and audited |

## P1 - Tenant And Audit Coverage

| Gap | Rust target | Done when |
| --- | --- | --- |
| Cross-tenant access tests | focused backend tests | important endpoints reject wrong tenant/branch access |
| Central audit log coverage | audit service + protected routes | money, role, payroll, client delete, payment, inventory adjustment writes audit events |
| Sensitive data masking | response/log/AI context helpers | phone/email/payment refs/API keys are masked where full value is not required |

## P1 - Payments, Files, AI

| Gap | Rust target | Done when |
| --- | --- | --- |
| Payment webhook hardening | payment platform routes/services | Razorpay signatures are verified and writes are idempotent |
| File upload security | upload routes/services | MIME whitelist, size caps, random filenames, and malware scan hook exist |
| AI security | Rust AI boundary + `ai-service/` | prompt injection filter, PII/payment masking, and AI action audit are enforced |

## P2 - Operations And Compliance

| Gap | Rust target | Done when |
| --- | --- | --- |
| Backups | deployment/runbook/scripts | encrypted daily backup, offsite copy, and restore drill evidence exist |
| Monitoring/security alerts | observability + alert service | failed login, unusual access, API error and rate-limit alerts are visible |
| Secure development CI | GitHub workflows | secret scanning, Rust/Angular dependency scan, and basic SAST run in CI |
| Compliance flows | compliance/client data services | data export/delete request handling and retention policy are documented and wired |

## Existing Strengths

- Rust Axum backend structure.
- PostgreSQL source of truth.
- Tenant and branch scoping foundation.
- SQLx query safety.
- RBAC foundation.
- Ledger-backed finance model.
- Security, API, database, and project docs exist.

## Implementation Rule

Implement one row at a time. Each row needs the smallest useful verification:
targeted backend test/check for Rust changes, TypeScript check for UI wiring, or
focused runtime smoke when middleware behavior is involved.
