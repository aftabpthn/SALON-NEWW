# Device and Browser Readiness

The operational support and certification boundary is published in
[HARDWARE_SUPPORT_MATRIX.md](./HARDWARE_SUPPORT_MATRIX.md).

This gate separates automated browser coverage from physical-device acceptance. Passing Playwright proves the configured browser engines, viewport, touch mode, network simulation, frontend behavior, and real staging APIs. It does not prove a specific physical iPhone, Android handset, or carrier network.

## Automated matrix

| Project | Browser engine | Viewport/device | Network |
|---|---|---|---|
| android-chrome-4g | Chromium | Pixel 5 profile | 4G latency |
| android-chrome-slow-4g | Chromium | Pixel 5 profile | Slow 4G latency |
| iphone-safari-wifi | WebKit | iPhone 13 profile | Wi-Fi |
| iphone-safari-slow | WebKit | iPhone 13 profile | Slow network |
| tablet-chrome-portrait | Chromium | 834 x 1194, touch | Wi-Fi |
| tablet-chrome-landscape | Chromium | 1194 x 834, touch | Wi-Fi |
| tablet-safari-portrait | WebKit | iPad Pro 11 portrait | Wi-Fi |
| tablet-safari-landscape | WebKit | iPad Pro 11 landscape | Wi-Fi |
| laptop-chrome | Chromium | Desktop | Broadband |
| laptop-edge | Microsoft Edge | Desktop | Broadband |
| laptop-firefox | Firefox | Desktop | Broadband |

The 4G profiles add deterministic API latency. Offline/reconnect uses the browser context offline control. Physical carrier bandwidth and radio handover still require device acceptance.

## Automated release checks

The read-only matrix verifies:

- authenticated route loading for dashboard, appointments, POS, clients, and staff;
- root viewport overflow on every target;
- branch context after reload;
- branch switch and restoration when E2E_SECOND_BRANCH_NAME is configured;
- real client search when E2E_CLIENT_QUERY is configured;
- refresh-cookie recovery after the access token expires;
- POS offline state and online recovery.

The pwa-chromium project verifies the production manifest, Angular service-worker activation, and offline app-shell reload. The service-worker configuration intentionally has no API data group, so authenticated CRM API responses are not cached.

The state-changing-chromium project is disabled unless E2E_ALLOW_WRITES=true. It creates and updates an appointment, creates a paid POS invoice, and saves an existing staff member's branch access. Run it only against a dedicated staging tenant with approved real test records.

## Required environment

Read-only authentication requires:

- E2E_BASE_URL
- E2E_TENANT_CONTEXT
- E2E_LOGIN_ID
- E2E_PASSWORD
- E2E_MFA_CODE when MFA is enabled
- E2E_BRANCH_NAME for a multi-branch login

Optional read-only coverage:

- E2E_SECOND_BRANCH_NAME
- E2E_CLIENT_QUERY

State-changing coverage additionally requires:

- E2E_ALLOW_WRITES=true
- E2E_SERVICE_QUERY
- E2E_STAFF_QUERY
- E2E_APPOINTMENT_DATE in DD/MM/YYYY
- E2E_APPOINTMENT_TIME as the option value used by the appointment page
- E2E_APPOINTMENT_UPDATE_NOTE
- E2E_POS_SERVICE
- E2E_POS_STAFF
- E2E_POS_PAYMENT_METHOD

From frontend-angular, install browsers once with npm run e2e:install and run the configured suite with npm run e2e. Use the GitHub Device and browser readiness workflow for the repeatable staging gate.

## Physical-device release sign-off

Before production promotion, record one result for each physical target:

| Target | Required checks |
|---|---|
| Android phone and Chrome | 4G, slow 4G, offline/reconnect, touch keyboard, login, branch switch, appointment, POS |
| iPhone and Safari | Wi-Fi, slow network, touch keyboard, login, branch switch, appointment, POS |
| Android or iPad tablet | Chrome and Safari where available, portrait and landscape, appointment and POS |
| Laptop | Current Chrome, Edge, and Firefox, keyboard navigation, token refresh, reload persistence |

Record device model, OS version, browser version, network, staging build identifier, tester, timestamp, result, and evidence link. A release is not physically device-proven until every row has an evidence-backed pass.
