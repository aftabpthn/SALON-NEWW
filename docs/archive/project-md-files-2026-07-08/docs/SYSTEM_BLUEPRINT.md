# Aura Salon Operating System - Master Blueprint

This document is the source of truth for completing Aura into a production-grade salon SaaS product without breaking existing code, routes, database data or workflows.

## 1. Product Vision

Aura is a multi-tenant Salon Operating System for India-focused and global salon chains. It combines CRM, appointment booking, POS, finance, inventory, staff operations, marketing automation, AI assistance, analytics, online booking, security, audit, offline support and deployment readiness in one connected SaaS platform.

The product must be original. It may be inspired by mature salon platforms, but it must not copy proprietary UI, workflows, code or visual design.

Primary outcomes:

- Help owners see one source of truth for revenue, bookings, clients, staff, inventory and branch health.
- Help front desk teams book, bill and follow up quickly.
- Help staff manage appointments, performance and payouts.
- Help accountants close daily cash, GST, payments, refunds and expenses.
- Help marketers run WhatsApp/SMS/email campaigns using real customer segments.
- Help enterprise salon groups operate multiple branches and tenants securely.
- Help customers book online, reschedule, cancel and later review/pay from a customer portal.

## 2. Full Module Map

### Core Platform

- Dashboard: revenue, bookings, new clients, pending payments, stock, staff, memberships, quick actions.
- Clients: profiles, tags, notes, history, wallet, membership, birthdays, follow-ups.
- Appointments: create, cancel, complete, no-show, walk-in, staff/chair assignment.
- Calendar: day/week/month, staff-wise view, status workflow.
- POS: cart, service/product items, GST, discount, split payment, invoice, inventory deduction.
- Services: categories, price, duration, GST, staff assignment, required product usage, add-ons, packages.
- Products and Inventory: retail/professional stock, suppliers, purchase, adjustment, transfer, batch, expiry.
- Staff: profiles, attendance, shifts, commissions, performance, payroll export.
- Memberships and Packages: plans, credits, balance, validity, loyalty, gift cards.
- Reports: sales, GST, booking, staff, inventory, retention, P/L, branch comparison.
- Settings: salon profile, taxes, payments, invoice templates, working hours, notification templates.

### Enterprise CRM

- Customer 360: LTV, average spend, last visit, favorite service, preferred staff, churn risk, notes timeline.
- Segmentation: spend, visits, service, membership, inactivity, tags.
- AI next-best-action: retention, upsell, win-back, service recommendation.

### Booking Engine

- Smart slot recommendation.
- Auto staff assignment.
- Conflict prevention.
- Waitlist and promotion.
- Online booking request.
- QR check-in.
- Queue prediction.

### Finance Engine

- Cash drawer open/close.
- Daily closing.
- Expenses.
- Partial payments.
- Refunds.
- Staff payouts.
- Profit/loss.
- Pending: coupon codes, wallet ledger, credit note, invoice PDF.

### Inventory Intelligence

- Supplier management.
- Batch tracking.
- Expiry and low stock alerts.
- Stock movement ledger.
- Auto deduction after product sale or service usage.
- AI reorder suggestions.
- Waste tracking.

### Staff and Payroll

- Attendance.
- Shift planner.
- Commission runs.
- Incentives.
- Payroll export.
- Productivity scoring.
- Staff report card.

### Marketing Automation

- WhatsApp automation.
- Email templates.
- Campaign generation.
- Retargeting workflows.
- Festival campaigns.
- Review request.
- Inactive client win-back.
- Pending: production provider connectors.

### AI Salon Assistant

- AI receptionist.
- Booking assistant.
- Upsell suggestions.
- Service recommendations.
- Churn prediction.
- Analytics summary.
- Staff insights.
- Inventory prediction.
- Marketing writer.
- Review reply generator.

### SaaS Platform

- Tenants.
- Branches.
- Tenant users.
- Role definitions.
- Permission matrix.
- Subscription plans.
- Trial system.
- Usage limits.
- Super admin.
- Feature toggles.
- Tenant suspension.
- White-label branding.
- Domain mapping.

### Security and Compliance

- Password-backed JWT access tokens.
- Refresh tokens.
- RBAC and permission matrix.
- Audit logs.
- Login history.
- Activity tracking.
- Rate limiting.
- Secure response envelope for `/api/v1`.
- Backup system.

### Realtime and Offline

- WebSocket booking/dashboard/queue/staff presence events.
- Offline cache snapshots.
- Offline billing.
- Offline booking.
- Sync queue and conflict records.

### Deployment and Quality

