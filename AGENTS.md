# AGENTS.md - AuraShine CRM Rust

## Canonical Workspace Rule

- The only writable AuraShine CRM Rust workspace is `C:\Users\Aftab Ahamad\AuraShine CRM Rust`.
- Every new task and every resumed older task must make all reads, edits, builds, tests, and Git operations in that canonical workspace.

## Canonical GitHub Repository Rule

- The only default writable and publish target is `https://github.com/aftabahamad260-code/AuraShine-CRM-Rust.git` and it must be configured as `origin`.
- `https://github.com/Aurashine-Infitech/AuraShine-CRM-Rust.git` is the fetch-only `upstream`; agents must not push or open pull requests there unless the user explicitly changes the target.
- Before every push or pull request, verify that the target repository is `aftabahamad260-code/AuraShine-CRM-Rust`.


## Core Rules

- Prefer clean, scalable, production-ready architecture.
- Analyze existing code before editing.
- Reuse existing components, services, types, and routes.
- Keep changes minimal and focused.
- Do not duplicate logic.
- Preserve backward compatibility.
- No agent may add dummy, fake, demo, placeholder, or sample business data; use real API/database data or a clear empty state only.
- New top-level folders are allowed only when the domain is genuinely different.
- AI agents must not execute `npm run ...` commands in this repository. When a frontend npm script is needed, provide the exact command for the user to run instead.
## GSD Execution Rule

- Prioritize Get Stuff Done: ship the smallest production-safe fix that solves the real issue.
- Avoid rabbit holes: do not over-explore unrelated files, features, or speculative future work.
- Use a tight loop: inspect, fix, run the smallest useful verification, then report.
- If the same issue repeats after two failed attempts, stop and report the root cause, blocker, and next concrete action.

## Windows Rust Build And Runtime Rule

- Reuse `backend-rust/target` for normal checks and builds. Do not create a new per-task `CARGO_TARGET_DIR`; use one stable fallback only after a confirmed target-artifact lock.
- Use `cargo check --bin aura-shine-backend` for normal backend verification. Run `cargo build --bin aura-shine-backend` only when a refreshed executable is required for live verification.
- Never run the live backend directly from `backend-rust/target/debug/aura-shine-backend.exe`. Use `backend-rust/scripts/restart-backend-dev.ps1`, which runs a copied executable so Cargo can replace its build output without Windows `Access is denied` errors.
- Never start a second Cargo command because the first command timed out. Check the existing `cargo`/`rustc` process and captured log, then wait for that same process or report the blocker.

## Token Efficiency Rules

- After completing one logical task, feature, or fix, run `/compact` before moving to the next task when the current agent environment supports it.
- After investigation or debugging is complete, compact or summarize the findings before implementation; do not carry unnecessary research context forward.
- Do not scan the whole codebase. Read only the files directly relevant to the current task.
- Prefer targeted, low-noise commands and summarized output, for example `git status --short` instead of verbose status output.
- Do not repeatedly paste raw output from verbose commands such as `git status`, `ls -la`, `docker ps`, or full test runs.
- Use low or medium reasoning effort for routine edits; reserve high or xhigh effort for genuinely complex, multi-step problems.
- Keep each session focused on one task or feature. Suggest a new session for unrelated work, but resume related follow-up work in the current session.
- Avoid repeating known file content. Show focused diffs or patches instead of entire files unless the user explicitly requests the full file.

## 10X Completion Rule

- Every requested task must be completed to a 10X production-ready standard within the approved scope.
- Treat a task as complete only when all applicable backend, database, frontend, security, permission, real-data, error-handling, reload, and verification requirements are finished and correctly wired.
- Do not mark partial, demo-only, placeholder, mock-backed, disconnected, or unverified work as complete.
- Reuse and extend existing architecture instead of creating parallel implementations merely to finish faster.
- Break large work into clear phases and complete the active phase end to end before moving to the next phase. Do not force trivial tasks into ten artificial phases.
- If completion depends on credentials, external services, user approval, or another genuine blocker, keep that item explicitly pending and report the exact blocker instead of claiming completion.

