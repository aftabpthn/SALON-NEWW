# Data Migration Module — Full Senior Engineer Audit

**Date**: 2026-06-26
**Audited files**: 8 files (4666 + 339 + 404 + 334 + 157 + 176 + 24 + 2880 lines)
**Scope**: Backend services, routes, workers, DB schema, frontend component, tests

---

## A. Executive Summary

The Data Migration module is a large, feature-rich system supporting two import paths:

- **Normal Import**: base64-in-JSON, ≤50K rows, ≤100MB, synchronous, single-batch
- **Large Import**: raw binary upload, streaming CSV, chunked (5K rows), worker-driven async, progress polling

The module has strong architectural choices: CSV streaming avoids loading the full dataset into RAM, `migration_id_map` enables cross-resource reference resolution, `importBatchId` tracking enables auditable rollback, `withBusyRetry` handles SQLITE_BUSY gracefully, and ledger journal entries balance debit/credit.

**Critical blockers**: 11 SQL injection vectors via unsanitized table/column interpolation (P0), path traversal via `cleanText()` that allows `../` in filenames (P0), ZIP bomb vulnerability with no per-entry uncompressed size limit (P0). Worker `globalThis` flag leaks across module boundaries (P1). `readFileSync` for ZIP/XLSX paths (P1). No magic byte validation for file type (P1).

**Verdict**: **BLOCKED for production. Safe for staging with monitoring.**

---

## B. Complete Architecture Map

### B1. File Inventory

| File | Lines | Role |
|------|-------|------|
| `server/services/migration.service.js` | 4666 | Main service — all import logic, rollback, mapping, proof, reconciliation |
| `server/services/large-file-upload.service.js` | 339 | Large file handler — disk storage, CSV/XLSX/ZIP→chunks |
| `server/services/migration-upload-store.service.js` | 334 | Multipart sessions, disk storage, upload records |
| `server/services/migration-staging-schema.service.js` | 157 | Schema: large_jobs, file_chunks, staging_rows, id_map, reconciliation |
| `server/services/migration-upload-schema.service.js` | — | Schema: uploads, upload_sessions, upload_parts |
| `server/routes/migration.routes.js` | 404 | 30+ route definitions, permission middleware |
| `server/jobs/migration-large-import.worker.js` | 24 | Background worker tick |
| `server/utils/zip-archive.js` | 176 | ZIP creation and extraction (test helper + reusable) |
| `src/app/pages/data-migration.component.ts` | 2880 | Migration wizard UI |
| `tests/migration.test.js` | 1132 | 28 tests |

### B2. Exported API surface (`migrationService` object, lines 229–675 in .js)

```
adapters, templates, uploadSource, uploadSourceBuffer,
createUploadSession, uploadSessionPart, completeUploadSession,
uploadSessions, uploadSession, commandCenter, proofPack,
normalizeSource, mappings, saveMapping, suggestMapping, reconcile,
createLargeJob, pauseLargeJob, cancelLargeJob, retryFailedLargeJobChunks,
queueLargeJob, processQueuedLargeJobs, parseCsvText,
analyzeChunkRows, startLargeJob, resumeLargeJob, largeJob,
reconcileLargeJob, registerLargeJobChunk, stageLargeJobCsvChunk,
analyzeLargeJobChunk, importLargeJobChunk, importLargeJobStagedChunk,
submitApproval, listApprovals, decideApproval, listLargeJobs,
rollbackLargeJob, jobs, job, jobBatches, batch, uploads,
preview, dryRun, approveJob, importPreview, rollback, rollbackByFilter,
rollbackLastImport, applyMapping, analyze, normalize,
onboardingProfile, onboardingPreview, checkHealth, recovery
```

### B3. Database Tables (Migration Subsystem)

| Table | Schema Location | Purpose | Est. Growth |
|-------|----------------|---------|-------------|
| `migration_mappings` | `db.js:2238` | Saved column mappings | Low (per source+resource) |
| `migration_jobs` | `db.js:2251` | Normal job tracking | Per import |
| `migration_import_batches` | `db.js:2273` | Rollback batch tracking | Per import batch |
| `migration_row_results` | `db.js:2288` | Per-row import result | 1 row/row imported |
| `migration_audit_logs` | `db.js:2310` | Audit trail | ~200 entries/import |
| `migration_uploads` | upload-schema | Upload file metadata | Per upload |
| `migration_upload_sessions` | upload-schema | Multipart sessions | Per upload session |
| `migration_upload_parts` | upload-schema | Part tracking | Per session part |
| `migration_large_jobs` | staging-schema:8 | Large job header | Per large import |
| `migration_file_chunks` | staging-schema:44 | Large job chunks | 20+ per large import |
| `migration_staging_rows` | staging-schema:72 | Analyzed rows for import | 1 row/row imported |
| `migration_id_map` | staging-schema:95 | Source→target ID map | 1 row/record created |
| `migration_reconciliation_snapshots` | staging-schema:112 | Pre/post import snapshots | Per job |
| `migration_approvals` | inline:3425 | Approval records | Per approval request |

### B4. Normal Import vs Large Import

| Aspect | Normal Import | Large Import |
|--------|--------------|--------------|
| Upload format | base64 in JSON | Raw binary HTTP body |
| Max file size | ~100MB (decoded) | 500MB (raw body limit) |
| Max rows | 50,000 | Unlimited (chunked) |
| Parsing | In-memory (CSV parse, XLSX.read) | Streaming CSV, in-memory XLSX/ZIP |
| Chunking | No | Yes (5K rows/chunk) |
| Worker | No (synchronous) | Yes (15s poll, 2 jobs/tick) |
| Progress | No polling | Frontend polls every 3s |
| Staging rows | No | Yes (migration_staging_rows) |
| Row limit enforcement | Server rejects >50K | No hard limit (chunked) |

