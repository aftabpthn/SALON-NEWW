# Monorepo consistency

AuraShine is a monorepo: one git repository holding three Angular apps
(`frontend-angular`, `staff-app`, `customer-app`), a Rust backend and a Python
AI service. The Rust backend is a monolith — one binary, one deploy — and that
is a deliberate choice, not a stage on the way to microservices.

What the repository does not have is monorepo *tooling*. There is no npm
workspaces, nx, lerna or turbo, so nothing ever checked that the three apps
agree with each other. They stopped agreeing.

## What drifted

At the time this check was introduced, **16 of the 21 dependencies the three
apps share were on different versions**, including a whole major of Angular:

| Dependency | frontend-angular | staff-app | customer-app |
|---|---|---|---|
| `@angular/core` | ^21.2.18 | 20.3.25 | 20.3.25 |
| `typescript` | ~5.9.3 | ~5.8.0 | ~5.8.0 |
| `@angular/cli` | ^21.2.19 | 20.3.30 | 20.3.30 |

Four cross-cutting modules also exist in more than one app and no longer match:
`csrf.interceptor.ts`, `auth.guard.ts`, `auth.interceptor.ts`,
`auth.service.ts`. Divergence there is a bug rather than a design — a CSRF
interceptor that retries on 403 in one app and not in another is one app
quietly missing a fix. (`app.component.ts` and `app.routes.ts` differ too, and
are excluded: every app has its own shell and screens.)

## What the check does

`scripts/check-monorepo-consistency.mjs` runs in the pull-request gate and
fails on **new** drift only. Everything already wrong is recorded in
`docs/evidence/monorepo-consistency-baseline.json`.

That split is deliberate. Aligning the apps today would mean moving `staff-app`
and `customer-app` from Angular 20 to 21, which is a major upgrade that has to
be planned and tested, not swept in by a lint script. Failing the build on it
now would only teach everyone to skip the check. So the existing gap stays
visible and countable, and nothing can quietly add to it.

```bash
node scripts/check-monorepo-consistency.mjs             # verify (CI runs this)
node scripts/check-monorepo-consistency.mjs --baseline  # re-record
```

The baseline is a debt ceiling: `--baseline` refuses to record a list worse
than the one on disk, so it cannot be used to wave a regression through. Use it
after you have *removed* drift, to lock the improvement in.

## Burning the baseline down

1. **Align the safe ones first.** `tslib`, `rxjs`, `zone.js` and `@capacitor/app`
   differ only in patch or minor range. Pick one version per dependency, update
   all three `package.json` files, run `npm install` in each app, build each
   app, then re-record the baseline.
2. **Extract the shared modules.** `csrf.interceptor.ts` and the `auth.*` files
   solve the same problem in more than one app. Moving them to a shared location
   needs a TypeScript path mapping in each app's `tsconfig.json`; do it one
   module at a time and build each app after each move.
3. **Plan the Angular alignment separately.** `staff-app` and `customer-app` are
   a major version behind `frontend-angular`. That is its own piece of work with
   its own testing, not a cleanup task.

Steps 1 and 2 need `npm install` and a real build to verify, so they belong to
whoever can run the front-end toolchain.