## Real Data Only Rule

- Do not add dummy, fake, demo, placeholder, sample, or dirty business data.
- Do not invent clients, staff, services, appointments, payments, reports, tenants, branches, or inventory rows.
- UI can show empty states, loading states, and API-backed values only.
- Static mock arrays are allowed only when explicitly requested by the user for visual prototyping.
- If real data is missing, leave the state empty and show a clear empty UI instead of fabricating data.
- Seed scripts must be opt-in and clearly marked as demo/dev only.
- Production code must never depend on demo data.

## AI Working Order

Before making changes, AI agents must read these in order:

1. `AGENTS.md`
2. `docs/README.md`
3. The module doc related to the task, for example `docs/ARCHITECTURE.md`, `docs/API_GUIDELINES.md`, `docs/DATABASE.md`, or `docs/UI_UX_GUIDELINES.md`
4. The exact source files being changed

If docs conflict with current code, this file and current source code win.

## Project Path Map

- Frontend Angular app: `frontend-angular/`
- Frontend app source: `frontend-angular/src/app/`
- Frontend core: `frontend-angular/src/app/core/`
- Frontend layout shell: `frontend-angular/src/app/layout/`
- Frontend reusable UI: `frontend-angular/src/app/shared/`
- Frontend route pages: `frontend-angular/src/app/pages/`
- Frontend domain features: `frontend-angular/src/app/features/`
- Frontend routes: `frontend-angular/src/app/app.routes.ts`
- Frontend shell: `frontend-angular/src/app/app.component.ts`
- Backend Rust app: `backend-rust/`
- Backend routes: `backend-rust/src/routes/`
- Backend source: `backend-rust/src/`
- Python AI service: `ai-service/`
- Active docs: `docs/`
- Imported old/reference docs: `docs/archive/`

## Frontend Enterprise Structure

Use this app-level folder structure:

```text
frontend-angular/src/app/
  core/          app-wide config, guards, interceptors, singleton services, models
  layout/        app shell only: header, sidebar, topbar, nav
  shared/        reusable UI components, directives, pipes, utilities
  pages/         route entry pages grouped by domain
  features/      domain business features grouped by domain
```

Domain folders must be reused before creating a new one. If a new page or feature is 60% or more related to an existing domain, put it in that domain folder.

Folder ownership notes live in `frontend-angular/src/app/README.md` and the README inside each app subfolder.

Current domain folder names:

- `appointments`
- `booking`
- `clients`
- `staff`
- `inventory`
- `pos`
- `finance`
- `reports`
- `memberships`
- `packages`
- `marketing`
- `messaging`
- `security`
- `offline`
- `data-migration`
- `settings`
- `dashboard`
- `platform`
- `ai`
- `analytics`
- `engagement`
- `leads`
- `compliance`
- `workflow`
- `marketplace`
- `locations`
- `business`
- `suppliers`
- `products`
- `purchases`
- `payments`
- `taxes`
- `reputation`

## Angular Component Rules

- Every page must live inside its own folder under `frontend-angular/src/app/pages/<domain>/`.
- New pages and components must use separate files:
  - `*.component.ts` for component logic and metadata.
  - `*.component.html` for template markup.
  - `*.component.css` for styling.
- Do not put large inline `template` or `styles` blocks inside `.ts` files for pages.
- Header and sidebar belong in `frontend-angular/src/app/layout/`.
- Shared reusable UI belongs in `frontend-angular/src/app/shared/`.
- Page-specific CSS stays with that page component.
- Global CSS is only for theme variables, resets, and truly shared shell rules.

## New Page Proposal and Visual Approval Rule

- This rule applies to every AI agent, including subagents, before creating a new frontend page, page folder, or route.
- First inform the user that a new page is proposed, then show an image-based layout preview that matches the Appointment UI baseline. The preview must show the primary hierarchy, key actions, responsive layout, and real empty/loading states; it must not use invented business records.
- With the preview, provide a short workflow/layout outline, name the real API/data sources the page will use, and suggest the next advanced version of the same page after the first version is complete.
- Wait for the user's explicit visual approval before creating the page route, folder, or page code. The only exception is when the user explicitly says to build the page directly or has already approved a specific visual proposal.
- This approval requirement is only for genuinely new pages. Improvements to an existing page follow the normal implementation flow unless they create a new route-level screen.