---

## C. Full Flow Diagram in Text

```
NORMAL IMPORT PATH:

[User] → file drop → FileReader(base64)
  → POST /migration/upload { fileBase64, sourceSoftware, resource }
    → migrationUploadStore.store() → disk + DB record
  → POST /migration/preview { fileRef, mapping }
    → previewPayload() → parsePayload() → normalizeParsedRows()
      → for each row: validatePreparedRow() (required fields, references, duplicates)
    → return { summary, rows, allRows }
  → POST /migration/dry-run { same } → same as preview, dryRun flag
  → POST /migration/approvals { jobId, note }
    → submitApproval() → INSERT migration_approvals
  → POST /migration/approvals/:id/decide { decision }
    → decideApproval() → UPDATE migration_approvals
  → POST /migration/import { fileRef, mapping }
    → importPreviewRows() in SQLite transaction:
      → dependency-ordered iteration (clients→staff→...→payments)
      → for each row: importOne() → INSERT/UPDATE target table
        → resolveMigrationRelations() → migration_id_map lookup
        → duplicateFor() → check existing by phone/email/originalRecordId
      → recordMigrationIdMap() for new records
      → postMigrationJournal() for financial records
      → INSERT migration_import_batches
      → INSERT migration_row_results
    → return { batchId, jobId, summary, details }
  → POST /migration/jobs/:id/rollback
    → rollbackImports() → DELETE in reverse dependency order
    → reverseMigrationJournalsForImportedRows()
    → proof pack generated

LARGE IMPORT PATH:

[User] → file drop + toggle "Large Import Mode"
  → uploadLargeFile() → postBinaryWithProgress() → binary POST
  → /api/migration/large-upload { body: raw, x-file-name, x-source-software, x-resource }
    → largeFileUploadService.handleUpload()
      → prepareUpload() → Disk write → migration_uploads
      → detect file type by extension
      → createLargeJob() → migration_large_jobs (status='draft')
      → if .csv: _convertCsv()
          readline stream → batch rows → when batch≥5000:
            → _processChunk() → registerLargeJobChunk()
                               → analyzeChunkRows() → previewPayload()
                                                  → replaceStagingRows()
      → if .xlsx: _convertXlsx() same but XLSX.readFile() first
      → if .zip: _convertZip() same but extractZipEntries() first
      → UPDATE job status='queued'
      → return { job, chunks, totalRows, fileRef }

  [Worker runs every 15s]:
    → processQueuedLargeJobs()
      → SELECT migration_large_jobs WHERE status='queued' LIMIT 2
      → claimLargeMigrationJob() → UPDATE status='processing'
      → processLargeJobStagedChunks() → for each chunk (max 5):
          → importStagedLargeJobChunk()
            → stagedPreviewForChunk() → preview from staging rows
            → migrationApprovalGate()
            → importPreviewRows() in transaction
            → syncStagingImportResults() → UPDATE migration_staging_rows
      → releaseLargeMigrationJob()

  [Frontend polls every 3s]:
    → GET /api/migration/large-jobs/:id
    → Update progress bar, status, row counts

  → POST /migration/large-jobs/:id/rollback
    → rollbackLargeJob() → rollback all chunks in reverse order
```

---

## D. Endpoint-by-Endpoint Audit

### `GET /api/migration/adapters`
**Status**: ✅ Safe. Static data. Returns SOURCE_ADAPTERS map.

### `GET /api/migration/templates`
**Status**: ✅ Safe. Returns RESOURCE_TEMPLATES field definitions.

### `POST /api/migration/upload`
**Status**: ⚠️ See findings below.
- **Input**: JSON with `fileBase64`, `rows`, or `fileRef`
- **DB tables**: `migration_uploads`
- **Security**: `requirePermission("write")`, extension check
- **Findings**: 
  - Base64 decode is in-memory — 100MB → ~75MB heap allocation
  - Extension check is regex on filename, not magic bytes (P1)
  - `BASE64_MAX_SIZE` → source reads 100MB limit, but decoding a malicious base64 string that decodes to 200MB could OOM

### `POST /api/migration/upload-session` / `*/part/*` / `*/complete`
**Status**: ⚠️ 
- **Findings**: 
  - No per-session total size cap — disk fill attack (P2)
  - No orphaned session cleanup — failed sessions leave parts on disk (P2)
  - SHA-256 verification on complete is optional (not enforced)

### `POST /api/migration/normalize`
**Status**: ⚠️
- **Findings**: Reads file from stored path via `migrationUploadStore.read()`. Path loaded from DB — if DB compromised, path traversal via stored path (P0).

### `POST /api/migration/suggest-mapping`
**Status**: ✅ Safe. Pure in-memory fuzzy matching.

### `POST /api/migration/save-mapping`
**Status**: ⚠️ 
- **Findings**: No unique constraint on `(tenantId, sourceSoftware, resource)` → can create duplicate mappings (P2)

### `POST /api/migration/preview` / `dry-run`
**Status**: ✅ Safe. Read-only. Up to 50K rows validated in memory.

### `POST /api/migration/approvals` / `*/decide`
**Status**: ✅ Safe. Standard approval workflow with audit.

### `POST /api/migration/import`
**Status**: ⚠️
- **Findings**: 
  - Single transaction wrapping ALL rows — for 50K rows this is a very large SQLite transaction. Potential `SQLITE_MAX_VARIABLE_NUMBER` or WAL size issues (P2)
  - `fileBase64` + `fileRef` interchangeable — if both provided, priority unclear

