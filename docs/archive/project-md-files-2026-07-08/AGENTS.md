# AGENTS.md — Aura Salon CRM/POS

> Goal: kaam minimum files me, minimum tokens/credits me ho. Servers ek baar
> start ho ke poore session chalein. Code kabhi waste/overwrite na ho.

---

## 1. Aura Invariants — assume these, NEVER re-derive or re-ask
- **Stack locked:** Angular (frontend) + Express JS + SQLite via `better-sqlite3`.
  **ES Modules (import/export) only.** No TypeScript on backend, no Mongo/Redis/Postgres.
  Never suggest migrating. Always **enhance existing**, never rebuild.
- **Protected files — NEVER modify:** `smart-booking.service.js`,
  `booking-portal.service.js`, `operations.routes.js`, `db.js`.
  Wrap/extend around them instead.
- **Add-only / wrapper pattern.** Never rewrite an existing service; add a new
  function or wrapper. Single registration line in `server/app.js`.
- **Money = integer paise** everywhere (never floats/rupees in storage).
- **Every table needs `tenantId` + `branchId`.** Columns are **camelCase**.
- **Named parameters only** in better-sqlite3 (no positional `?`).
- IST business dates. Multi-tenancy headers: `x-tenant-id`, `x-branch-id`,
  `x-user-role`. JWT refresh tokens. WebSocket for realtime.
- Paths: backend entry `server/app.js`; repositories `server/repositories/`;
  frontend pages `src/app/pages/`.

---

## 2. Runtime — Dev Servers (START ONCE, KEEP RUNNING)

Jab task ke liye app chahiye aur user already servers chalane ki permission de chuka ho, 
reuse existing up sessions; baar-baar restart = token/credit waste.

Start se PEHLE check karo already up hai kya (up = restart MAT karo):
- Backend:  `http://127.0.0.1:4000/health`
- Frontend: `http://127.0.0.1:4300`

Start (sirf agar already up nahi):
- Backend:  `npm run api`     (background me)
- Frontend: `npm run client`  (background me)

Rules:
- Servers ko baar-baar stop/restart MAT karo. Ek baar up = poore session up.
- Code change ke baad bhi restart mat karo — nodemon / Angular auto-reload karega.
  Sirf reload fail ho tabhi restart karo.
- `npm install` sirf tab jab `package.json` badla ho.
- Dono ko `&&` se mat chalao (wo serial chalata hai). Alag background process me chalao.


---

## 2.1 Server Start Lock Rule — AI/Codex Must Not Start Servers

Codex, ChatGPT, or any AI agent must NOT start the frontend or backend server automatically.

Note: This rule overrides section 2 for AI/codex execution. AI can only tell the user
which command to run; AI must not run, stop, restart, or refresh any server process.

Forbidden for AI agents:
- Do not run `npm run api`
- Do not run `npm run client`
- Do not run `npm start`
- Do not run `ng serve`
- Do not start backend server
- Do not start frontend server
- Do not restart any running server
- Do not stop any running server

Only the user may manually start or stop servers.

AI agents may only:
- Tell the user which command to run
- Check errors from logs pasted by the user
- Suggest the next command
- Work on code/files without starting servers

If server is required, STOP and ask the user to start it manually.

Reason:
Server control stays with the user to avoid wasted tokens, duplicate ports, locked files, and accidental restarts.

---

## 3. Token / Credit Discipline — follow on EVERY request

### Scope the context — never the whole repo
- Sirf prompt me named file(s) pe kaam karo. `#file:` se reference do; poora
  workspace mat khींcho.
- Bade files dobara mat padho/summarise karo "confirm" karne ke liye — §1 ke
  invariants pe bharosa karo. File already context me hai to dobara mat padho.
- Logs/stack trace: sirf user ne jo lines pasted ki wahi; poora log mat fetch karo.

### Output minimal diffs, not rewrites
- Sirf **diff / changed function** do — poori file tabhi jab user "rewrite the file" bole.
- No speculative refactor, no rename, no reformat untouched code, no "while I'm here" cleanup.
- One prompt = one focused change. Plan chahiye to 3–5 line ka do, fir ruk jao.

### Don't re-explain or echo
- Request restate mat karo, files wapas summarise mat karo, pehle likha recap mat karo.
- Preamble/postamble skip. Code pehle, ek line "why" agar zaroori ho.

### Model & agent-mode
- Cheapest capable model: chhote edits (rename/format/small fix/boilerplate) → base model;
  sirf architecture/hard-debug → premium model.
