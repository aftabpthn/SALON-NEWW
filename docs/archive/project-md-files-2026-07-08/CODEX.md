# CODEX.md — Instructions for OpenAI Codex / GPT coding agents

> **Primary AI Role:** Chief Software Architect (delegates to domain roles per file)

Codex agents working in this repository MUST read and obey **AGENTS.md** first.
This file only adds Codex-specific notes; on any conflict, AGENTS.md wins.

## Hard rules (from AGENTS.md — never violate)

- Stack is locked: Angular 20 + Express 5 (ESM JavaScript) + SQLite (`better-sqlite3`). No TypeScript backend, no other databases, no rebuilds — enhance existing code only.
- Protected files (`smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`) are read-only: wrap or extend around them.
- Money = integer paise. Every table has `tenantId` + `branchId`. camelCase columns. Named SQL parameters only.
- Delete Safety Rule: no deletion of any code/file/route/schema/test/config without explicit user approval — propose the exact removal list first and wait.

## Codex working style for this repo

1. **Plan short, then act.** If a plan is needed, 3–5 lines maximum, then implement.
2. **Context economy.** Reference only the files named in the prompt. Do not re-read large files to “confirm” — trust the invariants in AGENTS.md §1.
3. **Diff-only output.** Emit changed functions/blocks, never whole-file rewrites unless asked.
4. **Registration pattern.** New backend feature = new service file + new route file + one registration line in `server/app.js`. Repository layer owns all SQL.
5. **Tests.** Extend the matching suite in `tests/` (they are named by feature, e.g. `billing-*.test.js`). Run only that suite: `npx vitest run tests/<file>`.
6. **Commit + push after every working change** so GitHub stays live: `git add -A && git commit -m "<what>" && git push origin HEAD`.

## Quick map

- Backend entry: `server/index.js` → `server/app.js`
- Layers: `server/routes` → `server/services` → `server/repositories` (+ `validators`, `middleware`, `jobs`, `workers`, `templates`, `utils`, `migrations`)
- Frontend: `src/app/pages` (Angular standalone components)
- Python ML sidecar: `ml-service/` (CLV, uplift)
- Standards: `ARCHITECTURE.md`, `DATABASE.md`, `API_GUIDELINES.md`, `SECURITY.md`, `RBAC.md`
- Domain docs: `docs/<domain>.md` — read only the one(s) the task touches

## Anti-patterns (credit burners — from AGENTS.md)

- Re-reading protected/service files for “context”.
- Whole-file emission for a 3-line change.
- Running the full test/build suite after a trivial edit.
- Suggesting TS/Mongo/Postgres migrations (always rejected).
- Restarting dev servers repeatedly.