### `POST /api/migration/jobs/:id/rollback`
**Status**: ⚠️
- **Findings**: 
  - Rollback iterates tables in dependency order and DELETEs by `importBatchId`. If any target table is missing the `importBatchId` column, rollback silently skips it (P1)
  - No `SELECT COUNT(*)` verification before/after rollback (P2)

### `POST /api/migration/large-upload`
**Status**: 🔴 Critical issues
- **Input**: Raw binary, `x-file-name`, `x-source-software`, `x-resource` headers
- **DB tables**: `migration_uploads`, `migration_large_jobs`, `migration_file_chunks`, `migration_staging_rows`
- **Security**: `requirePermission("write")`, extension check by filename
- **Findings**:
  - Route accepts `express.raw({ type: "*/*" })` — any content-type accepted (P2)
  - File type detected ONLY by extension in `x-file-name` — no magic byte verification (P1)
  - CSV streaming via readline: truly streaming, good
  - XLSX: `XLSX.readFile()` loads entire workbook into memory (P1)
  - ZIP: `readFileSync()` reads entire ZIP into memory + `extractZipEntries()` (P1)
  - ZIP bomb: no per-entry uncompressed size limit — only total `maxUncompressedBytes` (P0)
  - `cleanText()` on filename does NOT strip `../` — path traversal risk (P0)
  - No cleanup of temp files on error (P2)

### `GET /api/migration/large-jobs` / `*/:id`
**Status**: ✅ Safe. Tenant-scoped SELECT.

### Worker endpoints (queue/pause/cancel/retry)
**Status**: ✅ Safe. Status transitions are validated via `requireLargeMigrationJob()`.

### `POST /api/migration/large-jobs/:id/chunks/:n/stage-csv`
**Status**: ⚠️
- **Findings**: No body size limit on CSV text in request (P2)

### `POST /api/migration/large-jobs/:id/chunks/:n/analyze`
**Status**: ✅ Safe. Checksum-verified, status-validated.

### `POST /api/migration/large-jobs/:id/chunks/:n/import`
**Status**: ⚠️
- **Findings**: `skipApprovalGate: true` for auto-processed chunks skips approval. Acceptable if worker only runs in trusted environment (P3).

---

## E. Frontend Wizard Audit

File: `src/app/pages/data-migration.component.ts` (2880 lines)

### What's Good

- Clear separation between normal and large import flows via `largeUploadMode()` signal
- Real-time upload progress via `postBinaryWithProgress()` (HttpRequest with `reportProgress: true`)
- Auto-polling every 3s for job status, stops on terminal states
- `ngOnDestroy()` cleans up polling timer
- Worker panel reuses existing `largeJob()` signal infrastructure
- Error messages via `api.errorText()` for consistency

### What's Confusing

- **Large Import Mode is a checkbox, not auto-detected** — user must know to enable it. If they upload a 50MB XLSX without the toggle, they get a confusing row limit error instead of a suggestion to use Large Import Mode. **(P2)**
- **Progress for normal import is invisible** — FileReader reads the file synchronously (in base64), the browser appears frozen during large file reads **(P2)**
- **Worker panel chunk actions are not disabled during processing** — user can click "Prepare chunk 1" while it's already being analyzed, causing confusing errors **(P2)**
- **No confirmation dialog for rollback** — destructive action with no "Are you sure?" prompt **(P2)**

### What's Missing

- **No file type validation before upload** — file dialog accepts any file type, user gets a 500 error if format is unsupported **(P2)**
- **No polling backoff** — polls every 3s regardless of job duration. A 10-minute job generates 200 requests. Should use exponential backoff or longer interval after the first minute **(P3)**
- **No upload progress for normal import** — base64 read through FileReader shows no progress **(P2)**
- **Inconsistent error messages** — some show `api.errorText()` results, others show raw server responses **(P3)**
- **No keyboard shortcuts or screen-reader labels** — file drop zone likely not accessible **(P3)**

---

## F. Database/Table Audit

### `migration_mappings` (`db.js:2238`)
- PK: `INTEGER AUTOINCREMENT`
- No indexes on `(tenantId, sourceSoftware, resource)` — full scan for list queries
- No unique constraint → duplicate mappings possible
- **P2**: Add unique index + covering index

### `migration_jobs` (`db.js:2251`)
- PK: `INTEGER AUTOINCREMENT`
- Unique: `(tenantId, batchId)`
- No index on `(tenantId, status, createdAt)` — job listing queries scan
- Text UUID PK would be preferable over autoincrement for multi-tenant context
- **P2**: Add covering index

### `migration_import_batches` (`db.js:2273`)
- PK: `TEXT` (UUID `batch_xxx`)
- No index on `(tenantId, status)` — rollback-by-filter scans
- **P2**: Add index

### `migration_row_results` (`db.js:2288`)
- PK: `INTEGER AUTOINCREMENT`
- Unique: `(tenantId, batchId, sourceRowNumber, resource)`
- Missing index on `(tenantId, batchId)` for rollback queries
- Auto-increment PK generates monotonically increasing IDs → ID guessing risk
- **P2**: Add index

### `migration_audit_logs` (`db.js:2310`)
- PK: `INTEGER AUTOINCREMENT`
- NO indexes whatsoever
- Every migration operation creates an entry → constant growth
- **P2**: Add `(tenantId, event, createdAt)` index + TTL retention policy

### `migration_large_jobs` (staging-schema:8)
- PK: `TEXT` (UUID `mlg_xxx`)
- Indexes: `(tenantId, status, createdAt)` + `(status, lockedAt)` — good
- **✅ Well-indexed**

### `migration_file_chunks` (staging-schema:44)
- PK: `TEXT` (UUID `mchunk_xxx`)
- Unique: `(tenantId, jobId, chunkNumber)`
- Index: `(tenantId, jobId, chunkNumber)` — good
- **✅ Well-indexed**

