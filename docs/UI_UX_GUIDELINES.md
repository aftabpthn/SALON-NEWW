# UI_UX_GUIDELINES.md — Frontend & Design Standards

> **Primary AI Role:** UI/UX Architect
> **Status:** Living document. Detailed tokens/components: `docs/DESIGN_SYSTEM.md`.

## 1. Purpose

Standards for the Angular 20 SPA: structure, components, state, design tokens,
responsiveness and UX rules for a busy salon front desk.

## 2. Frontend Architecture

- Angular 20, **standalone components**, pages under `src/app/pages`, shared services for API access.
- Dev server on `127.0.0.1:4300` with `proxy.conf.json` proxying `/api` to the backend (`:4000`).
- Lazy-load feature routes; keep initial bundle within the budgets in `angular.json`.
- RxJS for async; unsubscribe via `takeUntilDestroyed`/async pipe — no leaked subscriptions.
- White-label: colors/logos come from tenant theme tokens, never hard-coded brand values.

## 3. Design System

- Use the tokens (color, typography, spacing, radius, elevation) defined in `docs/DESIGN_SYSTEM.md`; no ad-hoc hex values in components.
- Controls, tables, forms and responsive states follow the Level 18 design-system artifacts.
- Icons and imagery follow the reference map (`docs/ZENOTI_16_IMAGE_REFERENCE_MAP.md`) where applicable.

## 4. UX Rules (salon operations first)

1. **Front desk speed:** common flows (walk-in, quick bill, check-in) reachable in ≤ 2 clicks from the calendar/POS.
2. **Realtime honesty:** WebSocket updates reflect on screen without refresh; optimistic updates roll back visibly on failure.
3. **Money display:** paise from the API formatted to ₹ with a single shared pipe/util — never re-computed per component.
4. **Errors are actionable:** show the envelope `error.message`; never a blank failure. The global Angular error boundary catches the rest.
5. **Destructive actions** (void, delete, refund) always confirm, state the consequence, and respect RBAC-hidden availability.
6. **Offline-aware:** POS/booking surfaces degrade to the offline workflows (local cache, sync conflicts surfaced) rather than freezing.
7. **IST everywhere:** all displayed times in IST; date pickers use business dates.

## 5. Forms & Validation

- Reactive forms with validators mirroring server rules; server remains authoritative.
- Inline field errors on blur/submit; disable submit while pending; preserve user input on failure.
- Phone numbers are the client identity key — normalize as the user types; names auto-case (`auto-name-case` behaviour).

## 6. Accessibility & Responsiveness

- Keyboard-operable POS and calendar (front desk works fast on keys).
- Sufficient contrast per design tokens; focus states never removed.
- Responsive: desktop-first for POS/calendar, fully usable on tablets; booking widget mobile-first (`docs/booking-widget.md`).

## 7. AI Instructions

- Match the structure and idiom of the nearest existing page in `src/app/pages` — do not introduce new state libraries or UI kits.
- UI change verification = `npm run build:client` (lean rule, AGENTS.md §4).
- Never gate security in the UI alone; hide-by-permission mirrors the API, which enforces.

## 8. Acceptance Criteria

- Build passes budgets; no hard-coded brand colors; no unmanaged subscriptions.
- Front-desk flows meet the ≤ 2-click rule.
- UI wiring test suites (`*-wiring.test.js`, `clients-layout.test.js`, `form-validation.test.js`) pass.

## 9. Future Roadmap

- Component gallery page documenting live design-system usage.
- UX metrics (task completion time) for front-desk flows.
