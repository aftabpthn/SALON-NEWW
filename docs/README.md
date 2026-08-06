# Aura Salon CRM/POS

## Current Project Source Of Truth

- Current repo backend: `backend-rust/` with Rust + Axum.
- Current repo frontend: `frontend-angular/` with Angular.
- Current repo AI service: `ai-service/` with Python service code.
- Active docs live directly in `docs/`.
- Old/imported reference docs live in `docs/archive/` and should only be used when converting old CRM logic.

Endpoint references in this README are catalog entries, not automatic runtime claims. [ROUTE_CATALOG.md](./ROUTE_CATALOG.md) is authoritative: `mounted` is callable in the current Rust router, `future` is a non-callable contract target, `external` requires a provider boundary, and `retired` must not be called.

## Top 5 Start Docs

- [PRD.md](./PRD.md) — product scope, users, core features, and non-negotiables.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture, layering, and folder map.
- [PROJECT_RULES.md](./PROJECT_RULES.md) — coding guardrails, roles, and workflow for contributions.
- [RULES.md](./RULES.md) — compact Rust/Angular build rules for fast tasks.
- [PHASES.md](./PHASES.md) — delivery phases and completion boundaries.
- [DATABASE.md](./DATABASE.md) — tenant data model, isolation, and migration assumptions.
- [API_GUIDELINES.md](./API_GUIDELINES.md) — endpoint patterns, validation, error, and response contracts.
- [SECURITY_HARDENING_ROADMAP.md](./SECURITY_HARDENING_ROADMAP.md) — Rust-specific security gap tracker.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — compact UI tokens referenced by UI/UX guidelines.
- [INVENTORY_API_CONTRACTS.md](./INVENTORY_API_CONTRACTS.md) — current Rust inventory, audit, supplier, backbar, laundry and forecast contracts.
- [ZENOTI_MASTER_PARITY_REGISTER.md](./ZENOTI_MASTER_PARITY_REGISTER.md) — locked public Zenoti capability index, Aura evidence map, route truth and product-owner gate.
- [SALONIST_MASTER_PARITY_REGISTER.md](./SALONIST_MASTER_PARITY_REGISTER.md) — current official Salonist Help Center and feature-page atomic baseline.
- [DINGG_MASTER_PARITY_REGISTER.md](./DINGG_MASTER_PARITY_REGISTER.md) — current official DINGG Help and advanced feature-page atomic baseline.
- [AURASHINE_COMPETITOR_FEATURE_COVERAGE_MATRIX.md](./AURASHINE_COMPETITOR_FEATURE_COVERAGE_MATRIX.md) — current cross-competitor evidence status, genuine gaps, activation gates and do-not-rebuild list.
- [INVENTORY_ZENOTI_PARITY_REGISTER.md](./INVENTORY_ZENOTI_PARITY_REGISTER.md) — permanent Zenoti-to-AuraShine inventory workflow and verification register.
- [STAFF_APP_ZENOTI_PARITY_REGISTER.md](./STAFF_APP_ZENOTI_PARITY_REGISTER.md) — linked Staff App parity and certification sub-register.
- [AI_PREDICTION_OUTCOMES.md](./AI_PREDICTION_OUTCOMES.md) — how stored predictions are checked against what happened, and how measured accuracy is reported.
- [AI_SEMANTIC_RETRIEVAL.md](./AI_SEMANTIC_RETRIEVAL.md) — the pgvector index behind copilot retrieval: what is indexed, what deliberately is not, and how scope is enforced.
- [AI_EARNED_AUTONOMY.md](./AI_EARNED_AUTONOMY.md) — when the copilot may complete a task without confirmation, what it takes to earn that, and how any run is reversed.
- [AI_MEMORY.md](./AI_MEMORY.md) — what the copilot remembers about a client, who may write it, and how it expires.
- [SECURITY.md](./SECURITY.md) — auth, JWT/session behavior, and production hardening baseline.
- [AUDIT_REMEDIATION_PLAN.md](./AUDIT_REMEDIATION_PLAN.md) — phased tracker for full audit gaps and pending verification.

## Docs Layout

- Active project docs stay directly in `docs/`.
- Imported or old-project markdown packs stay in `docs/archive/`.
- Start from this README before using archive material.

Angular + Rust Axum + PostgreSQL + Redis salon CRM/POS suite for multi-location,
multi-tenant salon SaaS operations.

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
- Testing and quality center with unit/API/form-validation tests, server syntax checks and Angular error boundaries. Production code never depends on demo data.
- Deployment readiness with Docker, Compose, `.env.example`, production static serving, PostgreSQL/Redis integration, and deployment guide.

## Run

