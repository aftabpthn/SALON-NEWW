# Permission Engine

Single authoritative permission registry for the whole product. There are no
separate frontend checkbox catalogs: the UI renders exactly what the backend
registry defines and enforces.

## Source of truth

`backend-rust/src/services/permission_registry.rs`

Each `PermissionSpec` carries:

| Field | Meaning |
| --- | --- |
| `key` | Permission code, e.g. `staff.payroll.manage` |
| `module` | Owning module; also the UI checkbox group |
| `action` | `read`, `write`, `approve`, or `export` |
| `scope` | Widest grantable scope: `self`, `branch`, `tenant`, `platform` |
| `sensitive` | Requires reason + confirmation + audit when granted |
| `feature_key` | Subscription feature the permission belongs to |
| `routes` | Sample backend routes that must enforce this permission |

Derived views:

- `auth_service::TENANT_PERMISSION_CATALOG` (role editor catalog, UI
  `permissionOptions`) is generated from the registry at startup — it cannot
  drift from enforcement.
- `GET /api/v1/staff/auth-roles` returns each permission with `action`,
  `scope`, `sensitive`, and `featureKey` so clients can render enforcement
  metadata without hardcoding it.

## Enforcement rules

- Every protected route resolves through
  `middleware/tenant.rs::require_route_role`. A path without a permission
  mapping is denied by default (`no permission mapping for this endpoint`).
- Tests in `permission_registry.rs` fail the build when:
  - a route enforces a permission key that is not registered;
  - a registered permission's mapped routes stop enforcing it;
  - a role template grants an unknown or platform-scoped permission.
- System roles are immutable (`roles.is_system`); custom roles are editable
  and validated against the registry.
- Branch-specific overrides come from `user_branch_roles` (per-branch role,
  deputation windows, default branch).
- Updating a custom role's permissions bumps `users.permission_version` for
  every user holding that role (primary or branch assignment); the auth
  middleware then rejects their existing sessions and forces re-login.
- Granting any `sensitive` permission requires a 5–240 character reason.
  The UI asks for confirmation, and `auth.role.changed` audit events record
  the sensitive keys and the reason.

## Recommended roles

`SYSTEM_ROLE_TEMPLATES` (mirrors `migrations/0179_system_auth_role_templates.sql`):

| Role | Scope | Notes |
| --- | --- | --- |
| `super_admin` | platform | SaaS platform only, holds no salon permissions |
| `owner` | tenant | Full tenant catalog; not a Staff App employee login |
| `admin` | tenant | Full tenant catalog; not selectable in Staff App role picker |
| `manager` | branch | Operations/team/schedule/approvals for assigned branches |
| `accountant` | tenant | Finance, payroll review + manage, statutory reporting |
| `front_desk` | branch | Appointments, clients, POS, payments |
| `cashier` | branch | POS, collection, cash drawer |
| `inventory_manager` | branch | Products, stock, suppliers, purchase approvals |
| `staff` | self | Read-only operational views; writes limited to self-service |

Manager defaults deliberately exclude `staff.payroll.manage` (payroll runs,
salary revisions, statutory filings), `security.manage` (API keys, biometric
and audit administration), `finance.write`, `settings.manage`, and
`data_migration.*` — verified by
`manager_defaults_exclude_payroll_security_and_statutory_rights`.

## Staff identity and assignment

A staff record and a login account are separate concepts, explicitly linked:

```
staff_profile (staff)
  -> staff_user_link (staff.user_id, provisioned atomically)
  -> user (users)
  -> role_assignment (users.role_id / user_branch_roles.role_id)
  -> branch_assignment (user_branch_roles: permanent or deputation, one default)
```

Rules, and where they are enforced:

- **One active login per staff profile.** `staff.user_id` is a single column;
  provisioning locks the row (`FOR UPDATE`) and refuses staff that already
  have a linked login (`staff_repository::provision_staff_login`).
- **`admin`, `owner`, `super_admin` are never employee roles.**
  `permission_registry::is_privileged_role_name` (driven by the
  `staff_app_selectable` flag on `SYSTEM_ROLE_TEMPLATES`) is enforced in
  `provision_login`, in `save_branch_access`, and the role picker options
  returned by `load_branch_access` exclude those roles.
