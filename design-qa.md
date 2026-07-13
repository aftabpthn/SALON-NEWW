# Invoice Settings Option 3 Design QA

- Source visual truth: `C:\Users\Aftab Ahamad\.codex\generated_images\019f55a4-32b6-77c0-92df-74a4a00cfd3c\exec-e526890e-8564-4297-893f-c998830fa8c5.png`
- Implementation screenshot: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust\invoice-settings-option-3-implementation.png`
- Dual-language source: `C:\Users\AFTABA~1\AppData\Local\Temp\codex-clipboard-46b2c294-7599-42e5-8650-8f301fca94c1.png`
- Dual-language implementation: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust\invoice-dual-language-implementation.png`
- Route: `http://127.0.0.1:4200/settings/invoice`
- Viewport: 1265 x 712 browser capture within the desktop app shell
- State: Dual Invoice Language / A4, branch_hyd, live bilingual preview

**Full-view comparison evidence**

- The source and implementation were opened together for the comparison pass.
- Both use the approved two-pane studio: compact settings editor on the left and a sticky live invoice preview on the right.
- The implementation preserves the source hierarchy, tab structure, two-column toggle density, blue active states, white invoice paper, subdued borders, and top save controls.
- The existing AuraShine sidebar and header remain intentionally visible because this is a production route inside the current application shell.

**Focused region comparison evidence**

- Settings editor: category navigation, search, reset action, aligned two-column toggle rows, and readable switch states match the selected direction.
- Preview: A4/Thermal controls, business header, invoice metadata, client/payment region, HSN/SAC line structure, totals, notes, download, and signature areas are present.
- Save state: top and sticky bottom actions clearly show Saved, Unsaved changes, and disabled saved states.
- Language editor: the reference's English and Other Language coverage is retained in a compact three-column field/English/translation table, with an enable switch and named second language.
- No raster imagery is required. The mock's decorative icons and logo placeholder were omitted because the app has no shared icon library or saved business logo asset; no fake SVG/CSS assets were introduced.

**Required fidelity surfaces**

- Fonts and typography: global `--font-sans` is used; body, control, and heading weights follow 400/600/700 project rules with consistent hierarchy.
- Spacing and layout rhythm: compact 14-20px page spacing, aligned two-column controls, 8-12px radii, and restrained elevation match the operational baseline.
- Colors and visual tokens: existing white, pale blue-grey, navy, border, and brand-blue tokens are used; semantic saved and warning states remain legible.
- Image quality and asset fidelity: not applicable; no raster product imagery is present in the selected screen.
- Copy and content: production labels are retained; preview uses neutral empty structures rather than invented client, service, or payment records.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- P3: Source-only decorative icons are omitted until the project adopts a shared icon library.
- P3: The reference's very tall split forms were intentionally compacted into a scrollable aligned table so the live invoice preview remains visible.

**Interaction verification**

- Invoice settings route opened successfully with authenticated tenant and branch context.
- A4 and Thermal preview modes switched successfully.
- Common and Terms & Conditions tabs switched successfully.
- Dual Invoice Language tab opened successfully; Hindi name and `कुल` translation updated the live preview to `Total / कुल`.
- Bilingual settings saved and survived reload; temporary QA values were then removed from `branch_hyd`.
- Branch-scoped settings saved, reloaded, and restored to A4 successfully.
- Saved and unsaved action states updated correctly.
- Browser console warnings/errors checked: none.

**Comparison history**

- Pass 1: the branch label showed a generic fallback; the component was updated to fall back to the real branch ID and a fresh screenshot confirmed `branch_hyd`.
- Pass 2: source and revised implementation were compared together. No P0/P1/P2 mismatch remained.
- Pass 3: the dual-language reference and live implementation were opened together; field coverage, hierarchy, compact density, preview behavior, and persistence passed.

**Follow-up polish**

- Add real brand logo rendering only after a branch-owned logo asset and upload contract exist.

final result: passed

---

# Sidebar Hover Fly-out QA

- Source visual truth: `C:\Users\AFTABA~1\AppData\Local\Temp\codex-clipboard-3949f98c-7765-4e2d-b913-fd6ef72dd473.png`
- Implementation screenshot: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust\sidebar-hover-implementation.png`
- Focused comparison: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust\sidebar-design-comparison.png`
- Route: `http://127.0.0.1:4200/`
- Viewport: 1280 x 720
- State: Staff icon rail with its fly-out menu open by keyboard focus, using the same visual state as hover

**Full-view comparison evidence**

- The default implementation is a narrow icon-only rail; the fly-out overlays page content without changing the shell grid width.
- The desktop capture confirms the header and page frame remain aligned while the Staff menu is open.

**Focused region comparison evidence**

- Source and implementation sidebar regions were placed together in `sidebar-design-comparison.png`.
- Both use a dark narrow icon rail, a full-height blue fly-out, a compact heading, thin dividers, outlined icons, and vertically aligned submenu links.
- AuraShine shows only its real Staff and Availability routes instead of copying vendor-only employee records or workflows.

**Required fidelity surfaces**

- Fonts and typography: the global `--font-sans` token and 600/700 navigation hierarchy are preserved.
- Spacing and layout rhythm: the 54px rail, 42px icon targets, 232px fly-out, compact rows, and full-height overlay match the reference proportions.
- Colors and visual tokens: existing `--brand-strong` and `--brand` tokens provide the reference's two-tone blue navigation treatment.
- Image quality and asset fidelity: Bootstrap Icons provide consistent real outline icons; no placeholder glyphs or handcrafted SVGs remain.
- Copy and content: menu labels map only to existing AuraShine routes; no sample business data or vendor-only entries were added.

