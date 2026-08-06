# Zenoti parity triage

Generated 2026-08-06T14:24:17.273Z from `docs/evidence/zenoti-master-parity-register.json`.

**This file decides nothing.** Every row below is still `Unmapped`. The register
marks a capability Complete only when a person records the real UI, API route and
test behind it, and that rule does not change here. What this adds is a starting
point: the register said 2561 rows were equally unknown, and they are not.

AuraShine surface searched: 1545 mounted route literals, 241 backend modules, 123 frontend pages/components, 592 database tables, 135 focused frontend tests.

| Band | Rows | What it means |
|---|---:|---|
| High | 822 | A route or screen carries the capability's most distinctive term. Very likely already built — verify and map. |
| Medium | 1227 | Partial agreement across surfaces. Probably adjacent to something that exists. |
| Schema-only | 100 | Tables match but no route, module or screen does. Review for an incomplete flow or obsolete schema. |
| Low | 181 | One weak signal. Treat as unknown. |
| None | 231 | Nothing in the codebase resembles it. Most likely a genuine gap. |

### How to read this

Work **High** first: it is the cheapest way to replace a misleading parity
number with a real one. **Schema-only** is the most actionable band — each row
is either a feature to finish or a migration to delete, and leaving it half-done
is what made the register look complete when it was not. **None** is the honest
roadmap input, but read it with judgement: it also contains Zenoti-branded
things (their assistant, their payments status page) that are not gaps to close,
and specific hardware models that belong in a support matrix rather than a
feature backlog.

Matching is by name only, so it misses features that exist under different
wording. A shipped workflow can still land in Low when its route, table and
screen use another domain term. Absence of a match is a
prompt to look, not a verdict.

## High confidence — verify and map (822)

