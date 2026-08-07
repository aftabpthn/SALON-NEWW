# Aura Salon CRM/POS

Original Angular + Express + SQLite salon CRM/POS suite for multi-location, multi-tenant salon SaaS operations.

## Engineering audit

- [AuraSalon source audit and Rust porting guidance (6 August 2026)](docs/AURASALON_AUDIT_2026-08-06.md)

## Modules

- Dashboard with revenue, bookings, new clients, pending payments, low stock, staff performance and membership revenue.
- Appointment calendar with day/week/month modes, drag status changes, walk-ins, online status, staff and chair assignment.
- Client CRM with profiles, visits, purchase history, membership, wallet, loyalty, notes, dates, tags, WhatsApp history and consent forms.
- POS billing with services/products, discounts, GST, UPI/cash/card/wallet split payments, invoices, inventory deduction and commission basics.
- Services, products, inventory, memberships, staff, marketing automation, reports, branches and settings.
- First-class package definitions, commission policies, omnichannel message logs and tenant audit logs are available as real CRUD resources, not static placeholders.
- AI salon assistant with booking, upsell, service recommendation, chatbot, follow-up copy, review replies, marketing captions, analytics summary and churn prediction.
- WhatsApp automation engine with auto replies, confirmations, reminders, missed-call follow-up, payment reminders, birthday wishes, campaign broadcasting, lead qualification, intent detection and human handoff.
- Advanced analytics engine with revenue forecasting, peak-hour analysis, staff productivity scoring, repeat customer analytics, churn risk, lifetime value, heatmaps, conversion funnel, membership performance and branch comparison.
- Smart staff management with dynamic commissions, attendance, shift planning, productivity ranking, incentive calculation, payroll export and AI-style staff performance insights.
- Intelligent inventory with supplier management, batch tracking, expiry alerts, purchase prediction, AI reorder suggestions, product usage tracking, waste analysis and batch-aware auto deduction.
- Mobile-ready backend with password-backed JWT auth, refresh tokens, `/api/v1` versioning, secure endpoints, envelope responses, mobile device registration and push notification queues.
- Realtime WebSocket layer for live booking updates, dashboard refreshes, staff online status, instant notifications and front-desk queue management.
- SaaS super admin console for all-salon management, subscription revenue, tenant health, suspension controls, plan management and platform feature toggles.
- AI marketing automation platform with persisted campaign generation, captions, offer recommendations, segmentation, retargeting workflows, WhatsApp sequences, email templates and festival campaigns.
- Smart booking engine with intelligent slot recommendation, auto staff assignment, conflict prevention, waitlists, online booking requests, QR check-in and queue prediction.
- Enterprise security layer with rate limiting, API protection headers, persisted audit logs, permission records, session management, encrypted secrets, backup snapshots and activity tracking.
- Offline-first workflows for local cache snapshots, offline appointment creation, offline billing and sync conflict handling.
- White-label SaaS with tenant brand profiles, theme tokens, custom logo/domain support and branch-specific branding.
- Future salon intelligence lab with AI growth advisor, pricing optimizer, offer engine, emotion analysis, no-show prediction, demand forecasting, inventory prediction, voice booking assistant, kiosk mode and AI receptionist.
- Level 27–50 ecosystem modules now persist AI voice calls, queue TV displays, dynamic pricing rules, growth tasks, franchises, academy lessons, image analysis, reputation reviews, marketplace connectors, gamification, fraud alerts, smart forms, recommendations, warehouse snapshots, KPI monitors, appointment optimizations, API keys, webhooks, forecasting models, knowledge base articles, plugins, app marketplace listings and localization profiles.
- Level 17 PRD and Level 18 design system artifacts with user roles, journeys, data flow, business rules, success metrics, color tokens, typography, controls, tables, forms and responsive states.
- Workflow engine with trigger, condition, action and delay definitions, plus persisted WhatsApp/SMS/email execution history.
- Finance engine with daily closing, cash drawer, expenses, partial payments, outstanding balances, refunds, staff payout and profit/loss calculations.
- Customer 360 intelligence with lifetime value, favorite service, risk score, preferred staff, notes timeline and next-best-action snapshots.
- Customer-facing online booking website with service/staff/slot selection, confirmation, cancellation, rescheduling and payment-ready event tracking.
- Permission matrix with owner, manager, receptionist, staff, accountant, inventory manager and custom role definitions enforced by RBAC.
- Audit and compliance ledger for booking creation, bill edits, client deletion, payment changes, discount approval and login history.
- Testing and quality center with unit/API/form-validation tests, server syntax checks, Angular error boundary and demo seed data.
- Deployment readiness with Docker, Compose, `.env.example`, production static serving, backend start script, SQLite backup and deployment guide.

