# TENANT_ARCHITECTURE.md — Multi-Tenant SaaS Design

> **Primary AI Role:** Solution Architect
> **Status:** Living document. Operational procedures live in `docs/multi-tenant.md`.

## 1. Purpose

Design rationale and rules for AuraShine’s multi-tenancy: how tenants, branches,
subscriptions and white-labeling are modelled and isolated in a shared-schema,
shared-database deployment.

## 2. Model

- **Tenant** = one salon business (SaaS customer). **Branch** = one physical location of a tenant.
- Shared PostgreSQL database, shared schema, **row-level isolation**: every tenant-owned table carries `tenantId` (+ `branchId`), and every repository read/write filters on it.
- Users belong to a tenant with a role; staff/front-desk users additionally hold assigned branch ids.
- `tenants.id` and `branches.id` UUIDs are the canonical IDs returned by APIs and stored in operational `tenant_id`/`branch_id` fields. Legacy scope IDs and old branch codes resolve through `tenant_id_aliases` and `branch_id_aliases`; `scope_id` remains only as a backward-compatible mirror of the canonical UUID.

## 3. Tenant Resolution

1. `x-tenant-id` header (first-party apps), **validated against the authenticated user’s tenant** — the header selects context, it never grants access.
2. No header → **verified domain mapping** resolves the tenant from the request host (white-label domains, booking widget).
3. No resolution → request is rejected for tenant-scoped routes.

Branch context comes from `x-branch-id`, constrained server-side by role (RBAC.md §4).

## 4. Subscription & Metering

- Subscription states: `trialing` → `active` (plus suspension); plan limits and usage checks enforced at write time with friendly errors.
- Entitlements are backend-enforced: `trialing`/`active` allow normal access, `past_due` keeps existing operations available but blocks branch expansion, and `paused`/`cancelled` or a non-active tenant block access. Branches above `includedBranches` are allowed only when `overageBranchPaise > 0`, so billing can charge the saved overage rate.
- Enterprise branch onboarding supports a header-only CSV template, dry-run validation, downloadable row failures, atomic/idempotent import, automatic Owner/Admin access, and additive UUID-cursor listing under `/api/settings/branches/*`.
- Usage events persisted for metering and SaaS billing (`saas-billing-metering.test.js`).
- Onboarding is one atomic workflow: tenant + trial subscription + owner user + first branch + optional domain mapping (`POST /api/saas/onboarding`).
- Only a platform superadmin can call onboarding. The camelCase request contains `idempotencyKey`, salon name/slug, `planId`, owner name/email/password, first-branch name/code/address, and optional `trialEndsAt`/`domain`.
- The default trial is 14 days. A supplied domain is created unverified, and the same idempotency key replays the original result; reusing it with different non-secret onboarding data returns `409 CONFLICT`.

Key endpoints: `/api/saas/context`, `/api/saas/plans`, `/api/saas/usage`,
`/api/saas/domain-mappings`, `PATCH /api/saas/subscription`; platform controls
under `/api/super-admin/*` (superAdmin only).

## 5. White-Label & Branding

- Tenant brand profiles: theme tokens, logo, custom domain; branch-specific branding supported.
- The booking widget and client-facing messages render tenant branding resolved from domain mapping.

## 6. Isolation Guarantees (the contract)

1. A query without a `tenantId` filter on a tenant-owned table is a defect, full stop.
2. Client-supplied headers can narrow scope but never widen it.
3. Files, WebSocket rooms, caches, exports and AI knowledge (RAG chunks) are all tenant-partitioned.
4. Aggregations for the platform (super admin analytics) run through dedicated snapshot paths, not by relaxing tenant filters in business code.
5. Guard tests must stay green: `tenant-safety.test.js`, `billing-tenant-isolation.test.js`.

## 7. Suspension & Lifecycle

- Suspension blocks tenant logins/writes but preserves data; controlled from the super admin console with audit (`super_admin_audit`).
- Offboarding/export follows the data-retention policy (SECURITY.md, docs/backup.md).

## 8. AI Instructions

- Every new table: add `tenantId` + `branchId` + indexes before anything else.
- Every new query: tenant filter first, then business filters.
- New realtime events: emit into tenant-scoped channels only.
- Never “temporarily” relax isolation for debugging or reporting.

## 9. Acceptance Criteria

- Isolation guard tests pass; attempts to read cross-tenant via forged headers fail in tests.
- Onboarding creates a fully working tenant atomically.
- Plan limits reject over-limit writes with typed errors, not crashes.

## 10. Future Roadmap

- Per-tenant export/import for tenant portability.
- Optional per-tenant database sharding path at scale (design note only — current model is locked).
