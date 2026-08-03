# Staff App — Zenoti MyZen and Zenoti Mobile Parity Register

Baseline date: 2026-08-01
Zenoti public-release cutoff: 2026-07-28
AuraShine source of truth: canonical `staff-app/`, Rust `/api/v1` routes, PostgreSQL, and active `docs/` only.

## Completion rule

This register separates source presence from verified product parity. A row is complete only after its UI, API, database persistence, tenant/branch/self-scope, permission denial, audit, automatic reload, failure states, and real authenticated UAT are evidenced. Provider, native-device, biometric, payout, and store-distribution rows additionally require real provider/device evidence.

Statuses:

- `SOURCE READY`: current source has the main end-to-end contract; authenticated/browser or device proof can still be pending.
- `PARTIAL`: useful implementation exists, but one or more Zenoti workflow steps or evidence layers are missing.
- `MISSING`: no equivalent production workflow was found in the current Staff App.
- `EXTERNAL BLOCKED`: source contract exists, but credentials, device, signing, provider, or certification evidence is unavailable.

## Official Zenoti sources

- [MyZen](https://help.zenoti.com/en/myzen.html)
- [Get started with MyZen](https://help.zenoti.com/en/myzen/get-started-with-myzen-app.html)
- [Manage schedule](https://help.zenoti.com/en/myzen/manage-schedule.html)
- [Manage earnings](https://help.zenoti.com/en/myzen/manage-earnings.html)
- [View performance metrics](https://help.zenoti.com/en/myzen/other-actions/view-your-performance-metrics.html)
- [Employee and payroll](https://help.zenoti.com/en/employee-and-payroll.html)
- [Zenoti Mobile appointment management](https://help.zenoti.com/en/zenoti-mobile/zenoti-mobile-v2/manage-appointments.html)
- [Zenoti Mobile security permissions](https://help.zenoti.com/en/configuration/security-configurations/understand-security-permissions.html)
- [AI Scribe](https://help.zenoti.com/en/configuration/forms-configurations/ai-scribe/set-up-and-manage-ai-scribe.html)
- [Release notes](https://help.zenoti.com/en/release-notes.html)

## A. Identity, access, profile, and application shell

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| A01 | Employer/account and employee sign-in | `/auth/csrf`, `/auth/login`, tenant header, `staff-login.page.ts` | SOURCE READY | 1 |
| A02 | Secure token refresh without exposing access token to durable browser storage | `/auth/refresh`, in-memory access token, credentialed refresh flow | SOURCE READY | 1 |
| A03 | Logout and session invalidation | `/auth/logout`, active session/device list, self-revoke, Staff App authoritative session check, termination refresh-session revocation and offline queue purge | SOURCE READY; LIVE UAT PENDING | 1 |
| A04 | Restore session and employee identity | `/auth/me`, `/staff/self/dashboard` | SOURCE READY | 1 |
| A05 | Per-screen and per-action mobile permissions | `staffPermissionGuard`, granular `staff.app.*`, Rust fail-closed mapping | SOURCE READY | 1 |
| A06 | Employee-only self-scope | JWT-linked staff profile, tenant/branch/self-scoped Rust handlers | SOURCE READY | 1 |
| A07 | Device biometric/PIN application unlock | WebAuthn register/login plus server-hashed per-device PIN with retry lockout; no PIN/token/password is stored in browser storage | SOURCE READY; LIVE UAT PENDING | 1 |
| A08 | Change password | `/auth/change-password`, Staff Settings | SOURCE READY | 1 |
| A09 | MFA enrollment and use | Existing setup/enable/challenge flow preserved; Staff App enrollment and challenge remain part of the three-role live certification gate | SOURCE READY; LIVE UAT PENDING | 1 |
| A10 | Edit employee phone/email/profile image | Self-scoped contact edit, real email/SMS verification challenge, JPG/PNG validation, production malware scan, secure image read/upload and automatic reload | SOURCE READY; PROVIDER/LIVE UAT PENDING | 1 |
| A11 | Switch authorized center/branch in app | Backend-authoritative `/auth/switch-branch`, active assignment validation, optional preferred branch and session/context reload | SOURCE READY; LIVE UAT PENDING | 1 |
| A12 | Automatic logout/inactivity policy | Branch security policy drives PIN lock with logout grace or immediate logout; security recovery actions remain available | SOURCE READY; LIVE UAT PENDING | 1 |
| A13 | Geofence-limited application access | Whole Staff App supports full access, read-only outside, blocked outside, configurable radius and case-insensitive role exceptions | SOURCE READY; GPS/LIVE UAT PENDING | 1 |
| A14 | Guest and financial field masking | Business response has fine-grained name/invoice/discount/GST/value/commission permissions | SOURCE READY | 1 |
| A15 | Mobile-first loading, retry, empty, denied, and API-error states | Shared page state plus loading-first dashboard architecture | SOURCE READY | 1 |
| A16 | Configurable workspace/preferences | Persisted compact/time/date preferences, locale selection aligned with existing English/Hindi/Hinglish catalog codes, calendar-sync preference and authorized branch selection | SOURCE READY; LIVE UAT PENDING | 1 |

## B. Dashboard, schedule, attendance, breaks, and leave

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| B01 | Useful employee dashboard | `/staff/self/dashboard`, `staff-dashboard.page.ts` | SOURCE READY | 1 |
| B02 | Load core dashboard before optional metrics/preferences | Core-first render with background hydration | SOURCE READY | 1 |
| B03 | View own weekly schedule and time sheet | Roster and Calendar pages, `/staff/self/roster`, `/staff/self/calendar` | SOURCE READY | 2 |
| B04 | Employee adds own available schedule | `/staff-self/calendar` validates self-scope, permission, future date, overlap and PostgreSQL persistence; Roster auto-reloads | SOURCE READY; LIVE UAT PENDING | 2 |
| B05 | Reschedule/update assigned shift | `/staff-self/calendar/:id`, optimistic version and reload | SOURCE READY | 2 |
| B06 | Accept/reject shift or substitution request | Self-scoped employee decision inbox, accept/reject reason, optimistic version and manager-only final approval are wired | SOURCE READY; LIVE UAT PENDING | 2 |
| B07 | Sync work calendar to iCal/Google/Outlook | Revocable hashed private calendar-feed token and standards-based ICS response exposed in Roster | SOURCE READY; CLIENT/LIVE UAT PENDING | 2 |
| B08 | Clock in and clock out | `/staff-attendance/clock-in`, `/clock-out` | SOURCE READY | 2 |
| B09 | Start and end breaks | `/staff-attendance/break-start`, `/break-end`, transport-only offline queue | SOURCE READY | 2 |
| B10 | Biometric attendance with physical identity and liveness | WebAuthn attendance is correctly labelled passkey verification; true face/fingerprint gateway, consent and retention are separate, while real provider/device certification remains unavailable | EXTERNAL BLOCKED | 2 |
| B11 | Attendance history and worked/overtime breakdown | Self-scoped attendance detail and 30-day UI | SOURCE READY | 2 |
| B12 | Early departure request and status | `/staff-attendance/early-departure-requests` | SOURCE READY | 2 |
| B13 | Request correction to past clock-in/out with work task and reason | Staff App self-request, pending history, manager approve/reject with reason, optimistic version, immutable superseded sessions and audit | SOURCE READY; LIVE UAT PENDING | 2 |
| B14 | Declare cash tips during clock-out | Staff App rupee input posts integer paise; session and daily attendance records persist declared tips | SOURCE READY; LIVE UAT PENDING | 2 |
| B15 | View leave balances | `/staff-leave/balances` self-scope | SOURCE READY | 2 |
| B16 | Request leave | `/staff-leave/requests`, offline transport queue, idempotency | SOURCE READY | 2 |
| B17 | Withdraw pending leave | `/staff-leave/requests/:id/withdraw`, optimistic version | SOURCE READY | 2 |
| B18 | Receive approval/rejection status and notification | Persisted approval status and notification automation are wired; provider delivery proof remains deployment UAT | SOURCE READY; PUSH/LIVE UAT PENDING | 2 |
| B19 | Weekly off, holiday, special leave, half day, late and absent states | Migration/status model and attendance services support these states | SOURCE READY | 2 |
| B20 | Multiple shifts and clock sessions per business date | Two shift slots remain in the schedule contract; attendance sessions preserve every clock-in/out and aggregate daily worked/break/tip totals | SOURCE READY; LIVE UAT PENDING | 2 |
| B21 | Work task selection and approved task pay rate | Active staff work-task rates are selected at clock-in and snapshotted on the immutable attendance session for payroll input | SOURCE READY; PAYROLL UAT PENDING | 2 |
| B22 | Schedule room/job/role, manager editing, overwrite prevention and change notice | Manager schedule carries associations, locks current rows, rejects stale versions and queues staff notifications | SOURCE READY; LIVE UAT PENDING | 2 |
| B23 | Scheduled/unscheduled clock policy, early threshold, break warning and forgot-clock reminder | Attendance clock options are policy-backed and enforce block/warn/early thresholds; mandatory-break and forgot-clock controls persist in PostgreSQL | SOURCE READY; REMINDER DELIVERY UAT PENDING | 2 |
| B24 | Overnight attendance and payroll lock protection | Business date remains explicit across midnight; clock/correction service rejects locked payroll periods | SOURCE READY; LIVE UAT PENDING | 2 |
| B25 | Full-day and partial-day leave with per-day times | Leave request-day rows store exact time windows and requested fractions; appointment availability blocks only overlapping partial leave | SOURCE READY; LIVE UAT PENDING | 2 |
| B26 | Cancel approved leave and restore appointment availability | Exact leave-linked future schedule backup/restore prevents unrelated schedule deletion; cancellation is versioned and audited | SOURCE READY; LIVE UAT PENDING | 2 |
| B27 | Unified balance, accrual, negative/cap/carry configuration and manager on behalf | Same-user multi-branch balance, accrual ledger, limits and manager-scoped request contract are database-backed | SOURCE READY; POLICY/LIVE UAT PENDING | 2 |
| B28 | Personal block-out create/edit/delete | Versioned, self/manager-scoped block-outs are available through Roster and schedule APIs | SOURCE READY; LIVE UAT PENDING | 2 |

## C. Provider appointments and guest service execution

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| C01 | View own today/upcoming/live/completed/cancelled appointments | Dashboard plus Staff App appointment views | SOURCE READY | 3 |
| C02 | Search and filter full self appointment history | `/staff-self/business` filters and pagination | SOURCE READY | 3 |
| C03 | View appointment client, services, chair, duration, and history | Appointment details drawer and enterprise timeline | SOURCE READY | 3 |
| C04 | Reschedule own appointment with validation | `/staff-self/appointments/:id/reschedule` and automatic reload | SOURCE READY | 3 |
| C05 | Cancel own appointment with reason | `/staff-self/appointments/:id/cancel` and automatic reload | SOURCE READY | 3 |
| C06 | Book a new appointment from provider calendar | Existing client/service/resource contracts feed the Staff Appointment Book; transactional batch save validates availability and refreshes automatically | SOURCE READY; LIVE UAT PENDING | 3 |
| C07 | Rebook a completed appointment | Appointment drawer reuses the existing booking editor for same-provider or another-provider rebooking and refreshes the real Appointment Book after save | SOURCE READY; LIVE UAT PENDING | 4 |
| C08 | Move appointment by drag/list action | Provider/date/time/duration/room move is complete through the list/drawer action with authoritative conflict validation and reload; drag is interaction polish, not a separate business workflow | SOURCE READY; LIVE UAT PENDING | 3 |
| C09 | Check in guest | Permission-scoped Staff App status action persists `arrived`, audits and reloads | SOURCE READY; LIVE UAT PENDING | 3 |
| C10 | Start, complete, undo, confirm, or no-show service | Confirm, check-in, reasoned no-show, start, pause/resume and complete are wired; completion is blocked for missing manual recipe usage or pending approval | SOURCE READY; LIVE UAT PENDING | 3 |
| C11 | Edit service duration | Booking drawer edits exact start/end duration with conflict validation and optimistic version protection | SOURCE READY; LIVE UAT PENDING | 3 |
| C12 | Add/remove service and zero-duration add-on | Multi-line service/add-on editor uses real service variants/add-ons, authoritative quote and transactional batch save | SOURCE READY; LIVE UAT PENDING | 3 |
| C13 | Group/parallel appointment handling | Staff App supports couple, 2–6 guest group, large-group and parallel/manual-time booking through the transactional batch engine | SOURCE READY; LIVE UAT PENDING | 4 |
| C14 | Create/manage provider block-out time | Versioned provider block-out API and Staff App Roster create/delete workflow auto-reload real data | SOURCE READY; LIVE UAT PENDING | 2 |
| C15 | View permission-masked guest profile and indicators | Appointment-scoped Guest 360 returns masked contact by permission plus visits, benefits, activity, occasions and operational alerts | SOURCE READY; LIVE UAT PENDING | 5 |
| C16 | View/add guest and appointment notes | Visibility-scoped assigned/branch/management notes persist with appointment association and audit history | SOURCE READY; LIVE UAT PENDING | 5 |
| C17 | Open, fill, sign, and submit guest/service forms | One versioned engine supports guest/service/membership/package/tag scope, conditional fields, drafts, signatures, immutable final evidence, corrections, expiry and review | SOURCE READY; LIVE UAT PENDING | 5 |
| C18 | Capture before/after photos with consent | Camera/gallery upload validates type/magic/size, requires consent, scans files and streams private no-store content without public URLs | SOURCE READY; DEVICE/LIVE UAT PENDING | 5 |
| C19 | Record consultation/clinical notes | Optimistic-version clinical allergies/preferences editor is permission-scoped and audited | SOURCE READY; LIVE UAT PENDING | 5 |
| C20 | View prior service and contraindication/allergy alerts | Existing Client 360 service history and protected clinical profile now render in the appointment drawer | SOURCE READY; LIVE UAT PENDING | 5 |
| C21 | Track service consumables against appointment | Service workspace records planned versus actual and wasted quantity through `/staff-self/business/product-usage`; appointment, service, staff and client remain ledger-attributed and the frontend never changes stock directly | SOURCE READY; DATABASE/LIVE UAT PENDING | 6 |
| C22 | FEFO/recipe/variance/approval behavior for consumption | Transactional inventory service validates selected current FEFO batch, stock, expiry, waste reason and recipe limits; abnormal usage enters maker-checker review and the idempotency key prevents a second movement | SOURCE READY; DATABASE/LIVE UAT PENDING | 6 |
| C23 | Upsell retail item or service add-on | Barcode/search uses real available retail stock and configured selling price; product, service, membership and package recommendations append seller-attributed lines to the existing appointment POS draft without automatic discount, sale or payment | SOURCE READY; AUTHENTICATED POS UAT PENDING | 6 |
| C40 | Service workspace summary and handoff | Existing appointment drawer now shows guest risk/consent context, selected services/add-ons, provider instructions, room/equipment, execution/forms state, usage history, checkout draft and audited handoff notes | SOURCE READY; DEVICE/LIVE UAT PENDING | 6 |
| C28 | My Day plus own 1/3/7-day calendar | Existing My Day queue and API-backed 1/3/7-day own calendar with past/future navigation | SOURCE READY; LIVE UAT PENDING | 3 |
| C29 | Read team calendar and room/equipment calendar | Separate explicit-deny-aware team read permission; one-day provider/resource views show schedules and non-working time | SOURCE READY; LIVE UAT PENDING | 3 |
| C30 | Provider-specific request, pricing and eligibility review | Any/preferred/required provider request, provider quote, conflict check and membership/package/wallet visibility before save | SOURCE READY; LIVE UAT PENDING | 3 |
| C31 | Idempotent, audited, optimistic booking mutation | PostgreSQL advisory serialization, durable mutation key replay, stale-version rejection, audit activity and automatic reload | SOURCE READY; DATABASE/LIVE UAT PENDING | 3 |
| C32 | Permission-aware team edit and price override | Self/team mutation boundaries are separate; manual price requires exact permission and a persisted audit reason | SOURCE READY; DENIAL/LIVE UAT PENDING | 3 |
| C33 | Couples, 2-6 guest groups, large groups and day packages | Existing atomic batch engine now accepts per-line guests, typed group shape, validated/persisted real day-package ID and service membership, host/group notes and durable booking-group membership | SOURCE READY; LIVE UAT PENDING | 4 |
| C34 | Gaps, parallel, segmented, recurring, surprise and virtual appointments | Per-service flow metadata, manual time windows, 1-52 recurrence validation, surprise flag and validated HTTPS meeting link persist in PostgreSQL | SOURCE READY; LIVE UAT PENDING | 4 |
| C35 | Waitlist, arrival queue and online reschedule/cancellation inbox | Team-scoped waitlist conversion, arrived/waiting start action, and approve/reject inbox reuse the booking/reschedule/cancel engines | SOURCE READY; LIVE UAT PENDING | 4 |
| C36 | Provider substitution, capacity/resource conflict and block time | Manager handoff uses authoritative provider availability; booking reuses staff/resource/blackout conflicts; Appointment Book reuses schedule block-outs | SOURCE READY; LIVE UAT PENDING | 4 |
| C37 | Start, pause, resume and complete individual/group service | Durable execution state/timestamps/pause accumulation with self/team scope and immutable appointment activity | SOURCE READY; LIVE UAT PENDING | 4 |
| C38 | Rebook, adjacent visits, activity, forms and consumables | Same/other-provider rebook, immediate visits, full activity ledger and database-derived form/consumable indicators are visible in the existing detail drawer | SOURCE READY; LIVE UAT PENDING | 4 |
| C39 | Checkout-ready handoff without page refresh | Existing canonical appointment/group POS draft is created idempotently, appointments complete, and Staff App auto-refetches through the shared update event | SOURCE READY; AUTHENTICATED POS UAT PENDING | 4 |
| C24 | View closed invoice and receipt | Self-scoped appointment checkout returns the canonical POS invoice, lines, payments, printable HTML and audited delivery actions | SOURCE READY; AUTHENTICATED UAT PENDING | 7 |
| C25 | Launch POS and collect payment | Existing Appointment drawer opens the canonical invoice and supports cash/manual methods, provider card token, India UPI link, partial/split payment, durable multi-staff tip allocation, finalize, receipt, refund and void | SOURCE READY; PROVIDER/AUTHENTICATED UAT PENDING | 7 |
| C26 | Split/group bill and apply eligible benefits | Group appointment reference is preserved; server validates and consumes package/membership credits and blocks pricing edits after payment | SOURCE READY; DATABASE/AUTHENTICATED UAT PENDING | 7 |
| C27 | Tap/contactless payment from staff device | Staff App accepts only an opaque token from the approved provider/device SDK; raw card/UPI manual recording is rejected and duplicate protection is provider/idempotency based | SOURCE READY; REAL TERMINAL/TAP DEVICE EXTERNAL BLOCKED | 7 |
| C41 | Product/service/liability sale and no-show fee | Existing product/service/membership/package adapters are reused; gift/prepaid card finalization issues the real liability ledger and permission-gated no-show fee uses the existing payment-link engine | SOURCE READY; AUTHENTICATED UAT PENDING | 7 |
| C42 | Drawer/session, cash movement, blind close and manager approval | Existing cash-drawer engine is exposed through explicit-deny-aware Staff App wrappers and the Business screen never reveals expected cash before close | SOURCE READY; AUTHENTICATED UAT PENDING | 7 |
| C43 | Provider settlement reconciliation | Existing Razorpay/Cashfree/PhonePe reconciliation, MFA and review workflow is exposed to register approvers without duplicating settlement logic | SOURCE READY; PROVIDER STATEMENT UAT PENDING | 7 |

## D. Earnings, tips, payroll, performance, and feedback

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| D01 | View earnings and commission summary | Payroll and Business pages use real dashboard/business data | SOURCE READY | 8 |
| D02 | Invoice-level commission explanation | `/staff-self/earnings` returns sale, invoice, item, rule, base and exact-paise commission detail | SOURCE READY | 8 |
| D03 | Smart same-day commission refresh and calculated-through timestamp | Safe GET refresh preserves the selected period/basis; `calculatedUpTo` is the latest persisted commission-snapshot timestamp, never request time | SOURCE READY | 8 |
| D04 | Service, product, membership, package, free-service, cancellation, and no-show commissions | Staff Payroll exposes canonical commission snapshots by item type and flags free-service and cancellation/no-show cases | SOURCE READY; REAL-DATA UAT PENDING | 8 |
| D05 | Hourly versus commission, overtime, bonuses, and deductions | Existing finalized payroll breakdown is retained; cost and deduction sections are separately permission-controlled | SOURCE READY; FINALIZED-RUN UAT PENDING | 8 |
| D06 | View payroll history and payslip | Payroll page and payslip path mapping exist | SOURCE READY | 8 |
| D07 | View tax, deduction, employer, and year-to-date paystub detail | Staff payroll shows gross, deduction, net, employer statutory contribution, YTD totals, item drill-down and protected payslip PDF | SOURCE READY; FINALIZED PAYROLL UAT PENDING | 8 |
| D08 | Download employee and business HR/payroll documents | Verified payroll, tax, statutory, policy, handbook and employment documents stream through self-scoped `/staff-self/payroll-documents/:id/content`; raw file URLs are not returned | SOURCE READY | 8 |
| D09 | Same-day tips payout | Card/cash allocation, declared tips, payout status/method/history, reconciliation state and dispute request are Staff-visible; real payout-provider certification is unavailable | EXTERNAL BLOCKED | 8 |
| D10 | Employee wallet, physical/virtual card, direct deposit, card controls | India decision: Zenoti US Wallet/card is `NOT APPLICABLE`; AuraShine retains employer-controlled INR bank/UPI payout and reconciliation | NOT APPLICABLE (INDIA) | 8 |
| D20 | Salary advance, recovery and reimbursement history | Canonical salary advances/recoveries and staff-linked outgoing-fund reimbursements are exposed self-scoped | SOURCE READY | 8 |
| D21 | Tip allocation follows multi-staff split ownership | Earnings and payroll tip sources read canonical `tip_splits`; payout uniqueness is per sale and staff | SOURCE READY | 8 |
| D22 | Inactive employee document access | Disabled by default because self-document handlers require an active linked staff identity; enable only after an approved business/legal requirement | NOT APPLICABLE BY DEFAULT | 8 |
| D11 | View configurable performance metrics by period | `/staff-self/performance` and the existing Performance page support day, week, month, payroll period and custom dates; Staff Control Center persists branch metric visibility and safe custom aliases | SOURCE READY; AUTHENTICATED UAT PENDING | 9 |
| D12 | Choose sale-date versus close-date/revenue basis | Performance has an explicit basis selector; the backend applies business date or finalized close date to attributed POS facts | SOURCE READY; REAL-DATA RECONCILIATION PENDING | 9 |
| D13 | Revenue, guest, retention, rebooking, product/service, utilization and rating KPIs | All Phase 9 metrics expose value, numerator, denominator, formula, source and freshness; 90-day retention excludes cohorts too recent for an outcome | SOURCE READY; REAL-DATA RECONCILIATION PENDING | 9 |
| D14 | Leaderboard and ranking | Dedicated leaderboard remains branch-scoped and now exposes every component, weight and evidence source; ranking is advisory and non-punitive | SOURCE READY; AUTHENTICATED UAT PENDING | 9 |
| D15 | Goals, coaching, skills and training | Persisted coaching goals, progress, self-scoped skill matrix, training recommendations and evidence-based coaching are integrated; workload safeguards are excluded from score | SOURCE READY; AUTHENTICATED UAT PENDING | 9 |
| D16 | Appraisals, self-review, key results, and acknowledgement | Existing `/staff-self/appraisals` workflows remain on Performance and load after the core KPI state | SOURCE READY; AUTHENTICATED UAT PENDING | 9 |
| D17 | View guest feedback | Self-scoped feedback page | SOURCE READY | 9 |
| D18 | Submit internal feedback/request | `/staff-self/feedback` create workflow | SOURCE READY | 9 |
| D19 | Manager resolution visible to employee | Manager note/status are returned in the self-scoped feedback API and realtime update reloads the employee page | SOURCE READY; LIVE UAT PENDING | 9 |

## E. Tasks, learning, chat, notifications, reports, and offers

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| E01 | View assigned tasks | `/staff/self/tasks` and Tasks kanban | SOURCE READY | 10 |
| E02 | Move/complete task with optimistic version and reload | Task status API and transport-only offline queue | SOURCE READY | 10 |
| E03 | Work-task-aware field jobs | Field job status, GPS, and customer-confirmed proof | SOURCE READY | 10 |
| E04 | Read policies/SOPs | `/staff-self/rules` | SOURCE READY | 10 |
| E05 | Mandatory acknowledgement and server-scored quiz | Read/ack endpoints, quiz answer hiding and server score | SOURCE READY | 10 |
| E06 | Assigned training/course completion | Versioned course profiles, enrolment tasks, server-scored completion and certification issuance reuse the Rules/LMS flow | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E07 | Employee and company documents | Secure payroll files plus published company document/policy/announcement content are permission-scoped; full inactive-employee retention policy remains approval-gated | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E08 | Team chat | `/team-chat/conversations`, realtime WebSocket updates and 15-second polling fallback | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E09 | Private employee-to-owner conversation | `/team-chat/private-owner` with persisted participant access | SOURCE READY | 10 |
| E10 | Message retries, unread/read state and attachments | Idempotency keys, persisted read cursors, scanned 10 MB attachments and 30-day access expiry are wired; message search remains a later need | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E11 | Staff notifications inbox and read/archive state | Staff Notifications page and `/staff-self/notifications/:id` | SOURCE READY | 11 |
| E12 | Foreground/background/closed-app push | Encrypted registration and queue exist; live provider/device evidence pending | EXTERNAL BLOCKED | 11 |
| E13 | Check-in/out and schedule reminders | Persisted notification automation, retry log, badge/read/archive and clock/schedule triggers are wired | SOURCE READY; PROVIDER/LIVE UAT PENDING | 11 |
| E14 | Leave, appraisal, task, payroll, rule, and chat event notifications | Domain events persist permission-scoped notifications and realtime/polling reload; provider delivery matrix remains deployment UAT | SOURCE READY; PROVIDER/LIVE UAT PENDING | 11 |
| E15 | Self-scoped staff reports | Reports page and permission-filtered business/enterprise data | SOURCE READY | 9 |
| E16 | Current approved offers and eligible services | `/staff-self/offers` reads published, active Staff App offers | SOURCE READY | 10 |
| E17 | Direct, group and manager broadcast chat | Persisted participant lists and broadcast write restriction reuse the existing chat tables | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E18 | Smart Share appointment, invoice and guest | Shared IDs disclose no record payload; opening rechecks current permission plus manager/self scope | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E19 | Employee surveys and issue resolution | Versioned manager survey lifecycle, validated self response, existing feedback submission and manager resolution | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |
| E20 | Guest/appointment-linked tasks and realtime Kanban | Optional links validate branch-owned records; task changes publish realtime events with polling fallback | SOURCE READY; AUTHENTICATED UAT PENDING | 10 |

## F. Offline, native delivery, AI, and production proof

| ID | Zenoti workflow | AuraShine evidence | Baseline | Target phase |
|---|---|---|---|---|
| F01 | Installable web/PWA shell | Manifest and shell-only service worker | SOURCE READY | 12 |
| F02 | Safe offline mutations | Online-first queue for transport status `0`, idempotency retained | SOURCE READY | 12 |
| F03 | Do not queue validation, authorization, conflict, or server errors | `queueableMutation` restricts fallback to transport failure | SOURCE READY | 12 |
| F04 | Reconnect and replay exactly once | User/tenant/branch/device-bound queue, idempotency, conflict UI, reconnect and polling fallback are source-complete | SOURCE READY; SIGNED-DEVICE UAT PENDING | 12 |
| F05 | Android native project | Capacitor Android project exists | SOURCE READY | 12 |
| F06 | iOS native project | Capacitor iOS project exists | SOURCE READY | 12 |
| F07 | Signed Android and iOS builds | Keystore, Apple profile, signing and install evidence unavailable | EXTERNAL BLOCKED | 12 |
| F08 | App Store and Play Store distribution | Store accounts/listings/review evidence unavailable | EXTERNAL BLOCKED | 12 |
| F09 | Crash, telemetry, app-version, and forced-upgrade controls | Deduplicated scoped crash reports plus server-authoritative minimum/latest version policy, rollback switch and blocking update shell are wired | SOURCE READY; DEPLOYMENT/MONITORING UAT PENDING | 12 |
| F10 | AI Scribe recording with consent | No complete Staff App recording/consent workflow | MISSING | 13 |
| F11 | Transcription and structured clinical summary | AI foundations exist outside app; Staff App Scribe workflow missing | MISSING | 13 |
| F12 | AI-assisted form fill with staff review/edit | No complete Staff App form-fill workflow | MISSING | 13 |
| F13 | Permission/license/model/audit governance for Scribe | Governed AI patterns exist; Scribe-specific controls are missing | PARTIAL | 13 |
| F14 | Staff copilot for schedule, performance, tasks, and SOP questions | Staff App Copilot uses the existing allow-listed, permission-scoped, audited read-only Rust tools and shows calculations, confidence and approval-gated recommendations | SOURCE READY; LIVE UAT PENDING | 13 |
| F15 | Authenticated browser UAT | Three-persona Playwright certification matrix and evidence ledger are source-ready; authenticated environment execution remains pending | SOURCE READY; AUTHENTICATED UAT PENDING | 14 |
| F16 | Real Android/iOS critical-flow UAT | No signed real-device evidence | EXTERNAL BLOCKED | 14 |
| F17 | Real push-provider certification | Required provider secrets and delivery evidence unavailable | EXTERNAL BLOCKED | 14 |
| F18 | Payroll payout provider certification | Provider sandbox/credentials and reconciled transfer evidence unavailable | EXTERNAL BLOCKED | 14 |
| F19 | Biometric/liveness provider certification | Face Liveness integration/provider/device evidence unavailable | EXTERNAL BLOCKED | 14 |
| F20 | Load, security, backup/restore, monitoring, and release runbooks | Production certification workflow, evidence ledger, AWS Terraform checks, backup/restore, monitoring, rollback and release-note diff runbooks are source-ready | SOURCE READY; DEPLOYMENT CERTIFICATION PENDING | 14 |

## Phase order

1. Phase 0 — this register, baseline evidence, and frozen scope.
2. Phase 1 — identity, session, permissions, profile, branch/device security.
3. Phase 2 — schedule, attendance, breaks, correction, leave, and liveness boundary.
4. Phase 3 — complete provider Appointment Book: My Day, calendars, create, quote, edit and core lifecycle actions.
5. Phase 4 — rebook, start/complete/undo, drag polish and advanced group/parallel operations.
6. Phase 5 — Guest 360, notes, forms, photos, consent, and clinical history.
7. Phase 6 — services, add-ons, consumables, retail, recipe, and inventory evidence.
8. Phase 7 — mobile POS, invoice, benefits, payment, terminal, and reconciliation.
9. Phase 8 — earnings, commissions, tips, payroll, payslips, and documents.
10. Phase 9 — performance metrics, data-basis parity, goals, leaderboard, appraisals, and feedback loop.
11. Phase 10 — ZenChat parity, realtime linked tasks, policies, surveys, training, certifications, announcements, and feedback resolution.
12. Phase 11 — notification event matrix and real push delivery.
13. Phase 12 — offline conflicts, signed native builds, telemetry, and store delivery.
14. Phase 13 — AI Scribe and permission-scoped Staff Copilot.
15. Phase 14 — authenticated roles, devices, providers, load, security, and production certification.

## Phase 1 certification gate

Phase 1 source implementation is complete only after the following live gate passes against migrated PostgreSQL data and the active Rust executable:

1. Phone viewport: password login, forced password change, MFA enrollment/challenge and passkey unlock.
2. Roles: Staff, Manager, and a custom limited Staff App role; Owner/Admin is a separate expected-denial case.
3. Profile: self-only email/phone update, delivery-backed verification code, photo upload/read, invalid type/size/malware rejection and reload persistence.
4. Workspace: authorized branch switch without logout, optional preferred branch, language/catalog and calendar-sync preference after reload/refresh recovery.
5. Security: PIN lock/unlock, inactivity logout, current/remote session revoke, device revoke, explicit-deny explanation and permission-status screen.
6. Geofence: inside, outside read-only, outside blocked, missing GPS, missing branch coordinates and role exception.
7. Termination: refresh cookie and active access rejected immediately; browser auth state and owned offline queue cleared on the first rejected request.

Local evidence (2 August 2026): `390x844` login/reload rendered without horizontal overflow, the backend/proxy health path passed, and an inactive refresh session was rejected and redirected to login with no password retained. Valid-session MFA/passkey/profile/branch/logout coverage across the three required roles remains pending approved credentials and configured delivery/device providers.

## Phase 2 certification gate

Phase 2 source implementation is complete. Product certification remains pending until this real-data chain passes with Staff and Manager credentials: schedule create/edit/version conflict and notification; clock-in with work task, break and tip clock-out; correction request and manager decision; payroll preview input; full/partial leave approval, appointment overlap blocking, cancellation restoration; calendar client subscription; geofence/device denial; overnight and locked-payroll rejection. Current local evidence: migration `0376` applied successfully, seven Phase 2 tables exist, no duplicate active attendance session exists, Rust compile passes, four focused attendance tests pass, both Angular TypeScript checks pass, and Staff App focused tests pass `39/39`. Browser, real device, calendar client, push provider, biometric provider and authenticated mutation evidence remain pending.

## Phase 3 certification gate

Phase 3 is source-complete only after migration `0377`, Rust compile/test and Staff App Angular template checks pass. Current local evidence (2 August 2026): migration `0377` is present and successful in `_sqlx_migrations`; the column and partial index exist; final Rust check/build passed; the focused booking-key test passed `1/1`; Staff App TypeScript, Angular template compilation and focused workflows passed `10/10`; backend `8082` and Staff App `4320` listen; health returns `200`; and the new unauthenticated Appointment Book request returns `401` rather than `404`. Product certification still requires a real provider to search/create a guest, quote and save a multi-service appointment, edit provider/time/duration/service/add-on/resource, reload identical PostgreSQL data, run confirm/check-in/no-show/cancel actions, replay the same idempotency key without duplication, reject a stale version, and prove restricted-staff and team-read-only denials. The current browser session is at login, so those authenticated mutations remain pending. The server—not the browser—owns tenant/branch/self/team scope, price permission, conflict detection and mutation replay.

## Phase 4 certification gate

Phase 4 source and local-runtime wiring are complete. Current local evidence (2 August 2026): migrations `0378` and `0379` are successful in `_sqlx_migrations`; advanced booking/execution columns, persisted day-package linkage and the queue/inbox indexes exist; Rust check/build and the focused advanced-booking validation test pass `1/1`; Staff App TypeScript and Angular template checks pass; the focused Staff workflow file passes `11/11`; backend `8082` and Staff App `4320` return `200`; and the fresh unauthenticated operations route returns `401`, proving it is registered rather than stale/404. Product certification remains pending authenticated Provider and Manager execution against real guests/services/packages: create couple/group/large-group/day-package and recurring visits, prove parallel/resource capacity conflicts, convert waitlist and online requests, run check-in/start/pause/resume/handoff/per-service and group completion, verify forms/consumables indicators, create the canonical POS draft, and confirm a restricted role is denied. No external video provider is required: Phase 4 stores and opens a validated HTTPS meeting link; provider-generated meetings would be a separate integration.

## Phase 7 certification gate

Phase 7 source wiring is complete and reuses the canonical POS, payment-platform, cash-drawer and accounting flows. Migration `0382` persists validated multi-staff tip allocations on the canonical sale. Current local evidence (2 August 2026): Rust formatting/check passes; direct Angular template compilation passes; and the focused Staff POS/register wiring test passes `1/1`. Product certification remains pending authenticated Staff/Cashier/Manager denial and mutation UAT with real invoice, benefit, till and settlement rows, plus a configured Razorpay/Cashfree/PhonePe account and a real card/tap terminal. The Rust test target is currently blocked before running this phase test by four unrelated stale `clients_repository` test call signatures; the production binary compile is clean. No payment is queued offline, no raw card details are accepted, and no demo business data was added.

## Phase 8 certification gate

Phase 8 source and local-runtime wiring are complete. Existing payroll, payslip, commission snapshots, attendance cash-tip declarations, salary advances, outgoing-fund reimbursements and secure staff files remain the source of truth; no second payroll engine or public document URL was added. Migration `0383` is applied and makes tip payout ownership split-aware, adds India payout/reconciliation states and persists self-scoped tip disputes. Current local evidence (2 August 2026): Rust check/build, direct Angular template compilation and the focused Phase 8 test pass; backend `8082`, Staff App `4320` and health are live; unauthenticated earnings/documents requests return `401`; database exact-paise equations have zero mismatches across two existing payroll items. Product certification remains pending because the database has one `calculated` run, zero finalized/paid runs, zero tip payouts/disputes and zero verified staff documents. A real finalized payroll, invoice commission/tip rows, configured INR payout provider and authenticated Staff/Manager roles are required to prove the requested exact-paise drill-down, PDF/document access, dispute and reconciliation chain.

Phase 15 workforce extension (3 August 2026): migration `0405` adds backend-authoritative `off_cycle` and `final_settlement` payroll cycles without creating a second calculation engine. Both require one employee, an explicit historical period and a reason; final settlement additionally requires a completed offboarding case in `ready` settlement state. Runs are employee-scoped so two employees can use the same period without collision, while monthly regeneration remains backward compatible. PostgreSQL constraint/ledger verification, focused Rust payroll tests and direct Angular compilation pass. Real payout/bank-tax onboarding certification still requires an approved payroll provider and controlled live transaction. AI Scribe rows F10-F13 remain unresolved because no guest-audio data-transfer destination has been approved; source code must not transmit recordings to a third-party provider until that explicit privacy decision exists.

## Phase 10 certification gate

Phase 10 source wiring is complete without a second messaging, task, training or appraisal stack. Migration `0385` extends persisted conversations for direct/group/broadcast, read cursors, scanned expiring attachments, record-linked tasks, surveys and company content. Smart Share returns no record data until the open action rechecks the current permission and manager/self scope. Existing field-job GPS/proof, feedback resolution, Rules/SOP quiz acknowledgement, LMS courses, certification renewal and appraisal self-review remain canonical. Current local evidence (2 August 2026): migration `0385` is successful in `_sqlx_migrations`; PostgreSQL tables exist with zero fake survey/response/attachment rows; ClamAV is healthy; Rust check/build passes with pre-existing warnings; Staff App and manager Angular TypeScript/template compilation pass; the focused Phase 10 regression passes `1/1`; backend `8082`, Staff App `4320` and CRM `4200` listen; health returns `200`; and unauthenticated chat/survey routes return `401`, not `404`. Product certification still requires authenticated Staff/Manager/Owner chat/task/survey mutations, reload persistence, restricted Smart Share denial, WebSocket/poll fallback observation, real push delivery, malware rejection and attachment-expiry access denial.

## Baseline source evidence

- Standalone Staff App: `staff-app/` with Angular/Ionic, PWA assets, Android Capacitor, and iOS Capacitor projects.
- Frontend route map: `staff-app/src/app/app.routes.ts`.
- API/session/offline boundary: `staff-app/src/app/core/staff-app.service.ts`.
- Rust self-service routes: `backend-rust/src/routes/staff_enterprise.rs`, `staff_attendance.rs`, `staff_leave.rs`, `staff_hrms.rs`, `staff_advanced.rs`, `appointments.rs`, and `notifications.rs`.
- Permission catalog: `backend-rust/src/services/auth_service.rs` and `backend-rust/src/middleware/tenant.rs`.
- Current live-device checklist: `docs/STAFF_LIVE_UAT.md`.

## Change-control rule

- Add a Zenoti release-note delta as a new row; never silently broaden an existing row.
- Reclassify a row only with a focused evidence link or exact test/UAT record.
- Preserve `EXTERNAL BLOCKED` until real credentials, signed device, provider reference, or certification report exists.
- Do not create a new Staff App page when an existing page/service can host the workflow.