## Run

```bash
npm install
npm run dev
```

- Angular app: http://127.0.0.1:4300
- API: http://127.0.0.1:4000/api/health

## Build

```bash
npm run build
```

Development SQLite data is created in `data/salon-crm.sqlite`. Production uses the external path supplied by `AURA_DB_PATH` (configured as `/home/u840940482/persistent-data/salon-crm.sqlite`).

Quality and deployment commands:

```bash
npm run check:server
npm test
npm run quality
npm run seed:demo
npm run seed:ai-knowledge -- --workbook "path/to/AURASHINE SALON.xlsx"
npm run backup:db
docker compose up --build
```

## AuraShine AI Knowledge Import

The WhatsApp AI agent reads tenant-scoped knowledge from `ai_knowledge_documents` and `ai_knowledge_chunks`. Seed or refresh the `AURASHINE SALON` Google workbook content after exporting the sheet as XLSX:

```bash
npm run seed:ai-knowledge -- --workbook "path/to/AURASHINE SALON.xlsx" --tenant tenant_aura
```

Use `--branch branch_hyd` or `AURASHINE_BRANCH_ID=branch_hyd` to scope the imported FAQs/routes to one branch. Without a branch, the import is global to the tenant and remains visible to branch-scoped WhatsApp agent searches. The script is idempotent: reruns update existing source-keyed documents, rebuild chunks, and remove stale rows from the same workbook unless `--no-delete-stale` is supplied.

## Multi-Tenant SaaS

- Every tenant-owned table has a `tenantId` column and repository reads/writes are scoped by tenant.
- Tenant context is resolved from `x-tenant-id`; when no tenant header is supplied, verified domain mappings can resolve the tenant from the request host.
- Branch access is scoped with `x-branch-id`. Owner/admin/manager/analyst can work across branches, while staff and front-desk users are limited to their assigned branch IDs.
- Subscriptions support trialing/active states, plan limits, usage checks, and persisted usage events.
- SaaS onboarding creates a tenant, trial subscription, owner user, first branch, and optional domain mapping in one workflow.

Useful SaaS endpoints:

```text
GET    /api/saas/context
GET    /api/saas/plans
POST   /api/saas/onboarding
GET    /api/saas/usage
POST   /api/saas/domain-mappings
POST   /api/saas/domain-mappings/:id/verify
PATCH  /api/saas/subscription
```

SaaS super admin endpoints:

```text
GET    /api/super-admin/overview
POST   /api/super-admin/analytics/run
PATCH  /api/super-admin/tenants/:id/suspension
PATCH  /api/super-admin/tenants/:id/subscription
POST   /api/super-admin/plans
PATCH  /api/super-admin/plans/:id
POST   /api/super-admin/feature-toggles
```

Super admin operations require `x-user-role: superAdmin`. Platform controls persist in `feature_toggles`, `platform_analytics_snapshots` and `super_admin_audit`, while subscription and plan changes update the existing tenant and subscription records.

AI assistant endpoints:

```text
GET    /api/ai/history
POST   /api/ai/appointment-booking
POST   /api/ai/upsell
POST   /api/ai/service-recommendation
POST   /api/ai/chatbot
POST   /api/ai/follow-up
POST   /api/ai/review-reply
POST   /api/ai/marketing-caption
POST   /api/ai/analytics-summary
POST   /api/ai/churn-prediction
```