- **Staff identity is never accepted from the request body.**
  `services/staff_identity_service.rs` resolves the acting `staff_id` from
  the session-linked profile (`staff.user_id = claims.sub`) in the token's
  tenant and branch. A body/query `staffId` is honoured only for callers who
  can manage other staff (management roles or an explicit domain manage
  permission); for everyone else it is ignored, not validated.
- **Staff see only their own records.** Attendance summary/details, leave
  requests/balances, and schedule reads go through
  `resolve_read_filter`, which forces self-scoped actors onto their own
  profile. `/staff/self/*` and `/staff/mobile/*` (payroll, targets, profile)
  already derive identity from the JWT. Named reporting and front-desk roles
  (analyst, accountant, receptionist, cashier, ...) and roles holding the
  relevant view permissions keep team visibility for rosters and reporting.
- **Managers manage staff of their assigned branches only.** Sessions are
  branch-scoped: the auth middleware re-validates branch access on every
  request and rejects `x-branch-id` values that do not match the token.
- **Cross-branch access is an explicit assignment.** A user reaches another
  branch only through an active `user_branch_roles` row (permanent or
  time-boxed deputation), selected at login; there is no implicit fallback.

## Subscription and feature entitlements

Entitlements are feature-key based, never URL-regex based. The engine lives in
`backend-rust/src/services/entitlement_service.rs` and is invoked centrally
from the auth middleware for every mutating request; login gates reuse the
same state machine.

### Feature keys

Plans (`saas_plans.features_json`) grant keys from
`permission_registry::ENTITLEMENT_FEATURE_KEYS`:

`staff.basic`, `staff.advanced`, `staff.payroll`, `staff.biometric`,
`staff.ai`, `staff.api`, `reports.export`, plus module keys (`appointments`,
`pos`, `inventory`, ...). Matching is hierarchical: granting `staff` covers
every `staff.*` key; `all` covers everything. A plan with no feature list is
legacy and allows all features. Unknown keys are rejected when a plan is
saved.

A route's required features come from route metadata: the feature keys of the
permissions guarding it in the registry, refined by
`ROUTE_FEATURE_OVERRIDES` (e.g. `/staff/biometric/*` -> `staff.biometric`,
`/settings/integrations/api-keys` and `/integrations/*` -> `staff.api`,
`/staff-enterprise` -> `staff.advanced`).

### Lifecycle states

`effective_state` resolves the stored subscription status plus per-plan
policies (`grace_period_days`, `suspension_policy`, `retention_window_days`
on `saas_plans`) and any active override:

| State | Behaviour |
| --- | --- |
| `trialing` | Trial plan entitlements |
| `active` | Plan entitlements |
| `past_due` | Full access during the configurable grace window |
| `grace` | Reads allowed; sensitive writes (registry `sensitive` flag) blocked |
| `suspended` | Read-only, or login blocked when the plan policy is `blocked` (`paused` maps here) |
| `cancelled` | Read-only retention/export window (`retention_window_days`), then expired |
| `expired` | Only login recovery and billing; no tenant reads or writes |

Tenant data — including employee wage and payroll records — is **never
deleted** by any lifecycle transition; cancellation and expiry only gate
access. There is no code path that destroys payroll rows on subscription
change, and none may be added.

### Overrides, API exposure, idempotency

- Platform admins can force an effective status via
  `POST /platform/saas/subscriptions/:id/overrides` with a mandatory reason
  (5-240 chars) and expiry (max one year); the actor, reason, and expiry are
  stored in `saas_subscription_overrides` and audited
  (`saas.subscription.override.created` / `.revoked`). Overrides are revoked,
  never deleted.
- The owner UI reads entitlements from `GET /api/v1/saas/context`
  (`entitlements` block: effective state, granted features, read-only and
  sensitive-write flags). Frontend hiding is a convenience — the backend
  middleware block is mandatory and always applies.
- Billing ingestion is idempotent end to end: gateway webhooks dedupe on a
  SHA-256 event hash (`pos_payment_events` unique insert), usage events carry
  a per-tenant idempotency key, and onboarding replays by idempotency key +
  request fingerprint.

## Adding a permission

1. Add a `PermissionSpec` to `PERMISSION_REGISTRY` with at least one sample
   route.
2. Map the route in `middleware/tenant.rs::route_access`.
3. Run `cargo test permission_registry` — the tests confirm both directions.
4. The UI catalog and role editor pick the new permission up automatically.
