# AGENTS.md

## Profit Intelligence

Read `docs/profit-intelligence.md` only for:

* balance sheet
* accounting
* profitability
* expenses
* cashflow
* service recipes
* CEO dashboard

## Rules

* Reuse existing architecture
* No protected files
* JavaScript ESM only
* tenantId required
* Money = integer paise
* IST business dates
* camelCase columns

## Accounting

* journalEntryLines = source of truth
* balanceSheetSnapshots = archival only
* Debit == Credit
* WMA inventory costing
* Idempotent schedulers

## Workflow

1. Open minimum files
2. Read profit-intelligence.md only if needed
3. Build one stage at a time
4. Run smallest verification

## Runtime

Do NOT start/restart backend or frontend unless explicitly requested.
Do NOT run any `npm run ...` command unless explicitly requested; the user will run npm commands.

Backend:
`npm run api`

Frontend:
`npm run client`

Both:
`npm run api && npm run client`

Verify health/url only when asked.

## Balance Sheet Scope

Keep:

* Balance Sheet
* Ledger Engine
* Auto Ledger Grouping
* Tally Drill Down
* Working Capital
* Fixed Assets
* Deferred Revenue
* Cost Centers
* Hardening Controls
* AI Ledger Suggestions

Do NOT build:

* Trading Account
* Purchase Account Screen
* Sales Account Screen
* Profit & Loss Report
* Trial Balance Tab
* Cash Flow Tab
* Forecast Tab
* Dashboard Tab
<!--
  DROP-IN: paste this whole block into `.github/copilot-instructions.md`
  (or append to AGENTS.md) for the Aura Salon CRM/POS repo.
  Goal: cut Copilot/Codex premium-request + token usage without losing quality.
-->

# ⚡ Token / Credit Discipline (Codex · GitHub Copilot)

These rules exist to reduce credit burn. Follow them on **every** request.

## 1. Scope the context — never the whole repo
- Work only on the file(s) named in the prompt. Reference them with `#file:` — do **not** pull in the full workspace.
- Do **not** open, read, or re-summarise large files unless explicitly asked. Trust the invariants in §5 instead of re-reading to "confirm".
- If a file is already in context this turn, do not re-read it.
- For logs / stack traces: use only the relevant lines the user pasted. Never expand or re-fetch the whole log.

## 2. Output minimal diffs, not rewrites
- Return a **patch / diff or the single changed function** — never re-emit a whole file unless the user says "rewrite the file".
- No speculative refactors, no renaming, no reformatting untouched code, no "while I'm here" cleanups.
- One prompt = one focused change. Don't bundle audit + plan + implement into a mega-response; if planning is needed, give a 3–5 line plan, then stop and wait.

## 3. Don't re-explain or echo
- No restating the request, no summarising files back, no recapping what you already wrote earlier in the thread.
- Skip preamble/postamble. Code first, one line of why if needed.

## 4. Model & agent-mode settings
- Use the **cheapest capable model** for the task: trivial edits (rename, format, small fix, boilerplate) → base/cheap model; only architecture/hard-debug → premium model. Don't run everything on the top model.
- In agent mode, cap iterations: if a fix isn't converging in ~2–3 tool cycles, stop and report — don't loop.
- Turn off auto/full-codebase context features; feed relevant files manually.

## 5. Aura invariants — assume these, never re-derive or re-ask
Baking these in saves the round-trips Copilot spends "checking".
- **Stack is locked:** Angular (frontend) + Express JS + SQLite via `better-sqlite3` (CommonJS). **No TypeScript on backend, no MongoDB/Redis/Postgres.** Never suggest migrating. Always **enhance existing**, never rebuild.
- **Protected files — NEVER modify:** `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`. Wrap/extend around them instead.
- **Add-only / wrapper pattern.** Never rewrite an existing service; add a new function or wrapper.
- **Money = integer paise** everywhere (never floats/rupees in storage).
- **Every table needs `tenant_id` + `branch_id`.** DB columns are **camelCase**.
- Multi-tenancy headers: `x-tenant-id`, `x-branch-id`, `x-user-role`. JWT refresh tokens. WebSocket for realtime.
- Paths: backend entry `server/app.js`; repositories `server/repositories/`; frontend pages `src/app/pages/`.

## 6. Definition of Done (lean — keep it lean on purpose)
- Change compiles and does the one requested thing. That's it.
- **Do NOT auto-run the full quality gate** (full lint + full test suite + full build) as part of every task — it's the biggest silent credit drain. Run only the targeted check relevant to the change, and only if asked.
- Suggest tests/lint as a one-line note; don't generate them unless requested.

## 7. Codex environment (reference — don't re-discover)
- Node **v24**, Universal base image, install with `npm ci`, Container Caching **ON**.
- Client build: `npm run build:client` → `ng build`.

## ❌ Anti-patterns (these burn credits for nothing)
- Re-reading a large protected/service file to "understand context".
- Re-emitting full files for a 3-line change.
- Audit + plan + implement + test all in one giant prompt.
- Running the whole test/build suite after a trivial edit.
- Suggesting a TS/Mongo migration (always rejected — wasted tokens).