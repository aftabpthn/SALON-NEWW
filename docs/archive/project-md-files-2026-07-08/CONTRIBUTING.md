# CONTRIBUTING.md — How to Contribute

> **Primary AI Role:** Code Reviewer / Documentation Engineer
> Humans and AI agents both follow this document. AGENTS.md invariants override everything.

## 1. Before You Start

1. Read **AGENTS.md** (invariants, token discipline, Delete Safety Rule) — non-negotiable.
2. Read **PROJECT_RULES.md** (Definition of Done) and **ARCHITECTURE.md** (where code goes).
3. For the domain you’re touching, read only its `docs/<domain>.md` — not the whole tree.

## 2. Setup

```bash
npm install
npm run dev        # API :4000 + Angular :4300 (proxy configured)
npm run seed:demo  # optional demo data
```

Dev servers start once and stay up — don’t restart per change (auto-reload handles it).

## 3. Making a Change

1. **One focused change per branch/PR.** No drive-by refactors, renames or reformatting of untouched code.
2. Respect layering: `server/routes` → `server/services` → `server/repositories`; SQL only in repositories; one registration line in `server/app.js`.
3. Protected files are read-only: `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js` — wrap, never edit.
4. Schema changes only via a new sequential file in `server/migrations` (additive-first).
5. Anything destructive (delete/rename/drop of code, routes, schema, tests, config) needs **explicit maintainer approval first** — list exactly what and why.

## 4. Verifying (lean — see TESTING.md)

- Backend change → `npx vitest run tests/<matching-feature>.test.js`
- UI change → `npm run build:client`
- Cross-module/risky → `npm run quality` once
- New features ship with the coverage listed in TESTING.md §4 (happy path, tenant isolation, permission denial, validation, money invariants, idempotency).

## 5. Committing & PRs

- Commit after every working change: `git add -A && git commit -m "<imperative summary>" && git push origin HEAD`.
- Never `git reset --hard`, `git checkout -- .`, `git clean -fd` or force-push without explicit permission.
- PR description: what changed, why, test evidence (exact command + result). Check yourself against PROJECT_RULES.md’s Definition of Done.
- Behaviour changes update the matching domain doc in the same PR; released changes get a CHANGELOG.md entry (docs/release-process.md).

## 6. Review Checklist (for reviewers)

- [ ] Tenant + branch scoping on every new query/table; named params only; money in paise.
- [ ] Permission mapping for new mutations; audit log for protected actions.
- [ ] Envelope + typed error codes per API_GUIDELINES.md / ERROR_HANDLING.md.
- [ ] No protected file edits; no SQL outside repositories; no new dependencies without justification.
- [ ] Tests per TESTING.md §4; docs updated; no secrets anywhere.

## 7. Reporting Issues

- Bugs: exact steps, expected vs actual, `requestId` if available.
- Security vulnerabilities: **privately** to maintainers — never a public issue (SECURITY.md §8).
