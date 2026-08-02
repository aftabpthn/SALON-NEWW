# Clean Release Baseline 2026.08.02

Internal version: `2026.08.02-baseline.1`
Phase 1 authorization: user instruction approved on 2026-08-02.

## Release boundary

Included: current Rust contracts, migrations through 0389, Angular CRM contracts, Staff App source/native wrappers, inventory/POS regression fixes, parity registers, route truth and release verification tooling.

Excluded from this release: `infra/aws/terraform/` deployment work and generated `frontend-angular/staff-app-playwright-report/` output. Production deployment remains outside this phase.

## Source and contract evidence

- README route claims: 177; mounted 49, future 124, external 3, retired 1.
- Unknown route classifications: 0.
- Missing README document references: 0.
- Local runtime documentation: Angular 4200 -> Rust 8082.
- Rust compile: `cargo check --bin aura-shine-backend` passed with existing warnings.
- Angular CRM compiler: `ngc -p tsconfig.app.json` passed with two non-blocking template/import warnings.
- Staff App compiler: `ngc -p tsconfig.app.json` passed with no reported error.
- Exact generated evidence: [route catalog](./ROUTE_CATALOG.md) and [source/runtime JSON](./evidence/release-baseline-source.json).

## Migration and runtime evidence

- Source migrations: 383; latest version 0389; duplicate versions 0.
- PostgreSQL applied migrations: 383; latest version 0389.
- Missing source, failed, checksum mismatch and unapplied migrations: 0.
- Fresh executable timestamp is newer than Rust source, Cargo manifests and migrations.
- Direct `http://127.0.0.1:8082/health`: HTTP 200 with PostgreSQL and Redis healthy.
- Proxied `http://127.0.0.1:4200/api/v1/health`: HTTP 200.

## Focused regression evidence

- Inventory/POS Node contract tests: 58 passed, 0 failed.
- PostgreSQL inventory isolation, idempotency, concurrency and invariant test: 1 passed, 0 failed.
- Authenticated browser UAT used the existing `Salon Owner` session at branch `S.sense Kandivali`.
- Dashboard settled from loading to live API data with no console error.
- Inventory loaded 10 real records, controls and stock values with no API or console error.
- POS checkout loaded real branch, staff, appointments and payment modes with no API or console error.
- POS reload preserved the authenticated session and branch and returned to a settled checkout state.
- Browser UAT was read-only; no sale, stock, invoice or payment mutation was created for baseline verification.

## Evidence intentionally pending

- AWS deployment and production smoke tests.
- Live payment terminal/provider, push provider, biometric hardware and signed Android/iOS evidence.
- App Store and Play Store publication evidence.

These external/provider/device items are not source-release blockers and must remain pending until their real credentials, hardware or production environment is available.
