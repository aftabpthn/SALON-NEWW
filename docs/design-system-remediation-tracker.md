# Aura Design System Remediation Tracker

Source: `C:\Users\ADMIN\.codex\attachments\3fac217b-b697-4dfb-9443-44a7d6242a64\pasted-text-1.txt`

## Completed Foundation

- Duplicate Angular selectors were resolved by keeping modern Aura components on `aura-*` selectors and renaming legacy components to `aura-legacy-*` selectors/classes.
- Shared UI exports now expose modern Aura components and legacy aliases without same-name class/type collisions.
- Additional button/drawer selector ambiguity was removed by keeping modern `aura-button` and `aura-drawer` canonical and renaming legacy versions to `aura-legacy-button` and `aura-legacy-drawer`.
- A canonical Aura component catalog now documents modern selectors, legacy shims, barrel imports, and card migration rules.
- A repeatable `npm run audit:design-system` gate checks selector uniqueness, canonical/legacy selector contracts, legacy Aura template/import leakage outside shared UI, token bridges, card utility aliases, barrel exports, and catalog presence.
- A token source decision records `src/styles.css` as the current runtime token source and preserves `_tokens.scss` as legacy reference material until a generator/migration is approved.
- A card migration inventory records current legacy card-class footprint and safe migration order.
- A CSS split plan defines the future token, Aura primitive, layout, legacy-card, and feature-legacy layers plus extraction gates.
- An accessibility QA checklist covers keyboard, focus, contrast, semantics, card migration, shell preservation, and theme checks.
- A performance budget plan records current build warnings, future primitive CSS targets, and enforcement sequencing after CSS splitting.
- Global Aura token aliases now bridge the active `--color-*` runtime variables into `--aura-*` variables.
- Root layout/type/card aliases exist for `--radius-*`, `--space-*`, `--font-size-*`, `--metric-card-*`, `--kpi-*`, and `--card-*` tokens.
- A canonical standalone `aura-card` component exists with `tone`, `variant`, `padding`, `radius`, `shadow`, `hover`, and `interactive` inputs.
- Global `.aura-card--*` utility classes exist for incremental class-based migrations.
- `aura-kpi-card` now opts into the shared utility surface with `metric-card aura-card aura-card--type-metric aura-card--hover aura-card--interactive`, preserving legacy CSS behavior while joining the new card system.
- `app-metric-card` now emits the same `metric-card aura-card aura-card--type-metric aura-card--hover` bridge and pairs legacy tones with `aura-card--tone-*` aliases.

## Migration Rules

- Do not remove legacy card classes during migration; pair them with `.aura-card` utilities first.
- Prefer `aura-card` for new framed surfaces and repeated cards.
- For existing KPI surfaces, keep `metric-card` until the owning page has been visually checked, then add `aura-card aura-card--type-metric` and a tone alias.
- Legacy metric tones map forward as `teal`, `violet`, `slate`, `green`, `amber`, `red`, `blue`, and `rose` utility aliases; keep the legacy tone class while migrating.
- For action cards, use `aura-card aura-card--type-action` before removing any old `.action-card` styling.
- For booking/status cards, add `aura-card--status-pending`, `aura-card--status-completed`, `aura-card--status-cancelled`, or `aura-card--status-canceled` alongside the old status class.
- Page migrations must be incremental and verified with build plus visual inspection for the affected page.

## Remaining Work

- Migrate page-level card classes to `aura-card` or `.aura-card--*` utilities in small batches.