```powershell
.\backend-rust\scripts\restart-backend-dev.ps1 -Port 8082
cd frontend-angular
npm start -- --host 127.0.0.1 --port 4200
```

- Angular app: http://127.0.0.1:4200
- API: http://127.0.0.1:8082/health
- Proxied API: http://127.0.0.1:4200/api/v1/health

## Build

```bash
npm run build
```

PostgreSQL backing storage is configured through `DATABASE_URL`.

Quality and deployment commands:

```bash
cargo check
cargo test

cd ../frontend-angular
npm run build
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

AI outputs are stored in `ai_interactions` with `tenantId`, optional `branchId`, selected client/appointment references, input, compact business context, output, actions, model and confidence. The default provider is a deterministic local salon intelligence engine. Set `AI_PROVIDER=openai`, `OPENAI_API_KEY` and optionally `OPENAI_MODEL` to enhance generated text through a model provider without changing API contracts. Direct AI service calls require `Authorization: Bearer <AI_SERVICE_TOKEN>` except `/health`.

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

Current inventory endpoints:

```text
GET/POST/PATCH /api/v1/inventory
GET            /api/v1/inventory/ledger
GET            /api/v1/inventory/valuation
GET/PUT        /api/v1/inventory/policy
GET            /api/v1/inventory/advanced-controls
GET/POST       /api/v1/inventory/reorder-forecasts
GET/POST       /api/v1/inventory/stock-audits
GET/POST       /api/v1/inventory/backbar-usage
GET/POST       /api/v1/inventory/backbar-containers
GET/POST       /api/v1/inventory/supplier-governance
GET/POST       /api/v1/inventory/laundry/orders
GET/POST       /api/v1/purchases/orders
GET/POST       /api/v1/purchases/grn
```

PostgreSQL is the durable source of truth. Stock changes post through immutable ledger transactions; batch movements support FIFO/FEFO evidence; stock-audit and backbar overrides are approval gated. See [INVENTORY_API_CONTRACTS.md](./INVENTORY_API_CONTRACTS.md) for exact request, role, idempotency and ownership rules.

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

Protected `/api/v1` routes require `Authorization: Bearer <accessToken>`. Tenant users authenticate with email/password; password hashes, lockout counters and last-login timestamps are stored on `tenant_users`, while refresh tokens are persisted in `auth_refresh_tokens`. Mobile devices, push subscriptions and push notifications are stored in `mobile_devices`, `push_subscriptions` and `push_notifications`. Configure auth with `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_SECRET`, and `JWT_REFRESH_TTL_DAYS` before production.

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

Offline and device-delivery endpoints:

```text
POST   /api/v1/pos/offline-checkout
GET    /api/v1/pos/offline-checkout/:operationId
POST   /api/v1/staff/mobile/sync
GET    /api/v1/staff/mobile/conflicts
POST   /api/v1/staff/mobile/conflicts/:id/resolve
POST   /api/v1/staff/self/mobile/telemetry
GET    /api/v1/staff/mobile/telemetry
```

Staff App snapshots and allowlisted mutations use its encrypted, user-bound
device store and server idempotency/conflict contracts. POS offline checkout is
restricted to unpaid service/product invoices; payments and customer-liability
mutations remain online-only. Device telemetry persists in
`staff_mobile_device_telemetry`. See
[HARDWARE_SUPPORT_MATRIX.md](./HARDWARE_SUPPORT_MATRIX.md).

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

Role definitions persist in `role_definitions`; enforcement uses `security_permissions` plus built-in grants. Compliance trails persist in `security_audit_logs`, while quality and deployment operations persist in `quality_runs` and `deployment_events`. Backups follow PostgreSQL/Redis operational procedures for the configured services.

Local demo headers:

```text
x-tenant-id: tenant_aura
x-user-role: owner | admin | manager | frontDesk | staff | analyst | superAdmin
x-branch-id: branch_blr
```

## Architecture

```text
backend-rust/
  src/main.rs                    Axum entrypoint and app bootstrap
  config/                        Environment and runtime config
  infrastructure/                Redis/Postgres clients and startup utilities
  middleware/                    Request context, RBAC, async/error handling
  routes/                        REST resources and workflow routes
  services/                      Tenant, resource, auth, super admin, realtime, AI, AI marketing, smart booking, security, deployment, offline, white-label, analytics, staff, inventory, workflow, finance, customer 360 and booking portal services
  repositories/                  Repository and SQL query boundary
  models/                        Typed request/response types
  state.rs                       Shared app state container

src/app/
  core/                          API client and application state
  shared/ui/                     Reusable UI primitives
  pages/                         Routed feature screens
