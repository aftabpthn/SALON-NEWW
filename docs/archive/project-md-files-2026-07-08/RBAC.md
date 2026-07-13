# RBAC.md — Role-Based Access Control

> **Primary AI Role:** Security Engineer
> **Status:** Living document. The live, per-action matrix is `docs/permissions.md`; this file defines the architecture.

## 1. Purpose

How roles, permissions and enforcement work across AuraShine, for tenant users and
the platform super admin.

## 2. Role Model

**Tenant roles (per user, per tenant):**

| Role | Intent | Branch scope |
| --- | --- | --- |
| owner | Full control of the tenant | All branches |
| manager | Operations, approvals, reports | All branches |
| analyst | Read-heavy reporting/analytics | All branches |
| accountant | Finance, accounting, reports | All branches |
| receptionist / front-desk | Booking, POS, clients | Assigned branch only |
| staff | Own calendar, own performance | Assigned branch only |
| inventory manager | Stock, purchases, suppliers | Assigned branch (configurable) |
| custom roles | Composed from named permissions | As configured |

**Platform role:** `superAdmin` (`x-user-role: superAdmin`) — SaaS console only
(tenant management, plans, suspensions, feature toggles). Super admin actions are
recorded in `super_admin_audit` and never bypass tenant data rules for business operations.

## 3. Permission Model

- Permissions are **named capabilities** (e.g. `billing.invoice.void`, `clients.delete`, `reports.finance.view`, `discount.approve`).
- Roles are bundles of permissions; custom roles compose from the same names — there is no side door.
- Every API mutation maps to exactly one permission; the mapping is maintained in `docs/permissions.md` and checked in review.

## 4. Enforcement Points

1. **Middleware (authoritative):** authenticates JWT, resolves tenant, loads role/permissions, denies by default.
2. **Branch guard:** staff/front-desk requests are constrained server-side to their assigned branch ids — a forged `x-branch-id` is rejected.
3. **Repository scope:** even after RBAC passes, queries are tenant+branch scoped (defence in depth).
4. **UI gating:** Angular hides forbidden actions for UX only; never relied upon for security.

## 5. Protected Actions

Void/cancel invoice, delete client, bill edits after settlement, payment changes,
discount above threshold, data export, permission/role changes, restore/backup
operations. Each requires: elevated permission → optional approval workflow →
**audit log entry in the same transaction** (`docs/audit-log.md`).

## 6. Session & Token Rules

- JWT access tokens short-lived; refresh tokens rotated on use and revocable per session.
- Role/permission changes take effect on next request (permissions re-validated server-side, not baked immutably into the JWT’s trust).

## 7. AI Instructions

- Adding an endpoint? Name the permission first, add it to `docs/permissions.md`, guard the route, then implement.
- Never grant broad roles to make a feature work — request the minimal permission.
- Never move enforcement into the UI or into client-supplied headers.

## 8. Acceptance Criteria

- `rbac.test.js` and `protected-actions.test.js` pass.
- Every mutation route has a permission mapping; deny-by-default verified for unauthenticated and under-privileged calls.
- Cross-branch access by branch-limited roles is impossible server-side.

## 9. Future Roadmap

- Permission usage analytics (which roles use what) to tighten defaults.
- Time-boxed elevated access (break-glass) with automatic expiry.
