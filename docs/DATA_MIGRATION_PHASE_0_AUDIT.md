# Data Migration Phase 0 Audit and Fixed Contracts

Status: source-verified on 29/07/2026. Scope is Phase 0 only. Live Zenoti/DINGG certification still requires provider credentials and a real export.

## Fixed contract source of truth

`GET /api/v1/settings/integrations/import-templates` is the machine-readable contract registry. Contract version `2026-07-phase0-v1` is produced from `migration_adapter_service::templates`; the same fixed registry is used by mapping validation and row preparation.

Each entity returns:

```json
{
  "contractVersion": "2026-07-phase0-v1",
  "entity": "clients",
  "columns": [{
    "field": "phone",
    "required": true,
    "aliases": ["phone", "mobile", "mobile number", "contact number"],
    "dataType": "phone",
    "maxLength": null,
    "allowedValues": [],
    "referenceEntity": null,
    "defaultBehavior": "row_rejected_when_blank",
    "transformationRule": "trim_then_normalize_phone",
    "validationRules": ["required_non_blank"],
    "permission": "data_migration.manage"
  }],
  "duplicateDecisions": ["merge", "keep", "link"]
}
```

`maxLength: null` means the current importer has no explicit character limit. An empty `allowedValues` array means values are not enum-restricted by the current importer. These values are deliberate and must not be replaced by guessed limits.

Unknown source columns remain unmatched. `validate_mapping_contract` rejects every mapping target that is not in the selected entity contract. The importer writes only hard-coded business columns through typed entity branches. It never creates or alters CRM columns from source headers.

## Existing architecture audit

### Routes

All migration routes live under the tenant-protected `/api/v1/settings/integrations` router.

- Discovery and mapping: `GET import-templates`, `GET import-adapters`, `GET/POST import-mappings`, `POST import-mapping-suggestions`, `POST import-jobs/analyze`.
- Jobs: `GET/POST import-jobs`, `POST import-jobs/from-source`, `GET import-jobs/:id`, pause, resume, retry-failed, cancel, approval, rollback, rollback-impact, recovery, governance, monitoring, proof-pack and failed-rows.
- Large files: create/get upload session, upload part, complete upload, list/profile/evidence source files and list job chunks.
- Provider connectors: list/start connector, save credentials, sync, disconnect and list connector jobs.

### Services and repositories

| Layer | Existing responsibility |
|---|---|
| `migration_adapter_service` | Fixed aliases, provider normalization, mapping validation, dependency lookup, transformations, row validation and dry-run analysis |
| `migration_service` | Job orchestration, saved mappings, approval, governance, proof pack, recovery, rollback and worker processing |
| `migration_file_service` | Multipart intake, immutable source files, parsing/profile/evidence and worker source reads |
| `migration_large_import_service` | Chunk creation, pause/resume/retry/cancel and lease-based large-import workers |
| `migration_provider_service` | Zenoti/DINGG connector configuration, credentials, export/snapshot and sync validation |
| `migration_repository` | Transactional application, dependency resolution, duplicate decisions, audit, reconciliation and rollback |
| `migration_large_import_repository` | Staging rows, chunks, worker claims, checkpoints and retries |
| `migration_file_repository` | Upload sessions/parts, source files/artifacts and evidence audit |

### Migration control tables

- `integration_import_jobs`
- `integration_import_batches`
- `integration_import_row_results`
- `integration_import_audit_events`
- `integration_import_mappings`
- `integration_import_upload_sessions`
- `integration_import_upload_parts`
- `integration_import_source_files`
- `integration_import_source_artifacts`
- `integration_import_chunks`
- `integration_import_staging_rows`
- `integration_import_job_dependencies`
- `integration_connector_connections` for encrypted provider connector configuration

Historical bulk-import tables `staff_bulk_import_jobs` and `branch_bulk_imports` are separate feature flows; they are not the integration migration engine and must not be treated as its job/audit source.

### Controls already connected

- Dry-run uses the same adapter preparation and validation path as commit, without applying business writes.
- Commit jobs require approval when validation succeeds; approval/rejection is persisted with actor, time and note.
- Invalid rows are retained as `error` row results and exported through `failed-rows`; large imports keep staged rows and chunk failure state.
- Failed jobs/chunks support retry and checkpoint resume. Source hash/idempotency and prior row results prevent blind duplicate replay.
- Rollback uses per-row target IDs plus before snapshots and records recovery actions; financial entities have reconciliation/rollback handlers.
- Proof packs include source/target totals, mismatches, audit evidence and configured HMAC signing through `MIGRATION_PROOF_SIGNING_KEY`.
- Middleware requires `data_migration.read`/`data_migration.manage`; exports require `data_migration.export` or an authorised management role.
- Mapping suggestions may use the AI service, but results are constrained to known source headers and fixed target fields. AI does not write business records.

## Supported entity contracts and targets

All rows below are present in the fixed registry and the adapter/repository dispatch. Combined product terms such as “sales/invoices” are intentionally separate contracts so dependency order and rollback remain deterministic.

