# AuraSalon source audit and Rust porting guidance

## Snapshot and scope

- Upstream: `garvkataria23/aurasalon`
- Audited branch: `main`
- Audited commit: `70c5922a6ed9dd3222f7f4a71691ce5eb737a3a8`
- Audit date: 6 August 2026
- `aftabpthn/SALON-NEWW` received this source snapshot through PR #21.
- This was a read-only source audit. Build, runtime, authenticated browser UAT, native-device testing and provider testing were not run.

Counts below are approximate source-scan results for this commit, not runtime coverage claims.

## Executive verdict

`garvkataria23/aurasalon` is ahead in feature breadth, Customer App polish and Staff mobile experience. The canonical Rust/Axum/PostgreSQL/Redis implementation is structurally stronger in backend scalability, security defaults, data architecture, CI/CD and production reliability.

Treat this repository as a feature and UX reference for the canonical Rust product. Do not wholesale-merge its Express/SQLite backend into the Rust workspace. Port useful capabilities one by one against existing Rust contracts, tenant boundaries, permissions and persistence.

## Genuinely advanced areas

### Customer mobile app

- Ionic, Angular 20 and Capacitor 8.
- Native push notifications, haptics, keyboard and status-bar handling, and native settings deep-links.
- My Salon context, saved salons, wishlist, business profiles, booking chat, support and notifications.
- Multi-step booking and rescheduling flows.
- Package eligibility and Happy Hour price presentation.

### Staff and owner mobile app

- Attendance and biometric workflows.
- Payroll, roster, queue, chat, leave and performance surfaces.
- Inventory, reports and owner operations.
- Vitest coverage and multi-device Playwright configuration.

### Happy Hours and pricing lab

- Elasticity and ROI analysis.
- Fraud guards and no-show risk.
- Staff and inventory awareness.
- Auto-sunset and offer lifecycle controls.
- Branch leaderboard, flash-sale and bundle concepts.

### Feature breadth

- Approximately 236 API route files.
- Approximately 380 service files.
- More than 2,000 handler declarations.
- Approximately 307 CRM routes, 78 Customer App paths and 44 Staff App paths.

### Marketing site

- Separate Next.js 16 and React 19 application.
- Three.js, GSAP and motion tooling.

### Security feature surface

The source mounts modules for MFA, WebAuthn, step-up authentication, session kill switch, GDPR, audit chains, SIEM and rate limiting. Their presence is not proof that every path is production-ready or fully exercised.

## Critical slot-hold contract gap

The advertised real slot hold is not currently wired end to end:

| Layer | Source path | Observed contract |
| --- | --- | --- |
| Customer route | `server/routes/customer-app.routes.js` | Sends `startAt` and `durationMinutes` to `createHold` |
| Reservation service | `server/services/slot-reservation.service.js` | Requires `startTime` and `endTime` |
| Service response | `server/services/slot-reservation.service.js` | Returns `reservedUntil` |
| Customer type | `customer-app/src/app/core/api.types.ts` | Requires `expiresAt` |
| Customer fallback | `customer-app/src/app/features/booking/booking-flow.page.ts` | Catches the failed hold and continues with a local five-minute timer |

The result is a visible reservation countdown without a guaranteed server reservation. Fix and integration-test this contract before calling the flow production-ready.

The canonical Rust backend already uses a Redis-backed five-minute hold with expiry validation and confirmation-time lookup in its booking portal v2 flow. Reuse that contract when porting the Customer App UX.

## Production weaknesses

### Data and scaling

- A single SQLite file is the durable store, which limits horizontal scaling and concurrent-write capacity.
- `server/db.js` is approximately 4,462 lines and `server/app.js` approximately 874 lines in the audited snapshot.
- Approximately 288 of 380 service files directly call `db.*`; repository boundaries are not consistently enforced.
- Docker deployment is a single Node and SQLite container. PostgreSQL, Redis, an ML sidecar, Staff App and Customer native builds are not composed as one production stack.

### Security defaults

`server/config/env.js` contains development fallbacks that must not be accepted as production defaults:

- Default JWT and encryption secrets.
- Default demo administrator password.
- Refresh-token lifetime default of 3,650 days.
- Refresh tokens allowed in request bodies and responses by default.

These defaults require fail-closed production validation before deployment.

### Testing and delivery

- The root `npm test` command primarily runs the root Node test runner; it does not automatically execute every Staff Playwright/E2E and Vitest suite.
- No GitHub Actions workflow was present in the audited upstream snapshot.
- The security policy was a generic template rather than a project-specific operational policy.

### Repository hygiene

- Hundreds of generated files under `staff-app/apk-output` are tracked.
- Spreadsheets, logs and accidental zero-byte filenames are present.
- The generated Android tree can exceed default Windows path limits during checkout.

### AI and ML claims

A substantial part of the AI/ML surface uses deterministic formulas or local fallbacks. Treat it as rules-based assistance unless a trained model, monitored provider path and real evaluation evidence are attached.

## Comparison with the canonical Rust implementation

| Area | AuraSalon Express/SQLite | Canonical Rust/PostgreSQL |
| --- | --- | --- |
| Customer App UX | Ahead | Functional, with fewer consumer surfaces |
| Staff mobile and E2E | Ahead | Fewer equivalent mobile routes and no matching device suite |
| Feature breadth | Ahead by source count | More consolidated |
| Booking hold | Contract currently broken | Redis hold plus confirmation-time validation |
| Backend safety | Express and SQLite | Rust, Axum, PostgreSQL and Redis |
| Database evolution | Monolithic schema plus a small migration set | Approximately 420 SQL migrations at audit time |
| Security defaults | Risky development fallbacks | Required strong secrets, split access/refresh secrets and database TLS checks |
| Scaling | Single SQLite writer | PostgreSQL, Redis and workers |
| CI and deployment | Docker only; no Actions found | Nine GitHub workflows plus AWS Terraform, deploy, rollback and restore flows at audit time |
| Production confidence | Medium-low without UAT | Structurally stronger; browser, device and provider UAT remains feature-dependent |

## Recommended porting order

1. My Salon, saved salons and booking-chat UX.
2. Customer and Staff App Capacitor 8 upgrade patterns.
3. Staff App multi-device Playwright harness.
4. Search, filtering, touch-target and safe-area polish.
5. Package eligibility and Happy Hour presentation using the existing Rust pricing contract.
6. Marketing-site design patterns when the public site becomes a priority.

## Do not copy into the canonical Rust product

- The broken slot-hold contract.
- The single-file SQLite architecture.
- Duplicate `/api` routing patterns.
- Default security secrets and permissive refresh-token settings.
- Generated APK/build output and other repository artifacts.

## Validation boundary

This document is a source-backed engineering assessment, not a claim that the repository is fully working or production-certified. Confirm every port with real API/database behavior, tenant and branch isolation, permissions, reload behavior, error handling and relevant browser, native-device or provider UAT.
