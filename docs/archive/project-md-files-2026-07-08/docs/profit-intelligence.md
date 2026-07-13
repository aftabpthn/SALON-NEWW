# AGENTS.md - Aura Salon CRM/POS Credit-Saver Guide

Use this file to do good work with fewer credits. Be precise, open fewer files, edit only what the task needs.

## Project

Aura Salon CRM/POS is a multi-tenant salon SaaS:

- Frontend: Angular 20 standalone components, RxJS, signals
- Backend: Express 5, plain JavaScript ES modules
- Database: SQLite with better-sqlite3, synchronous calls, WAL mode
- Default tenant: `tenant_aura`

Do not propose another stack.

## Credit-Saver Workflow

1. Read this file first.
2. Do not scan the whole repo to "understand" it.
3. Open only files named by the task, direct imports, route mounts, failing logs, or tests you must touch.
4. Before the first edit, keep exploration small: usually 3-8 files is enough.
5. Use `rg` for targeted search only, never broad noisy scans.
6. Do not paste long command output. Summarize the useful lines.
7. Do not write long plans unless the user asks or the task is risky.
8. If the request is ambiguous, ask one short question. Otherwise make a reasonable scoped change.
9. Prefer one focused fix over broad rewrites.
10. Verify at most once with the smallest useful check. If that check fails, fix once and rerun that same check once.
11. If the same check fails twice, stop and ask the user instead of looping.
12. Final answer should be short: what changed, what was verified, any blocker.
13. Protect user credits: use the fewest useful tool calls, avoid repeated scans, avoid repeated checks, and ask before any broad or expensive investigation.

## Protected Files

Never modify these files. If a task truly needs them, stop and tell the user what change is needed.

- `server/services/smart-booking.service.js`
- `server/services/booking-portal.service.js`
- `server/routes/operations.routes.js`
- `server/db.js`

Reading them for context is allowed only when necessary.

## Repo Map

Use this map instead of exploring randomly.

```text
server/
  app.js                         route mounts and startup schema hooks
  index.js                       API entry
  db.js                          protected DB helpers and core schema
  middleware/                    auth, RBAC, request context, errors
  repositories/                  BaseRepository and registry
  routes/*.routes.js             thin route handlers
  services/*.service.js          business logic
  validators/request-validator.js
  utils/app-error.js
src/app/
  pages/*.component.ts           standalone screens
  core/api.service.ts            API wrapper
  core/state/
  shared/ui/
tests/*.test.js                  node:test
scripts/
```

Backend flow: `route -> service -> repository -> db/helpers`.

## Backend Rules

- Backend is JavaScript ESM only: `import` / `export`, no `require`.
- Use 2-space indent and double quotes in backend files.
- Keep routes thin: validate, permission check, call service, return JSON.
- Put business logic in services.
- Use repositories or existing DB helpers for data access.
- `better-sqlite3` is sync: `db.prepare(sql).get(params)`, `.all(params)`, `.run(params)`.
- Use named SQL params: `@tenantId`, `@id`.
- Use camelCase DB columns: `tenantId`, `branchId`, `clientId`, `staffId`, `startAt`, `createdAt`, `updatedAt`.
- Every tenant table/query must scope by `tenantId`; most also scope by `branchId`.
- Use `tenantService.accessScope(access, resource)` and `tenantService.assertBranchAccess(access, branchId)`.
- Throw errors with helpers from `server/utils/app-error.js`.
- Never string-concat SQL.
- Do not add dependencies without explicit approval.

Money rule: store money as integer paise only. Convert to rupees only in UI.

## New Backend Feature Pattern

For a normal new resource:

1. Add repository in `server/repositories/`.
2. Register it in `server/repositories/repository-registry.js`.
3. Add service in `server/services/`.
4. Add thin route in `server/routes/`.
5. Mount route in `server/app.js` under `/api/v1` with auth.
6. Add one focused `tests/*.test.js`.

If a new table is needed, do not edit `server/db.js`. Prefer a small startup schema service mounted from `server/app.js`, or flag the exact SQL if the user wants core DB migration.

## Frontend Rules

- Use Angular standalone components.
- Use `src/app/core/api.service.ts`; do not use raw `HttpClient` for app APIs.
- Do not hardcode `localhost` URLs in components.
- Preserve existing UI patterns.
- Keep UI edits scoped to the requested screen.
- Use real API data where the feature needs persistence. Avoid fake/static data for business flows.
- Text must fit on mobile and desktop.

## Commands

```powershell
npm run api           # API only, usually port 4000
npm run client        # Angular only, usually port 4300
npm run dev           # API + web
npm run check:server  # server route/schema check
npm test              # node:test suite
npm run build:client  # Angular client build, if this script exists
npm run build         # Angular build
npm run seed:demo     # seed demo data
node --test tests/<file>.test.js  # targeted test
npm run quality       # check + tests + build
```

Do not run `npm install` unless explicitly asked. Do not suggest NX commands unless `package.json` proves NX is used.

## Runtime Ownership

- Codex must not start the backend, frontend, or combined dev server. The user starts `npm run api`, `npm run client`, or `npm run dev` separately.
- Codex should only make code changes and run the allowed small verification commands when needed.

## Verification Budget

Choose the smallest useful verification. `npm run quality` is expensive; use it only for cross-module or high-risk changes, and run it at most once.

- Text/UI-only change: run `npm run build:client` or `npm run build` only when practical.
- Backend route/service change: run `npm run check:server` and one targeted test, not the whole suite.
- Cross-module or high-risk change: run `npm run quality` once.
- Do not start dev servers or open preview URLs.
- If a check fails, fix once and rerun that same check once. If it fails twice, stop and ask the user.

Avoid rerunning the full suite repeatedly for the same small change.

## Git and Dirty Worktrees

- Never revert user changes.
- Check status before editing when needed.
- Touch only task-relevant files.
- If unrelated files are dirty, ignore them.
- Do not use destructive git commands unless the user clearly asks.

## Output Style

For Hinglish/Hindi requests, reply simply in Hinglish when natural.

Final response format:

- Changed: short list or one sentence
- Verified: commands run, or "not run, docs-only"
- Blockers: only if any

If a protected file such as `server/db.js` is needed, give the exact SQL or change for the user instead of editing it.

Do not include full diffs or long explanations unless asked.

## Definition of Done

- Only task-relevant files touched.
- No protected file modified.
- Money stays integer paise.
- New queries are tenant-scoped with camelCase columns.
- Services throw app-error helpers, not raw responses.
- New backend resources have repository, service, route, `/api/v1` mount, and a focused test when needed.
- Smallest useful verification was run, or skipped clearly for docs-only work.
- No new dependencies added without approval.