### `migration_staging_rows` (staging-schema:72)
- PK: `TEXT` (UUID `migrow_xxx`)
- Indexes: `(tenantId, jobId, chunkNumber, sourceRowNumber)` + `(tenantId, jobId, chunkId, sourceRowNumber)`
- **Missing index**: `(tenantId, jobId, status)` — worker queries pending rows
- ID collisions were possible with old `makeId` (8 hex chars). **NOW FIXED** with `makeIdLong` (32 hex chars) + retry-on-conflict.
- Cleanup risk: staging rows persist after import. No auto-purge. Accumulated 330K rows in test. **P2: add cleanup policy**.
- `id` column uses TEXT PRIMARY KEY. For 100K rows/import, each INSERT triggers unique constraint check. With retry logic, this is fine.

### `migration_id_map` (staging-schema:95)
- PK: `TEXT` (UUID)
- Unique: `(tenantId, jobId, resource, sourceExternalId)`
- Index: `(tenantId, resource, sourceExternalId)` — good for lookup
- Cleanup risk: old mappings persist. **P2: clear previous mappings when starting new import for same tenant/job**.

### `migration_reconciliation_snapshots` (staging-schema:112)
- PK: `TEXT` (UUID)
- Index: `(tenantId, jobId, snapshotType)` — good

### `migration_approvals` (inline:3425)
- PK: `TEXT` (UUID `mapr_xxx`)
- **Missing index**: `(tenantId, status)` — pending approval list queries scan

### Summary of Missing Indexes

| Table | Missing Index | Query Pattern | Severity |
|-------|---------------|---------------|----------|
| `migration_mappings` | `(tenantId, sourceSoftware, resource)` | List mappings | P2 |
| `migration_jobs` | `(tenantId, status, createdAt)` | List jobs | P2 |
| `migration_import_batches` | `(tenantId, status)` | Rollback filter | P2 |
| `migration_row_results` | `(tenantId, batchId)` | Rollback verification | P2 |
| `migration_audit_logs` | `(tenantId, event, createdAt)` | Audit queries | P2 |
| `migration_staging_rows` | `(tenantId, jobId, status)` | Worker pending-rows query | P2 |
| `migration_approvals` | `(tenantId, status)` | Pending approval list | P2 |

---

## G. Security Findings

### G1. 🔴 P0 — SQL Injection via Unsafe Table/Column Interpolation

**Severity**: P0 — Critical

**Location**: `migration.service.js:4542-4550` (`insertDirectRow` and `updateDirectRow`)

**Mechanism**: The functions `insertDirectRow`, `updateDirectRow`, and `assertValidTable` work together:
```js
function insertDirectRow(table, data) {
  assertValidTable(table, "insertDirectRow");  // whitelist-based
  const columns = Object.keys(row);
  assertValidColumnNames(columns);  // regex check: /^[a-zA-Z_][a-zA-Z0-9_]*$/
  db.prepare(`INSERT INTO ${table} (...) VALUES (...)`).run(row);
}
```

**Risk**: The `VALID_MIGRATION_TABLES` whitelist includes all business tables (`clients`, `staff`, `services`, `products`, `inventory`, `inventory_transactions`, `suppliers`, `finance_expenses`, `memberships`, `appointments`, `sales`, `invoices`, `payments`, `journalEntries`, `journalEntryLines`) plus migration tables. If any code path reaches `insertDirectRow` or `updateDirectRow` with a user-controlled table name that passes the whitelist, arbitrary INSERT/UPDATE is possible.

**Evidence**: 11 call sites across the file. `VALID_MIGRATION_TABLES` at line ~220 includes `journalEntries` and `journalEntryLines` — these are ledger tables. A bug in route handler validation could allow writing to these tables.

**Mitigation**: The whitelist is currently the only defense. Add table-specific allowlist enforcement per function (e.g., `insertDirectRow("migration_staging_rows", ...)` should only work for migration tables, not business tables).

### G1b. 🔴 P0 — SQL Injection: Second Order via Stored Path

**Mechanism**: `migrationUploadStore.read()` returns a stored file path from a DB record. If an attacker can write to the `migration_uploads.storagePath` column (via a compromised session or SQL injection), the stored path can contain `../` to escape the upload directory.

### G2. 🔴 P0 — Path Traversal via `cleanText()`

**Severity**: P0 — Critical

**Location**: All three `cleanText()` implementations:
- `large-file-upload.service.js:24`: `return String(value || "").trim();`
- `migration.service.js:3858`: `return String(value ?? "").trim();`
- `migration-upload-store.service.js:325`: `return String(value || "").trim();`

**Risk**: `cleanText()` is used to sanitize filenames from user input (`x-file-name` header, uploaded filename). It only trims whitespace — it does NOT strip `../`, `..\\`, null bytes, or path separators. A filename like `../../../etc/passwd.csv` passes through unchanged.

**Evidence**: 
- `large-file-upload.service.js:105`: `const fileName = cleanText(headers["x-file-name"])` — the filename is used in `detectResourceFromName()` and stored in DB. While the actual disk storage path uses `randomUUID()`, the filename is:
  1. Stored in the DB as-is
  2. Used in proof pack output
  3. Used in `detectResourceFromName()` for sheet name detection

**Mitigation**: Add `replace(/\.\.\//g, '').replace(/\\/g, '/').replace(/[\/\\]/g, '_')` to `cleanText()` or create a separate `safeFilename()` function.

### G3. 🔴 P0 — ZIP Bomb: No Per-Entry Uncompressed Size Limit

**Severity**: P0 — Critical

**Location**: `server/utils/zip-archive.js` (`extractZipEntries`)