```

## API architecture

- REST endpoints are mounted under `/api` and `/api/v1`.
- Generic CRUD routes use repositories and typed models.
- Workflow routes call service methods for checkout, payments, appointment completion, membership redemption, stock transfer, marketing segmentation, SaaS administration, mobile auth, push notifications, realtime events, AI assistance, AI marketing automation, smart booking, enterprise security, permission matrices, compliance audit, deployment readiness, offline sync, white-label branding, future salon intelligence, WhatsApp automation, analytics, staff intelligence, inventory intelligence, automation workflows, finance operations, customer intelligence, online booking and reports.
- `/api/v1` uses JWT claims plus `x-tenant-id` / `x-branch-id` for tenant and branch isolation.
- Structured request logs include request id, route, status, duration and role.
- Centralized error handling returns `{ error, status, requestId }`.

## Documentation

Enterprise Documentation Suite — standards live at the root, domain guides under `docs/`.
AI agents (Claude Code / Codex / Cursor) must read `AGENTS.md` first; per-agent entry points:
`CLAUDE.md`, `CODEX.md`, `CURSOR_RULES.md`.

| Area | Documents |
| --- | --- |
| Working rules | `AGENTS.md`, `PROJECT_RULES.md`, `CONTRIBUTING.md` |
| Design | `ARCHITECTURE.md`, `TENANT_ARCHITECTURE.md`, `DATABASE.md`, `API_GUIDELINES.md`, `UI_UX_GUIDELINES.md` |
| Security | `SECURITY.md`, `RBAC.md`, `docs/permissions.md`, `docs/audit-log.md`, `docs/security-hardening.md` |
| Quality & ops | `TESTING.md`, `PERFORMANCE.md`, `ERROR_HANDLING.md`, `OBSERVABILITY.md`, `DEPLOYMENT.md`, `BACKUP_RECOVERY.md` |
| Release | `CHANGELOG.md`, `ROADMAP.md`, `docs/release-process.md` |
| 100X enterprise blueprint | `docs/ENTERPRISE_100X_BLUEPRINT.md` |
| Domain guides | `docs/<domain>.md` — appointments, billing, clients, staff, inventory, accounting, memberships, packages, payments, razorpay, whatsapp, reports, analytics, ai-features, multi-tenant, and more (46 files) |

Each domain document follows the same 14-section enterprise structure
(Purpose → Scope → Responsibilities → Architecture → Standards → Workflow →
Coding/Security/Performance Rules → Do/Don't → Examples → AI Instructions →
Acceptance Criteria → Future Roadmap) and names a primary AI role
(see `PROJECT_RULES.md` §4 for the full role map).

## Enterprise Software Design Document

This README is the master entry point for AuraShine CRM/POS. It gives a new
owner, engineer, auditor, or AI agent enough context to route work without
re-reading the whole repository.

### 1. Project Overview

AuraShine is an enterprise salon, spa, clinic, and wellness operating platform.
It combines appointment booking, POS billing, inventory, staff operations,
customer CRM, marketing, reporting, accounting, AI assistance, and SaaS admin
in one multi-tenant product.

### 2. Vision

Make AuraShine the AI-first operating system for salon and wellness businesses,
from single-branch shops to multi-country enterprise chains.

### 3. Mission

Give owners one dependable platform for bookings, billing, inventory,
marketing, analytics, finance, and customer experience, while keeping the app
secure, fast, and simple for daily front-desk use.

### 4. Business Goals

- Support multi-tenant SaaS with branch-level isolation.
- Run salon workflows end to end: lead -> booking -> service -> invoice ->
  payment -> inventory -> accounting -> reporting.
- Keep provider integrations replaceable through existing service boundaries.
- Scale operational docs so engineers and AI tools follow the same rules.

### 5. Product Philosophy

Security first, performance first, mobile-ready, AI-assisted, offline-aware, and
backward compatible. Enhance existing flows; do not rebuild working surfaces.

### 6. Feature Overview

Core modules: dashboard, calendar, POS, clients, staff, inventory, memberships,
packages, loyalty, discounts, marketing, WhatsApp/SMS/email, payments, reports,
analytics, AI assistant, profit intelligence, payroll, expenses, balance sheet,
offline sync, public booking, SaaS admin, white label, security, deployment,
quality, and audit logs.

### 7. Technology Stack

- Frontends: the Angular CRM SPA under `frontend-angular/src/app`, the standalone Ionic/Capacitor customer app under `customer-app/`, and the standalone Ionic staff app under `staff-app/`.
- Backend: Rust + Axum service under `backend-rust/src`.
- Database: PostgreSQL via `sqlx` and `DATABASE_URL`.
- Auth: JWT access tokens, refresh tokens, RBAC, tenant and branch headers.
- Realtime: WebSocket.
- DevOps: docker-compose (Postgres/Redis/API/AI), Cargo and npm scripts.

### 8. Repository Structure

- `frontend-angular/src/app/`: Angular application, routes, pages, core services, shared UI.
- `customer-app/`: standalone customer booking app for web/PWA and Capacitor Android/iOS packaging.
- `staff-app/`: standalone staff operations web/PWA app.
- `backend-rust/src/`: Rust Axum app, routes, services, repositories, middleware,
  infrastructure, and handlers.
- `docs/`: domain guides, audit reports, roadmap, runbooks, and operational
  references.
- `tests/` (legacy): historical references.

### 9. Module Structure

Operational flow is connected by modules, not duplicated implementations:
Calendar creates appointments, POS bills them, payments settle invoices,
inventory consumes stock, accounting records ledger lines, reports and AI read
from persisted truth tables.

### 10. Installation Guide

1. Clone the repository.
2. Run `npm install` in `frontend-angular/` when dependencies are missing or changed.
3. Copy `.env.example` to `.env` and set production secrets.
4. Start/rebuild the backend with `.\backend-rust\scripts\restart-backend-dev.ps1 -Port 8082`.
5. Start the frontend from `frontend-angular` with `npm start -- --host 127.0.0.1 --port 4200`.
6. Verify `http://127.0.0.1:8082/health`, `http://127.0.0.1:4200`, and `http://127.0.0.1:4200/api/v1/health`.

