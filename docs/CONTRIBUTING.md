# AuraShine CRM/POS — Quick Start for New Contributors

## 1) Start Here (5 minutes)
- Read:
  - [AGENTS.md](/Users/Aftab%20Ahamad/OneDrive%20-%20digi/Documents/AuraShine%20CRM%20Rust/AGENTS.md)
  - [PROJECT_RULES.md](/Users/Aftab%20Ahamad/OneDrive%20-%20digi/Documents/AuraShine%20CRM%20Rust/docs/PROJECT_RULES.md)
  - This file
- Open:
  - [docs/README.md](/Users/Aftab%20Ahamad/OneDrive%20-%20digi/Documents/AuraShine%20CRM%20Rust/docs/README.md)

## 2) Samajh lo kaam ka flow (what changes where)
- Frontend (UI): `src/app`
- Backend API: `backend-rust/src`
- Database / schema notes: `backend-rust/src/repositories`, `backend-rust/migrations`, `docs/DATABASE.md`
- Docs and standards: `docs/`

## 3) Local bootstrap
```bash
npm install
npm run dev
```
- Frontend: `http://127.0.0.1:4300`
- Backend health: `http://127.0.0.1:4000/health`

## 4) Task pick karne ka simple order
1. Pehle existing route/component/service ko locate karo.
2. Naya module tabhi add karo jab bilkul zaroori ho.
3. Existing helper/service/pattern reuse karo.
4. Minimum file changes karo (smallest patch).

## 5) Safe change rules
- Backward compatibility todna nahi hai.
- Existing feature break na ho, ispar focus.
- New logic ke liye 1) validation, 2) repository/service, 3) route, 4) UI order follow karo (same architecture).
- Har ticket ke liye: "kya hua" + "kyun hua" notes zaroor add karo.

## 6) Jab release ke liye check karna ho
- `npm run check:server`
- `npm test`
- Relevant quick smoke checks (backend health + core UI flow)

## 7) Non-engineer onboarding one-screen checklist
- Is project me kaam start karne se pehle: requirements likh lo.
- "Files changed" list chhoti rakho.
- Har change ke baad "impact" mention karo (kiske upar effect).
- Agar doubt ho: ask before assumptions.

## 8) Report format (mandatory)
Final update me include:
- What changed
- Kis file me kiya
- Why kiya
- Smallest verification result
- Abhi kya pending hai