- Dockerfile.
- docker-compose.
- `.env.example`.
- Production build.
- Static Angular serving from Express.
- DB backup script.
- Demo seed script.
- Unit/API/form-validation tests.
- Quality gate script.

## 3. Page Routing Map

Existing Angular routes must remain backward compatible:

| Route | Purpose |
|---|---|
| `/dashboard` | Owner/operator dashboard |
| `/prd` | PRD reference |
| `/design-system` | Design tokens and component states |
| `/ai` | AI salon assistant |
| `/analytics` | Advanced analytics |
| `/smart-booking` | Smart booking engine |
| `/security` | Enterprise security controls |
| `/permissions` | Role and permission matrix |
| `/compliance` | Audit and compliance ledger |
| `/quality` | Testing and quality center |
| `/deployment` | Deployment readiness |
| `/offline` | Offline-first workflows |
| `/white-label` | Branding/domain controls |
| `/future-features` | Innovation lab |
| `/workflows` | Automation workflow engine |
| `/finance` | Finance engine |
| `/customer-360` | Customer intelligence |
| `/book` | Customer-facing booking portal |
| `/appointments` | Appointment calendar |
| `/clients` | Client CRM |
| `/clients/:id` | Client detail |
| `/pos` | POS checkout |
| `/services` | Service setup |
| `/inventory` | Products and stock |
| `/memberships` | Memberships, packages, gift cards |
| `/staff` | Staff operations |
| `/marketing` | AI marketing automation |
| `/whatsapp` | WhatsApp automation |
| `/reports` | Reports and analytics |
| `/saas` | Tenant onboarding and SaaS context |
| `/super-admin` | Platform admin |
| `/branches` | Branch management |
| `/settings` | Tenant settings |

Route rules:

- No broken routes.
- Keep existing route paths stable.
- New pages must be standalone Angular components.
- Portal route `/book` may render outside the admin shell.

## 4. Database Schema

Current SQLite schema contains tenant-scoped operational tables. Future migrations must be additive and preserve existing data.

### SaaS and Identity

- `tenants`
- `subscriptions`
- `subscription_plans`
- `tenant_users`
- `role_definitions`
- `security_permissions`
- `domain_mappings`
- `feature_toggles`
- `usage_events`
- `auth_refresh_tokens`

### Salon Operations

- `branches`
- `clients`
- `staff`
- `services`
- `products`
- `appointments`
- `inventory_transactions`
- `sales`
- `invoices`
- `payments`
- `memberships`
- `packages`
- `commissions`
- `gift_cards`
- `settings`

### Inventory and Staff Intelligence

- `suppliers`
- `inventory_batches`
- `inventory_predictions`
- `inventory_waste_events`
- `staff_attendance`
- `staff_shifts`
- `staff_commission_runs`
- `payroll_exports`
- `staff_presence`

### CRM, Marketing and AI

- `customer_intelligence_snapshots`
- `customer_timeline_events`
- `campaigns`
- `notifications`
- `message_logs`
- `ai_interactions`
- `ai_marketing_generations`
- `marketing_workflows`
- `marketing_sequences`
- `email_templates`
- `whatsapp_threads`
- `whatsapp_messages`
- `whatsapp_automation_rules`
- `whatsapp_handoffs`

### Booking, Portal, Realtime and Offline

- `booking_recommendations`
- `booking_waitlist`
- `online_booking_requests`
- `booking_portal_events`
- `qr_checkins`
- `realtime_events`
- `realtime_queue_items`
- `offline_cache_snapshots`
- `offline_sync_items`


### Level 27–50 Ecosystem Resources

- `voice_call_logs`, `queue_displays`, `dynamic_pricing_rules`, `growth_advisor_tasks`
- `franchises`, `franchise_royalties`, `training_lessons`, `training_assignments`
- `image_analyses`, `reputation_reviews`, `marketplace_connections`, `gamification_events`
- `fraud_alerts`, `smart_forms`, `form_responses`, `recommendation_events`
- `warehouse_snapshots`, `kpi_monitors`, `appointment_optimizations`, `api_keys`, `webhooks`
- `forecasting_models`, `knowledge_base_articles`, `plugin_manifests`, `app_marketplace_apps`, `localization_profiles`

### Security, Quality and Deployment

- `security_audit_logs`
- `audit_logs`
- `security_activity_events`
- `security_sessions`
- `security_backups`
- `encrypted_secrets`
- `quality_runs`
- `deployment_events`

Schema rules:

- Every tenant-owned table must have `tenantId`.
- Branch-owned records should have `branchId`.
- Ledger-style records should be append-only where possible.
- Financial updates must create auditable records.
- Future DB work should split schema, migrations and seeds from `server/db.js` without changing runtime behavior first.