| Zenoti capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [HC-0001](https://help.zenoti.com/en/admin.html) Admin | admin | `page: frontend-angular:pages/platform/saas-admin/saas-admin-page.component` |
| [HC-0002](https://help.zenoti.com/en/admin/access-all-my-business-accounts.html) Access all my business accounts | access, accounts, business | `route: /security/access-rules`<br>`route: /security/access-rules/:rule_id/disable`<br>`route: /staff/:id/branch-access` |
| [HC-0003](https://help.zenoti.com/en/admin/add-new-centers-in-zenoti.html) Add new centers in Zenoti | add, centers | `route: /balance-sheet/cost-centers`<br>`route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request` |
| [HC-0004](https://help.zenoti.com/en/admin/backup-your-data.html) Backup your data | data | `route: /inventory/master-data`<br>`route: /inventory/master-data/values`<br>`route: /security/data-governance` |
| [HC-0007](https://help.zenoti.com/en/admin/plan-for-the-unexpected.html) Plan for the unexpected | plan | `route: /membership-enterprise/active/:id/change-plan`<br>`route: /membership-enterprise/plan-changes`<br>`route: /saas/subscriptions/:id/change-plan` |
| [HC-0022](https://help.zenoti.com/en/admin/set-up-cash-drawers/troubleshoot-cash-drawer-issues-in-zenoti-pos.html) Troubleshoot Cash Drawer Issues in Zenoti POS | cash, drawer, issues, pos | `route: /pos/cash-drawer/:id/approval-link`<br>`route: /pos/cash-drawer/:id/approve`<br>`route: /pos/cash-drawer/:id/deposits` |
| [HC-0023](https://help.zenoti.com/en/admin/system-requirements.html) System requirements | requirements | `route: /staff-enterprise/lms/skill-requirements`<br>`table: service_resource_requirements`<br>`table: staff_skill_requirements` |
| [HC-0034](https://help.zenoti.com/en/ai-lead-management.html) AI Lead Management | lead, management | `page: frontend-angular:pages/staff/leave-management/staff-leave-management-page.component`<br>`test: frontend-angular:tests/staff-leave-management-wiring.test.mjs`<br>`test: frontend-angular:tests/marketing-lead-scoring-wiring.test.mjs` |
| [HC-0036](https://help.zenoti.com/en/ai-lead-management/ai-lead-manager.html) AI Lead Manager | lead, manager | `route: /staff/hrms/appraisal-reviews/:id/manager`<br>`test: frontend-angular:tests/marketing-lead-scoring-wiring.test.mjs`<br>`table: marketing_lead_activities` |
| [HC-0037](https://help.zenoti.com/en/ai-lead-management/all-tasks.html) All tasks | tasks | `route: /staff/hrms/lifecycle-cases/:id/tasks/:task_id`<br>`route: /staff/operations/:id/tasks`<br>`route: /staff/operations/tasks` |
| [HC-0040](https://help.zenoti.com/en/ai-lead-management/configure-lead-capture-sources-and-ai-lead-scoring.html) Configure lead capture sources and AI lead scoring | capture, lead, scoring | `test: frontend-angular:tests/marketing-lead-scoring-wiring.test.mjs`<br>`module: services/marketing_lead_scoring_service`<br>`route: /pos/payment-platform/payments/:id/capture` |
| [HC-0052](https://help.zenoti.com/en/ai-lead-management/sales-agent-leaderboard.html) Sales Agent Leaderboard | leaderboard, sales | `route: /pos/happy-hours/branch-leaderboard`<br>`page: staff-app:features/staff/staff-leaderboard.page`<br>`test: staff-app:tests/staff-leaderboard-wiring.test.mjs` |
| [HC-0053](https://help.zenoti.com/en/ai-lead-management/security-role-permissions.html) Security role permissions | role, security | `route: /staff/auth-roles/:role_id`<br>`table: staff_role_assignments`<br>`test: staff-app:src/app/features/staff/staff-role-label.spec.ts` |
| [HC-0055](https://help.zenoti.com/en/analytics.html) Analytics | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0056](https://help.zenoti.com/en/analytics/analytics---amazon-s3.html) Analytics - Amazon S3 | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0097](https://help.zenoti.com/en/analytics/analytics-express.html) Analytics Express | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0099](https://help.zenoti.com/en/analytics/analytics-express/appointment-insights-dashboard.html) Appointment Insights Dashboard | appointment, dashboard, insights | `route: /notifications/marketing-insights`<br>`route: /staff-os/coach/insights`<br>`route: /staff/coach/insights` |
| [HC-0100](https://help.zenoti.com/en/analytics/analytics-express/employee-insights-dashboard.html) Employee Insights Dashboard | dashboard, employee, insights | `route: /staff/shift-swaps/:id/employee-decision`<br>`test: frontend-angular:tests/staff-auto-employee-code-wiring.test.mjs`<br>`route: /notifications/marketing-insights` |
| [HC-0102](https://help.zenoti.com/en/analytics/analytics-express/guest-insights-dashboard.html) Guest Insights Dashboard | dashboard, guest, insights | `route: /notifications/marketing-insights`<br>`route: /staff-os/coach/insights`<br>`route: /staff/coach/insights` |
| [HC-0104](https://help.zenoti.com/en/analytics/analytics-express/kpi-dashboard.html) KPI dashboard | dashboard, kpi | `route: /billing/clients/:id/kpi`<br>`route: /pos/clients/:id/kpi`<br>`test: frontend-angular:tests/appointment-kpi-history-wiring.test.mjs` |
| [HC-0106](https://help.zenoti.com/en/analytics/analytics-express/membership-metrics-dashboard.html) Membership Metrics dashboard | dashboard, membership, metrics | `route: /metrics`<br>`test: frontend-angular:tests/supplier-metrics.test.mjs`<br>`route: /inventory/color-bowls/staff-shift-dashboard` |
| [HC-0107](https://help.zenoti.com/en/analytics/analytics-express/overview-of-analytics-express.html) Overview of Analytics Express | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0109](https://help.zenoti.com/en/analytics/analytics-express/provider-utilization-dashboard.html) Provider Utilization dashboard | dashboard, provider, utilization | `route: /fitness/reports/utilization`<br>`route: /inventory/color-bowls/staff-shift-dashboard`<br>`route: /reports/dashboard` |
| [HC-0111](https://help.zenoti.com/en/analytics/analytics-express/sales-insights-dashboard.html) Sales Insights Dashboard | dashboard, insights, sales | `route: /notifications/marketing-insights`<br>`route: /staff-os/coach/insights`<br>`route: /staff/coach/insights` |
| [HC-0112](https://help.zenoti.com/en/analytics/analytics-express/self-service-dashboard.html) Self service dashboard | dashboard, self, service | `route: /staff/self/dashboard`<br>`route: /membership-enterprise/client/:client_id/self-service/status-link`<br>`route: /membership-enterprise/self-service` |
| [HC-0114](https://help.zenoti.com/en/analytics/analytics-plus.html) Analytics Plus | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0115](https://help.zenoti.com/en/analytics/analytics-plus/analytics-plus-faqs.html) Analytics Plus FAQs | analytics | `route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover`<br>`route: /booking-analytics/abandonments/detect` |
| [HC-0116](https://help.zenoti.com/en/analytics/analytics-plus/analytics-subscription.html) Analytics subscription | analytics, subscription | `route: /staff/mobile/devices/:id/push-subscription`<br>`page: frontend-angular:layout/subscription-banner.component`<br>`test: frontend-angular:tests/login-subscription-expiry-wiring.test.mjs` |
| [HC-0117](https://help.zenoti.com/en/analytics/analytics-plus/data-models.html) Data Models | data | `route: /inventory/master-data`<br>`route: /inventory/master-data/values`<br>`route: /security/data-governance` |
| [HC-0118](https://help.zenoti.com/en/analytics/business-snapshot.html) Business Snapshot | business, snapshot | `route: /staff/mobile/snapshot`<br>`table: integration_opening_inventory_snapshot_lines`<br>`route: /settings/invoice-business-profile` |
| [HC-0119](https://help.zenoti.com/en/analytics/business-snapshot/add-ons.html) Add-ons | add | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [HC-0120](https://help.zenoti.com/en/analytics/business-snapshot/appointments-by-status.html) Appointments by status | appointments, status | `route: /appointment-lifecycle/appointments/:id/status`<br>`route: /appointments/:id/status`<br>`route: /staff-self/appointments/:id/status` |
| [HC-0121](https://help.zenoti.com/en/analytics/business-snapshot/bookings-by-source.html) Bookings by source | bookings, source | `route: /clients/:id/merge/:source_id/reverse`<br>`route: /membership-enterprise/renewals/:source_sale_id`<br>`route: /purchases/bill-drafts/:id/source` |
| [HC-0123](https://help.zenoti.com/en/analytics/business-snapshot/gift-cards.html) Gift cards | cards, gift | `route: /customer/gift-cards`<br>`route: /customer/gift-cards/claim`<br>`route: /customer/gift-cards/redeem` |
| [HC-0124](https://help.zenoti.com/en/analytics/business-snapshot/guest-rating.html) Guest rating | guest | `route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile`<br>`route: /staff-self/appointments/:appointment_id/guest-360/contact-preferences` |
| [HC-0125](https://help.zenoti.com/en/analytics/business-snapshot/liabilities.html) Liabilities | liabilities | `route: /membership-enterprise/reports/liabilities` |
| [HC-0126](https://help.zenoti.com/en/analytics/business-snapshot/packages.html) Packages | packages | `route: /customer/packages`<br>`route: /marketplace/businesses/:id/packages`<br>`route: /packages` |
| [HC-0128](https://help.zenoti.com/en/analytics/business-snapshot/provider-utilization-rate.html) Provider utilization rate | provider, utilization | `route: /fitness/reports/utilization`<br>`route: /auth/sso/:provider/callback`<br>`route: /auth/sso/:provider/start` |
| [HC-0129](https://help.zenoti.com/en/analytics/business-snapshot/sales.html) Sales | sales | `route: /billing/sales-register`<br>`route: /billing/sales/register`<br>`route: /integrations/v1/sales` |
| [HC-0132](https://help.zenoti.com/en/analytics/signals.html) Signals | signals | `route: /ai/briefing/signals/:signal/decision`<br>`route: /membership-enterprise/risk-signals/:id/review` |
| [HC-0133](https://help.zenoti.com/en/analytics/targets.html) Targets | targets | `route: /staff/mobile/targets`<br>`route: /staff/self/service-targets`<br>`route: /staff/self/targets` |
| [HC-0135](https://help.zenoti.com/en/appointments.html) Appointments | appointments | `route: /appointment-activity/appointments/:id/timeline`<br>`route: /appointment-lifecycle/appointments/:id/status`<br>`route: /appointment-sms/appointments/:appointment_id/queue` |
| [HC-0136](https://help.zenoti.com/en/appointments/daily-tasks.html) Daily tasks | daily, tasks | `route: /inventory/color-bowls/daily-variance`<br>`route: /invoice-notifications/daily-report/process`<br>`table: micro_profit_daily_rollup` |
| [HC-0137](https://help.zenoti.com/en/appointments/daily-tasks/book-appointments.html) Book appointments | appointments, book | `route: /staff-self/appointment-book`<br>`route: /staff-self/appointment-book/clients/:id/eligibility`<br>`route: /staff-self/appointment-book/quote` |
| [HC-0138](https://help.zenoti.com/en/appointments/daily-tasks/book-appointments/book-appointment-using-booking-wizard.html) Book appointment using Booking Wizard | appointment, book, booking, wizard | `route: /staff-self/appointment-book`<br>`route: /staff-self/appointment-book/clients/:id/eligibility`<br>`route: /staff-self/appointment-book/quote` |
| [HC-0139](https://help.zenoti.com/en/appointments/daily-tasks/book-appointments/book-appointments-using-appointment-info-panel.html) Book appointments using Appointment Info panel | appointment, appointments, book | `route: /staff-self/appointment-book`<br>`route: /staff-self/appointment-book/clients/:id/eligibility`<br>`route: /staff-self/appointment-book/quote` |
| [HC-0141](https://help.zenoti.com/en/appointments/daily-tasks/end-your-day.html) End your day | day, end | `route: /pos/terminals/:id/sessions/end`<br>`route: /staff-attendance/break-end`<br>`route: /pos/day-close/:date` |
| [HC-0144](https://help.zenoti.com/en/appointments/daily-tasks/end-your-day/view-today-s-sales.html) View today's sales | sales, today, view | `route: /clients/return-tracker/:view`<br>`route: /staff/mobile/today`<br>`route: /billing/sales-register` |
| [HC-0145](https://help.zenoti.com/en/appointments/daily-tasks/end-your-day/view-today-s-summary.html) View today's summary | summary, today, view | `route: /clients/return-tracker/:view`<br>`route: /staff/mobile/today`<br>`route: /birthday-campaign/summary` |
| [HC-0146](https://help.zenoti.com/en/appointments/daily-tasks/end-your-day/view-today-s-tips.html) View today's tips | tips, today, view | `route: /clients/return-tracker/:view`<br>`route: /staff/mobile/today`<br>`route: /staff/tips` |
| [HC-0152](https://help.zenoti.com/en/appointments/daily-tasks/manage-appointments/modify-appointment-using-booking-wizard.html) Modify appointment using Booking Wizard | appointment, booking, wizard | `route: /booking-wizard/state`<br>`route: /booking-wizard/state/:session_id`<br>`table: booking_wizard_state` |
| [HC-0155](https://help.zenoti.com/en/appointments/daily-tasks/manage-online-booking-requests.html) Manage online booking requests | booking, online, requests | `route: /staff-self/online-booking-requests/:id/decision`<br>`route: /smart-booking/online-request`<br>`table: smart_booking_requests` |
| [HC-0159](https://help.zenoti.com/en/appointments/daily-tasks/start-your-day.html) Start your day | day, start | `route: /appointments/:id/start-service`<br>`route: /auth/sso/:provider/start`<br>`route: /pos/terminals/:id/sessions/start` |
| [HC-0162](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-gift-cards.html) Manage gift cards | cards, gift | `route: /customer/gift-cards`<br>`route: /customer/gift-cards/claim`<br>`route: /customer/gift-cards/redeem` |
| [HC-0164](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/add-guest-to-waitlist.html) Add guest to waitlist | add, guest, waitlist | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [HC-0165](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/add-notes.html) Add notes | add, notes | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [HC-0172](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/view-a-guest-s-appointment-history.html) View a guest's appointment history | appointment, guest, history, view | `route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile`<br>`route: /staff-self/appointments/:appointment_id/guest-360/contact-preferences` |
| [HC-0173](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/view-coupons.html) View coupons | coupons, view | `route: /clients/return-tracker/:view`<br>`route: /pos/coupons`<br>`route: /pos/coupons/analytics` |
| [HC-0174](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/view-guest-photos-and-files.html) View guest photos and files | files, guest, photos, view | `route: /staff-self/appointments/:appointment_id/guest-360/photos`<br>`route: /staff-self/appointments/:appointment_id/guest-360/photos/:photo_id`<br>`route: /staff-self/appointments/:appointment_id/guest-360/photos/:photo_id/content` |
| [HC-0177](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests/view-notification.html) View notification | notification, view | `route: /clients/return-tracker/:view`<br>`route: /staff-self/notification-center`<br>`route: /staff-self/notification-preferences` |

_762 more in the JSON report._

## Schema-only — finish it or drop the tables (100)

| Zenoti capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [HC-0038](https://help.zenoti.com/en/ai-lead-management/configure-automation-rules.html) Configure automation rules | automation, rules | `table: whatsapp_automation_rules`<br>`page: frontend-angular:pages/messaging/whatsapp-automation-page.component`<br>`table: inventory_automation_actions` |
| [HC-0054](https://help.zenoti.com/en/ai-lead-management/work-with-leads.html) Work with leads | leads, work | `table: staff_work_task_pay_rates`<br>`route: /marketing/leads`<br>`route: /marketing/leads/:id` |
| [HC-0066](https://help.zenoti.com/en/analytics/analytics---amazon-s3/fact-and-dimension-tables--s3-/membership-user-redemptions-value-fact-table--s3-.html) Membership user redemptions value fact table (s3) | membership, redemptions, user, value | `table: pos_membership_redemptions`<br>`test: frontend-angular:tests/stock-audit-value-variance-wiring.test.mjs`<br>`route: /scim/v2/Users/:user_id` |
| [HC-0086](https://help.zenoti.com/en/analytics/analytics-dedicated-redshift/fact-and-dimension-tables--redshift-/membership-user-redemptions-value-fact-table--redshift-.html) Membership user redemptions value fact table (Redshift) | membership, redemptions, user, value | `table: pos_membership_redemptions`<br>`test: frontend-angular:tests/stock-audit-value-variance-wiring.test.mjs`<br>`route: /scim/v2/Users/:user_id` |
| [HC-0187](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-memberships/manage-membership-service-credits.html) Manage membership service credits | credits, membership, service | `table: client_membership_credits`<br>`route: /membership-enterprise/client/:client_id/self-service/status-link`<br>`route: /membership-enterprise/self-service` |
| [HC-0188](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-memberships/manage-recurring-memberships--payment-related-actions.html) Manage recurring memberships: Payment-related actions | actions, memberships, payment | `table: payment_provider_actions`<br>`route: /customer/memberships`<br>`route: /customer/memberships/:id/auto-renew` |
| [HC-0231](https://help.zenoti.com/en/appointments/onboard-and-set-up/bookings/service-rules.html) Service rules | rules, service | `table: service_price_rules`<br>`route: /clients/discount-rules`<br>`route: /clients/discount-rules/:rule_id` |
| [HC-0312](https://help.zenoti.com/en/configuration/appointments-configurations/bookings/service-rules.html) Service rules | rules, service | `table: service_price_rules`<br>`route: /clients/discount-rules`<br>`route: /clients/discount-rules/:rule_id` |
| [HC-0363](https://help.zenoti.com/en/configuration/business-details-configurations/update-center-s-operating-hours-or-center-timings-and-holidays.html) Update center's operating hours or center timings and holidays | center, holidays, hours, operating | `table: branch_operating_hours`<br>`route: /purchases/price-update-requests`<br>`route: /purchases/price-update-requests/:id/review` |
| [HC-0458](https://help.zenoti.com/en/configuration/fitness-configurations/mandate-selecting-a-payment-method-for-enrolling-students.html) Mandate selecting a payment method for enrolling students | method, payment | `table: pos_payment_method_settings`<br>`route: /appointment-deposits/followups/:payment_link_id`<br>`route: /billing/invoices/:id/payment` |
| [HC-0501](https://help.zenoti.com/en/configuration/forms-configurations/set-up-and-manage-guest-medical-records.html) Set Up and Manage Guest Medical Records | guest, records | `table: ai_voice_call_records`<br>`table: staff_attendance_records`<br>`route: /staff-self/appointments/:appointment_id/guest-360` |
| [HC-0505](https://help.zenoti.com/en/configuration/forms-configurations/track-form-review-compliance-using-the-compliance-tracking-dashboard.html) Track Form Review Compliance Using the Compliance Tracking Dashboard | compliance, dashboard, form, review | `table: client_form_review_events`<br>`route: /operations/outcall/jobs/:id/tracking-link`<br>`route: /operations/tracking/:token` |
| [HC-0533](https://help.zenoti.com/en/configuration/integrations-configurations/accounting-integration.html) Accounting Integration | accounting, integration | `table: integration_opening_inventory_accounting`<br>`route: /pos/day-close/:date/accounting-preview`<br>`route: /pos/z-reports/:date/post-accounting` |
| [HC-0539](https://help.zenoti.com/en/configuration/inventory-configurations/print-barcodes.html) Print barcodes | barcodes, print | `table: inventory_item_barcodes`<br>`route: /billing/invoices/:id/print`<br>`route: /pos/invoices/:id/print` |
| [HC-0547](https://help.zenoti.com/en/configuration/kiosk-configurations/configure-guest-actions-in-kiosk.html) Configure guest actions in kiosk | actions, guest, kiosk | `table: kiosk_guest_sessions`<br>`route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile` |
| [HC-0572](https://help.zenoti.com/en/configuration/marketing-configurations/marketing-settings.html) Marketing settings | marketing, settings | `table: marketing_governance_settings`<br>`route: /customer/marketing-offers`<br>`route: /customer/marketing-offers/:id/creative` |
| [HC-0637](https://help.zenoti.com/en/configuration/notifications-configurations/fitness-notifications/class-notifications/guest-challenge-accepted.html) Guest Challenge Accepted | challenge, guest | `table: fitness_challenge_participants`<br>`route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile` |
| [HC-0638](https://help.zenoti.com/en/configuration/notifications-configurations/fitness-notifications/class-notifications/guest-challenge-completed.html) Guest Challenge Completed | challenge, guest | `table: fitness_challenge_participants`<br>`route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile` |
| [HC-0724](https://help.zenoti.com/en/configuration/notifications-configurations/macros-in-inventory-notifications/macros-in-vendor-invoice-mail-notification.html) Macros in Vendor Invoice Mail notification | invoice, notification | `table: invoice_notification_contact_verifications`<br>`table: invoice_notification_profile_media`<br>`table: invoice_notification_profiles` |
| [HC-0730](https://help.zenoti.com/en/configuration/notifications-configurations/macros-in-kiosk-notifications/macros-in-kiosk-threshold-notification---queue-position.html) Macros in Kiosk Threshold Notification - Queue Position | kiosk, notification, queue | `table: staff_notification_queue`<br>`route: /staff-self/notification-center`<br>`route: /staff-self/notification-preferences` |
| [HC-0732](https://help.zenoti.com/en/configuration/notifications-configurations/macros-in-memberships-and-packages-notifications/gift-credit-on-membership-cancellation-macros.html) Gift Credit on Membership Cancellation macros | credit, gift, membership | `table: membership_credit_adjustments`<br>`route: /customer/gift-cards`<br>`route: /customer/gift-cards/claim` |
| [HC-0752](https://help.zenoti.com/en/configuration/notifications-configurations/macros-in-queue-notifications/macros-in-queue-ready-for-client-notification.html) Macros in Queue Ready for Client notification | client, notification, queue | `table: staff_notification_queue`<br>`route: /staff-self/notification-center`<br>`route: /staff-self/notification-preferences` |
| [HC-0765](https://help.zenoti.com/en/configuration/packages-configurations/allow-package-redemption-during-appointment-booking.html) Allow package redemption during appointment booking | appointment, booking, package | `table: appointment_package_reservations`<br>`route: /booking-payments/:appointment_id/refund`<br>`route: /booking-payments/:appointment_id/status` |
| [HC-0783](https://help.zenoti.com/en/configuration/pos-configurations/bank.html) Bank | bank | `table: cash_drawer_bank_deposits` |
| [HC-0798](https://help.zenoti.com/en/configuration/pos-configurations/essentials/configure-default-action-on-invoice-closure.html) Configure default action on invoice closure | action, invoice | `table: pos_invoice_action_history`<br>`route: /profit-intelligence/governance/evaluate-action`<br>`table: ai_action_audit` |
| [HC-0836](https://help.zenoti.com/en/configuration/pos-configurations/payments-and-invoices/allow-full-refund-on-an-invoice.html) Allow full refund on an invoice | full, invoice, refund | `table: pos_invoice_refund_lines`<br>`test: frontend-angular:tests/full-crm-mobile-audit.test.mjs`<br>`route: /billing/invoices/:id/refund` |
| [HC-0852](https://help.zenoti.com/en/configuration/pos-configurations/sales-rules/allow-prepaid-card-sale-in-pos.html) Allow prepaid card sale in POS | card, pos, sale | `table: pos_sale_lines`<br>`route: /appointments/:id/convert-to-sale`<br>`route: /membership-enterprise/renewals/:source_sale_id` |
| [HC-0867](https://help.zenoti.com/en/configuration/queue-configurations/configure-display-settings-for-queue/display-walk-in-appointments-in-pink-in-the-queue-view.html) Display Walk-in Appointments in Pink in the Queue View | appointments, display, queue, view | `table: walk_in_queue_entries`<br>`route: /appointment-sms/appointments/:appointment_id/queue`<br>`route: /clients/return-tracker/:view` |
| [HC-0929](https://help.zenoti.com/en/configuration/zenoti-payments-configurations/business-payments/royalty-fees-transaction-history.html) Royalty fees transaction history | history, royalty | `table: franchise_royalty_statements`<br>`route: /appointment-history/appointment/:appointment_id/timeline`<br>`route: /appointment-history/client/:client_id` |
| [HC-0930](https://help.zenoti.com/en/configuration/zenoti-payments-configurations/business-payments/set-up-multiple-merchant-accounts.html) Set up multiple merchant accounts | accounts, merchant | `table: payment_merchant_accounts`<br>`route: /balance-sheet/accounts`<br>`route: /pos/corporate-accounts` |
| [HC-0931](https://help.zenoti.com/en/configuration/zenoti-payments-configurations/business-payments/set-up-royalty-payments-v2.html) Set Up Royalty Payments v2 | payments, royalty | `table: franchise_royalty_statements`<br>`route: /booking-payments/:appointment_id/refund`<br>`route: /booking-payments/:appointment_id/status` |
| [HC-1043](https://help.zenoti.com/en/consumer-experience/webstore/register-and-manage-custom-domain-names-for-your-webstore-in-zenoti.html) Register and manage custom domain names for your Webstore in Zenoti | custom, domain, register | `table: tenant_domain_mappings`<br>`route: /reports/custom`<br>`route: /reports/custom/:id/lifecycle` |
| [HC-1072](https://help.zenoti.com/en/employee-and-payroll/employee-related-manager-tasks/manage-breaks.html) Manage breaks | breaks | `table: staff_attendance_breaks` |
| [HC-1132](https://help.zenoti.com/en/employee-and-payroll/employee-related-manager-tasks/manage-work-tasks.html) Manage work tasks | tasks, work | `table: staff_work_task_pay_rates`<br>`route: /staff/hrms/lifecycle-cases/:id/tasks/:task_id`<br>`route: /staff/operations/:id/tasks` |
| [HC-1135](https://help.zenoti.com/en/employee-and-payroll/employee-related-manager-tasks/set-attendance-rules.html) Set attendance rules | attendance, rules | `table: staff_attendance_rules`<br>`route: /staff-attendance/:staff_id/:business_date/correction`<br>`route: /staff-attendance/:staff_id/details` |
| [HC-1152](https://help.zenoti.com/en/employee-and-payroll/onboard-and-set-up/manage-work-tasks.html) Manage work tasks | tasks, work | `table: staff_work_task_pay_rates`<br>`route: /staff/hrms/lifecycle-cases/:id/tasks/:task_id`<br>`route: /staff/operations/:id/tasks` |
| [HC-1207](https://help.zenoti.com/en/fitness/house-accounts/statements.html) Statements | statements | `table: franchise_royalty_statements` |
| [HC-1220](https://help.zenoti.com/en/fitness/memberships/advance-booking-windows-for-memberships.html) Advance booking windows for memberships | advance, booking, memberships, windows | `table: ai_workforce_request_windows`<br>`test: frontend-angular:tests/appointment-advance-payment-wiring.test.mjs`<br>`module: repositories/staff_advance_repository` |
| [HC-1225](https://help.zenoti.com/en/fitness/memberships/corporate-memberships/create-a-corporate-account.html) Create a corporate account | account, corporate, create | `table: corporate_account_members`<br>`route: /appointments/:id/create-touchup`<br>`route: /booking-payments/payment-link/create` |
| [HC-1256](https://help.zenoti.com/en/hyperconnect/analytics/organization-level-analytics-in-hyperconnect.html) Organization Level Analytics in HyperConnect | analytics, level, organization | `table: service_pricing_level_prices`<br>`route: /booking-analytics/abandonments`<br>`route: /booking-analytics/abandonments/:id/recover` |
| [HC-1275](https://help.zenoti.com/en/hyperconnect/hyperconnect-configurations/manage-voice-call-settings.html) Manage Voice Call Settings | call, settings, voice | `table: ai_voice_call_records`<br>`route: /webhooks/voice/concierge`<br>`route: /appointment-settings` |
| [HC-1276](https://help.zenoti.com/en/hyperconnect/hyperconnect-configurations/manage-voice-call-settings/call-routing.html) Call Routing | call | `table: ai_voice_call_records` |
| [HC-1281](https://help.zenoti.com/en/hyperconnect/hyperconnect-voice-service-level-agreement.html) HyperConnect Voice Service Level Agreement | level, service, voice | `table: service_pricing_level_prices`<br>`route: /webhooks/voice/concierge`<br>`table: ai_voice_call_records` |
| [HC-1285](https://help.zenoti.com/en/hyperconnect/manage-social-reviews/managing-business-listings-using-hyperconnect.html) Managing Business Listings Using HyperConnect | business, listings | `table: marketplace_listings`<br>`route: /settings/invoice-business-profile`<br>`route: /staff-attendance/:staff_id/:business_date/correction` |
| [HC-1286](https://help.zenoti.com/en/hyperconnect/manage-social-reviews/set-up-smart-replies-for-customer-reviews-in-zenoti-hyperconnect.html) Set Up Smart Replies for Customer Reviews in Zenoti Hyperconnect | customer, reviews, smart | `table: customer_booking_reviews`<br>`route: /smart-booking/bookings`<br>`route: /smart-booking/online-request` |
| [HC-1294](https://help.zenoti.com/en/hyperconnect/smartbot/how-does-quickbook-feature-work-.html) How does Quickbook feature work? | feature, work | `table: staff_work_task_pay_rates`<br>`table: tenant_feature_overrides` |
| [HC-1308](https://help.zenoti.com/en/integrations/accounting-integrations/accounting-integration--onboarding-.html) Accounting Integration (Onboarding) | accounting, integration, onboarding | `table: integration_opening_inventory_accounting`<br>`route: /pos/payment-platform/onboarding`<br>`route: /saas/onboarding` |
| [HC-1310](https://help.zenoti.com/en/integrations/accounting-integrations/accounting-integration--troubleshooting.html) Accounting integration: Troubleshooting | accounting, integration | `table: integration_opening_inventory_accounting`<br>`route: /pos/day-close/:date/accounting-preview`<br>`route: /pos/z-reports/:date/post-accounting` |
| [HC-1311](https://help.zenoti.com/en/integrations/accounting-integrations/accounting-integration-v2.html) Accounting Integration v2 | accounting, integration | `table: integration_opening_inventory_accounting`<br>`route: /pos/day-close/:date/accounting-preview`<br>`route: /pos/z-reports/:date/post-accounting` |
| [HC-1331](https://help.zenoti.com/en/integrations/shopify-integrations/shopify-integration-at-center-level.html) Shopify Integration at Center Level | center, integration, level | `table: service_pricing_level_prices`<br>`route: /balance-sheet/journal-lines/:line_id/cost-center`<br>`route: /inventory/command-center` |
| [HC-1353](https://help.zenoti.com/en/inventory/operational-tasks/automatic-purchase-orders-and-transfer-orders.html) Automatic purchase orders and transfer orders | orders, purchase, transfer | `table: purchase_orders`<br>`route: /inventory/transfer-optimizer`<br>`route: /inventory/transfer-settings` |
| [HC-1391](https://help.zenoti.com/en/inventory/reports/inventory-traceability-report-for-batch-tracked-products.html) Inventory Traceability Report for Batch Tracked Products | batch, inventory, products, report | `table: integration_opening_inventory_batch_applications`<br>`table: inventory_batch_movements`<br>`route: /appointments/batch` |
| [HC-1404](https://help.zenoti.com/en/kiosk/new-kiosk/configure-guest-actions-for-new-kiosk.html) Configure guest actions for new Kiosk | actions, guest, kiosk | `table: kiosk_guest_sessions`<br>`route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile` |
| [HC-1414](https://help.zenoti.com/en/kiosk/onboard-and-set-up/configure-guest-actions-in-kiosk.html) Configure guest actions in kiosk | actions, guest, kiosk | `table: kiosk_guest_sessions`<br>`route: /staff-self/appointments/:appointment_id/guest-360`<br>`route: /staff-self/appointments/:appointment_id/guest-360/clinical-profile` |
| [HC-1422](https://help.zenoti.com/en/kiosk/onboard-and-set-up/track-guest-actions-on-kiosk-using-google-analytics-and-tag-manager.html) Track guest actions on Kiosk using Google Analytics and Tag Manager | actions, analytics, guest, kiosk | `table: kiosk_guest_sessions`<br>`route: /staff/hrms/appraisal-reviews/:id/manager`<br>`route: /booking-analytics/abandonments` |
| [HC-1572](https://help.zenoti.com/en/point-of-sale/check-out/apply-membership-service-credits.html) Apply membership service credits | apply, credits, membership, service | `table: client_membership_credits`<br>`route: /pos/happy-hours/auto-sunset/decisions/:id/apply`<br>`route: /staff/roster/drafts/:id/apply` |
| [HC-1579](https://help.zenoti.com/en/point-of-sale/check-out/other-actions/invoice-level-actions.html) Invoice level actions | actions, invoice, level | `table: service_pricing_level_prices`<br>`route: /ai/actions/autonomy`<br>`route: /ai/actions/autonomy/undoable` |
| [HC-1601](https://help.zenoti.com/en/point-of-sale/onboard-and-set-up/bank.html) Bank | bank | `table: cash_drawer_bank_deposits` |
| [HC-1616](https://help.zenoti.com/en/point-of-sale/onboard-and-set-up/essentials/configure-default-action-on-invoice-closure.html) Configure default action on invoice closure | action, invoice | `table: pos_invoice_action_history`<br>`route: /profit-intelligence/governance/evaluate-action`<br>`table: ai_action_audit` |
| [HC-1643](https://help.zenoti.com/en/point-of-sale/onboard-and-set-up/payments-and-invoices/allow-full-refund-on-an-invoice.html) Allow full refund on an invoice | full, invoice, refund | `table: pos_invoice_refund_lines`<br>`test: frontend-angular:tests/full-crm-mobile-audit.test.mjs`<br>`route: /billing/invoices/:id/refund` |

_40 more in the JSON report._

## No match — likely genuine gaps (231)

| Zenoti capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [HC-0005](https://help.zenoti.com/en/admin/faqs-and-prompts-for-zeenie.html) FAQs and prompts for Zeenie |  | — |
| [HC-0006](https://help.zenoti.com/en/admin/manage-machine-authentication.html) Manage machine authentication |  | — |
| [HC-0010](https://help.zenoti.com/en/admin/recommended-barcode-scanners-and-readers/install-tvs-electronics-model---bs-c101-star-barcode-scanner.html) Install TVS Electronics Model - BS-C101 Star barcode scanner | barcode, model, scanner | `test: staff-app:src/app/features/staff/staff-dashboard.model.spec.ts`<br>`route: /inventory/barcode-aliases`<br>`route: /inventory/laundry/items/scan/:barcode` |
| [HC-0013](https://help.zenoti.com/en/admin/recommended-printers.html) Recommended printers |  | — |
| [HC-0014](https://help.zenoti.com/en/admin/recommended-printers/epson-tm-m30-printer.html) Epson TM-m30 printer |  | — |
| [HC-0015](https://help.zenoti.com/en/admin/recommended-printers/epson-tm-t82-printer.html) Epson TM-T82 printer |  | — |
| [HC-0016](https://help.zenoti.com/en/admin/recommended-printers/epson-tm-t88vi-printer.html) Epson TM-T88VI printer |  | — |
| [HC-0017](https://help.zenoti.com/en/admin/recommended-printers/epson-tm-u220-printer.html) Epson TM-U220 printer |  | — |
| [HC-0018](https://help.zenoti.com/en/admin/recommended-printers/posiflex-aura-6800u-printer.html) Posiflex Aura-6800U printer |  | — |
| [HC-0020](https://help.zenoti.com/en/admin/recommended-printers/star-tsp-100-printer.html) Star TSP 100 printer |  | — |
| [HC-0032](https://help.zenoti.com/en/admin/zeenie-keyboard-shortcuts.html) Zeenie keyboard shortcuts |  | — |
| [HC-0059](https://help.zenoti.com/en/analytics/analytics---amazon-s3/fact-and-dimension-tables--s3-.html) Fact and dimension tables (S3) |  | — |
| [HC-0077](https://help.zenoti.com/en/analytics/analytics-dedicated-redshift/fact-and-dimension-tables--redshift-.html) Fact and dimension tables (Redshift) |  | — |
| [HC-0095](https://help.zenoti.com/en/analytics/analytics-dedicated-redshift/get-started.html) Get Started |  | — |
| [HC-0096](https://help.zenoti.com/en/analytics/analytics-dedicated-redshift/redshift-faqs.html) Redshift FAQs |  | — |
| [HC-0122](https://help.zenoti.com/en/analytics/business-snapshot/collections.html) Collections |  | — |
| [HC-0148](https://help.zenoti.com/en/appointments/daily-tasks/faq-and-troubleshooting.html) FAQ and Troubleshooting |  | — |
| [HC-0163](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-guests.html) Manage guests |  | — |
| [HC-0181](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-loyalty-points.html) Manage loyalty points |  | — |
| [HC-0192](https://help.zenoti.com/en/appointments/manage-guest-experience/manage-opportunities.html) Manage opportunities |  | — |
| [HC-0197](https://help.zenoti.com/en/appointments/new-front-desk-experience.html) New Front Desk Experience |  | — |
| [HC-0198](https://help.zenoti.com/en/appointments/onboard-and-set-up.html) Onboard and set up |  | — |
| [HC-0238](https://help.zenoti.com/en/appointments/onboard-and-set-up/essentials.html) Essentials |  | — |
| [HC-0251](https://help.zenoti.com/en/appointments/onboard-and-set-up/personalization.html) Personalization |  | — |
| [HC-0252](https://help.zenoti.com/en/appointments/onboard-and-set-up/personalization/interface.html) Interface |  | — |
| [HC-0257](https://help.zenoti.com/en/appointments/onboard-and-set-up/personalization/toolbar.html) Toolbar |  | — |
| [HC-0274](https://help.zenoti.com/en/configuration/add-ons-configurations/zenoti-connect.html) Zenoti Connect |  | — |
| [HC-0320](https://help.zenoti.com/en/configuration/appointments-configurations/essentials.html) Essentials |  | — |
| [HC-0334](https://help.zenoti.com/en/configuration/appointments-configurations/personalization.html) Personalization |  | — |
| [HC-0335](https://help.zenoti.com/en/configuration/appointments-configurations/personalization/interface.html) Interface |  | — |
| [HC-0348](https://help.zenoti.com/en/configuration/appointments-configurations/personalization/toolbar.html) Toolbar |  | — |
| [HC-0355](https://help.zenoti.com/en/configuration/business-details-configurations/configure-equipment.html) Configure equipment |  | — |
| [HC-0359](https://help.zenoti.com/en/configuration/business-details-configurations/manage-domains.html) Manage domains |  | — |
| [HC-0360](https://help.zenoti.com/en/configuration/business-details-configurations/manage-taxes.html) Manage taxes |  | — |
| [HC-0364](https://help.zenoti.com/en/configuration/cma-configurations.html) CMA configurations |  | — |
| [HC-0370](https://help.zenoti.com/en/configuration/cma-configurations/customize-bottom-navigation-bar.html) Customize bottom navigation bar |  | — |
| [HC-0371](https://help.zenoti.com/en/configuration/cma-configurations/customize-branding.html) Customize branding |  | — |
| [HC-0372](https://help.zenoti.com/en/configuration/cma-configurations/customize-homescreen.html) Customize homescreen |  | — |
| [HC-0385](https://help.zenoti.com/en/configuration/employee-configurations/configure-commissions/configure-deductions.html) Configure Deductions |  | — |
| [HC-0396](https://help.zenoti.com/en/configuration/employee-configurations/configure-tenure.html) Configure tenure |  | — |
| [HC-0403](https://help.zenoti.com/en/configuration/employee-mobile-app-configurations/myzen.html) MyZen |  | — |
| [HC-0415](https://help.zenoti.com/en/configuration/employee-mobile-app-configurations/zenoti-mobile/essentials.html) Essentials |  | — |
| [HC-0421](https://help.zenoti.com/en/configuration/finance-gst-configurations/e-invoicing-in-saudi-arabia--phase-2.html) E-Invoicing in Saudi Arabia- Phase 2 |  | — |
| [HC-0422](https://help.zenoti.com/en/configuration/finance-gst-configurations/e-invoicing-in-saudi-arabia.html) E-Invoicing in Saudi Arabia |  | — |
| [HC-0424](https://help.zenoti.com/en/configuration/finance-gst-configurations/gst---australia.html) GST - Australia |  | — |
| [HC-0425](https://help.zenoti.com/en/configuration/finance-gst-configurations/gst---india.html) GST - India |  | — |
| [HC-0426](https://help.zenoti.com/en/configuration/finance-gst-configurations/gst---malaysia.html) GST - Malaysia |  | — |
| [HC-0463](https://help.zenoti.com/en/configuration/fitness-configurations/set-up-milestones-for-students.html) Set up milestones for students |  | — |
| [HC-0465](https://help.zenoti.com/en/configuration/fitness-configurations/set-up-virtual-classes.html) Set up virtual classes |  | — |
| [HC-0487](https://help.zenoti.com/en/configuration/forms-configurations/create-forms-using-form-builder/hide-fields-from-guests.html) Hide fields from guests |  | — |
| [HC-0491](https://help.zenoti.com/en/configuration/forms-configurations/faq-and-troubleshooting.html) FAQ and Troubleshooting |  | — |
| [HC-0513](https://help.zenoti.com/en/configuration/guests-configurations.html) Guests configurations |  | — |
| [HC-0534](https://help.zenoti.com/en/configuration/integrations-configurations/configure-gantner.html) Configure Gantner |  | — |
| [HC-0552](https://help.zenoti.com/en/configuration/localization-configurations.html) Localization configurations |  | — |
| [HC-0556](https://help.zenoti.com/en/configuration/loyalty-configurations.html) Loyalty configurations |  | — |
| [HC-0557](https://help.zenoti.com/en/configuration/loyalty-configurations/set-up-regular-loyalty-program.html) Set up regular loyalty program |  | — |
| [HC-0558](https://help.zenoti.com/en/configuration/loyalty-configurations/set-up-tiered-loyalty-program.html) Set up tiered loyalty program |  | — |
| [HC-0562](https://help.zenoti.com/en/configuration/marketing-configurations/manage-campaigns/dlt-and-kyc.html) DLT and KYC |  | — |
| [HC-0564](https://help.zenoti.com/en/configuration/marketing-configurations/manage-campaigns/dlt-and-kyc/dlt-registration-faq.html) DLT registration FAQ |  | — |
| [HC-0644](https://help.zenoti.com/en/configuration/notifications-configurations/fitness-notifications/class-notifications/registration-cancelled.html) Registration Cancelled |  | — |

_171 more in the JSON report._
