# Aura Customer App

Standalone Ionic Angular + Capacitor customer application for web/PWA, Android, and iOS. It is isolated from the CRM frontend and accesses business data only through public or customer-authorized `/api/v1` endpoints.

## Included

- Customer authentication, guarded routes, refresh handling, CSRF support, and device-session controls
- API-backed marketplace, search, business profile, availability, bookings, profile, offers, notifications, memberships, payments, and customer account modules
- Capacitor Android project, PWA manifest, responsive Ionic UI, and runtime Firebase configuration support
- Empty and error states; production routes do not fall back to fabricated business records

## Local commands

After installing dependencies, run the app on `http://127.0.0.1:4310`:

```bash
npm start
```

Use `npm run start:lan` only when the app must be reachable from another device on the local network. Build and native packaging commands remain available in `package.json`.

## Configuration

- Development API requests use `/api/v1` through `proxy.conf.json`.
- Production API requests use the same-origin `/api/v1` path; deployment must proxy that path to the Rust backend.
- Production Firebase values are supplied at runtime through `src/assets/customer-firebase-config.js`; do not commit private credentials.
- Native Capacitor builds use `src/assets/customer-runtime-config.js`; set `AURA_CUSTOMER_API_BASE_URL` to the HTTPS Rust API base (for example `https://api.example.com/api/v1`) before packaging. Web builds keep the relative `/api/v1` proxy.

The Rust backend remains the source of truth. The app must never call the database or protected owner/admin APIs directly.

## Integration status

The application source and production-safe configuration are imported and type-checked. Rust now exposes the marketplace, customer profile/session controls, bookings, rewards, wallet, memberships, packages, gift cards, invoices, payments, notifications, support, referrals, family, corporate, gallery, goals, and favorites used by the app.

Firebase customer authentication now exchanges verified Firebase ID tokens for normal Rust customer sessions and persists provider identities without bypassing the existing refresh/session boundary. Public live consultation is implemented with Redis rate limiting, bounded photo/context validation, safety guidance, and recommendations derived only from supplied live marketplace rows.

Live activation still requires `CUSTOMER_FIREBASE_API_KEY` and the matching runtime Firebase web configuration. Without those deployment values, Firebase sign-in intentionally returns an unavailable/configuration error; OTP customer login remains independent.