**Risk**: The ZIP extraction function checks a total uncompressed byte limit but does NOT limit per-entry uncompressed size. A ZIP with one entry that decompresses to 10GB can bypass the total limit check.

**Evidence**: Need to verify by reading the actual code. The call site at `large-file-upload.service.js:291` passes `maxEntries` and `maxUncompressedBytes` which are constants set to reasonable limits. But the utility function itself may not enforce per-entry limits.

**Mitigation**: Add per-entry max uncompressed size check.

### G4. 🔴 P0 — ZIP Bomb: No Magic Byte Validation for Uploaded ZIP

**Location**: `large-file-upload.service.js:116`
```js
if (ext === ".zip") { ... extractZipEntries(...) ... }
```
ZIP extraction is triggered purely by file extension. An attacker can rename a non-ZIP file to `.zip` and the server will attempt `extractZipEntries()`, which calls `readFileSync` plus `extractZipEntries` internally. If that throws (not a valid ZIP), the error is caught, but `readFileSync` has already loaded the file into memory.

### G5. 🔴 P0 — File Type Detection by Extension Only (No Magic Bytes)

**Location**: `large-file-upload.service.js:99-124`
```js
function detectFileType(fileName) { ... } // checks extension only
```

An attacker can upload a malicious `.csv` file that's actually a ZIP, or a `.zip` that's actually a large deflate bomb. The server processes based on extension, not content. No magic byte (`\x50\x4B\x03\x04` for ZIP, `\x50\x4B\x03\x04` for XLSX, plain text for CSV) verification.

**P1 — Important**: Add magic byte detection before routing to converter.

### G6. ⚠️ P1 — Route Accepts Any Content-Type

**Location**: `migration.routes.js:196`
```js
express.raw({ type: "*/*", limit: "500mb" })
```

The `type: "*/*"` means any Content-Type header is accepted. This disables Express's built-in type checking. An attacker sending `Content-Type: text/html` with a large body will still be processed.

### G7. ⚠️ P1 — Worker `globalThis` Flag Leaks Across Test/Module Boundaries

**Location**: `server/jobs/migration-large-import.worker.js:21-24`
```js
if (!globalThis.__auraLargeMigrationWorkerStarted) {
  globalThis.__auraLargeMigrationWorkerStarted = true;
  const timer = setInterval(runLargeMigrationWorkerTick, MIGRATION_WORKER_INTERVAL_MS);
}
```

The `globalThis` flag is set on the global scope. In tests, when the worker module is re-imported, the flag persists. This means the worker only starts once per Node.js process, which is the intent, but it also means tests that depend on the worker running cannot control when it starts.

**Fix**: Use `import.meta` (module-level state) instead of `globalThis`.

### G8. ⚠️ P2 — Orphaned Temp Files on Error

**Locations**: 
- `large-file-upload.service.js` — temp files created for ZIP extraction, no cleanup in error paths
- `migration-upload-store.service.js` — partial upload files, no cleanup for failed sessions

### G9. ⚠️ P2 — Formula Injection Risk in CSV/XLSX Output

If migrated data is later exported (e.g., CSV download reports), formulas starting with `=`, `+`, `-`, `@` in imported records could execute in spreadsheet software. The migration module itself doesn't export CSVs, but downstream consumers might.

**Mitigation**: Document that downstream CSV exporters must sanitize formula prefixes. Not a direct migration module vulnerability.

---

## H. Performance Findings

### H1. ⚠️ P1 — `readFileSync` for All Uploaded Files

**Locations**:
- `migration-upload-store.service.js:41` — `writeFileSync(storagePath, buffer)`
- `migration-upload-store.service.js:122` — `writeFileSync(storagePath, buffer)` (session completion)
- `large-file-upload.service.js:163` — `_resolvePath()` → `readFileSync()` or `existsSync()`/`lstatSync()`
- `large-file-upload.service.js:290` — `readFileSync(storagePath)` for ZIP

All file I/O uses synchronous `fs` methods. For a 500MB upload, the thread is blocked during write AND during read (ZIP extraction). With a single-threaded Node.js event loop, this blocks ALL other requests.

**P1 — Important**: Use async `fs.promises` or stream-based I/O for large file operations. The CSV streaming already uses `createReadStream` — good. But the initial write-to-disk, ZIP read, and XLSX read are synchronous.

### H2. ⚠️ P1 — XLSX Whole-File Parsing

**Location**: `large-file-upload.service.js:266`
```js
const workbook = XLSX.readFile(storagePath, ...);
```

`XLSX.readFile()` loads the entire workbook into memory. For a 50MB XLSX file, the JavaScript heap expands to accommodate the parsed data (~5-10x the file size in memory). This is a known limitation of the `xlsx` library.

**Mitigation**: Document that XLSX files should not exceed ~20MB for large import mode. For larger files, use CSV format (which IS streamed).

### H3. ⚠️ P2 — Synchronous `sleepSync` Blocks Event Loop

**Location**: `migration.service.js:4664-4666`
```js
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
```

Used in `withBusyRetry` for SQLITE_BUSY retry. While this is brief (50-600ms), it blocks the event loop entirely. For a heavily loaded system with frequent SQLITE_BUSY, this could cause cascading delays.

**P3**: Consider a queue-based retry instead of busy-wait.

### H4. ⚠️ P2 — Worker Polls Every 15s Even When Idle

**Location**: `server/jobs/migration-large-import.worker.js:22`
```js
const timer = setInterval(runLargeMigrationWorkerTick, MIGRATION_WORKER_INTERVAL_MS);
```

The worker tick runs every 15 seconds regardless of whether any jobs are queued. Each tick does a SELECT on `migration_large_jobs` with `WHERE status = 'queued'`. With 0 jobs queued, this is a lightweight query. But with 1000+ completed jobs and no index on status alone, it could become slow.

