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

Jab task ke liye app chahiye, dono servers **ek baar background me** start karo,
fir wahi reuse karo. Baar-baar restart = token/credit waste.

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
