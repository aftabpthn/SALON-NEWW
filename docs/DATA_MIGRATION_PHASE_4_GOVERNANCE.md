# Data Migration Phase 4 — Mapping Governance

## Scope

Phase 4 classifies every deterministic mapping decision with rule version
`2026-07-phase4-v1`. AI output remains advisory and cannot approve, score, or
write migration data.

| State | Score | Execution rule |
| --- | ---: | --- |
| Green | 90–100 | Auto-selected for dry-run only when datatype and value patterns are compatible, no target collision exists, required fields are covered, and no hard validation issue exists. |
| Yellow | 65–89 | Excluded from the executable mapping until a user with `data_migration.manage` approves the exact source-to-target decision. |
| Red | 0–64 or hard failure | Excluded and blocks the import. It cannot be approved or overridden. |

Yellow includes ambiguous headers, mixed patterns, ambiguous DD/MM versus
MM/DD dates, low score margin, and drift from a saved mapping. An approval is
bound to tenant, branch, entity, provider, rule version, source evidence
fingerprint, source column, and target field. Any source, profile, sheet,
mapping, provider, or rule-version drift changes the fingerprint and requires a
new approval.

Red includes incompatible datatypes, missing required coverage, invalid or
duplicate protected targets, and confidence below 65. Foreign-reference errors
remain row-level hard failures during validation. Financial reconciliation
mismatches remain cutover blockers and are not covered by mapping approval.

## Audit and access

Yellow approvals are immutable and idempotent in
`integration_import_mapping_approvals`. Each new approval also writes the
`migration.mapping.yellow_approved` audit event with the decision evidence and
actor. Mapping evaluation requires `data_migration.read` (or manage access);
mapping writes, approvals, uploads, job controls, and rollback require
`data_migration.manage`. Backend authorization is authoritative.

The UI always renders an icon and the text `Green — automatic`,
`Yellow — approval required/approved`, or `Red — blocked`; color is only a
secondary cue. Red has no approval or override action.

## Acceptance evidence

- Same source/profile/mapping and rule version produce the same decision and fingerprint.
- Green decisions alone enter the dry-run mapping automatically.
- Unapproved Yellow and every Red decision remain in `blockingIssues`.
- Approved Yellow enters the executable mapping only for its exact fingerprint.
- Critical datatype, required-field, reference, collision, and financial failures have no approval path.

Phase 5 is intentionally outside this document and implementation checkpoint.
