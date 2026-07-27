# API Key Architecture

API keys are **machine-integration credentials only**. They never represent a
person, never carry a staff identity, and are never accepted as a staff login.
Humans authenticate with JWT plus a secure refresh cookie and CSRF token.

## Machine integrations

`integration_service::INTEGRATION_TYPES` — every key declares exactly one:

| Integration type | Allowed scopes |
| --- | --- |
| `attendance_device` | `attendance.write`, `attendance.read` |
| `accounting_export` | `accounting.read`, `sales.read`, `reports.read` |
| `payroll_provider` | `payroll.read`, `payroll.export`, `attendance.read` |
| `messaging_provider` | `messaging.send`, `messaging.status.write`, `clients.read` |
| `ai_service` (Python AI service) | `clients.read`, `appointments.read`, `sales.read`, `analytics.read`, `reports.read` |
| `external_reporting` | `clients.read`, `appointments.read`, `sales.read`, `reports.read`, `analytics.read` |

Scopes are validated against the declared integration: an attendance device
cannot be issued `payroll.export`, and a messaging provider cannot read sales.

## Per-key controls

| Control | Implementation |
| --- | --- |
| Tenant and optional branch scope | `tenant_id` + `branch_id` on every key; all data queries are scoped to the key's tenant/branch |
| Hashed at rest | Argon2 hash in `secret_hash`; the raw key is never stored |
| Raw secret shown once | Returned only in the create/rotate response; no endpoint can read it back |
| Prefix / key ID | `key_prefix` (first 17 chars) is the lookup handle and the only form used in logs and audit |
| Explicit scopes | `scopes_json`, validated against the scope catalog and the integration type |
| Expiry | **Mandatory**, max 400 days; enforced at issue and in the lookup query |
| Rotation | Atomically revokes the old key and issues a new one, preserving controls and linking `rotated_from_id`, stamping `rotated_at` |
| Revoke | Sets `status='revoked'` with actor and timestamp; revoked keys never authenticate |
| Rate limit | `rate_limit_per_minute` per key, enforced with a Redis fixed-window counter |
| IP allowlist (optional) | `ip_allowlist_json` — IPv4/IPv6 addresses or CIDR blocks; empty means unrestricted, non-empty **fails closed** when the caller IP is unknown |
| Last-used timestamp | `last_used_at` plus `last_used_ip` on every successful authentication |
| Audit | `api_client.created`, `.rotated`, `.revoked`, `.ip_blocked`, `.rate_limited` |
| Never logged in plaintext | Only `key_prefix` appears in audit payloads and error paths |

## Authentication order

`authenticate_api_key` verifies in this order, failing closed at each step:

1. Look up the active, unexpired key by **prefix**.
2. Verify the secret against the Argon2 hash.
3. Check the required scope.
4. Check the IP allowlist (audited on failure).
5. Check the per-key rate limit (audited on failure).
6. Stamp `last_used_at` / `last_used_ip`.

A successful check yields data scopes bound to the key's tenant and branch — it
never produces a JWT, session, or staff identity. Redis being unavailable fails
open on the rate limit only; authentication, scope, and IP checks always apply.

## Human authentication (browser and mobile)

- **Access**: short-lived JWT in the `Authorization: Bearer` header.
- **Refresh**: `aurashine_refresh_token` cookie — `HttpOnly`, `SameSite=Strict`,
  `Secure` outside local dev, `Path=/api`.
- **CSRF**: `GET /auth/csrf` issues a token and sets the readable
  `aurashine_csrf` cookie. When a refresh request presents the refresh token
  **via cookie** (an ambient credential), the `x-csrf-token` header must match
  the cookie (double-submit, constant-time comparison). A refresh token sent in
  the request body — how native clients hold it — is not ambient, so CSRF does
  not apply to it.

## Enforced invariants

Tests in `integration_service` fail the build when:

1. **Any API scope looks like human or administrative access** — no scope may
   contain `auth`, `login`, `session`, `self`, `role`, `permission`,
   `password`, `user`, `security`, `settings`, `staff.manage`, or
   `management`, and every scope must end in `.read`, `.export`, `.send`, or
   `.write`.
2. Every integration type declares only known scopes, and cross-integration
   scopes are rejected.
3. Keys cannot be issued without an expiry, or beyond the maximum window.
4. Rate limit and IP allowlist inputs are validated (including CIDR bounds).
5. The IP allowlist matches CIDR ranges correctly and fails closed on an
   unknown caller IP.

Tests in `routes::auth` fail the build when cookie-borne refresh stops
requiring a matching CSRF token.

Related: `docs/PERMISSION_ENGINE.md` (permissions, staff identity, subscription
entitlements — `staff.api` is the entitlement feature gating API key
management).
