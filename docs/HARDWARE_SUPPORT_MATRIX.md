# Hardware Support Matrix

Baseline: 2026-08-03. `Code-ready` means the mounted API and application flow
exist; it does not mean a physical model or payment provider is certified.

## Realtime contract

Every WebSocket message carries `schemaVersion`, unique `eventId`,
`occurredAt`, `type` and `cacheTags` plus the scoped entity identifiers. Events
are invalidation signals, not business truth: clients reload the matching REST
resource after receipt. Delivery is at-least-once, clients tolerate duplicate or
lagged events, and reconnect uses capped backoff. Authentication and
tenant/branch scope are revalidated when the socket connects; REST remains the
fallback after reconnect or process restart.

| Capability | Supported connection | Product policy | Current evidence | Physical certification |
| --- | --- | --- | --- | --- |
| Receipt/invoice printing | Browser print, queued thermal/A4 POS print jobs | Retryable; invoice remains PostgreSQL-authoritative | Code-ready | Pending named printer/model UAT |
| Cash drawer | Assigned POS terminal/till; printer/driver kick where configured | No drawer mutation from a device callback; register totals remain server-authoritative | Code-ready | Pending printer/drawer bridge UAT |
| Barcode scanner | USB/Bluetooth HID keyboard input | Supported online; inventory scan events use client event IDs | Code-ready | Pending named scanner UAT |
| Camera barcode scan | Browser `BarcodeDetector` or manual barcode fallback | Camera permission required; no silent fallback | Conditional | Pending Android/iOS camera UAT |
| Payment terminal | Configured online provider/terminal adapter | Online-only; disconnect or unknown result never becomes paid | Fail-closed contract | Pending provider and terminal certification |
| Tap to Pay | Provider and device capability dependent | Online-only; unavailable until provider activation and compliance approval | Not certified | Pending provider/device selection |
| Kiosk tablet | Android tablet or iPad Capacitor/web kiosk | Enrolled device, branch allowlist, short guest session and remote revocation | Code-ready | Pending real tablet UAT |
| Camera/photo capture | Android/iOS camera or browser file capture | Consent, type/size scan and protected download required | Code-ready | Pending real-device UAT |
| Signature capture | Versioned form signature/confirmation | Online final submit; immutable submitted evidence | Code-ready | Pending touch-device UAT |
| Biometric attendance | Approved eSSL gateway or configured liveness provider | Consent, mapping, retention and branch policy required | Conditional | eSSL network/device and provider UAT pending |
| Android Staff App | Capacitor Android wrapper | Push, deep links, camera, GPS, reconnect and telemetry | Code-ready | Signed build/device UAT pending |
| iOS Staff App | Capacitor iOS wrapper | APNs, deep links, camera, GPS, reconnect and telemetry | Code-ready | Signed build/device UAT pending |

## Offline policy

- Staff schedule/tasks/attendance snapshot: encrypted and visibly timestamped.
- Staff task, leave, break and notification mutations: allowlisted, user/tenant/
  branch-bound, idempotent and conflict-aware.
- POS offline queue: unpaid service/product invoices only. Payment, wallet,
  membership, package, gift-card and loyalty mutations are online-only.
- Guest files, payroll, payment authorization and biometric/liveness evidence are
  never cached for unrestricted offline use.

## Release evidence required

Record model, OS/firmware, app version, connection, branch, tester, timestamp,
result and evidence link for every claimed supported device. A local compile,
browser simulation or adapter presence is not hardware/provider certification.
