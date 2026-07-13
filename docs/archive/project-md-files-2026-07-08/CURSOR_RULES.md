# CURSOR_RULES.md — Rules for Cursor / IDE AI assistants

> **Primary AI Role:** Chief Software Architect (delegates to domain roles per file)
> Mirror these into `.cursor/rules` if project rules are configured there. On any conflict, **AGENTS.md wins**.

## Always-on rules

1. **Stack is locked.** Angular 20 (TypeScript, frontend only) + Express 5 (ESM JavaScript) + SQLite via `better-sqlite3`. Never propose TypeScript on the backend, another database, an ORM, or a rewrite. Enhance existing code only.
2. **Protected files — do not edit:** `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`. Wrap/extend around them.
3. **Money is integer paise** everywhere in storage and logic. Rupee formatting only in display components/pipes.
4. **Every table:** `tenantId` + `branchId`, camelCase column names, named parameters (`@param`) in all SQL — never positional `?`.
5. **Delete Safety Rule:** never delete code, files, routes, schema, tests or config without the user’s explicit approval. Additive/wrapper changes preferred.
6. **Layering:** route → service → repository. No SQL outside `server/repositories`. New routes register with one line in `server/app.js`.
7. **Tenancy:** requests carry `x-tenant-id`, `x-branch-id`, `x-user-role`; repositories still enforce scope server-side. Never write a query missing the tenant filter.
8. **IST business dates**, ISO timestamps, JWT + refresh tokens, WebSocket for realtime.

## Editing style

- Work only on the file(s) the user references (`#file:` scope) — never the whole workspace.
- Minimal diffs. No drive-by renames, reformatting or “while I’m here” cleanups.
- One request = one focused change. Keep completions consistent with the surrounding code’s idiom.
- Frontend: standalone Angular components under `src/app/pages`, services for API calls, follow `docs/DESIGN_SYSTEM.md` tokens.

## Verification (lean)

- Backend edit → run just the matching test file: `npx vitest run tests/<feature>.test.js`.
- UI edit → `npm run build:client` only.
- Full `npm run quality` only when the user asks or the change is high-risk cross-module.

## Git

- After each working change: `git add -A && git commit -m "<what>" && git push origin HEAD`.
- Never `git reset --hard`, `git checkout -- .`, `git clean -fd` or force push without explicit user permission.

## Where to look things up

`AGENTS.md` (invariants) · `ARCHITECTURE.md` · `DATABASE.md` · `API_GUIDELINES.md` ·
`SECURITY.md` · `RBAC.md` · `TENANT_ARCHITECTURE.md` · `docs/<domain>.md` (per-feature rules).
Read only what the current task needs.