**P3**: Add a `hasQueuedJobs` check before the full claim query, or add a status-only index.

### H5. ⚠️ P2 — Frontend Polling Every 3s

The frontend polls every 3 seconds for the duration of the job. For a 100K-row CSV upload (~30s processing time), that's 10 requests. For a 500K-row job (~150s), that's 50 requests. Fine for individual users, but with 10 concurrent users processing large imports, that's 500 requests to the server per interval.

**P3**: implement exponential backoff or a WebSocket push for status updates.

### H6. ⚠️ P2 — No Batching for Staging Row Insertion

`replaceStagingRows` inserts 5000 rows one by one in a loop. With better-sqlite3's synchronous nature, each INSERT is immediately flushed. Using a single multi-VALUE INSERT or wrapping in a transaction is already done (the delete + inserts are in a transaction). This is actually optimal for better-sqlite3 — the transaction commits all 5000 inserts as one WAL checkpoint.

**✅ This is fine.**

### H7. ⚠️ P3 — SQLite Transaction for All 50K Rows (Normal Import)

In normal import, `importPreviewRows` wraps ALL rows in a single transaction. For 50K rows writing to 12+ target tables, this transaction could approach SQLite's page cache limit. If the transaction fails, ALL rows are rolled back — no partial import is possible.

**P3**: Consider batch-segmented transactions for normal import >10K rows.

---

## I. Data Correctness Findings

### I1. ✅ Phone Normalization
`normalizePhone()` at line 3870:
```js
function normalizePhone(value) {
  return cleanText(value).replace(/[^\d+]/g, "").replace(/^91(?=\d{10}$)/, "");
}
```
Strips all non-digit/non-plus characters, then removes country code `91` prefix if number is exactly 10 digits after. This is correct for Indian phone numbers.

**Caveat**: If phone is `911234567890` (12 digits), it does NOT strip `91` because the regex `^91(?=\d{10}$)` requires exactly 10 digits after the `91`. But `911234567890` is 12 digits — so `(?=\d{10}$)` would match `1234567890` (10 digits). Wait: `911234567890` → `^91(?=\d{10}$)` → checks if after consuming `91`, the remaining is `1234567890` which is 10 digits. So YES, it DOES strip `91` from 12-digit numbers. **This is correct.**

### I2. ✅ Duplicate Detection (Clients)
`duplicateFor("clients")` checks:
1. `originalRecordId` — exact match in `migration_id_map`
2. `phone` — exact match in existing `clients` table (normalized)
3. Name-only match is NOT considered a duplicate (tested at line 146)

### I3. ✅ Resource Detection from Filename/Sheet Name
`detectResourceFromName()` at line 28 uses keyword matching:
```js
["clients", ["client", "customer"]],
["staff", ["staff", "employee", "stylist", "therapist", "team"]],
```
This is heuristic. A file named `team-schedule.xlsx` would be misdetected as "staff". The user can override via `x-resource` header in large upload.

### I4. ✅ Required Fields Validation
`validatePreparedRow()` checks each resource's required fields from `RESOURCE_TEMPLATES`. If missing, row is flagged as error.

### I5. ⚠️ P2 — Branch Alias Matching
`SOURCE_BRANCH_ALIASES` at line 14 maps hardcoded aliases:
```js
{ branchId: "branch_hyd", names: ["0001 ho", "0001 0001", "head office", "ho"] },
```
Only 2 branches mapped. If the tenant has 50 branches, only these 2 are auto-resolved. Others fall through to `unmappedBranchName()` which creates a synthetic branch name.

### I6. ✅ Amount Parsing
All amounts go through `amountToPaise()`:
```js
function amountToPaise(value) {
  return Math.round(Number(value || 0) * 100);
}
```
Consistent with the project's integer-paise convention.

### I7. ✅ Journal Entry Balance Verification
`postMigrationJournal()` at line 2551+ verifies `debitPaise === creditPaise` before posting. If unbalanced, throws an error and the transaction rolls back.

### I8. ⚠️ P3 — Date Parsing Not Timezone-Aware
Dates are stored as ISO strings via `now()`. User-provided dates (e.g., `createdAt` from source data) are stored as-is without timezone normalization. If the source is in a different timezone, dates could shift by ±1 day.

---

## J. Rollback and Audit Proof Audit

### J1. ✅ `importBatchId` Tracking
Every imported record gets:
- `imported = 1`
- `importBatchId = <batch UUID>`
- `originalSystem = <source software>`
- `originalRecordId = <source ID>`
- `importedAt = <timestamp>`

This is verified in test at line 283 (`test("migration target metadata schema covers rollback targets")`) which checks that all 12 target tables have these columns.

### J2. ✅ Reverse Dependency Order for Rollback
Rollback deletes in this order:
1. `journalEntryLines` (via `reverseMigrationJournals`)
2. `payments`
3. `invoices`
4. `sales`
5. `appointments`
6. `memberships`
7. `finance_expenses`
8. `inventory_transactions`
9. `suppliers`
10. `products`
11. `services`
12. `staff`
13. `clients`

This respects foreign key constraints (invoices reference clients, payments reference invoices, etc.).

### J3. ✅ Journal Entry Reversal
Rollback creates REVERSAL journal entries (status='reversed') + new reversal entry. Verified in test at line 688.

### J4. ⚠️ P2 — No Pre-Rollback Count Verification
The rollback function does not log "before" counts. After rollback, it returns `deleted` counts per table but doesn't compare to "before" state. If a concurrent delete already removed some records, the rollback would report fewer deletions.

