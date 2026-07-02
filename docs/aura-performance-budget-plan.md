# Aura Performance Budget Plan

Date: 2026-07-02
Scope: design-system CSS and shared UI migration performance guardrails.

## Current Baseline

- `npm run build` currently passes with warnings.
- Initial bundle budget warning is expected until broader app/code splitting work reduces the initial bundle.
- `staff-os-section.component.ts` currently exceeds the Angular component CSS warning budget.
- `src/styles.css` remains the runtime stylesheet and is documented in the CSS split plan as roughly 360 KB raw in this workspace.

## Design-System Targets

| Target | Threshold | When Enforced |
| --- | ---: | --- |
| Reusable Aura primitive CSS | < 50 KB gzipped | After token and Aura primitive extraction. |
| Shared UI selector uniqueness | 0 duplicates | Enforced now by `npm run audit:design-system`. |
| Legacy Aura leakage outside shared UI | 0 matches | Enforced now by `npm run audit:design-system`. |
| Token source drift | 0 runtime imports of `_tokens.scss` | Enforced now by `npm run audit:design-system`. |
| Card migration scope drift | Inventory updated per batch | Enforced by review and audit artifact presence. |

## Enforcement Sequence

1. Keep `npm run audit:design-system` and `npm run build` green for every design-system commit.
2. After token extraction, record extracted CSS size in this document.
3. After Aura primitive extraction, measure gzipped size of the primitive layer and compare to the 50 KB target.
4. Do not convert the 50 KB target to a hard failing build gate until the primitive layer is split from legacy feature CSS.
5. Keep Angular budget warnings visible in final summaries until fixed by dedicated performance work.

## Measurement Commands

After CSS splitting creates separate files, use platform-appropriate equivalents of:

```sh
npm run build
node scripts/audit-design-system.mjs
```

Then inspect generated CSS assets under `dist/aura-salon-crm-pos` and record raw plus gzip sizes for the Aura primitive layer.

## Non-Goals For Current Cleanup

- Do not lower Angular budgets just to make warnings disappear.
- Do not hide or drop feature CSS to meet a size target.
- Do not split CSS before card migrations and visual QA reduce cascade risk.