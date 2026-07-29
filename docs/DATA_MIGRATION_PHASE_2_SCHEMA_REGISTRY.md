# Data Migration Phase 2: CRM Schema Registry and Alias Dictionary

Status: implemented on 29/07/2026. Phase 2 resolves source headers into the fixed Phase 0 CRM contracts; it does not write business rows.

## Authoritative resolution order

1. Global datatype aliases such as phone, email and ambiguous `Contact`.
2. Entity aliases published by each fixed CRM field contract.
3. Provider aliases for Zenoti, DINGG and other explicitly supported exports.
4. Tenant-approved aliases stored by tenant, branch, entity and provider.
5. Exact saved mappings selected for a specific import.

The Rust migration adapter registry is the only matcher. The profiler, suggestion endpoint, CSV analysis and large-file worker consume its result. Angular displays backend decisions and submits approvals; it contains no alias dictionary. External AI cannot override registry decisions.

## Decision safety

- A source header is Green only when it resolves to one target.
- Multiple possible targets are Yellow and omitted from automatic mapping.
- Multiple source columns resolving to one target are Red collisions; all affected automatic mappings are omitted and job creation/staging is blocked.
- `Contact` remains ambiguous between phone and email until a tenant-approved alias or exact saved mapping selects one.
- Provider rules are combined with lower fixed layers. A conflicting provider rule becomes ambiguous instead of overriding global/entity behavior.
- Exact CRM field names cannot be approved as aliases for a different target.
- Saved mappings reject duplicate normalized source keys, unsupported targets and repeated target fields.

## Tenant aliases

`GET/POST /api/v1/settings/integrations/import-aliases` is protected by the existing `data_migration.read`/`data_migration.manage` permission boundary. PostgreSQL queries always include tenant and branch. Provider `auto` applies to that entity for all providers; an approved provider-specific row applies only to that provider.

## Mapping response

`POST /api/v1/settings/integrations/import-mapping-suggestions` returns safe `suggestions`, `unmatchedColumns`, per-column `decisions` and `blockingIssues`. Each decision includes source column, selected target, candidates, alias level, Green/Yellow/Red confidence, collision flag and reason.
