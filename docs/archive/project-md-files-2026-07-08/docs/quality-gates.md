# Quality Gates

## Purpose
This file is the single checklist for PR readiness and release readiness in this project.

## Action Status

- **done**: Core PR/release gate criteria and test matrix are defined for functional, security and performance validation.
- **in-progress**: Owner-level accountability and automated ticket linkage for every gate item are being standardized.
- **blocker**: None.

## PR Quality Gate (before code review)
- Security impact reviewed
- Business scope matches issue and AGENTS constraints
- Multi-tenant impact checked (`tenantId` / `branchId`)
- Money values verified as paise integers
- DB query uses named parameters only
- Protected files unchanged (`smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`)
- Related docs updated if behavior changes
- No destructive changes without explicit approval

## Release Quality Gate (before deploy)
- Migrations, if any, are additive and documented
- New endpoints validated with authorization and role checks
- Smoke verification run for `/health` and critical user paths
- Error handling and rollback path documented
- Monitoring/alerts updated when new failure modes are introduced
- Backup and restore instructions verified
- Change log entry added

## Mandatory Test Matrix
- Unit: module-level logic and service-level decisions
- Integration: API routes and DB behavior for affected tenancy scope
- Regression: one scenario per modified major flow
- Security: permissions or auth changes must include a negative test
- Manual UAT: at least one happy path and one failure path
- Performance: pagination and query shape checked for changed list endpoints

## Exit criteria
- All PR checks checked as complete
- All release gate items checked by owner and approver
- Critical issues escalated before merge/deploy
