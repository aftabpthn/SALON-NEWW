# Staff app deployment

- Build with `npm run build` and publish `www/browser`.
- The production SPA registers `assets/staff-app-sw.js`. It caches only the application shell and static assets; API responses and authenticated business data are never cached.
- Attendance and leave mutations supported by the existing scoped offline queue are replayed after reconnection. Other actions remain online-only.
- The manifest uses the existing SVG brand icon. No raster icons were generated because the repository has no existing standard raster-generation command; install presentation therefore varies by browser.
- Production API URLs must be relative or HTTPS. `npm test` enforces this contract.
- Capacitor Android and iOS projects are committed under `android/` and `ios/`. Build the Angular web output before running the existing `cap:sync` script.
