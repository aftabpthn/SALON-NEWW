# CLAUDE.md — Instructions for Claude Code

> **Primary AI Role:** Chief Software Architect (delegates to domain roles per file — see AGENTS.md and PROJECT_RULES.md)

Claude Code working in this repository MUST read and obey **AGENTS.md** first.
Its invariants are absolute and override anything else, including this file.

## Non-negotiable invariants (summary — full detail in AGENTS.md)

- **Stack locked:** Angular 20 (frontend, TypeScript) + Express 5 (backend, **ESM JavaScript only**) + SQLite via `better-sqlite3`. Never suggest TypeScript on the backend, Postgres/Mongo/Redis, or any migration/rebuild. Always enhance existing code.
- **Protected files — never modify, only wrap:** `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`.
- **Money = integer paise** in all storage and computation. Format to rupees only at display.
- **Every table:** `tenantId` + `branchId`, camelCase columns, **named parameters only** in better-sqlite3 (no positional `?`).
- **Multi-tenancy headers:** `x-tenant-id`, `x-branch-id`, `x-user-role`. JWT + refresh tokens. WebSocket realtime. IST business dates.
- **Delete Safety Rule:** never delete/remove code, files, routes, APIs, schema, UI, tests, config or business logic without explicit user permission. Prefer additive/wrapper approaches.

## How to work

1. **Scope tightly.** Work only on files named in the task. Minimal diffs, no speculative refactors, no reformatting untouched code.
2. **Follow the layering:** `server/routes` → `server/services` → `server/repositories`. No SQL in routes. Register new routes with a single line in `server/app.js`.
3. **Verify lean.** Backend change → run only the related test from `tests/`. UI change → build only. Full `npm run quality` only for high-risk cross-module work, at most once.
4. **Commit and push** after every working change: `git add -A && git commit -m "<what>" && git push origin HEAD`. Never `git reset --hard`, force-push or clean without explicit permission.
5. **Dev servers:** start once in background if not already up (backend `npm run api` → check `http://127.0.0.1:4000/health`; frontend `npm run client` → `http://127.0.0.1:4300`). Do not restart on every change — auto-reload handles it.

## Where the knowledge lives

| Topic | Read |
| --- | --- |
| Project invariants, token discipline | `AGENTS.md` |
| System design | `ARCHITECTURE.md`, `docs/SYSTEM_BLUEPRINT.md` |
| Database rules | `DATABASE.md` |
| Tenancy | `TENANT_ARCHITECTURE.md`, `docs/multi-tenant.md` |
| Auth & roles | `RBAC.md`, `docs/permissions.md` |
| API shape | `API_GUIDELINES.md` |
| Security | `SECURITY.md`, `docs/security-hardening.md` |
| Accounting / balance sheet scope | `docs/accounting.md`, `docs/profit-intelligence.md`, AGENTS.md §6–7 |
| Per-domain rules | `docs/<domain>.md` (billing, appointments, inventory, staff, …) |

Read a domain doc only when the task touches that domain — do not pull the whole
docs tree into context (token discipline, AGENTS.md §3).

## Output discipline

- Diffs / changed functions only; full file only when explicitly asked to rewrite.
- No restating the request, no summarising files back, no preamble/postamble.
- One prompt = one focused change. If not converging in ~2–3 tool cycles, stop and report.