AI outputs are stored in `ai_interactions` with `tenantId`, optional `branchId`, selected client/appointment references, input, compact business context, output, actions, model and confidence. The default provider is a deterministic local salon intelligence engine. Set `AI_PROVIDER=openai`, `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to enhance generated text through a model provider without changing API contracts.

AI marketing automation endpoints:

```text
GET    /api/ai-marketing/summary
POST   /api/ai-marketing/segments
POST   /api/ai-marketing/campaigns/generate
POST   /api/ai-marketing/captions
POST   /api/ai-marketing/offers/recommend
POST   /api/ai-marketing/retargeting-workflows
POST   /api/ai-marketing/whatsapp-sequences
POST   /api/ai-marketing/email-templates
POST   /api/ai-marketing/festival-campaigns
```

AI marketing actions are tenant-scoped and persist to `campaigns`, `ai_marketing_generations`, `marketing_workflows`, `marketing_sequences` and `email_templates`. Segments and offer recommendations calculate from saved client, sale, membership and appointment history.

WhatsApp automation endpoints:

```text
GET    /api/whatsapp/summary
GET    /api/whatsapp/threads
GET    /api/whatsapp/messages
GET    /api/whatsapp/rules
GET    /api/whatsapp/handoffs
POST   /api/whatsapp/inbound
POST   /api/whatsapp/booking-confirmation
POST   /api/whatsapp/reminders
POST   /api/whatsapp/missed-call
POST   /api/whatsapp/payment-reminders
POST   /api/whatsapp/birthday-wishes
POST   /api/whatsapp/campaign-broadcast
POST   /api/whatsapp/qualify-lead
POST   /api/whatsapp/handoffs
PATCH  /api/whatsapp/handoffs/:id
```

WhatsApp data is stored in `whatsapp_threads`, `whatsapp_messages`, `whatsapp_automation_rules` and `whatsapp_handoffs`. Outbound WhatsApp messages are also mirrored into the existing notification queue with `queued-whatsapp` status so provider integration can be added behind one queue later.

Advanced analytics endpoints:

```text
GET    /api/analytics/snapshots
GET    /api/analytics/latest
POST   /api/analytics/run
```

Analytics runs calculate from persisted tenant data and store every generated snapshot in `analytics_snapshots` with `tenantId`, optional `branchId`, request input, metrics and generated insights. Branch-scoped analytics require branch access and restrict branch comparison, invoices and payments to the selected branch context.

Smart staff endpoints:

```text
GET    /api/staff-management/summary
GET    /api/staff-management/performance
GET    /api/staff-management/runs
POST   /api/staff-management/attendance
POST   /api/staff-management/shifts
POST   /api/staff-management/commissions/run
POST   /api/staff-management/incentives/calculate
POST   /api/staff-management/payroll/export
```

Staff operations persist into `staff_attendance`, `staff_shifts`, `staff_commission_runs` and `payroll_exports`. Commission and payroll calculations use saved sales, appointment completion, service duration, attendance and staff commission rules.

Intelligent inventory endpoints:

```text
GET    /api/inventory-intelligence/summary
GET    /api/inventory-intelligence/usage
GET    /api/inventory-intelligence/predictions
POST   /api/inventory-intelligence/suppliers
POST   /api/inventory-intelligence/purchase-entry
POST   /api/inventory-intelligence/batches
POST   /api/inventory-intelligence/waste
POST   /api/inventory-intelligence/reorder-suggestions/run
```

Inventory intelligence persists suppliers, batches, reorder predictions and waste events in `suppliers`, `inventory_batches`, `inventory_predictions` and `inventory_waste_events`. Sale and service deductions continue to reduce product stock and now attach batch/supplier cost metadata when an available batch exists.

Mobile API and auth:

```text
GET    /api/versions
GET    /api/v1/health
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
GET    /api/v1/mobile/context
POST   /api/v1/mobile/devices
POST   /api/v1/mobile/push-subscriptions
GET    /api/v1/mobile/push-notifications
POST   /api/v1/mobile/push-notifications
```

All `/api/v1` endpoints return a mobile response envelope:

```json
{ "success": true, "data": {}, "meta": { "requestId": "...", "version": "v1", "timestamp": "..." } }
```

Protected `/api/v1` routes require `Authorization: Bearer <accessToken>`. Tenant users authenticate with email/password; password hashes, lockout counters and last-login timestamps are stored on `tenant_users`, while refresh tokens are persisted in `auth_refresh_tokens`. Mobile devices, push subscriptions and push notifications are stored in `mobile_devices`, `push_subscriptions` and `push_notifications`. Configure auth with `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_DAYS`, `REQUIRE_PASSWORD_AUTH` and `DEMO_ADMIN_PASSWORD` before the first production run.

Realtime endpoints:

```text
WS     /api/v1/realtime?token=<accessToken>&branchId=<branchId>
GET    /api/v1/realtime/queue
POST   /api/v1/realtime/queue
PATCH  /api/v1/realtime/queue/:id
POST   /api/v1/realtime/staff/status
GET    /api/v1/realtime/events
```

Realtime events are persisted in `realtime_events`; queue items and staff presence are persisted in `realtime_queue_items` and `staff_presence`. Appointment changes emit `booking.updated`, dashboard-affecting writes emit `dashboard.updated`, push/notification writes emit `notification.instant`, and queue changes emit `queue.created` / `queue.updated`.

Smart booking endpoints:

```text
GET    /api/smart-booking/summary
GET    /api/smart-booking/queue-prediction
POST   /api/smart-booking/recommend-slots
POST   /api/smart-booking/bookings
POST   /api/smart-booking/waitlist
POST   /api/smart-booking/waitlist/:id/promote
POST   /api/smart-booking/online-request
POST   /api/smart-booking/qr-check-in
```

Smart booking records persist in `booking_recommendations`, `booking_waitlist`, `online_booking_requests` and `qr_checkins`. Confirmed smart bookings create real `appointments`, queue WhatsApp notifications and prevent staff/chair overlaps before saving.

Enterprise security endpoints:

```text
GET    /api/security/summary
GET    /api/security/activity/:userId
POST   /api/security/audit
POST   /api/security/sessions
PATCH  /api/security/sessions/:id/revoke
POST   /api/security/permissions
POST   /api/security/encrypt
POST   /api/security/backups
```

Security data persists in `security_audit_logs`, `security_activity_events`, `security_sessions`, `security_permissions`, `encrypted_secrets` and `security_backups`. API requests receive protection headers and rate-limit headers, and activity events are tracked without blocking business requests.

Offline-first endpoints:

```text
GET    /api/offline/summary
POST   /api/offline/cache-snapshots
POST   /api/offline/sync-items
POST   /api/offline/sync
POST   /api/offline/appointments
POST   /api/offline/billing
```

Offline data persists in `offline_cache_snapshots` and `offline_sync_items`. Offline appointments run through the smart booking conflict engine, while offline billing runs through POS checkout so invoices, payments, client history and inventory deduction remain consistent.

White-label endpoints:

```text
GET    /api/white-label/summary
GET    /api/white-label/resolve
POST   /api/white-label/profiles
POST   /api/white-label/branch-branding
POST   /api/white-label/domains
```

White-label configuration persists in `white_label_profiles`, `branch_branding` and existing `domain_mappings`. Runtime brand resolution merges tenant profile tokens with branch overrides.

Future salon intelligence endpoints:

```text
GET    /api/future-features/summary
POST   /api/future-features/:type/run
```

Supported future feature types are `growth-advisor`, `pricing-optimizer`, `offer-engine`, `emotion-analysis`, `no-show-prediction`, `demand-forecasting`, `inventory-prediction`, `voice-booking-assistant`, `smart-kiosk-mode` and `ai-receptionist`. Outputs persist in `innovation_runs`; voice and kiosk workflows also persist in `voice_booking_sessions` and `kiosk_sessions`.


Level 27–50 ecosystem endpoints:

```text
GET    /api/ecosystem/level-coverage
GET    /api/voiceCallLogs
GET    /api/queueDisplays
GET    /api/dynamicPricingRules
GET    /api/growthAdvisorTasks
GET    /api/franchises
GET    /api/franchiseRoyalties
GET    /api/trainingLessons
GET    /api/trainingAssignments
GET    /api/imageAnalyses
GET    /api/reputationReviews
GET    /api/marketplaceConnections
GET    /api/gamificationEvents
GET    /api/fraudAlerts
GET    /api/smartForms
GET    /api/formResponses
GET    /api/recommendationEvents
GET    /api/warehouseSnapshots
GET    /api/kpiMonitors
GET    /api/appointmentOptimizations
GET    /api/apiKeys
GET    /api/webhooks
GET    /api/forecastingModels
GET    /api/knowledgeBaseArticles
GET    /api/pluginManifests
GET    /api/appMarketplaceApps
GET    /api/localizationProfiles
```

Each resource also supports the existing generic CRUD contract (`POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`) and is tenant-scoped through the repository layer. The `/api/v1` version returns the standard mobile envelope and requires bearer authentication.

Workflow engine endpoints:

```text
GET    /api/workflows/summary
POST   /api/workflows
PATCH  /api/workflows/:id
POST   /api/workflows/:id/run
POST   /api/workflows/run-due
```

Workflow definitions persist in `workflow_definitions`; every run persists audience, trigger source and action results in `workflow_runs`. WhatsApp/SMS/email actions create real notification records.

Finance engine endpoints:

```text
GET    /api/finance/summary
POST   /api/finance/cash-drawers/open
PATCH  /api/finance/cash-drawers/close
POST   /api/finance/expenses
POST   /api/finance/daily-closing
POST   /api/finance/invoices/:id/partial-payment
POST   /api/finance/refunds
POST   /api/finance/staff-payouts
```

Finance records persist in `finance_cash_drawers`, `finance_expenses`, `finance_daily_closings`, `finance_refunds` and `finance_staff_payouts`. Calculations use saved invoices, payments, sales and staff commission rules.

Customer 360 endpoints:

```text
GET    /api/customer-360/summary
GET    /api/customer-360/clients/:id
POST   /api/customer-360/clients/:id/timeline
POST   /api/customer-360/clients/:id/snapshot
```

Customer intelligence snapshots persist in `customer_intelligence_snapshots`; notes and activity events persist in `customer_timeline_events` and are merged with saved appointment, invoice and sale history.

Online booking portal endpoints:

```text
GET    /api/booking-portal/context
POST   /api/booking-portal/slots
POST   /api/booking-portal/confirm
PATCH  /api/booking-portal/appointments/:id/cancel
PATCH  /api/booking-portal/appointments/:id/reschedule
```

Portal confirmation creates or reuses clients, saves online booking requests, creates real appointments through the smart booking service and records portal actions in `booking_portal_events`.

Permission, compliance, quality and deployment endpoints:

```text
GET    /api/security/permission-matrix
POST   /api/security/roles
GET    /api/security/compliance
POST   /api/security/audit
GET    /api/quality/summary
POST   /api/quality/run
POST   /api/quality/seed-demo
GET    /api/deployment/summary
POST   /api/deployment/preflight
POST   /api/deployment/backup
POST   /api/deployment/events
```

Role definitions persist in `role_definitions`; enforcement uses `security_permissions` plus built-in grants. Compliance trails persist in `security_audit_logs`, while quality and deployment operations persist in `quality_runs` and `deployment_events`. SQLite backups are written to `data/backups`.

Local demo headers:

```text
x-tenant-id: tenant_aura
x-user-role: owner | admin | manager | frontDesk | staff | analyst | superAdmin
x-branch-id: branch_blr
```

## Architecture

```text
server/
  app.js                         Express composition root
  config/                        Environment and runtime config
  middleware/                    Request context, RBAC, async/error handling
  repositories/                  Repository pattern over SQLite tables
  routes/                        REST resources and workflow routes
  services/                      Tenant, resource, auth, super admin, realtime, push, AI, AI marketing, smart booking, security, quality, deployment, offline, white-label, future intelligence, WhatsApp, analytics, staff, inventory, workflow, finance, customer 360 and booking portal services
  utils/                         Logger and application errors
  validators/                    Request validation layer
  db.js                          SQLite schema, seed data and persistence helpers

src/app/
  core/                          API client and application state
  shared/ui/                     Reusable UI primitives
  pages/                         Routed feature screens
```

## API architecture

- REST endpoints are mounted under `/api`.
- Generic CRUD routes use repositories and validation.
- Workflow routes call service methods for checkout, payments, appointment completion, membership redemption, stock transfer, marketing segmentation, SaaS administration, mobile auth, push notifications, realtime events, AI assistance, AI marketing automation, smart booking, enterprise security, permission matrices, compliance audit, quality gates, deployment readiness, offline sync, white-label branding, future salon intelligence, WhatsApp automation, analytics, staff intelligence, inventory intelligence, automation workflows, finance operations, customer intelligence, online booking and reports.
- `/api/v1` uses JWT claims plus `x-tenant-id` / `x-branch-id` for tenant and branch isolation; legacy `/api` demo headers are preserved for local development and are JWT-gated when `NODE_ENV=production`.
- Structured request logs include request id, route, status, duration and role.
- Centralized error handling returns `{ error, status, requestId }`.