- Agent mode me ~2–3 tool cycle me converge na ho to ruk ke report karo — loop mat karo.

---

## 4. Verification — lean (biggest silent credit drain)
- Change compile ho aur ek requested kaam kare — bas.
- **Full quality gate (full lint + full test + full build) har task pe MAT chalao.**
- Tiered: backend change = sirf related ek test; UI change = sirf build;
  full gate sirf high-risk cross-module pe, wo bhi at most 1 baar, jab maanga jaye.
- Tests/lint ko ek-line note ki tarah suggest karo; generate mat karo jab tak bola na jaye.

---

## 5. Git Safety / Backup — code kabhi waste na ho
- Har working change ke baad: `git add -A && git commit -m "<what>" && git push origin HEAD`.
- Codex jo bhi code/config/docs change kare, final response se pehle exact changed scope ko Git me commit + `git push origin HEAD` kare, taaki GitHub par live update ho jaye.
- Risky kaam (3+ files / migration / rename / delete) se PEHLE checkpoint commit + push.
- **NEVER bina explicit user permission:** `git reset --hard`, `git checkout -- .`,
  `git clean -fd`, force push. Unsure ho to STOP karke poochho.
- Project OneDrive path me hi rahe; OneDrive sync band mat karo.

---

## Delete Safety Rule

- Kisi bhi existing code, file, route, API, schema, UI section, test, config, ya business logic ko delete/remove karne se pehle user se explicit permission lo.
- Refactor ke naam par bhi removal mat karo jab tak user ne clearly approve na kiya ho.
- Agar obsolete code remove karna zaroori lage, pehle short reason + exact file/symbol list batao, phir approval ka wait karo.
- Additive change preferred: delete ke bajay disable, wrap, extend, or deprecate approach use karo jab feasible ho.
- Delete safety: existing code/file/route/API/schema/UI/test/config/business logic remove karne se pehle explicit user permission lo. Pehle exact removal list aur reason batao; approval ke bina additive/wrapper approach use karo.

---

## 6. Profit Intelligence
`docs/profit-intelligence.md` SIRF in ke liye padho:
balance sheet · accounting · profitability · expenses · cashflow ·
service recipes · CEO dashboard

### Accounting
- `journalEntryLines` = source of truth
- `balanceSheetSnapshots` = archival only
- Debit == Credit
- WMA inventory costing
- Idempotent schedulers

---

## 7. Balance Sheet Scope
**Keep:** Balance Sheet · Ledger Engine · Auto Ledger Grouping · Tally Drill Down ·
Working Capital · Fixed Assets · Deferred Revenue · Cost Centers ·
Hardening Controls · AI Ledger Suggestions

**Do NOT build:** Trading Account · Purchase Account Screen · Sales Account Screen ·
Profit & Loss Report · Trial Balance Tab · Cash Flow Tab · Forecast Tab · Dashboard Tab

---

## ❌ Anti-patterns (credit-burners — avoid)
- Bade protected/service file ko "context samajhne" ke liye dobara padhna.
- 3-line change ke liye poori file dobara emit karna.
- Audit + plan + implement + test ek hi giant prompt me.
- Trivial edit ke baad poora test/build suite chalana.
- TS / Mongo migration suggest karna (hamesha reject — wasted tokens).
- Servers baar-baar restart karna.

---

## 8. Enterprise AI Role Catalogue

Har AI role ka format: Purpose, Responsibilities, Scope, Inputs, Outputs, Rules,
Do, Don't, Examples, Acceptance Criteria. Detailed implementation hamesha
existing codebase pattern se route hoga, new framework se nahi.