## Frontend Typography Rule

- The full Angular app must use the global font token from `frontend-angular/src/styles.css`.
- Components should inherit `--font-sans`; do not hardcode a different `font-family` in page CSS unless the user explicitly asks for a special design.
- Default weights: body/content `400`, buttons/select controls `600`, headings and important values `700`.
- Keep font changes global-first, then only add page-level typography when that page genuinely needs a different hierarchy.

## Appointment UI Baseline Rule

- `frontend-angular/src/app/pages/appointments/` is the mandatory visual baseline for operational pages, including POS, clients, staff, services, inventory, memberships, packages, reports, and settings.
- Reuse the Appointment page typography exactly: global `--font-sans`, body `400`, controls `600`, and headings/important values `700`. Do not introduce a page-specific font or different default font weights.
- Reuse the Appointment page box language: compact white cards, thin blue-grey borders, consistent radii, compact controls, inline SVG icon badges, and the same 3D card/background depth treatment.
- Reuse the Appointment page right-side fly-out pattern for create, edit, detail, waitlist, move, and similar workflows: right-aligned drawer, bordered header, scrollable body, fixed action footer, close action, and shadow.
- Do not independently redesign these visual patterns on individual pages. Match the Appointment component CSS structure first; only change it when the user explicitly requests a different design.
- KPI card width and height are an approval-gated exception. Before adding or changing KPI dimensions, first show the user a visual mockup/image with the proposed KPI width and height, ask which size they want, and do not implement the size until the user confirms it.

## Frontend Copy Cleanliness Rule

- Do not add unnecessary static helper text, filler descriptions, marketing copy, or explanatory sentences to pages.
- Page UI should show only required labels, controls, data, table headers, actions, and clear empty-state titles.
- Extra guidance text should appear only when it is required for a real workflow, error, validation, permission, or backend/API state.
- If data is not loaded yet, do not explain future behavior with long text; use a short neutral empty state such as `No records yet`.
- Header subtitles and page descriptions must be backend/data-driven or explicitly requested by the user.

## Frontend Form Numeric Field Rule

- Numeric form fields must not show default `0` in the UI unless the backend has returned a real saved value.
- New/create forms should keep numeric inputs empty until the user types a value.
- If a numeric field is optional and left empty, map it to the backend default during save, for example `0`, without displaying that default in the input.
- Do not overwrite typed values such as `050` or `10` with `0` on focus, click, blur, or change.

## Frontend Auto Reload After Action Rule

- After any create, update, delete, save, move, block, waitlist, booking, import, export, or workflow action, reload the affected API-backed data automatically.
- Users must not need to refresh the browser to see newly saved staff, clients, services, appointments, inventory, POS, reports, or configuration changes.
- Prefer targeted reloads of the changed module over full-page reloads.
- Keep the current page, filters, selected date, selected view, and open workflow state when reloading data unless the workflow intentionally closes.
- Never use dummy data or stale local-only data as a replacement for reloading real backend data.

## Frontend Date Display Rule

- Calendar and date fields must display dates as `DD/MM/YYYY`, for example `09/07/2026`.
- Keep backend/API payload dates in ISO-safe formats such as `YYYY-MM-DD` or ISO datetime strings.
- Do not rely on native browser `type="date"` display formatting when the UI must show `DD/MM/YYYY`.
- Parse user-entered `DD/MM/YYYY` into the backend date format only during state update or save.
- Use the shared Angular date picker component for app calendar fields instead of creating one-off native date inputs.
- Calendar UI should be compact, clean, keyboard-friendly, and consistent across appointment, staff, client, service, POS, inventory, report, and settings pages.

## Frontend Compact Layout Rule

- Do not leave large empty vertical or horizontal whitespace in CRUD pages.
- Keep page toolbars, filters, and tables close together unless spacing improves scanability for real data.
- Default page section gaps should stay compact; increase spacing only when the user explicitly asks or the layout needs it for readability.
- Empty states should be short and compact; avoid oversized blank panels before real data exists.

