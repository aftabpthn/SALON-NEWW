# Aura Staff App

Standalone Ionic Angular staff operations application. It is separate from the CRM frontend and uses authenticated `/api/v1` endpoints for staff dashboards, appointments, attendance, payroll, targets, leave, chat, notifications, and device registration.

## Local commands

After installing dependencies, run the app on `http://127.0.0.1:4320`:

```bash
npm start
```

Use `npm run start:lan` only when another device on the local network must reach the app. The production build publishes `www/browser`.

## Security and data rules

- Staff must provide a real tenant ID and staff-linked login; no demo-session route or fabricated tenant default is used.
- Route guards mirror backend permissions, but the Rust API remains responsible for authorization and tenant/branch isolation.
- Access tokens are kept in memory; refresh and CSRF flows use secure credentialed requests.
- Business records come from APIs. Failed requests show loading, empty, or error states rather than mock staff data.

Production API paths are same-origin and must be proxied to the Rust backend over HTTPS.
Native Capacitor builds can set `AURA_STAFF_API_BASE_URL` in `src/assets/staff-runtime-config.js` to the HTTPS Rust API base before packaging; web builds keep the relative `/api/v1` proxy.

## Integration status

Core staff self-service is wired to the Rust backend: dashboard, schedule, attendance history, clock in/out, breaks, tasks, payroll, targets, leave requests, and leave balances use tenant/branch-scoped `/staff/*`, `/staff-attendance/*`, and `/staff-leave/*` routes. The app sends the authenticated tenant and branch context required by Rust; no second staff backend is used.

Advanced Staff App contracts are mapped to Rust: enterprise OS, workspace preferences, self-scoped business/invoice views, notification status, optimistic calendar updates, team/private-owner chat, encrypted Web Push registration, queued push delivery, and token-authenticated team-chat WebSocket updates. Private conversations enforce persisted participant access and all staff data remains tenant/branch/self scoped.

Live push activation still requires `MOBILE_PUSH_PROVIDER_URL`, `MOBILE_PUSH_PROVIDER_TOKEN`, `MOBILE_PUSH_PUBLIC_KEY`, and `SECURITY_ENCRYPTION_KEY`. The app reports push as unconfigured until all required provider values are present; its remaining staff workflows continue to work without push.
