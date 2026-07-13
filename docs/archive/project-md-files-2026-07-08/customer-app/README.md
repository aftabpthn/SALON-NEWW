# Aura Customer App

Standalone Ionic Angular + Capacitor customer booking app for web/PWA, Android, and iOS.

This folder is intentionally isolated from the existing SaaS. It does not import SaaS frontend modules, does not connect directly to the database, and does not modify existing backend behavior.

## Included

- Ionic Angular app structure
- Capacitor config for Android/iOS packaging
- PWA manifest and app icons
- Premium mobile-first customer UI
- Mock marketplace, services, staff, slots, and bookings
- API service placeholders for future backend integration
- Route structure for login, onboarding, home, search, business profile, booking, bookings, profile, notifications, settings, and help

## Run Later

After dependencies are installed:

```bash
npm install
npm start
```

Build web/PWA:

```bash
npm run build
```

Android:

```bash
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

iOS:

```bash
npm run cap:add:ios
npm run cap:sync
npm run cap:open:ios
```

## API Integration Order

1. `GET /api/v1/public/businesses`
2. `GET /api/v1/public/businesses/:slug`
3. `GET /api/v1/public/businesses/:slug/services`
4. `GET /api/v1/public/businesses/:slug/staff`
5. `GET /api/v1/public/businesses/:slug/availability`
6. `POST /api/v1/customer/auth/request-otp`
7. `POST /api/v1/customer/auth/verify-otp`
8. `POST /api/v1/customer/bookings`
9. `GET /api/v1/customer/bookings`
10. `POST /api/v1/customer/bookings/:id/cancel`
11. `POST /api/v1/customer/bookings/:id/reschedule`

## Safety Rule

The existing SaaS remains the source of truth. This app must call only public/customer-safe APIs and must never directly use private business/admin APIs.
