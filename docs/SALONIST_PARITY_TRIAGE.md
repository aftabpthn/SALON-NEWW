# Salonist parity triage

Generated 2026-08-06T14:24:17.499Z from `docs/evidence/salonist-master-parity-register.json`.

**This file decides nothing.** Every row below is still `Unmapped`. The register
marks a capability Complete only when a person records the real UI, API route and
test behind it, and that rule does not change here. What this adds is a starting
point: the register said 299 rows were equally unknown, and they are not.

AuraShine surface searched: 1545 mounted route literals, 241 backend modules, 123 frontend pages/components, 592 database tables, 135 focused frontend tests.

| Band | Rows | What it means |
|---|---:|---|
| High | 83 | A route or screen carries the capability's most distinctive term. Very likely already built — verify and map. |
| Medium | 172 | Partial agreement across surfaces. Probably adjacent to something that exists. |
| Schema-only | 12 | Tables match but no route, module or screen does. Review for an incomplete flow or obsolete schema. |
| Low | 21 | One weak signal. Treat as unknown. |
| None | 11 | Nothing in the codebase resembles it. Most likely a genuine gap. |

### How to read this

Work **High** first: it is the cheapest way to replace a misleading parity
number with a real one. **Schema-only** is the most actionable band — each row
is either a feature to finish or a migration to delete, and leaving it half-done
is what made the register look complete when it was not. **None** is the honest
roadmap input, but read it with judgement: it also contains Salonist-branded
things (their assistant, their payments status page) that are not gaps to close,
and specific hardware models that belong in a support matrix rather than a
feature backlog.

Matching is by name only, so it misses features that exist under different
wording. A shipped workflow can still land in Low when its route, table and
screen use another domain term. Absence of a match is a
prompt to look, not a verdict.

## High confidence — verify and map (83)

