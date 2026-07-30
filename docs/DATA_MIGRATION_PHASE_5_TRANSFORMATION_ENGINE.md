# Data Migration Phase 5 — Versioned Transformation Engine

Status: implemented in the shared Rust migration adapter. Phase 6 is not included.

## Fixed behavior

- Transformer version: `2026-07-phase5-v1`.
- Every inline and large import stores `transformationVersion` in `analysis_json`.
- A worker only stages a job with the transformer version captured by that job. Unsupported historical versions fail closed instead of silently changing results.
- Every row stores `__migration_evidence` inside the existing tenant-scoped `source_payload`:
  - immutable source header/value map;
  - source and CRM field names;
  - original value;
  - transformer name and version;
  - transformed value;
  - phone extension and source timezone when present;
  - warnings and errors.
- Live CRM writes still use the existing approval, quarantine, chunk-checksum and apply paths. Evidence keys are not dynamic CRM columns.

## Transformations

### Phone

- Indian 10-digit, leading-zero and `+91` formats normalize to E.164.
- Spaces, brackets and hyphens are accepted.
- Extensions are separated and retained in evidence.
- Scientific notation, invalid letters, invalid lengths and invalid extensions are Red row errors.
- Existing duplicate checks continue to use the normalized phone value.

### Money

- Major INR values convert to checked signed 64-bit integer paise without floating-point arithmetic.
- `₹1,250.50`, `₹0.99` and `-₹500` become `125050`, `99` and `-50000`.
- Explicit `Paise` columns remain integer paise.
- Unsupported currency, scientific notation, overflow and more than two decimals are Red errors. Implicit rounding is disabled.
- Negative money is allowed only for payroll `adjustmentPaise`; all other money fields reject it before import.

### Date and time

- `DD/MM/YYYY`, `DD-MM-YYYY`, ISO dates, approved Excel serial dates and supported datetimes normalize deterministically.
- Ambiguous day/month values are interpreted as India-locale `DD/MM/YYYY` only after mapping governance and retain an `AMBIGUOUS_DATE_INTERPRETED_DMY` warning.
- Naive datetimes use the source default `+05:30`; explicit RFC3339 offsets are preserved in evidence. CRM payloads use UTC RFC3339.
- Impossible or unsupported dates are Red errors.

### Status, gender and empty markers

- Status aliases normalize deterministically and are then checked against the target entity's fixed allowed values. Unknown statuses are blocked with `UNKNOWN_STATUS_APPROVAL_REQUIRED`.
- Appointment `No Show`, `NS`, `no_show` and `no-show` normalize to the existing CRM value `no-show`.
- `M`, `Male`, `पुरुष`; `F`, `Female`, `महिला`; and `O`, `Other` normalize to `male`, `female` and `other`.
- Blank gender becomes `unspecified`; unknown sensitive values are never guessed.
- Blank, `NULL`, `N/A`, `NA`, `-` and `Not Available` are controlled empty values. A required field using one is a Red row error.

## Acceptance evidence

- The shared engine runs before every entity adapter, so file and provider imports use identical rules.
- Original source files remain immutable and row evidence remains in the existing tenant/branch-isolated migration records.
- Ready rows contain transformed values; failed rows remain quarantined with original evidence and exact issue codes.
- Unit coverage exercises phone variants/extensions/scientific notation, INR precision/overflow/negative policy, locale dates/ambiguous/impossible/Excel values, timezone conversion, status aliases, multilingual gender, controlled required empties and transformer-version evidence.
