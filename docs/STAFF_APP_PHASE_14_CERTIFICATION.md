# Staff App Phase 14 — Production and Parity Certification

Current verdict: **NOT CERTIFIED — do not market as “Zenoti se advanced.”**

This is an evidence gate, not a source-completion checklist. The release label changes only when `node scripts/verify-staff-parity-certification.mjs --strict` exits successfully for the exact production commit and every external proof below is attached.

## Release identity

Before certification, pin these values in `docs/evidence/staff-app-phase14-ledger.json`:

- Git commit and immutable backend/AI image digest.
- Staff App semantic version and native build numbers.
- AWS environment and public Staff App URL.
- Deployment timestamp and release owner.

Evidence from a different commit, environment or app build does not certify the release.

## Required personas

Use a dedicated staging tenant with real, non-production-identifying UAT records:

1. `restricted-provider`: own appointments only; at least one explicit denied screen/action.
2. `senior-provider-frontdesk`: provider plus approved front-desk appointment/POS actions.
3. `manager`: team schedule, approval, register and staff-management actions.

The browser workflow reads all three from the protected `E2E_STAFF_PERSONAS` secret. Each persona object contains `id`, `tenantId`, optional `branchId`, `loginId`, `password`, optional `mfaCode`, `allowedPaths`, and `deniedPaths`. Passwords and MFA values must never enter Git, screenshots or artifacts.

## Row-level evidence

The public register currently contains 149 rows. The generated matrix is [staff-app-phase14-matrix.md](evidence/staff-app-phase14-matrix.md); editable evidence lives in [staff-app-phase14-ledger.json](evidence/staff-app-phase14-ledger.json).

Every row has ten independent gates:

| Gate | Pass evidence |
|---|---|
| Source | Exact release file/line or focused source report |
| API | Authenticated request/response ID and expected success/denial |
| Database | Tenant/branch/self-scoped query or immutable ledger evidence |
| Permission | Allowed persona plus explicit-deny persona result |
| Browser | Authenticated phone-layout workflow, reload and no-overflow proof |
| Android | Signed installed build, device/OS/build identity and result |
| iOS | Signed installed build, device/OS/build identity and result |
| Offline | `readable`, `queueable`, `online-only`, or `forbidden` behavior observed |
| Error/retry | Provider/network/conflict/validation failure and safe retry result |
| Audit | Actor, request ID, entity ID and persisted audit/event evidence |

`PASS` and `NA` require evidence, verifier and date. `NA` additionally requires an approved regional/business decision. `REGISTERED`, `PENDING` and `BLOCKED` never count as certified.

Commands:

```powershell
node scripts/verify-staff-parity-certification.mjs
node scripts/verify-staff-parity-certification.mjs --write
node scripts/verify-staff-parity-certification.mjs --strict
```

## Production gates

| Gate | Required proof | Current status |
|---|---|---|
| AWS deployment | Successful `Deploy AWS` production run, immutable image digests, migration task, ECS stable and public health | **BLOCKED** — local AWS credentials absent; GitHub `prod` environment is not configured. Latest dev deploy failed before apply; its EFS plan defect is fixed locally and `terraform validate` passes. |
| PostgreSQL backup/restore | Snapshot ID, isolated restore, migrations/integrity check, measured RPO/RTO and cleanup | **PENDING** — workflow exists; no successful drill evidence inspected for this release. |
| Redis failure | Controlled staging outage proving cache/session/rate-limit degradation, recovery and no durable-data loss | **PENDING** |
| Load/concurrency | Read/write targets, p50/p95/p99, error rate, DB pool, ECS scaling and idempotent race results | **PENDING** |
| WebSocket scale | Concurrent connections, reconnect storm, cross-replica delivery and polling fallback | **PENDING** |
| Payments | Sandbox payment/refund/void/dispute/payout plus one approved controlled live transaction and reconciliation | **EXTERNAL BLOCKED** |
| Push | Foreground/background/closed-app Android and iOS delivery, retry and revoked-device denial | **EXTERNAL BLOCKED** |
| Monitoring | CloudWatch alarms, mobile crash ingestion, alert receipt, trace/request correlation and on-call acknowledgement | **PARTIAL** |
| Security | Independent threat review, dependency/container/IaC scan, authenticated penetration test and closed findings | **PENDING** |
| Accessibility | Keyboard, screen reader, contrast, zoom/reflow and WCAG report on critical flows | **PENDING** |
| Retention/deletion | Tenant deletion, staff termination, guest media/forms, payroll, biometric and AI retention execution evidence | **PENDING** |
| Consent | Versioned biometric/AI consent, refusal/revocation, retention and legal sign-off | **EXTERNAL BLOCKED** — AI Scribe provider/data-transfer approval is still required. |
| Incident/rollback | Timed deploy rollback, frontend rollback, database decision tree, incident ticket and owner acknowledgement | **SOURCE READY; DRILL PENDING** |
| Store publication | Signed artifacts, privacy declarations, review approval, listing URLs and staged release tracks | **EXTERNAL BLOCKED** |
| Forced update | Server-authoritative minimum supported version, grace window, blocked old build and rollback escape | **PARTIAL** — crash capture exists; minimum-version enforcement is missing. |
| Zenoti delta | Monthly official release-index check and reviewed parity issue | **SOURCE READY** — scheduled workflow added; first successful run pending. |

## Existing operational controls reused

- AWS deploy: `.github/workflows/deploy-aws.yml`
- Isolated RDS restore drill: `.github/workflows/restore-drill-aws.yml`
- ECS/frontend rollback: `.github/workflows/rollback-aws.yml`
- Three-persona Staff browser proof: `.github/workflows/staff-production-certification.yml`
- Device/provider checklist: `docs/STAFF_LIVE_UAT.md`
- Payment activation: `docs/PAYMENTS_LIVE_ACTIVATION.md`
- Backup policy: `docs/BACKUP_RECOVERY.md`
- Mobile build notes: `staff-app/DEPLOYMENT.md`
- Monthly Zenoti monitor: `.github/workflows/zenoti-parity-diff.yml`

## Execution order

1. Merge a clean release commit; no certification runs against the current dirty workspace.
2. Configure GitHub `staging` and `prod` environments, OIDC role, Terraform state, Staff App URL and protected persona secrets.
3. Deploy staging; run migrations and public health.
4. Run the three-persona browser workflow and focused API/database/permission/audit evidence collection.
5. Run Android and iOS signed-device matrices, offline/reconnect, push, camera, GPS, biometric and AI consent cases.
6. Run payment/payout sandboxes, Redis chaos, load/concurrency, WebSocket and restore/rollback drills.
7. Close security/accessibility/privacy findings and approve India-specific `NA` decisions.
8. Deploy production through the protected environment, run controlled smoke/provider UAT, then stage store rollout.
9. Populate the ledger with redacted proof and run strict certification.

## Final rule

“Zenoti se advanced” is allowed only when all 149 rows are certified for the pinned production release, no `MISSING` remains, every `PARTIAL` has been resolved or explicitly approved for a documented business reason, regional `NA` decisions have named approval, all above-Zenoti rows use real data, and authenticated browser, signed Android/iOS, AWS and provider evidence all pass.
