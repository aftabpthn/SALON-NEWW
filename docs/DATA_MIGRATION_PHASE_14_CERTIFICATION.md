# Data Migration Phase 14 Certification Gate

Phase 14 is an evidence gate. A provider or scale row is `PASS` only after the named artifact is attached to the proof pack; code presence alone is `READY`, not certification.

## Provider UAT matrix

| Test | Automated control | Required certification evidence | Current gate |
| --- | --- | --- | --- |
| Zenoti API credential | Encrypted credential, explicit `ZENOTI_CREDENTIAL_EXPIRED`, bounded retry | Authorized tenant credential and completed dry-run job ID | PENDING EXTERNAL |
| Zenoti ZIP/XLSX | Immutable upload, SHA-256, MIME/OOXML/ZIP inspection | Original provider export checksum and reconciliation | PENDING EXTERNAL |
| DINGG export | Public-HTTPS SSRF guard, DNS pinning, encrypted bearer credential | Original authenticated export and completed dry-run job ID | PENDING EXTERNAL |
| Wrong headers | Deterministic mapping/confidence engine | Dry-run mapping report | READY |
| Mixed values | Datatype/pattern validation and quarantine | Quarantine export with stable codes | READY |
| Duplicate clients | Link/Merge/Keep/Reject governance | Approved duplicate decision audit | READY |
| Missing dependencies | Dependency-pending graph and retry | Parent/child retry audit | READY |
| Financial mismatch | Hard-stop reconciliation | Mismatch proof and blocked commit | READY |
| Worker interruption | Lease, checkpoint and idempotency keys | Kill/restart run with unchanged target counts | READY |
| Provider rate limiting | Five bounded HTTP retries, `Retry-After` cap, persisted job retry | Injected 429 trace and final job result | READY |
| Credential expiry | Stable non-PII provider error code | Injected 401/403 trace | READY |
| Network failure | HTTP retry plus persisted connector job backoff | Disconnect/reconnect trace | READY |

## Provider domain contract gate

| Domain | Verified source contract | Current gate |
| --- | --- | --- |
| Refunds | Zenoti invoice detail exposes refund state and transactions | PENDING original refund payload reconciliation |
| Inventory | Zenoti stock quantity snapshot endpoint is documented | READY for snapshot mapping; historical stock movements PENDING provider contract |
| Payroll | Zenoti employee detail exposes payroll configuration | PENDING payroll transaction/history contract |
| Commissions and attachments/images | No approved read/export contract supplied | PENDING provider contract and original export |

## Scale matrix

Use the same immutable source checksum for the dry-run, commit and reconciliation evidence. Record wall time, peak process RSS, database size growth, chunk count, retry count and duplicate count.

| Rows | Required run | Pass condition | Current gate |
| ---: | --- | --- | --- |
| 1,000 | Full upload to rollback verification | Exact counts/totals, zero duplicate writes | PENDING MEASURED RUN |
| 100,000 | Full upload to proof pack | Bounded worker concurrency, checkpoint recovery | PENDING MEASURED RUN |
| 10 lakh | Full upload, interruption and resume | Memory within deployment limit, exact reconciliation | PENDING MEASURED RUN |
| 1 crore | Sharded provider/file run | No one-million-row provider cap hit, bounded memory, exact reconciliation | BLOCKED BY CURRENT ZENOTI 1M-DATASET SAFETY CAP AND PENDING MEASURED RUN |

The ingestion path streams CSV validation through a one-chunk channel. Cross-chunk source identities and financial projections are tenant/job-scoped PostgreSQL state, so worker memory is chunk-bounded. Crore-row certification still requires sharded provider input and a measured production-equivalent PostgreSQL/storage run.

## Security gate

| Control | Implementation evidence | Gate |
| --- | --- | --- |
| Encrypted credentials | `security_service` ciphertext; encryption key required | READY |
| SSRF protection | HTTPS only, no URL credentials/fragments, public DNS/IP validation, pinned DNS, redirects disabled | READY |
| MIME/file validation | Extension, declared type, magic bytes, UTF-8 CSV and OOXML structure | READY |
| ZIP bomb protection | Entry, per-entry, total-uncompressed and compression-ratio limits; enclosed paths only | READY |
| Malware scanning | Original decrypted source and every extracted ZIP artifact are streamed to `clamd`; missing scanner, timeout, scanner error, incomplete/unknown verdict and `FOUND` all fail closed before database persistence | LOCAL RUNTIME PASS 2026-07-30; AWS ECS ClamAV sidecar and `MIGRATION_CLAMD_ADDRESS` READY, deployment evidence pending |
| Formula/CSV injection | Backend never evaluates formulas; generated error CSV prefixes spreadsheet control characters | READY |
| PII-safe logs | Worker logs IDs and safe provider codes, not rows/tokens/provider messages | READY |
| Tenant/branch RBAC | Tenant/branch-scoped repositories plus read/manage permissions | READY |
| Historical financial permissions | Owner/admin or explicit `data_migration.historical_financial`; explicit deny wins | READY |
| Export/download permissions | Proof packs, source evidence and row/error exports require owner/admin or explicit `data_migration.export`; explicit deny wins | READY |
| Saved-mapping isolation | Saved mappings are read and written with tenant and branch scope; repository isolation test exists | READY |
| Approval permissions | Manage permission and assigned-owner approval/revalidation | READY |
| Audit immutability | Append-only database trigger on migration audit events | PASS TRANSACTION APPLY/ROLLBACK |

