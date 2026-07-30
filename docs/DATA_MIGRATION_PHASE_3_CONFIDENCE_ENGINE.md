# Data Migration Phase 3: Mapping Suggestion and Confidence Engine

Status: implemented on 29/07/2026. Rule version: `2026-07-phase3-v1`.

## Deterministic score

Every source column is scored against every field in the selected fixed CRM entity:

| Signal | Weight |
| --- | ---: |
| Header and layered alias similarity | 35% |
| Profiled value datatype and pattern | 30% |
| Selected entity and business context | 20% |
| Related uniquely identifiable source columns | 15% |

Scores use normalized strings, fixed aliases, provider rules, tenant-approved aliases, Phase 1 datatype/pattern statistics and masked samples. Targets are ordered by score descending and CRM field name ascending, so ties are reproducible.

## Result contract

`POST /api/v1/settings/integrations/import-mapping-suggestions` returns the rule version, deterministic SHA-256 fingerprint, safe mapping, blocking issues and one decision per source column. A decision contains:

- Top target and up to three alternatives.
- Confidence percentage and Green/Yellow/Red state.
- Suggestion and rejection reasons.
- Detected datatype and masked sample evidence.
- Required transformation from the CRM schema contract.
- Alias level, ambiguity and collision state.

Green automatic mapping requires score 85 or above and at least a 10-point lead over the next target. Yellow/Red mappings are not returned as executable automatic mappings. Multiple source columns targeting one CRM field remain blocked.

## Write and validation boundary

- The Rust engine owns all weights, sorting, thresholds and final mapping decisions.
- Optional external AI output is returned only as a labelled semantic advisory; it is excluded from the deterministic score, blockers, fingerprint and executable import mapping.
- Suggestions never write CRM business rows.
- Exact/manual/saved mappings still run through source existence, CRM target, duplicate target, datatype and transformation validation.
- Strong datatype conflicts such as phone values mapped to email are blocked even after manual selection.
- Explicit `__ignore` is validated and preserved for the worker so ignored columns cannot be silently auto-mapped later.
- CSV analysis profiles values in the backend. Uploaded CSV/XLSX/ZIP imports reuse the immutable Phase 1 profile, including PII-masked evidence.