| Role | Purpose | Owns |
| --- | --- | --- |
| Chief Software Architect | Overall technical direction | locked stack, protected files, architecture drift |
| Technical Product Manager | Product sequencing | roadmap, acceptance criteria, release scope |
| Solution Architect | End-to-end design | module boundaries, integration flow |
| Business Analyst | Business rules clarity | salon workflows, edge cases |
| UI/UX Architect | Usable workflows | navigation, density, accessibility |
| Frontend Architect | Angular structure | routes, state, shared components |
| Frontend Engineer | UI delivery | pages, forms, client-side validation |
| Backend Architect | Express boundaries | route-service-repository layering |
| Backend Engineer | API delivery | routes, services, validators |
| Database Architect | Data model | SQLite, migrations, indexes, truth tables |
| Data Engineer | Reporting data | snapshots, exports, analytics inputs |
| Security Architect | Security model | auth, RBAC, tenancy, OWASP controls |
| Security Engineer | Security implementation | permission matrix, audit, secret handling |
| Performance Architect | Scaling model | query plans, caching choices, async work |
| Performance Engineer | Optimization | slow routes, indexing, payload size |
| DevOps Architect | Runtime strategy | deploy, backup, rollback, environments |
| DevOps Engineer | Operations | scripts, health checks, backup runbooks |
| Cloud Architect | Hosted topology | domains, TLS, monitoring, provider limits |
| QA Architect | Test strategy | lean checks, regression scope |
| QA Engineer | Verification | focused tests, reproduction notes |
| Automation Test Engineer | Repeatable checks | scripts, smoke tests, CI candidates |
| API Architect | API consistency | envelopes, versioning, errors, OpenAPI |
| Integration Engineer | Third-party systems | Razorpay, WhatsApp, SMS, email, webhooks |
| Accounting Expert | Finance correctness | ledger, GST, balance sheet, paise |
| Inventory Expert | Stock correctness | WMA costing, transfers, recipes |
| Salon Domain Expert | Operational fit | bookings, staff, customers, memberships |
| AI/ML Engineer | AI features | prompts, local fallbacks, provider adapters |
| Reporting Architect | Reports | KPIs, dashboards, drill-downs |
| Code Reviewer | Risk review | bugs, regressions, missing tests |
| Documentation Engineer | Durable docs | docs index, examples, acceptance criteria |
| Release Manager | Ship readiness | changelog, versioning, rollback notes |

## 9. Task Routing

- UI issue -> Frontend Architect/Engineer, then QA Engineer.
- API issue -> API Architect, Backend Engineer, Security Engineer if protected.
- Schema/query issue -> Database Architect, Backend Engineer.
- Auth/RBAC/tenant issue -> Security Architect/Engineer first.
- Accounting/inventory issue -> domain expert first, then backend/database.
- Docs/roadmap issue -> Documentation Engineer or Technical Product Manager.
- Deployment/runtime issue -> DevOps Engineer; check live state before restart.

## 10. Multi-Agent Workflow

Use extra agents only for parallel evidence gathering or independent review.
Single focused edits stay in one agent. Sub-agent findings are advisory; the
main agent must verify any code or file it changes.

## 11. Prompt Templates

- Bug fix: symptom, exact route/page/API, expected result, actual result,
  smallest reproduction, allowed files.
- Feature: user workflow, data source, permissions, API contract, UI entry
  point, acceptance criteria.
- Security: threat, affected route, trust boundary, permission, audit evidence,
  rollback plan.
- Docs: target file, required sections, source evidence, no-code constraint.

## 12. Enterprise Checklists

Coding: existing pattern reused, no protected file edits, no duplicate service,
tenant/branch scope, named params, integer paise.

Security: authenticated route, RBAC mapping, validation, audit event, safe error,
no secret leakage, tenant isolation test where risk exists.

Performance: indexed list query, pagination, no query-per-row loop, transaction
short, async job for long work.

Review: diff scoped, backward compatible, docs updated, lean verification run,
commit and push exact scope.

Release: env contract checked, migration additive, backup/rollback note present,
health check route known.

## 13. AI Decision Tree

1. Does the change need to exist? If no, report why.
2. Is there existing code/docs for it? Reuse that.
3. Can a wrapper/additive function solve it? Prefer that.
4. Is a protected file required? Stop and redesign around it.
5. Is deletion required? Ask explicit permission first.
6. Is verification possible with one focused check? Run that.

## 14. Review Workflow

Review output starts with risks, file/line references, missing tests, and
blocking questions. Summaries come after findings. No broad refactor requests
unless the current change makes them necessary.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## 15. Graphify Mandatory Workflow (Per Task)

Before any task:

1. Read `AGENTS.md`.
2. Read `graphify-out/GRAPH_REPORT.md`.
3. Load `graphify-out/graph.json`.
4. If the task is specific, use:
   `python -m graphify query "<task>" --budget 1500`.
5. Never scan the entire repo unless explicitly requested.
6. Read only files returned by graph queries.
7. Reuse existing architecture, APIs, models, services, and components.
8. Do not create duplicate implementations.
9. Do not start frontend or backend unless explicitly instructed.
10. Ask for approval before modifying protected files.
11. After code changes, run:
   `python -m graphify update . --force`.
12. Verify graph generation completed successfully before finishing.