## 5. API Contract

### API Families

- Legacy admin API: `/api/...`
- Versioned mobile/secure API: `/api/v1/...`
- Realtime WebSocket: `/api/v1/realtime?token=<accessToken>&branchId=<branchId>`

### Core Generic Resources

Generic CRUD resources are routed through `/api/:resource`:

- `clients`
- `appointments`
- `services`
- `products`
- `inventory`
- `sales`
- `invoices`
- `payments`
- `memberships`
- `packages`
- `commissions`
- `staff`
- `marketing`
- `messageLogs`
- `auditLogs`
- `branches`
- `settings`
- `giftCards`

### Specialized Business APIs

- POS and reports: `/api/sales/checkout`, `/api/reports/...`
- Smart booking: `/api/smart-booking/...`
- Customer 360: `/api/customer-360/...`
- Finance: `/api/finance/...`
- Inventory intelligence: `/api/inventory-intelligence/...`
- Staff management: `/api/staff-management/...`
- WhatsApp: `/api/whatsapp/...`
- AI: `/api/ai/...`
- AI marketing: `/api/ai-marketing/...`
- SaaS: `/api/saas/...`
- Super admin: `/api/super-admin/...`
- Security/compliance: `/api/security/...`
- Workflow engine: `/api/workflows/...`
- Offline: `/api/offline/...`
- White-label: `/api/white-label/...`
- Quality: `/api/quality/...`
- Deployment: `/api/deployment/...`

API rules:

- All writes must validate required fields.
- All business writes must use service methods, not raw route logic.
- All tenant-scoped reads/writes must include tenant scope.
- Financial, booking, security and destructive actions must write audit logs.
- `/api/v1` should remain JWT-protected.
- Level 27–50 resource APIs must stay tenant-scoped and exposed via `/api/:resource` plus `/api/ecosystem/level-coverage`.
- Legacy `/api` may continue for local/admin compatibility until JWT-only migration is complete.

## 6. User Roles

System roles:

- `superAdmin`: platform-level SaaS admin.
- `owner`: salon tenant owner.
- `admin`: salon tenant admin.
- `manager`: branch/operations manager.
- `receptionist`: front desk booking, client and POS operator.
- `frontDesk`: legacy alias for receptionist.
- `staff`: service provider.
- `accountant`: finance, GST, payments, refunds and closing.
- `inventoryManager`: stock, supplier, batch and transfer operator.
- `analyst`: reporting and analytics user.
- Custom roles: tenant-defined roles stored in `role_definitions` and `security_permissions`.

## 7. Permission Matrix

| Resource Group | Owner/Admin | Manager | Receptionist | Staff | Accountant | Inventory Manager | Analyst |
|---|---|---|---|---|---|---|---|
| Dashboard | Admin | Read | Read | Limited | Read | Read | Read |
| Clients | Admin | Write | Write | Read | Read | Read | Read |
| Appointments | Admin | Write | Write | Own/assigned | Read | Read | Read |
| POS/Sales | Admin | Write | Write | Limited | Read | Read | Read |
| Payments | Admin | Write | Write | None | Write | None | Read |
| Finance | Admin | Write | Read | None | Write | None | Read |
| Inventory | Admin | Write | Read | Read | Read | Write | Read |
| Staff | Admin | Write | Read | Own profile | Read | Read | Read |
| Marketing | Admin | Write | Read | None | Read | Read | Read |
| Reports | Admin | Read | Limited | Own reports | Read | Read | Read |
| Settings | Admin | Limited | None | None | Limited | Limited | None |
| Security | Admin | Read | None | None | Read | None | Read |
| Deployment | Admin | Write | None | None | Write | None | Read |

Permission rules:

- Explicit deny must override allow.
- Custom role grants are tenant-scoped.
- Staff and receptionist branch access must be limited by branch IDs.
- Super admin is platform-scoped and should not mutate tenant data without audit.

## 8. Data Flow Diagram In Text

### Booking To Billing Flow

Customer/front desk -> booking request -> smart slot recommendation -> conflict prevention -> appointment saved -> realtime booking event -> WhatsApp confirmation queued -> appointment completed -> service stock usage deducted -> POS checkout -> invoice created -> payment records created -> invoice status updated -> client history updated -> staff commission calculated -> dashboard/report metrics updated -> audit log saved.

### Inventory Flow

Supplier -> purchase entry -> batch created -> product stock increased -> sale/service usage -> stock transaction saved -> batch/product stock reduced -> low stock/expiry alerts -> AI reorder suggestion -> purchase planning.

