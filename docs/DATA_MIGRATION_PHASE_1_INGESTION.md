# Data Migration Phase 1: Immutable Source Ingestion

Status: implemented on 29/07/2026. Scope ends after verified source profiling; it does not approve or apply CRM business writes.

## Supported intake

- Multipart CSV, XLSX and ZIP upload.
- Zenoti authenticated API snapshots through the existing connector.
- DINGG authenticated export download through the existing connector.
- Approved Salonist, Fresha, Tally, Busy, Marg, Excel, CSV and Manual provider exports through the same fixed intake.

Provider connectors and browser uploads converge on `migration_file_service`; no provider gets a separate evidence or profiling path.

## Recorded source metadata

Upload session and immutable source records retain tenant, branch, uploader, original filename, declared and detected MIME type, size, provider, upload timestamps, plaintext SHA-256, part hashes, retention policy, evidence state and encryption scheme. ZIP artifacts retain entry filename, format, detected MIME type, size and plaintext SHA-256. The profile endpoint returns workbook/file names plus row and column counts per sheet.

Configured retention is `retentionDays` from 1 to 3650, default 90. When expired evidence is accessed, its encrypted source/artifact bytes are purged inside the tenant storage scope and the immutable metadata is moved through the only allowed `verified -> expired` transition with a system audit event.

## Immutability and encryption

- PostgreSQL rejects source-evidence update/delete operations. The only exception is the constrained retention expiry transition after `retention_until`.
- Completed original files and extracted ZIP artifacts are stored as read-only `aes-256-gcm-chunked-v1` ciphertext.
- The key is read from `MIGRATION_EVIDENCE_ENCRYPTION_KEY`, falling back to `SECURITY_ENCRYPTION_KEY`; completion fails closed if no key of at least 32 characters is configured.
- Encryption uses independent authenticated 1 MB chunks and a key derived with tenant and branch scope. Ciphertext copied to another tenant/branch cannot authenticate.
- Every profile, worker read and protected download decrypts into a tenant-scoped temporary file, recalculates the plaintext SHA-256 and requires it to match the immutable database hash.
- Temporary plaintext is deleted on stream/worker drop. Stale crash remnants older than one hour are removed only from the tenant runtime directory.

## File safety

- File size: 1 byte to 500 MB; upload parts: 1 byte to 8 MB; 1 to 1000 parts.
- Filename traversal, reserved Windows names, unsafe MIME/extension combinations and mismatched part/full hashes are rejected.
- CSV must be UTF-8, non-binary, parseable, have headers and contain a non-empty data row.
- XLSX must be a valid OOXML ZIP with required records, safe paths/ratios, at least one populated worksheet and no encrypted/password-protected package.
- ZIP is restricted to 300 CSV/XLSX entries, 250 MB per entry, 1 GB extracted total and 200:1 maximum compression ratio. Duplicate names, symlinks and unsafe paths are rejected.

## Column profile contract

`GET /api/v1/settings/integrations/import-source-files/:id/profile` returns each sheet/file with:

- Original and normalized header.
- PII-masked sample values.
- Detected datatype.
- Empty and unique percentages.
- Duplicate count.
- Minimum and maximum, masked for phone/email.
- Phone, email, date, currency, UUID and status patterns.
- Possible fixed CRM entity and field from the Phase 0 registry.
- Invalid value count.
- `statisticsExact` flag.

CSV and ZIP CSV entries are processed row-by-row. XLSX is decoded one worksheet at a time. Counters, patterns, minimum/maximum and invalid counts scan every row. Unique/duplicate statistics are exact through 100,000 non-empty values per column; above that they use the deterministic bounded sample and return `statisticsExact: false`. No values or learned aliases are shared across tenants or persisted as global learning.

## Security and write boundary

- Every repository query is tenant/branch scoped.
- Source evidence download remains protected by `data_migration.export`; profile/list reads use migration read/manage permissions.
- Audit events contain identifiers, hashes, sizes and formats only. Column samples never enter logs and phone/email samples returned by the profile are masked.
- Create upload, upload part, complete upload, list, profile and evidence download touch only integration control/audit tables and scoped evidence storage. They do not insert or update Clients, Staff, Services, POS, payments, inventory or any other live CRM business table.

## Production certification boundary

CSV processing is genuinely streaming and bounded-memory. ZIP entries are extracted and processed one at a time. Calamine decodes an XLSX worksheet into memory before its rows are profiled, so “crores of XLSX rows” requires an original maximum-size Zenoti/DINGG workbook benchmark. If that benchmark exceeds the approved memory budget, replace only the XLSX reader with a SAX OOXML row reader; the profile, encryption and fixed-contract layers remain unchanged.