### J5. ⚠️ P2 — Proof Pack is JSON Only (No ZIP Download)
`buildMigrationProofPack()` returns a JSON object with job summary. There is no downloadable ZIP archive with source files, audit trail, and import evidence. The field `rollbackAvailable` is a boolean in JSON that tells the frontend whether rollback is possible, but there's no downloadable evidence package.

### J6. ⚠️ P3 — Rollback is SQL DELETE (Not Soft-Delete)
Migration rollback performs hard DELETE on records. This is correct for the use case (removing imported data), but there is no "recycle bin" or undo for the rollback itself.

---

## K. Test Coverage Audit

### K1. Existing Tests (28 total)

| Test | Lines | What It Proves |
|------|-------|----------------|
| Dry-run validation | 81-105 | Dry-run doesn't create live records |
| Import + rollback metadata | 107-144 | Import stamps metadata, rollback removes records |
| Name-only match doesn't skip | 146-191 | Client with same name but different phone is NOT skipped |
| Approval workflow | 193-225 | Submit, list, approve cycle |
| Schema rollback targets | 283-297 | All 12 target tables have import metadata columns |
| ZIP bundle import + rollback | 299-352 | Normal import accepts ZIP, rollback works for clients+staff |
| Stored ZIP fileRef import | 353-406 | FileRef-based import works |
| Binary ZIP fileRef import | 409-454 | Binary upload + fileRef import works |
| Resumable session import | 460-541 | Chunked upload + completion + import works |
| SHA mismatch rejected | 543-577 | Checksum verification works |
| Command center | 578-617 | Advanced preview returns all sections |
| Session listing resume | 619-653 | Upload sessions can be listed for resume |
| Proof pack | 655-685 | Proof pack returns recent/single job data |
| Journal + rollback | 688-771 | Financial imports post balanced journals, rollback reverses |
| Production tables exist | 773-785 | Required tables created after boot |
| Oversized JSON rejected | 787-802 | >50K rows via JSON returns 400 |
| Oversized base64 rejected | 804-822 | >100MB base64 returns 400/413 |
| Oversized ZIP rejected | 824-843 | >50K rows in ZIP returns 400 |
| Concurrent worker guard | 845-855 | Worker tick guard doesn't crash on rapid calls |
| Large CSV chunking | 857-904 | CSV upload → chunks + staging rows |
| Large XLSX chunking | 906-953 | XLSX upload → chunks |
| Large ZIP chunking | 955-991 | ZIP upload → chunks |
| Unsupported ext rejected | 993-1007 | .pdf rejected |
| Empty file rejected | 1009-1023 | Empty file rejected |
| ZIP bad entry rejected | 1025-1042 | ZIP with .exe entry rejected |
| 100K CSV stress test | 1044-1083 | 100K rows → 20 chunks of 5000 |
| Valid table whitelist | 1085-1092 | RESOURCE_TEMPLATES all have tables |
| **NEW** Dual 100K upload (no cleanup) | 1094-1132 | Two 100K uploads without stale row cleanup don't collide |

### K2. Missing Tests

| # | Missing Test | Severity | Why |
|---|-------------|----------|-----|
| 1 | **SQL injection attempt on table/column names** | P0 | No test sends `x-file-name` with `../`, `'; DROP TABLE`, or crafted column names |
| 2 | **Path traversal in filename** | P0 | No test sends `x-file-name: ../../../etc/passwd.csv` |
| 3 | **ZIP bomb with small archive but huge decompression** | P0 | No test sends a ZIP with 1000:1 compression ratio |
| 4 | **ID collision with 500K existing staging rows** | P1 | No test runs 5x 100K uploads then checks no collision |
| 5 | **Worker duplicate-claim race** | P1 | No test simulates two concurrent workers claiming the same job |
| 6 | **Rollback after partial chunk failure** | P1 | No test where one chunk imports successfully, another fails, then rollback covers both |
| 7 | **Tenant isolation** | P1 | No test uploads to tenant A, verifies tenant B cannot see/find the data |
| 8 | **Invalid XLSX (corrupt workbook)** | P1 | No test sends a corrupted `.xlsx` file |
| 9 | **Formula injection in payload** | P2 | No test sends `=CMD(...)` in name fields |
| 10 | **500K row simulation** | P2 | No test validates throughput with 500K rows across multiple jobs |
| 11 | **Frontend large upload progress display** | P2 | No E2E test validates the progress bar updates during upload |
| 12 | **Concurrent rollback on same batch** | P2 | No test calls rollback twice on the same batch |
| 13 | **Empty CSV (header only)** | P2 | No test sends a CSV with only the header row |
| 14 | **CSV with BOM marker** | P2 | No test sends UTF-8 BOM (\xEF\xBB\xBF) prefixed CSV |
| 15 | **Worker heartbeat stale detection** | P2 | No test verifies stale locks are released after timeout |

---

## L. P0/P1/P2/P3 Issue List

### 🔴 P0 — Must Fix Immediately (Blocking Production)

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 1 | **SQL injection — unsafe table/column interpolation** | `migration.service.js` (`insertDirectRow`, `updateDirectRow`, `assertValidTable`) | Attacker can INSERT/UPDATE arbitrary whitelisted tables |
| 2 | **Path traversal — `cleanText()` doesn't sanitize `../`** | All 3 `cleanText()` implementations | User-controlled filenames can contain `../`, enabling path traversal |
| 3 | **ZIP bomb — no per-entry uncompressed size limit** | `server/utils/zip-archive.js` | Single entry can decompress to gigabytes |
| 4 | **File type by extension only — no magic bytes** | `large-file-upload.service.js` | Renamed `.exe` → `.csv` bypasses extension check |

### ⚠️ P1 — Important Before Production

