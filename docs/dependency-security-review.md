# Dependency Security Review

Date: 2026-06-24

## Scope

- Root AuraSalon web/admin workspace dependencies
- Customer mobile app workspace dependencies
- GitHub Dependabot branch `dependabot/npm_and_yarn/npm_and_yarn-4612830131`

## Decision

The stale Dependabot branch was not merged directly because its diff would remove current data migration implementation files and recent launch documentation. Instead, the safe same-major dependency updates were applied on the active branch.

## Applied Updates

Root workspace:

- Angular framework packages pinned to `20.3.25`
- Angular CLI/build tooling updated to safe available patch versions
- `concurrently` updated to `9.2.3`
- Lockfile refreshed with non-breaking `npm audit fix`

Customer app workspace:

- Angular framework packages pinned to `20.3.25`
- Angular CLI/build tooling updated to safe available patch versions
- Lockfile refreshed with non-breaking `npm audit fix`

## Residual Audit Risk

Root workspace audit now reports 5 vulnerabilities:

- `xlsx`: high severity, no patched npm release currently available through `npm audit`
- Angular compiler/build transitive `@babel/core`: audit suggests a breaking downgrade path, so it was not forced
- `esbuild`: dev-server-only advisory remains through current tooling resolution

Customer app audit now reports 11 vulnerabilities:

- Angular compiler/build transitive `@babel/core`
- `http-proxy-middleware`, `uuid`, `sockjs`, and `webpack-dev-server` through dev tooling
- `esbuild` through Vite/dev tooling

## Production Controls

- Do not expose Angular dev servers publicly.
- Keep imported spreadsheet files restricted to trusted tenant admins.
- Keep migration uploads validated through the server-side analyzer before import.
- Track `xlsx` replacement or upstream fix as a release-blocking security follow-up before broad public launch.
- Avoid `npm audit fix --force` until Angular publishes a non-breaking patched dependency path.

## Verification

- Root admin build passed with `npx ng build --configuration development`.
- Customer app build passed with `npm run build`.
- Customer app build reports a bundle budget warning, not a compilation failure.