**Findings**

- No actionable P0, P1, or P2 differences remain for the requested sidebar interaction.
- P3: the source includes more employee submenu routes than AuraShine currently exposes; copying them would create non-working navigation.

**Interaction verification**

- Icon-only default state rendered successfully.
- Staff fly-out opened on keyboard focus; CSS uses the same open state for pointer hover.
- Active icon and active submenu styles rendered.
- Angular production build passed.
- Browser console warnings/errors checked: none.

**Comparison history**

- Pass 1: existing sidebar used text abbreviations and had no fly-out.
- Fix: replaced abbreviations with Bootstrap Icons and added a route-backed overlay menu with hover and focus states.
- Pass 2: source and implementation were compared together at desktop scale; no P0/P1/P2 mismatch remained.

**Follow-up polish**

- Add more submenu entries only when corresponding real routes exist.

final result: passed

---

# POS Service Row And Staff Split QA

- Source visual truth: `C:\Users\AFTABA~1\AppData\Local\Temp\codex-clipboard-96522a73-2d6e-403d-b707-237f344b6944.png`
- Implementation screenshot: `C:\Users\Aftab Ahamad\OneDrive - digi\Documents\AuraShine CRM Rust\pos-service-split-qa.png`
- Route: `http://127.0.0.1:4200/pos`
- Viewport: 1265 x 712 in-app browser capture
- State: Hair Cut service added with a two-person 50/50 staff split

**Full-view comparison evidence**

- Source and implementation were opened and inspected at readable desktop scale.
- The implementation follows the reference hierarchy: item type/name stays in the Item cell; primary staff and `+ Staff` stay together; split rows show staff, percentage, remove action, and `Split total 100%`.
- A single combined browser comparison image could not be produced because the in-app browser blocked the local data URL used for the comparison board.

**Focused region comparison evidence**

- Live DOM confirmed that an empty checkout contains no placeholder service row.
- After adding Hair Cut, the cart showed `Service` and `Hair Cut` without a second item search field.
- Clicking `+ Staff` produced two rows at 50% each and `Split total 100%`.

**Required fidelity surfaces**

- Fonts and typography: existing global POS typography and 400/600/700 hierarchy are preserved.
- Spacing and layout rhythm: Item and Staff tracks are widened; split controls remain within the Staff column without overlap.
- Colors and visual tokens: existing POS navy, blue-grey border, white control, and semantic chip tokens are reused.
- Image quality and asset fidelity: no image assets are required for this table row.
- Copy and content: reference labels `Item`, `Staff`, `+ Staff`, percentage, and `Split total 100%` are represented.

**Findings**

- No visible P0/P1/P2 issue was found in the rendered implementation.
- Formal Product Design QA remains blocked because the required same-input composite comparison was rejected by browser security policy.

**Interaction verification**

- Empty cart state passed.
- Real service add passed.
- Two-person 50/50 split passed.
- Angular production build passed.
- Browser console warnings/errors: none.

**Comparison history**

- Pass 1: default empty Service row and duplicate line-item search were present; Staff and Split used separate cramped columns.
- Fix: removed automatic empty rows, rendered selected catalog items as summaries, and moved split controls into the Staff cell.
- Pass 2: live browser interaction confirmed the corrected service and split states.

final result: blocked

---

# Staff List Alignment QA

- Source visual truth: `C:\Users\AFTABA~1\AppData\Local\Temp\codex-clipboard-ee1c55dd-3674-4b64-8e6a-dec9aef8d68c.png`
- Implementation screenshot: `C:\Users\Aftab Ahamad\AppData\Local\Temp\staff-list-aligned-active-implementation.png`
- Source viewport: 1470 x 722
- Implementation viewport: 1513 x 787
- State: desktop staff list with Active status selected and real API-backed staff rows

**Full-view comparison evidence**

- The implementation matches the reference hierarchy: title/search/add row, compact filter toolbar, results/status row, utility actions, seven-column employee table, and pagination.
- All seven table columns use the same grid tracks, so headers and row values share identical left edges.
- Row height and header density are compact and consistent with the reference while preserving AuraShine controls and theme.

**Focused region comparison evidence**

- Table header and first two real rows were readable in both images and compared together.
- Code, First name, Last name, Phone number, Job, Active, and Center are present in the same order.
- First-name sorting and clickable employee names remain visible and functional.

**Required fidelity surfaces**

- Fonts and typography: global `--font-sans`, compact uppercase headers, and existing control/heading weights are preserved.
- Spacing and layout rhythm: seven equal columns, left-aligned header text, 40px header, and 48px rows remove the earlier drift.
- Colors and visual tokens: AuraShine navy, green primary action, blue-grey borders, and semantic active pills are intentionally retained.
- Image quality and asset fidelity: no raster content is required by the operational table.
- Copy and content: search, Add, Jobs, Status, result count, status pill, sorting, export, column selection, pagination, and all seven employee fields are present. Empty values reflect the real database.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- P3: the reference vendor shell and utility glyph treatment differ from AuraShine's existing shell and actions; this is an intentional product-system difference.

**Interaction verification**

- Active status filter selected successfully and refreshed real rows.
- Active status pill rendered.
- Staff name navigation remained available.
- Angular production build passed.
- No new application-origin console errors were observed.

**Comparison history**

- Pass 1: headers were centered inside unequal tracks and visibly drifted from row values.
- Fix: changed the shared table grid to seven equal tracks, left-aligned all headers, and compacted row/header heights.
- Pass 2: source and updated implementation were compared together; all column starts and visible information aligned with no remaining P0/P1/P2 issue.

**Follow-up polish**

- None required for the requested alignment.

final result: passed