| Salonist capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [SAL-0002](https://help.salonist.io/en/articles/10162156-how-can-i-add-the-close-of-business-day) How can I add the close of business day? | add, business, close, day | `route: /pos/day-close/:date`<br>`route: /pos/day-close/:date/accounting-preview`<br>`route: /pos/day-close/:date/lock` |
| [SAL-0005](https://help.salonist.io/en/articles/10198850-how-can-i-add-and-remove-notes-at-the-time-of-billing) How can I add and remove notes at the time of billing? | add, billing, notes, remove | `route: /billing/invoices/:id/add-item`<br>`route: /appointments/:id/remove-service`<br>`test: frontend-angular:tests/appointment-current-time-line.test.mjs` |
| [SAL-0012](https://help.salonist.io/en/articles/10221618-how-can-we-resend-the-invoice-message) How can we resend the invoice message? | invoice, message, resend | `route: /staff/:id/invite/resend`<br>`route: /message-templates`<br>`route: /settings/message-history` |
| [SAL-0017](https://help.salonist.io/en/articles/10229431-how-can-i-copy-the-staff-schedule) How can I copy the staff schedule? | copy, schedule, staff | `route: /staff-schedule/copy`<br>`test: frontend-angular:tests/availability-schedule-template-copy.test.mjs`<br>`route: /staff/incentive-rules/:id/copy` |
| [SAL-0019](https://help.salonist.io/en/articles/10230445-how-can-i-enable-and-disable-whatsapp-messages) How can I enable and disable WhatsApp messages? | disable, enable, messages, whatsapp | `route: /whatsapp/messages`<br>`route: /auth/mfa/enable`<br>`route: /auth/mfa/disable` |
| [SAL-0020](https://help.salonist.io/en/articles/10242916-how-do-i-delete-the-services) How do I delete the services? | delete, services | `route: /pos/invoice-delete-requests`<br>`route: /pos/invoice-delete-requests/:request_id/decision`<br>`route: /pos/invoices/:id/delete-request` |
| [SAL-0026](https://help.salonist.io/en/articles/10631509-how-can-i-add-a-template-type-for-a-gift-card) How can I add a template type for a gift card? | add, card, gift, template | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0027](https://help.salonist.io/en/articles/10631529-how-can-i-add-templates-for-gift-cards) How can I add templates for gift cards? | add, cards, gift, templates | `route: /customer/gift-cards`<br>`route: /customer/gift-cards/claim`<br>`route: /customer/gift-cards/redeem` |
| [SAL-0028](https://help.salonist.io/en/articles/10631606-what-are-gift-card-default-templates) What are gift card default templates? | card, gift, templates | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0029](https://help.salonist.io/en/articles/10631650-how-can-i-import-the-gift-card-into-salonist) How can I import the gift card into Salonist? | card, gift, import | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0032](https://help.salonist.io/en/articles/10631857-after-a-gift-card-is-generated-how-can-it-be-printed) After a gift card is generated, how can it be printed? | card, gift | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0033](https://help.salonist.io/en/articles/10631886-how-to-delete-gift-card) How to delete Gift card ? | card, delete, gift | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0039](https://help.salonist.io/en/articles/11562730-how-to-edit-commission-profile) How to edit commission profile ? | commission, edit, profile | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /membership-enterprise/reports/commission` |
| [SAL-0042](https://help.salonist.io/en/articles/11568753-how-do-i-download-or-export-leads) How do I download or export leads? | download, export, leads | `route: /security/pii-exports/:export_id/download`<br>`route: /reports/exports/:id/download`<br>`route: /marketing/leads` |
| [SAL-0049](https://help.salonist.io/en/articles/12147906-how-to-generate-an-invoice-in-salonist) How to generate an invoice in Salonist? | generate, invoice | `route: /membership-enterprise/reminders/generate`<br>`route: /invoice-notifications/contact-verifications/request`<br>`route: /invoice-notifications/contact-verifications/verify` |
| [SAL-0050](https://help.salonist.io/en/articles/15679746-how-to-give-roles-to-staff) How to give roles to staff | roles, staff | `route: /staff/auth-roles`<br>`route: /staff/auth-roles/:role_id`<br>`table: roles` |
| [SAL-0051](https://help.salonist.io/en/articles/15679768-how-to-create-staff-roles-with-the-new-role-management-system) How to Create Staff Roles with the New Role Management System | create, management, role, roles | `route: /staff/auth-roles/:role_id`<br>`page: frontend-angular:pages/staff/leave-management/staff-leave-management-page.component`<br>`test: frontend-angular:tests/staff-leave-management-wiring.test.mjs` |
| [SAL-0053](https://help.salonist.io/en/articles/9139940-how-can-i-add-services-in-salonist) How can I add services in Salonist? | add, services | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [SAL-0061](https://help.salonist.io/en/articles/9144110-how-can-the-staff-attendance-be-added) How can the staff attendance be added? | attendance, staff | `route: /staff-attendance/:staff_id/:business_date/correction`<br>`route: /staff-attendance/:staff_id/details`<br>`route: /staff-attendance/biometric/begin` |
| [SAL-0063](https://help.salonist.io/en/articles/9144210-how-can-we-reset-the-staff-password) How can we reset the staff password? | password, reset, staff | `route: /staff/:id/password`<br>`test: frontend-angular:tests/staff-password-mode-wiring.test.mjs`<br>`route: /public/kiosk/reset` |
| [SAL-0064](https://help.salonist.io/en/articles/9144392-how-can-the-staff-details-be-edited) How can the staff details be edited? | details, staff | `route: /staff-attendance/:staff_id/details`<br>`route: /public-booking/:token/details`<br>`route: /auth/staff-invitations/:token` |
| [SAL-0065](https://help.salonist.io/en/articles/9144434-how-staff-can-mark-the-attendance) How staff can mark the Attendance ? | attendance, mark, staff | `route: /staff-payroll/runs/:run_id/mark-paid`<br>`route: /staff-attendance/:staff_id/:business_date/correction`<br>`route: /staff-attendance/:staff_id/details` |
| [SAL-0066](https://help.salonist.io/en/articles/9144460-how-to-delete-the-staff) How to delete the staff? | delete, staff | `route: /pos/invoice-delete-requests`<br>`route: /pos/invoice-delete-requests/:request_id/decision`<br>`route: /pos/invoices/:id/delete-request` |
| [SAL-0067](https://help.salonist.io/en/articles/9144625-how-to-assign-a-commission-profile) How to assign a commission Profile? | assign, commission, profile | `route: /fitness/lockers/:id/assign`<br>`route: /staff-enterprise/training/assign`<br>`route: /membership-enterprise/reports/commission` |
| [SAL-0070](https://help.salonist.io/en/articles/9144781-how-can-i-add-a-client-to-the-salonist) How can I add a client to the salonist ? | add, client | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [SAL-0074](https://help.salonist.io/en/articles/9144999-how-can-i-add-a-client-group) How can I add a Client group? | add, client, group | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`route: /settings/integrations/historical-purchase-evidence/group-decisions` |
| [SAL-0077](https://help.salonist.io/en/articles/9148003-how-can-i-look-up-a-client-s-history) How can I look up a client's history? | client, history | `route: /appointment-history/client/:client_id`<br>`table: client_merge_history`<br>`table: client_segment_history` |
| [SAL-0079](https://help.salonist.io/en/articles/9148078-how-can-we-import-or-export-the-clients) "How can we Import or Export the clients?" | clients, export, import | `route: /clients/:id/report/export`<br>`route: /clients/bulk/export`<br>`route: /clients/reports/:report_type/export` |
| [SAL-0080](https://help.salonist.io/en/articles/9148105-how-do-i-book-a-room-appointment) How do I book a room appointment? | appointment, book | `route: /staff-self/appointment-book`<br>`route: /staff-self/appointment-book/clients/:id/eligibility`<br>`route: /staff-self/appointment-book/quote` |
| [SAL-0084](https://help.salonist.io/en/articles/9148547-how-can-i-delete-an-appointment) How can I delete an appointment? | appointment, delete | `route: /pos/invoice-delete-requests`<br>`route: /pos/invoice-delete-requests/:request_id/decision`<br>`route: /pos/invoices/:id/delete-request` |
| [SAL-0085](https://help.salonist.io/en/articles/9148587-how-to-add-advance-payment-while-appointment-booking) How to add advance payment while appointment booking? | add, advance, appointment, booking | `test: frontend-angular:tests/appointment-advance-payment-wiring.test.mjs`<br>`route: /appointment-deposits/followups/:payment_link_id`<br>`table: appointment_payment_allocations` |
| [SAL-0094](https://help.salonist.io/en/articles/9153884-how-to-add-vendor) How to add vendor? | add | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [SAL-0098](https://help.salonist.io/en/articles/9153966-how-can-i-manage-the-tax-settings) How can I manage the tax settings? | settings, tax | `route: /pos/day-close/:date/tax-register`<br>`route: /appointment-settings`<br>`route: /birthday-anniversary/settings` |
| [SAL-0103](https://help.salonist.io/en/articles/9154640-how-can-i-get-the-staff-sales) How can i get the staff sales? | sales, staff | `route: /reports/staff-sales`<br>`route: /staff/reports/sales`<br>`route: /billing/sales-register` |
| [SAL-0107](https://help.salonist.io/en/articles/9155143-how-can-i-see-daily-sales) How can I see daily sales ? | daily, sales | `route: /inventory/color-bowls/daily-variance`<br>`route: /invoice-notifications/daily-report/process`<br>`table: micro_profit_daily_rollup` |
| [SAL-0110](https://help.salonist.io/en/articles/9158004-how-can-i-see-payroll-list) How can I see payroll list? | list, payroll | `route: /reports/appointment-detail-list`<br>`route: /staff/list`<br>`route: /staff-payroll/commissions/calculate` |
| [SAL-0112](https://help.salonist.io/en/articles/9158016-how-can-i-see-my-membership-sales-list) How can I see my membership sales list? | list, membership, sales | `route: /membership-enterprise/reports/sales-by-customer`<br>`route: /reports/appointment-detail-list`<br>`route: /staff/list` |
| [SAL-0114](https://help.salonist.io/en/articles/9158026-how-to-view-staff-revenue) How to view staff revenue? | revenue, staff, view | `route: /clients/return-tracker/:view`<br>`route: /balance-sheet/deferred-revenue`<br>`route: /balance-sheet/deferred-revenue/:schedule_id/recognize` |
| [SAL-0115](https://help.salonist.io/en/articles/9158028-how-to-link-booking-page-with-website) How to link Booking page with website? | booking, link, page | `route: /booking-payments/payment-link/create`<br>`page: customer-app:features/booking/booking-flow.page`<br>`page: customer-app:features/booking/booking-success.page` |
| [SAL-0128](https://help.salonist.io/en/articles/9158148-how-to-run-sms-campaigns) How to run SMS campaigns? | campaigns, run, sms | `route: /notifications/sms-center/campaigns`<br>`route: /appointment-sms/appointments/:appointment_id/queue`<br>`route: /notifications/sms-center` |
| [SAL-0129](https://help.salonist.io/en/articles/9158163-how-to-set-referral-system-for-clients) How to set referral system for clients? | clients, referral | `route: /retention/clients/:client_id/referral-code`<br>`route: /retention/referrals/:referral_id/complete`<br>`table: client_referral_codes` |
| [SAL-0131](https://help.salonist.io/en/articles/9158179-how-to-add-gift-card) How to add gift card? | add, card, gift | `route: /retention/gift-cards/:gift_card_id`<br>`route: /retention/gift-cards/:gift_card_id/reissue`<br>`route: /retention/gift-cards/:gift_card_id/transfer` |
| [SAL-0136](https://help.salonist.io/en/articles/9158234-how-to-hide-specific-staff-for-an-online-booking) How to hide specific staff for an online booking? | booking, online, staff | `route: /staff-self/online-booking-requests/:id/decision`<br>`route: /smart-booking/online-request`<br>`route: /booking-portal/v2/staff` |
| [SAL-0137](https://help.salonist.io/en/articles/9158245-how-to-add-logo-on-the-online-booking-page) How to add logo on the online booking page? | add, booking, online, page | `route: /smart-booking/online-request`<br>`route: /staff-self/online-booking-requests/:id/decision`<br>`route: /billing/invoices/:id/add-item` |
| [SAL-0141](https://help.salonist.io/en/articles/9158270-how-to-add-business-hours-on-an-online-booking-page) How to add business hours on an online booking page? | add, booking, business, hours | `route: /smart-booking/online-request`<br>`route: /staff-self/online-booking-requests/:id/decision`<br>`page: customer-app:features/business/business-profile.page` |
| [SAL-0144](https://help.salonist.io/en/articles/9158290-how-can-we-change-the-online-booking-setting) How can we change the Online Booking setting? | booking, change, online | `route: /smart-booking/online-request`<br>`route: /staff-self/online-booking-requests/:id/decision`<br>`route: /auth/change-password` |
| [SAL-0146](https://help.salonist.io/en/articles/9158325-what-is-quick-sale) What is Quick sale ? | sale | `route: /appointments/:id/convert-to-sale`<br>`route: /membership-enterprise/renewals/:source_sale_id`<br>`table: pos_sale_lines` |
| [SAL-0147](https://help.salonist.io/en/articles/9158342-how-to-edit-the-bill) How to edit the bill? | bill, edit | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /purchases/bill-drafts` |
| [SAL-0148](https://help.salonist.io/en/articles/9158348-how-to-choose-multiple-payment-methods-while-billing-in-pos) How to choose multiple payment methods while billing in POS? | billing, methods, payment, pos | `route: /pos/payment-methods`<br>`route: /customer/payment-methods`<br>`route: /settings/payment-methods` |
| [SAL-0150](https://help.salonist.io/en/articles/9158385-how-to-cancel-or-delete-invoice) How to cancel or Delete invoice? | cancel, delete, invoice | `route: /pos/invoice-delete-requests`<br>`route: /pos/invoice-delete-requests/:request_id/decision`<br>`test: frontend-angular:tests/pos-invoice-delete-approval-wiring.test.mjs` |
| [SAL-0151](https://help.salonist.io/en/articles/9158524-how-to-check-the-upcoming-clients-birthday-and-anniversary) How to check the upcoming Clients Birthday and Anniversary ? | anniversary, birthday, check, clients | `route: /birthday-anniversary/audit-logs`<br>`route: /birthday-anniversary/auto-send`<br>`route: /birthday-anniversary/drafts` |
| [SAL-0154](https://help.salonist.io/en/articles/9158582-how-to-create-and-assign-membership) How to create and assign membership? | assign, create, membership | `route: /appointments/:id/create-touchup`<br>`route: /booking-payments/payment-link/create`<br>`route: /fitness/lockers/:id/assign` |
| [SAL-0155](https://help.salonist.io/en/articles/9158705-how-to-redeem-e-wallet-membership) How to redeem E-wallet membership? | membership, redeem, wallet | `route: /membership-enterprise/reports/redeem`<br>`route: /membership-enterprise/client/:client_id/wallet`<br>`route: /birthday-anniversary/vouchers/:id/redeem` |
| [SAL-0156](https://help.salonist.io/en/articles/9158720-how-to-redeem-the-coupon) How to redeem the coupon? | coupon, redeem | `route: /birthday-anniversary/vouchers/:id/redeem`<br>`route: /clients/:id/win-back-offers/:offer_id/redeem`<br>`route: /customer/gift-cards/redeem` |
| [SAL-0159](https://help.salonist.io/en/articles/9182534-how-can-i-edit-the-appointment) How can I edit the Appointment ? | appointment, edit | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /appointment-activity` |
| [SAL-0161](https://help.salonist.io/en/articles/9184266-how-to-edit-the-client-in-salonist) How to edit the client in Salonist ? | client, edit | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /appointment-activity/clients/:client_id` |
| [SAL-0170](https://help.salonist.io/en/articles/9207860-how-to-run-email-campaigns) How to run Email Campaigns? | campaigns, email, run | `route: /notifications/sms-center/campaigns`<br>`route: /customer/auth/email/request-code`<br>`route: /customer/auth/email/verify` |
| [SAL-0171](https://help.salonist.io/en/articles/9207987-how-to-assign-products-to-the-staff) How to assign products to the staff ? | assign, products, staff | `route: /staff-enterprise/training/assign`<br>`route: /fitness/lockers/:id/assign`<br>`route: /customer/products/checkout` |
| [SAL-0178](https://help.salonist.io/en/articles/9245877-how-can-i-change-the-cover-image-on-the-app-s-home-page) How can I change the cover image on the APP's home page? | app, change, home, page | `page: customer-app:features/home/home.page`<br>`test: customer-app:tests/home-grid-consistency.test.mjs`<br>`route: /auth/change-password` |
| [SAL-0181](https://help.salonist.io/en/articles/9249858-how-can-staff-login) How can Staff login ? | login, staff | `route: /staff/:id/login`<br>`table: staff_login_invitations`<br>`page: staff-app:features/staff/staff-login.page` |

_23 more in the JSON report._

## Schema-only — finish it or drop the tables (12)

| Salonist capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [SAL-0001](https://help.salonist.io/en/articles/10161837-how-can-i-verify-which-client-has-made-a-huge-payment) How can I verify which client has made a huge payment? | client, payment, verify | `table: client_payment_instruments`<br>`route: /booking-portal/v2/otps/verify`<br>`route: /customer/auth/email/verify` |
| [SAL-0025](https://help.salonist.io/en/articles/10558295-how-pet-feature-works-in-salonist) How "Pet" feature works in Salonist? | feature | `table: tenant_feature_overrides` |
| [SAL-0046](https://help.salonist.io/en/articles/11798767-how-can-i-hide-client-feedback-from-the-marketplace) How can I hide client feedback from the marketplace? | client, feedback, marketplace | `table: client_recommendation_feedback`<br>`route: /ai/concierge/sessions/:id/feedback`<br>`route: /clients/:id/recommendation-feedback` |
| [SAL-0060](https://help.salonist.io/en/articles/9144089-how-to-add-breaks-for-staff) How to add breaks for staff? | add, breaks, staff | `table: staff_attendance_breaks`<br>`route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request` |
| [SAL-0076](https://help.salonist.io/en/articles/9147992-how-to-add-client-notes) How to add client notes? | add, client, notes | `table: client_notes`<br>`table: client_soap_notes`<br>`route: /billing/invoices/:id/add-item` |
| [SAL-0123](https://help.salonist.io/en/articles/9158069-how-to-do-sms-api-integration) How to do SMS API integration? | api, integration, sms | `table: integration_api_keys`<br>`route: /settings/integrations/api-keys`<br>`route: /settings/integrations/api-keys/:id` |
| [SAL-0130](https://help.salonist.io/en/articles/9158167-how-does-coupons-work-and-how-its-beneficial) How does coupons work and How its beneficial ? | coupons, work | `table: staff_work_task_pay_rates`<br>`route: /pos/coupons`<br>`route: /pos/coupons/analytics` |
| [SAL-0143](https://help.salonist.io/en/articles/9158283-how-can-i-set-booking-reminder-days-and-hours) How can I set booking reminder days and hours? | booking, days, hours | `table: micro_profit_rollup_dirty_days`<br>`table: staff_leave_request_days`<br>`route: /pos/happy-hours/anomalies` |
| [SAL-0152](https://help.salonist.io/en/articles/9158533-how-to-clear-due-amount-of-the-client) How to clear due amount of the client? | client, due | `table: pos_client_due_receipts`<br>`route: /membership-enterprise/auto-renew/process-due`<br>`route: /pos/invoice-outbox/process-due` |
| [SAL-0187](https://help.salonist.io/en/articles/9310320-how-can-i-add-new-product-purchase) How can I add new product purchase? | add, product, purchase | `table: historical_purchase_product_mappings`<br>`route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request` |
| [SAL-0239](https://help.salonist.io/en/articles/9514955-dashboard-updates) Dashboard Updates | dashboard, updates | `table: appointment_arrival_updates`<br>`route: /inventory/color-bowls/staff-shift-dashboard`<br>`route: /reports/dashboard` |
| [SAL-0290](https://salonist.io/features/inventory) Inventory Management Effortlessly manage your salon product stock with | inventory, management, product, stock | `table: inventory_product_lifecycle_events`<br>`page: frontend-angular:pages/staff/leave-management/staff-leave-management-page.component`<br>`test: frontend-angular:tests/staff-leave-management-wiring.test.mjs` |

## No match — likely genuine gaps (11)

| Salonist capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [SAL-0009](https://help.salonist.io/en/articles/10208718-what-is-the-difference-between-inactive-and-deleted-staffs) What is the difference between "Inactive" and "deleted" Staffs? |  | — |
| [SAL-0058](https://help.salonist.io/en/articles/9143993-how-can-i-keep-track-of-my-expenses-in-salonist) How can I keep track of my expenses in Salonist ? |  | — |
| [SAL-0119](https://help.salonist.io/en/articles/9158052-how-can-i-integrate-salonist-paypal) How can I integrate salonist paypal? |  | — |
| [SAL-0124](https://help.salonist.io/en/articles/9158076-how-to-integrate-salonist-with-woocommerce) How to integrate salonist with woocommerce ? |  | — |
| [SAL-0126](https://help.salonist.io/en/articles/9158082-how-to-integrate-authorize-net-with-my-salonist) How to integrate Authorize.Net with my salonist? |  | — |
| [SAL-0221](https://help.salonist.io/en/articles/9428174-how-do-i-integrate-twilio-with-salonist) How do I integrate Twilio with Salonist? |  | — |
| [SAL-0230](https://help.salonist.io/en/articles/9452316-how-to-integrate-salonist-with-interakt) How to integrate Salonist with Interakt ? |  | — |
| [SAL-0287](https://salonist.io/features/forms) Forms Create a Customize consent form as per your need by drag and dro | consent, create, form, forms | `table: client_consent_events`<br>`route: /appointments/:id/create-touchup`<br>`route: /booking-payments/payment-link/create` |
| [SAL-0294](https://salonist.io/features/online-store) Online Store Elevating your salon's online presence and boosting sales | feature, online, sales, store | `table: tenant_feature_overrides`<br>`route: /smart-booking/online-request`<br>`route: /staff-self/online-booking-requests/:id/decision` |
| [SAL-0296](https://salonist.io/features/point-sale) Point of Sale Transform the way you manage your salon with our Salon P | point, pos, sale | `table: pos_sale_lines`<br>`test: frontend-angular:tests/inventory-eight-point-completion.test.mjs`<br>`route: /appointments/:id/convert-to-sale` |
| [SAL-0297](https://salonist.io/features/reward-point) Reward / Loyalty System Increase Salon referral customers with Salonis | customers, referral, reward | `table: membership_reward_ledger`<br>`route: /retention/clients/:client_id/referral-code`<br>`route: /retention/referrals/:referral_id/complete` |