## Final certification checklist

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Backend compile | `cargo check --bin aura-shine-backend` output and commit SHA | PASS 2026-07-30 (existing unrelated warnings) |
| Frontend typecheck | `npx ngc -p tsconfig.app.json --noEmit` output and commit SHA | PASS 2026-07-30 (two existing warnings) |
| Database migration apply/rollback | Apply migrations 0322-0336 and verify audit/state controls | LOCAL DATABASE PASS: 0322-0336 applied; production deployment evidence pending |
| Targeted unit/integration tests | Provider/file/repository test output | PASS: rollback-only 1,000-bill archive/mapping invariants; focused Rust test binary linking exceeded the task limit twice |
| Authenticated browser UAT | Tenant/branch user, dry-run/approval/quarantine/resume/proof-pack capture | PASS authenticated shell/import drawer; PENDING real-source workflow |
| Real provider dry-run | Original Zenoti and DINGG evidence | PENDING EXTERNAL |
| Source-versus-target reconciliation | Counts and all financial/inventory balances | PENDING REAL RUN |
| Signed proof pack | Source hash, mapping/transformer versions, approvals, reconciliation and HMAC/KMS metadata | AWS Secrets Manager HMAC key READY; PENDING REAL RUN and dedicated KMS policy |

Certification result is `PASS` only when every row above is `PASS`. `READY`, `PENDING` or `BLOCKED` must never be presented as certified.

## Historical purchase and cutover UAT matrix

Every row below needs a real job ID, source checksum, reconciliation result and proof-pack reference. `READY` means the deterministic control exists; it is not a measured production pass.

| Required UAT | Required result | Current gate |
| --- | --- | --- |
| 1,000 historical bills | Archive counts/totals match; stock and current GL deltas are zero | DATABASE INVARIANT PASS 2026-07-30; real source-file run pending |
| Same file twice | Second run creates no duplicate archive, stock or journal rows | READY; PENDING MEASURED RUN |
| Duplicate supplier invoices | Stable duplicate decision or quarantine; no silent skip | READY; PENDING MEASURED RUN |
| Same product on multiple lines/batches | Distinct source-line/batch identity remains distinct | READY; PENDING MEASURED RUN |
| Unmapped products | Archive preserved with optional CRM product link; snapshot remains blocked | READY; PENDING MEASURED RUN |
| Renamed/discontinued products | Historical original name remains immutable; mapping is versioned | READY; PENDING MEASURED RUN |
| Box-to-piece conversion | Approved units-per-package produces fixed-point stock units | READY; PENDING MEASURED RUN |
| Batch/expiry products | Product, location and batch totals reconcile | READY; PENDING MEASURED RUN |
| Snapshot 4 to 18 | One opening movement of +14; final stock exactly 18 | READY; PENDING MEASURED RUN |
| Snapshot 22 to 18 | One opening movement of -4; final stock exactly 18 | READY; PENDING MEASURED RUN |
| Snapshot rerun | Same snapshot/idempotency key creates no movement; delta zero | READY; PENDING MEASURED RUN |
| Live sale/GRN during cutover | Frozen branch blocks or queues unapproved movement; no lost write | READY; PENDING CONCURRENCY RUN |
| Late old bill after go-live | Defaults to `history_only`; stock/current GL remain unchanged | READY; PENDING MEASURED RUN |
| Paid and unpaid old bills | Neither automatically recreates current payable or GST credit | READY; PENDING MEASURED RUN |
| Opening payable allocation | Supplier allocations equal approved opening payable total exactly | READY; PENDING MEASURED RUN |
| Historical return/credit note | Original status and negative history retained with zero live posting | READY; PENDING MEASURED RUN |
| Worker kill/resume | Checkpoint resumes with unchanged final counts and zero duplicates | READY; PENDING PROCESS-KILL RUN |
| Rollback after live movements | Blind overwrite blocked; compensating recovery preserves live movements | READY; PENDING MEASURED RUN |
| Source-versus-CRM totals | Bills, lines, tax, stock, payable, valuation and attachments match or are explicitly explained | PENDING REAL RUN |
| Signed proof pack | HMAC signature verifies source hash, mappings, approvals, row results, reconciliation and rollback state | READY; PENDING REAL RUN AND DEDICATED KMS POLICY |

## Certification invariants

- Historical stock impact = `0`.
- Historical current-GL impact = `0`.
- Current stock = approved cutover snapshot plus net approved post-cutover movements (purchases/transfers in add; sales/consumption/transfers out subtract; approved adjustments apply by sign).
- Historical bills default to `history_only`; opening inventory uses exact set-to semantics; product mapping never posts stock.
- Historical bills never recreate current GST credit; opening payables are a separate import.
- Unmapped history remains traceable; live enablement is blocked until reconciliation passes.
- Frontend input cannot bypass backend posting mode, permissions, validation or approval rules.
- Real provider export UAT is mandatory before any `100% certified` claim.

## Complete coverage matrix

| Original requirement | Phase |
| --- | --- |
| File profiling | 1 |
| Fixed CRM fields | 0-2 |
| Alias-based automatic mapping | 2-3 |
| Confidence Green/Yellow/Red | 3-4 |
| Phone/date/amount/status/gender conversion | 5 |
| Wrong-column blocking | 6 |
| Cross-field/reference validation | 7 |
| Dependency-aware order and retry | 8 |
| Source vs CRM preview | 9 |
| Approval and dry-run | 9 |
| Quarantine/error export | 10 |
| Selective retry | 10 |
| Saved provider mapping | 11 |
| Schema drift detection | 11 |
| Safe approved learning | 11 |
| Duplicate Link/Merge/Keep/Reject | 12 |
| Transactional commit | 13 |
| Audit and rollback | 13 |
| Financial reconciliation | 13 |
| Signed proof pack | 13 |
| Real Zenoti/DINGG verification | 14 |
| Crore-row scale and recovery | 14 |
| Security and permissions | 1, 4, 9, 13, 14 |
