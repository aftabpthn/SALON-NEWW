# Staff app deployment

- Build with `npm run build` and publish `www/browser`.
- The production SPA registers `assets/staff-app-sw.js`. It caches only the application shell and static assets; API responses and authenticated business data are never cached.
- Attendance and leave mutations supported by the existing scoped offline queue are replayed after reconnection. Other actions remain online-only.
- The manifest, Android and iOS projects use committed raster icons and splash assets. Release certification still requires signed-build install screenshots and store asset validation from the exact release commit.
- Production API URLs must be relative or HTTPS. `npm test` enforces this contract.
- Capacitor Android and iOS projects are committed under `android/` and `ios/`. Build the Angular web output before running the existing `cap:sync` script.
- Do not call a wrapper store-ready until Android keystore, Apple signing profile, privacy declarations, push entitlements, real-device critical flows and staged store tracks are evidenced in `docs/evidence/staff-app-phase14-ledger.json`.