### 11. Development Workflow

Requirement -> minimum file read -> existing pattern reuse -> narrow edit ->
lean verification -> commit -> push. For runtime work, check existing servers
before starting new ones.

### 12. Branch Strategy

Use `main` for stable work, `codex/*` or `feature/*` for focused changes,
`hotfix/*` for production fixes, and `release/*` only when release management
needs a stabilization branch.

### 13. Environment Variables

Important contracts include `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`, `AI_SERVICE_TOKEN`, `DATABASE_URL`, `AI_PROVIDER`,
`OPENAI_MODEL`, SMTP credentials, Razorpay credentials, WhatsApp credentials,
SMS credentials, backup settings, and deployment flags. Keep real values out of
git.

### 14. Folder Structure

Use `ARCHITECTURE.md` for the system-level folder map and each `docs/<domain>.md`
file for the domain-specific structure.

### 15. Architecture Summary

Angular pages call `ApiService`; Axum routes validate and authorize; services
hold business logic; repositories own SQL; PostgreSQL stores tenant-scoped truth;
WebSocket broadcasts after commits.

### 16. AI Documentation Index

- Start here: `AGENTS.md`.
- Architecture: `ARCHITECTURE.md`, `docs/SYSTEM_BLUEPRINT.md`.
- Rules: `PROJECT_RULES.md`.
- Data: `DATABASE.md`.
- API: `API_GUIDELINES.md`.
- Security: `SECURITY.md`, `RBAC.md`, `docs/security-hardening.md`.
- Roadmap: `docs/ZENOTI_FRESHA_ROADMAP.md`.

### 17. Coding Standards

Follow existing Angular, Rust/Axum, PostgreSQL, repository, service, validator, and
middleware patterns. Use named SQL params and integer paise. Do not modify
protected files.

### 18. Security Overview

JWT, refresh rotation, RBAC, tenant isolation, branch isolation, audit logs,
rate limits, validation, secure headers, webhook signature checks, secret
management, and production HTTPS are mandatory.

### 19. Deployment Overview

Local runs use npm scripts. Production requires strong secrets, HTTPS, backup
policy, restricted server access, health checks, logs, and rollback planning.

### 20. Troubleshooting

Use `docs/troubleshooting.md`. Check backend health, frontend port, API logs,
PostgreSQL lock/connection errors, auth refresh failures, and missing
environment variables before changing code.

### 21. FAQ

- Is this Angular + Axum/Rust + PostgreSQL + Redis? Yes.
- Is Mongo planned? No. Postgres and Redis are current runtime layers.
- Is money stored in rupees? No, integer paise.
- Can AI edit protected files? No.
- Are `/api` and `/api/v1` both supported? Yes, where existing compatibility
  requires it.

### 22. Contribution Guide

Keep PRs focused, reuse existing code, add only the smallest useful
verification, update docs when behavior changes, and push the exact scope.

### 23. Roadmap

Immediate roadmap: stabilize core flows, complete CRM/POS/inventory/reporting,
extend AI automation, harden SaaS security, and scale enterprise operations.
Detailed roadmap: `docs/ZENOTI_FRESHA_ROADMAP.md`.

### 24. License

Project license is controlled by the repository owner. Do not add third-party
license commitments without approval.

### 25. Support

Primary support path is the repository owner and project maintainers. Operational
runbooks live under `docs/`.