| Order | Contract entity | Main CRM target | Dependency/reference rule |
|---:|---|---|---|
| 1 | Clients | `clients` | Base entity |
| 2 | Staff | `staff`, `staff_profiles` | Base entity |
| 3 | Services | `services` | Base entity |
| 4 | Products | `inventory_items` | Base entity |
| 5 | Suppliers | `suppliers` | Base entity |
| 6 | Inventory | `inventory_items` stock | Product required |
| 7 | Memberships | `memberships` | Services optional |
| 8 | Client memberships | `client_memberships` | Client and membership required; staff optional |
| 9 | Packages | `packages` | Services required |
| 10 | Appointments | `appointments` | Client, staff and services required |
| 11 | Sales | `pos_sales`, `pos_sale_lines` | Client required; staff/item conditional |
| 12 | Invoices | `pos_sales` invoice fields | Client required; sale optional |
| 13 | Payments | `pos_payments`, `pos_sales` paid balance | Invoice required |
| 14 | Expenses | `outgoing_fund_vouchers`, `outgoing_fund_lines` | Financial posting rules |
| 15 | Purchase bills | `purchase_receipts`, `purchase_receipt_lines`, stock ledger | Product required |
| 16 | Refunds | `pos_invoice_refunds`, credit notes and allocations | Invoice required |
| 17 | Gift cards | `gift_cards`, `gift_card_transactions` | Client optional |
| 18 | Loyalty | `membership_reward_ledger` | Client required; invoice/staff optional |
| 19 | Payroll | `staff_payroll_runs`, `staff_payroll_items` | Staff required |
| 20 | Commissions | `pos_staff_commission_snapshots` | Invoice, sale line and staff required |
| 21 | Client notes | `client_notes` | Client required |
| 22 | Files | `client_treatment_photos` or `staff_files` | Polymorphic owner; appointment optional for client photo |
| 23 | Stock movements | `inventory_stock_ledger`, `inventory_items` | Product required |

Provider/file adapters currently include Auto, Zenoti, DINGG, Salonist, Fresha, Tally, Busy, Marg, Excel, CSV and Manual. File intake supports controlled CSV/XLSX/ZIP-style source artifacts through the upload/source-file pipeline. Zenoti has an authenticated connector/export path and DINGG uses its validated export configuration; domains absent from a provider API must arrive through the provider export files and the same fixed contracts.

## Missing, duplicate and disconnected checklist

| Check | Result | Evidence/decision |
|---|---|---|
| Dynamic columns blocked | PASS | Entity enum, fixed field arrays and `validate_mapping_contract`; no DDL exists in import execution |
| Every supported entity has machine-readable field metadata | PASS | 23 templates expose datatype, required, max length, values, reference, default, transform, validation and permission |
| Existing architecture reused | PASS | Existing template endpoint and adapter registry extended; no parallel registry or new table |
| Dry-run and commit share validation | PASS | Both use adapter preparation |
| Approval and audit actor persisted | PASS | Job approval fields and audit events |
| Retry/resume/idempotency | PASS | Chunk/job checkpoints, source hash, row results and idempotency keys |
| Rollback and financial recovery | PASS | Target IDs, before snapshots and entity-specific rollback |
| Failed-row quarantine | PARTIAL | Failed rows are isolated/exportable as `error`, but there is no explicit `quarantined` row status or release workflow |
| Green/yellow/red field confidence | MISSING | Suggestions return mapping plus unmatched fields, not per-field confidence/evidence |
| Value-pattern cross-check | PARTIAL | Datatype/reference validation blocks bad rows after mapping; pre-approval semantic conflict scoring is missing |
| Mapping profile reuse/drift detection | PARTIAL | Saved mappings exist; provider/sheet/header fingerprint, versions and drift warnings are missing |
| Mapping approval history | PARTIAL | Job approval is audited; separate field-by-field mapping approval/version history is missing |
| Source profiling depth | PARTIAL | Sheet/header/profile support exists; null ratio, uniqueness, inferred type and outlier distribution are missing |
| Explicit duplicate reject decision | MISSING | Merge/keep/link exist; no first-class reject decision |
| Gender contract | MISSING | Clients and Staff do not currently expose a gender field; it must be added only against a confirmed CRM schema/allowed-value contract |
| Notes/files coverage | PASS | Client notes and files are separate fixed entities |
| Provider completeness | PARTIAL | Connector/export mechanisms exist; direct domain coverage depends on the real provider API/export contract |
| Zenoti/DINGG production certification | BLOCKED EXTERNAL | Requires sandbox credentials and original ZIP/XLSX exports |
| Proof signing | READY WITH CONFIG | HMAC proof signing requires `MIGRATION_PROOF_SIGNING_KEY`; key custody/KMS is deployment-owned |
| Migration runbook link | DISCONNECTED | Monitoring references `docs/DATA_MIGRATION_RUNBOOK.md`, but the active runbook file is absent |
| Legacy bulk import duplication | DOCUMENTED | Staff/branch bulk-import tables remain separate; consolidation is a later scoped decision |
| Frontend access | CONNECTED | Data Migration sidebar entry routes to `/settings/integrations-data`; backend permissions remain authoritative |

## Phase 0 sign-off

- Engineering source audit: SIGNED OFF — fixed contracts and code paths verified on 29/07/2026.
- Contract registry completeness: SIGNED OFF — all 23 runtime entities are covered by one versioned machine-readable registry.
- No dynamic CRM columns: SIGNED OFF — unknown fields are unmatched/rejected, never converted into schema columns.
- Product/provider live certification: PENDING — cannot be truthfully signed without real Zenoti/DINGG credentials and exports.
- Phase 1 implementation items: NOT STARTED — confidence scoring, semantic preview blocking, explicit quarantine workflow and mapping-profile learning remain on the checklist above.