## Frontend Utility Icon Button Rule

- Utility icon buttons, grid buttons, toolbar icon buttons, and small action icon controls should use a neutral white background by default.
- Use a normal subtle border matching the page control border.
- Icons, dots, and glyphs should use dark navy by default.
- Hover and focus states should use a light blue background with the standard blue focus/border color.
- Do not use strong purple/magenta filled icon buttons unless the user explicitly requests that brand treatment.

## Frontend Text Input Casing Rule

- Name/category-style text inputs should auto-format each word as title case while typing.
- After every space, the next word starts with a capital letter and the rest of that word is lowercase.
- Example: `hair cut` becomes `Hair Cut`; `WINE PEDICURE` becomes `Wine Pedicure`.
- Do not apply this rule to emails, phone numbers, IDs, codes, SKU/barcode fields, JSON fields, passwords, URLs, or free-form notes.

## Documentation Rules

- Active project documentation stays directly in `docs/`.
- Old imported markdown packs stay in `docs/archive/`.
- Do not use `docs/archive/` as implementation truth unless the task is explicitly about converting old project logic.
- When implementing a module, follow active docs first, then current code, then archive references.

## Backend Rust Rules

- Keep Axum route handlers thin.
- Put reusable business logic in services/helpers instead of duplicating route code.
- PostgreSQL is the source of truth for CRM data.
- Redis is for cache, short locks, rate limits, queues, and session/refresh-token cache.
- JWT/OAuth logic must remain centralized.

## Technology Roles

### Rust + Axum Main Backend

- Owns core CRM APIs: auth, tenants, clients, staff, services, appointments, billing, POS, inventory, memberships, packages, and reports.
- Keep route handlers in `backend-rust/src/routes/` thin.
- Put business logic in `backend-rust/src/services/`.
- Put database access in `backend-rust/src/repositories/`.
- Use typed request/response models in `backend-rust/src/models/`.
- Do not duplicate appointment, billing, tenant, or auth logic across routes.

### Python + FastAPI AI Service

- Owns AI, analytics, forecasting, recommendations, advanced reports, WhatsApp text generation, and service intelligence.
- Keep Python service code in `ai-service/`.
- Rust backend remains the source of truth for core CRM writes.
- Python service should read/compute/assist; do not move core CRM transactional logic into Python.

### PostgreSQL + Redis

- PostgreSQL is the single source of truth for durable CRM data.
- Every tenant-owned table must support tenant isolation.
- Redis is only for cache, rate limits, short locks, queues/backpressure, refresh/session cache, and temporary state.
- Do not store durable CRM truth only in Redis.

### Docker

- Docker is for local/dev/prod parity.
- Keep service wiring in `docker-compose.yml` unless a dedicated deployment file is required.
- Do not add extra containers unless the service has a real runtime need.

### JWT/OAuth

- Auth must be centralized in the Rust backend.
- Use short-lived access tokens and refresh-token flow.
- OAuth login can be added behind the same auth/session boundary.
- Never scatter token parsing or permission checks across unrelated frontend pages.

### AWS Deployment

- AWS is the production deployment target.
- Prefer boring managed services first: ECS/Fargate or App Runner for services, RDS PostgreSQL, ElastiCache Redis, S3/CloudFront for frontend assets, CloudWatch logs.
- Keep infrastructure configuration under `infra/` when added.
- Do not hardcode AWS secrets or environment-specific values in source code.

## Verification

- Run the smallest useful verification after changes.
- For frontend structure changes, do not run `npm run build`; tell the user to run `cd frontend-angular && npm run build`.
- For backend compile changes, `cargo check` inside `backend-rust` is enough.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- Do not run a repo-wide Graphify refresh as a blocking step after routine edits. Run `graphify update . --no-cluster` only for explicit `/graphify` requests or broad architecture changes, and never launch a duplicate refresh while one is active.
- If a refresh exceeds 60 seconds, stop that refresh process and report the graph as pending; normal task verification must continue without waiting for it.