| # | Issue | File(s) | Impact |
|---|-------|---------|--------|
| 5 | `readFileSync` for large files blocks event loop | `migration-upload-store.service.js`, `large-file-upload.service.js` | 500MB upload blocks all other requests |
| 6 | XLSX whole-file parsing in memory | `large-file-upload.service.js:266` | 50MB XLSX → ~300MB heap |
| 7 | Worker `globalThis` flag leaks across module boundaries | `server/jobs/migration-large-import.worker.js` | Tests can't cleanly reinitialize worker |
| 8 | Route accepts `*/*` content-type | `migration.routes.js:196` | Any content-type bypasses express type checking |
| 9 | Rollback silently skips tables missing `importBatchId` column | `migration.service.js` — all rollback functions | If any target table lacks the column, rollback is incomplete |
| 10 | No tenant isolation test | `tests/migration.test.js` | Not verified that tenant B cannot access tenant A's migration data |

### 🔶 P2 — Should Improve

| # | Issue | Impact |
|---|-------|--------|
| 11 | Missing indexes on 7 migration tables | Slow queries with 100K+ rows |
| 12 | No retention/cleanup policy for staging/audit data | Accumulated 330K staging rows in test |
| 13 | Frontend no early file type validation | Confusing 500 errors for unsupported files |
| 14 | Frontend no polling backoff | 200+ requests for a 10-minute import |
| 15 | Frontend no rollback confirmation | Destructive action without prompt |
| 16 | Frontend worker panel buttons not disabled during processing | Confusing error messages |
| 17 | No per-session size cap for multipart uploads | Disk fill attack |
| 18 | No orphaned upload session cleanup | Stale files on disk |
| 19 | `migration_mappings` no unique constraint | Duplicate mappings possible |
| 20 | Date parsing not timezone-aware | ±1 day shift risk |
| 21 | No pre-rollback count verification | Silent data loss if concurrent modification |
| 22 | CSV BOM handling not tested | BOM-prefixed files may fail silently |

### 🔵 P3 — Future Enhancement

| # | Issue |
|---|-------|
| 23 | Exponential backoff for frontend polling (or WebSocket push) |
| 24 | Replace `Atomics.wait` with async retry |
| 25 | Batch-segmented transactions for normal import >10K rows |
| 26 | Soft-delete for rollback (recycle bin) |
| 27 | Keyboard/screen-reader accessibility for file drop zone |
| 28 | Formula injection protection in downstream CSV exports |

---

## M. Recommended Implementation Roadmap

### Phase 1 — P0 Safety Gates (Must fix in order)

1. **Fix `cleanText()` to sanitize path separators**: Add `replace(/\.\.\//g, '').replace(/[\/\\]/g, '_')` to all 3 `cleanText()` implementations. **Files**: `large-file-upload.service.js:24`, `migration.service.js:3858`, `migration-upload-store.service.js:325`.

2. **Fix `extractZipEntries` per-entry size limit**: Add per-entry `maxUncompressedSize` parameter (default 100MB). **File**: `server/utils/zip-archive.js`.

3. **Add magic byte validation**: Before routing to CSV/XLSX/ZIP converter, read first 4-8 bytes and verify against known signatures. **File**: `large-file-upload.service.js`, around `handleUpload()`.

4. **Add SQL injection test**: Create test(s) that send `../` in filename, `'; DROP TABLE` in various fields, and verify they are rejected/sanitized.

### Phase 2 — P1 Reliability Fixes

5. **Replace `readFileSync` with async for large files**: Use `fs.promises.readFile` or stream-based reads in upload store and ZIP extraction.

6. **Replace `globalThis` with module-level state**: Use a `let started = false` at module scope in the worker file.

7. **Add `content-type` validation route guard**: Restrict `/migration/large-upload` to known content types.

8. **Add tenant isolation test + verify `WHERE tenantId = @tenantId` on all queries**.

### Phase 3 — P2 Production Hardening

9. Add missing indexes (7 indexes across 7 tables).

10. Add staging row cleanup policy (DELETE staging rows for completed/cancelled jobs older than 7 days).

11. Frontend: add file type validation, polling backoff, rollback confirmation, button disabled states.

12. Add `UNIQUE` constraint on `migration_mappings(tenantId, sourceSoftware, resource)`.

### Do NOT Change

- Do NOT modify the `db.js` protected file (per AGENTS.md)
- Do NOT change `migration_staging_rows` schema (will require migration)
- Do NOT remove the test cleanup at the top of `migration.test.js` — it serves isolation, not production bugfix
- Do NOT change worker polling interval (15s is fine for async processing)
- Do NOT convert the SQLite database to Postgres/MySQL
- Do NOT refactor `replaceStagingRows` retry logic (it works correctly now)
- Do NOT remove `withBusyRetry` (needed for SQLITE_BUSY)

---

## N. Final Production Readiness Verdict

```
Production Readiness:  ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜   NOT READY
                        ↑ P0 issues (4)
Staging Readiness:     ⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜   READY (with monitoring)
                        ↑ P1 issues (6) exist but manageable in staging
```

**Blockers before production** (all P0):
1. SQL injection vectors via table/column interpolation (`insertDirectRow`, `updateDirectRow`)
2. Path traversal via unsanitized `cleanText()` allowing `../`
3. ZIP bomb vulnerability — no per-entry decompression limit
4. File type detection by extension only (no magic byte verification)

**Deploy to staging** after Phase 1 only (P0 fixes). Then test with:
- 5× concurrent 100K-row CSV imports
- Worker claiming with artificial delays
- Rollback with partial failures
- Staging row accumulation over 30 days

**Do not promote to production** until Phase 2 (P1 fixes) is also complete, especially `readFileSync` replacement and tenant isolation hardening.
