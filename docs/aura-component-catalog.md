# Aura Component Catalog

This catalog defines the canonical shared UI surface after the selector cleanup. New work should import modern components from `src/app/shared/ui` and use the modern `aura-*` selectors. Legacy components remain available only as migration shims and use `aura-legacy-*` selectors.

## Canonical Components

| Selector | Class | Purpose | Notes |
| --- | --- | --- | --- |
| `aura-badge` | `AuraBadgeComponent` | Status and metadata badges | Use `variant`, `size`, and `dot` inputs instead of legacy tone-only badges. |
| `aura-button` | `AuraButtonComponent` | Shared action buttons | Supports `primary`, `secondary`, `ghost`, `danger`, and `link` variants. |
| `aura-card` | `AuraCardComponent` | Generic framed surfaces | Use for new cards; supports tone, variant, padding, radius, shadow, hover, and interactive states. |
| `aura-drawer` | `AuraDrawerComponent` | Overlay drawers | Modern API owns body scroll locking and two-way open state. |
| `aura-empty` | `AuraEmptyComponent` | Empty states | Uses modern `aura-button` for optional actions. |
| `aura-kpi-card` | `AuraKpiCardComponent` | Routed KPI metric cards | Keeps `.metric-card` for compatibility and adds Aura card utility classes. |
| `aura-page-header` | `AuraPageHeaderComponent` | Page title, actions, and breadcrumbs | Prefer over local header blocks for new shared pages. |
| `aura-skeleton` | `AuraSkeletonComponent` | Loading placeholders | Token-backed and safe for dark/high-contrast themes. |
| `aura-stat-strip` | `AuraStatStripComponent` | Compact metric strips | Use for grouped summary stats. |
| `aura-table` | `AuraTableComponent` | Data tables | Keeps `AuraCellDirective`, `AuraTableColumn`, and sort APIs public from the barrel. |
| `aura-tabs` | `AuraTabsComponent` | Module tabs and local segmented navigation | Use the modern typed tab API. |

## Legacy Shims

Legacy components are preserved for backward compatibility, but should not be used for new work.

| Selector | Class |
| --- | --- |
| `aura-legacy-badge` | `LegacyAuraBadgeComponent` |
| `aura-legacy-button` | `LegacyAuraButtonComponent` |
| `aura-legacy-drawer` | `LegacyAuraDrawerComponent` |
| `aura-legacy-empty` | `LegacyAuraEmptyComponent` |
| `aura-legacy-page-header` | `LegacyAuraPageHeaderComponent` |
| `aura-legacy-skeleton` | `LegacyAuraSkeletonComponent` |
| `aura-legacy-stat-strip` | `LegacyAuraStatStripComponent` |
| `aura-legacy-table` | `LegacyAuraTableComponent` |
| `aura-legacy-tabs` | `LegacyAuraTabsComponent` |

## Card Migration Rules

- Keep the old page class during migration, then pair it with `aura-card` utilities.
- Use `aura-card aura-card--type-metric` beside `.metric-card` for KPI surfaces.
- Use `aura-card aura-card--type-action` beside `.action-card` for action surfaces.
- Use `aura-card--status-pending`, `aura-card--status-completed`, `aura-card--status-cancelled`, or `aura-card--status-canceled` beside old booking/status classes.
- Legacy metric tones map to Aura utilities as `aura-card--tone-teal`, `aura-card--tone-violet`, `aura-card--tone-slate`, `aura-card--tone-green`, `aura-card--tone-amber`, `aura-card--tone-red`, `aura-card--tone-blue`, and `aura-card--tone-rose`.

## Import Rule

Import from the barrel for shared UI unless a component has a local-only reason to import directly:

```ts
import { AuraButtonComponent, AuraCardComponent, AuraTableComponent } from '../shared/ui';
```

Avoid importing from legacy folders in new code. Existing legacy imports should migrate to modern components in small, visually verified batches.