# DESIGN_SYSTEM.md - AuraShine UI Tokens

## Purpose

Compact operational design tokens for Angular CRM pages. Use this with
`docs/UI_UX_GUIDELINES.md`.

## Typography

- Font: inherit global `--font-sans` from `frontend-angular/src/styles.css`.
- Body/content: `400`.
- Inputs, buttons, labels: `600`.
- Headings and important values: `700`.
- No page-specific font family unless explicitly requested.

## Layout

- Operational pages use compact spacing.
- Cards use white backgrounds, thin blue-grey borders, and radius `8px` to `12px`.
- Drawers use right-side fly-out layout with fixed footer actions.
- Do not nest cards inside cards.

## Controls

- Inputs/selects/buttons: minimum height around `38px`.
- Utility icon buttons: white background, subtle border, dark navy icon.
- Focus state: blue border and visible focus ring.
- Date picker: shared `as-date-picker`; no one-off native date inputs for app calendar fields.

## Color Intent

- Text: dark navy.
- Muted text: blue-grey.
- Border: light blue-grey.
- Primary action: dark navy or approved green for apply/save actions.
- Selected calendar state: strong blue/navy with soft range highlight.

## Empty And Error States

- Empty: short neutral text such as `No records yet`.
- Error: show actionable backend envelope message where available.
- No marketing copy, filler guidance, or fake data.
