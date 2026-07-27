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

## Adding a permission

1. Add a `PermissionSpec` to `PERMISSION_REGISTRY` with at least one sample
   route.
2. Map the route in `middleware/tenant.rs::route_access`.
3. Run `cargo test permission_registry` — the tests confirm both directions.
4. The UI catalog and role editor pick the new permission up automatically.