### Finance Flow

Cash drawer opened -> POS payments/expenses/refunds captured -> partial payments update invoice balance -> staff payouts calculated -> daily closing summarizes payments/expenses/refunds/payouts -> P/L and GST reports calculate from saved ledgers -> audit log saved.

### CRM and Marketing Flow

Client saved -> appointments/sales/memberships accumulate history -> Customer 360 snapshot calculates LTV/risk/favorite service -> segment engine filters clients -> workflow or campaign sends WhatsApp/SMS/email notification -> follow-up history saved -> analytics measures response and retention.

### SaaS Flow

Tenant onboarded -> trial subscription created -> owner user and first branch created -> usage limits enforced -> branch/role scopes applied -> feature toggles control capabilities -> super admin monitors revenue/health/suspension -> white-label profile resolves brand/domain.

## 9. Business Rules

- Appointment cannot overlap same staff/chair unless explicitly allowed by an admin rule.
- Appointment must be completed before billing against that appointment.
- Product sale reduces retail stock.
- Service completion or service-only sale reduces internal/professional stock usage.
- Invoice status is `unpaid`, `partial`, `paid` or refund-adjusted based on payment ledger.
- Refund cannot exceed paid invoice amount.
- Partial payment must update paid and balance values.
- Cash drawer cannot open twice for the same branch while already open.
- Daily closing should be unique by tenant, branch and business date.
- Membership redemption cannot exceed remaining credits.
- Gift card redemption cannot exceed balance.
- Loyalty points should be ledger-backed before production wallet launch.
- Tenant subscription must be active/trialing before creating usage-generating records.
- Branch-restricted users can only access assigned branches.
- Audit logs must be written for sensitive actions.
- Provider sends should use queues first, direct sends second.
- Offline sync must detect conflicts rather than blindly overwriting server data.

## 10. Edge Cases

- Same client phone exists across branches.
- Walk-in has no complete profile.
- Client cancels after payment.
- No staff available for requested service.
- Staff is absent but already assigned.
- Chair/room has conflict.
- Product stock goes below zero.
- Batch expires before sale/use.
- Membership expires with remaining credits.
- Split payment has failed mode.
- UPI/card reference is duplicated.
- Refund after daily closing.
- Tenant suspended while branch user is active.
- Subscription limit reached mid-operation.
- Offline sale sync conflicts with depleted stock.
- WhatsApp provider is down.
- AI provider fails or returns unsafe text.
- Browser refresh occurs during POS checkout.
- Duplicate form submit.
- Time zone mismatch for branch working hours.

## 11. Implementation Order For 100 Percent Completion

The upgrade must be incremental. Old code and existing data must remain safe.

### Safety Rules

- Do not delete old code until the replacement is verified.
- Keep existing routes stable.
- Add migrations only; do not reset data.
- Add tests before risky refactors.
- Run quality gate after every implementation slice.
- Use feature-compatible service methods instead of duplicating logic.

### Order

1. Baseline verification: `npm run quality`, API health, key route smoke tests.
2. Split `server/db.js` into schema/migrations/seeds/resource metadata in a behavior-preserving refactor.
3. Add stronger validation schemas for every business route.
4. Continue hardening authentication with password-backed tenant login, production JWT-only legacy access, token refresh UX and optional MFA/device policies.
5. Complete POS gaps: coupon codes, wallet ledger, credit notes, invoice PDF.
6. Complete online portal gaps: customer login, booking history, reviews, payment-ready checkout state.
7. Complete calendar UX: drag/drop, staff lanes, chair/room lanes, better conflict UI.
8. Complete membership/loyalty: referral rewards, wallet credits, auto-renewal-ready records.
9. Complete provider integrations: WhatsApp, SMS, email, payment gateway adapters behind queues.
10. Complete realtime frontend subscriptions across dashboard, appointments, queue and notifications.
11. Complete offline PWA layer: local IndexedDB cache, sync queue UI, conflict resolution screens.
12. Complete reporting exports and saved custom reports.
13. Expand tests: service unit tests, API integration tests, Angular form tests, E2E smoke tests.
14. Add CI/CD pipeline and production deployment runbook.
15. Prepare database migration plan for Postgres when SaaS scale requires it.

## 12. Completion Definition

A phase is complete only when:

- Forms save to real database tables.
- Reports calculate from persisted records.
- Buttons either work or are disabled with clear state.
- Routes are reachable.
- Build passes.
- Server syntax check passes.
- Relevant API tests pass.
- Sensitive actions are audited.
- Tenant and branch access are enforced.
