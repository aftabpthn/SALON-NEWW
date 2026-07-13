# TESTING.md — Testing Standards

> **Primary AI Role:** QA Architect
> **Status:** Living document. Debugging guide: `docs/troubleshooting.md`.

## 1. Purpose

How AuraShine is tested: suite layout, what every feature must cover, and the
lean verification discipline that keeps iteration fast (AGENTS.md §4).

## 2. Test Stack & Layout

- **Runner:** vitest (`npm run test:unit`); orchestrated full run via `npm test` (`scripts/run-tests.mjs`); server syntax/health via `npm run check:server`.
- **Location:** `tests/`, one file per feature, named by domain (`billing-*.test.js`, `staff-*.test.js`, `tenant-safety.test.js`, …). ~100 suites and growing.
- **Quality gate:** `npm run quality` = check:server + tests + build. Used for releases and high-risk changes only.

## 3. Lean Verification Discipline

| Change | Verify with |
| --- | --- |
| Backend feature/fix | Only the matching suite: `npx vitest run tests/<feature>.test.js` |
| UI change | `npm run build:client` |
| Cross-module / risky | `npm run quality` — at most once, when warranted |
| Release | Full `npm run quality` (mandatory — docs/release-process.md) |

Do not run the full suite after trivial edits — it is the biggest silent credit drain.

## 4. What Every Feature Must Cover

1. **Happy path** through the public API (route level, envelope asserted).
2. **Tenant isolation:** a second tenant cannot read/write the feature’s rows (pattern: `tenant-safety.test.js`, `billing-tenant-isolation.test.js`).
3. **Permission denial:** under-privileged role gets 403 (pattern: `rbac.test.js`, `protected-actions.test.js`).
4. **Validation rejection:** malformed payload gets 400 with a stable error code.
5. **Money invariants** where applicable: paise integers, over-payment rejected, ledgers balance (pattern: `pos-invoice-payment-truth.test.js`, `billing-race-conditions.test.js`).
6. **Idempotency** for webhooks/schedulers/imports: replay is a no-op.

## 5. Test Style

- Tests are independent and re-runnable; each seeds its own tenant/branch fixtures — never depend on demo data or execution order.
- Assert behaviour through the API and resulting rows, not implementation internals.
- Name tests after the business rule (“rejects payment beyond invoice total”), not the function.
- Deterministic: fixed dates (IST semantics), no sleeps for time logic.

## 6. Regression Policy

- Every production bug gets a failing test first, then the fix, in the same change.
- Guard suites (tenant safety, billing security, RBAC) must never be weakened to pass — fix the code instead (SECURITY.md AI rules).

## 7. AI Instructions

- Extend the existing suite for the domain you touched; create a new file only for a genuinely new domain, following the naming convention.
- Never delete or skip failing tests to go green (Delete Safety Rule + report honestly).
- Include the exact command you ran and its result when reporting verification.

## 8. Acceptance Criteria

- New features land with the coverage in §4.
- `npm test` green on the release branch; guard suites green at all times.

## 9. Future Roadmap

- Automation Test Engineer role: browser-level smoke of POS + booking happy paths.
- Coverage reporting wired into the quality gate.
