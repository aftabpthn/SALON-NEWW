# DINGG parity triage

Generated 2026-08-06T14:24:17.694Z from `docs/evidence/dingg-master-parity-register.json`.

**This file decides nothing.** Every row below is still `Unmapped`. The register
marks a capability Complete only when a person records the real UI, API route and
test behind it, and that rule does not change here. What this adds is a starting
point: the register said 217 rows were equally unknown, and they are not.

AuraShine surface searched: 1545 mounted route literals, 241 backend modules, 123 frontend pages/components, 592 database tables, 135 focused frontend tests.

| Band | Rows | What it means |
|---|---:|---|
| High | 93 | A route or screen carries the capability's most distinctive term. Very likely already built — verify and map. |
| Medium | 108 | Partial agreement across surfaces. Probably adjacent to something that exists. |
| Schema-only | 1 | Tables match but no route, module or screen does. Review for an incomplete flow or obsolete schema. |
| Low | 10 | One weak signal. Treat as unknown. |
| None | 5 | Nothing in the codebase resembles it. Most likely a genuine gap. |

### How to read this

Work **High** first: it is the cheapest way to replace a misleading parity
number with a real one. **Schema-only** is the most actionable band — each row
is either a feature to finish or a migration to delete, and leaving it half-done
is what made the register look complete when it was not. **None** is the honest
roadmap input, but read it with judgement: it also contains DINGG-branded
things (their assistant, their payments status page) that are not gaps to close,
and specific hardware models that belong in a support matrix rather than a
feature backlog.

Matching is by name only, so it misses features that exist under different
wording. A shipped workflow can still land in Low when its route, table and
screen use another domain term. Absence of a match is a
prompt to look, not a verdict.

## High confidence — verify and map (93)

| DINGG capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [DIN-0001](https://dingg.app/features/beauty-salon-gift-cards) Gift Cards | cards, gift | `route: /customer/gift-cards`<br>`route: /customer/gift-cards/claim`<br>`route: /customer/gift-cards/redeem` |
| [DIN-0003](https://dingg.app/features/forms-and-surveys) Forms & Surveys | forms, surveys | `route: /staff-self/surveys`<br>`route: /staff-self/surveys/:id/responses`<br>`route: /staff/surveys` |
| [DIN-0004](https://dingg.app/features/salon-chain-management-software) Multi-Location Support | location, multi, support | `route: /staff/self/field-jobs/:id/location`<br>`table: field_job_location_events`<br>`table: inventory_location_batches` |
| [DIN-0006](https://dingg.app/features/salon-client-profile-software) Personalized Profiles | profiles | `route: /staff-payroll/statutory-profiles`<br>`route: /staff-payroll/statutory-profiles/:staff_id`<br>`table: client_clinical_profiles` |
| [DIN-0008](https://dingg.app/features/salon-inventory-management-software) Inventory Control | control, inventory | `route: /inventory/floor-control`<br>`page: frontend-angular:pages/inventory/backbar-containers/backbar-container-control-page.component`<br>`route: /platform/saas/tenants/:id/control-plane` |
| [DIN-0010](https://dingg.app/features/salon-loyalty-program) Loyalty Rewards | rewards | `route: /customer/rewards`<br>`route: /customer/rewards/redeem`<br>`route: /membership-enterprise/rewards/abuse-alerts` |
| [DIN-0013](https://dingg.app/features/salon-online-booking-system) 24/7 Online Booking | booking, online | `route: /smart-booking/online-request`<br>`route: /staff-self/online-booking-requests/:id/decision`<br>`route: /booking-analytics/abandonments` |
| [DIN-0015](https://dingg.app/features/salon-scheduling-software) Smart Scheduling | smart | `route: /smart-booking/bookings`<br>`route: /smart-booking/online-request`<br>`route: /smart-booking/qr-check-in` |
| [DIN-0016](https://dingg.app/features/salon-staff-management-software) Staff Management | management, staff | `page: frontend-angular:pages/staff/leave-management/staff-leave-management-page.component`<br>`test: frontend-angular:tests/staff-leave-management-wiring.test.mjs`<br>`route: /auth/staff-invitations/:token` |
| [DIN-0019](https://docs.dingg.app/Booking/Booking/How_to_book_appointment) How to book appointment | appointment, book | `route: /staff-self/appointment-book`<br>`route: /staff-self/appointment-book/clients/:id/eligibility`<br>`route: /staff-self/appointment-book/quote` |
| [DIN-0020](https://docs.dingg.app/Clients/Clients/How_to_add_and_manage_client's_family_members_) How to add and manage client's family members  | add, client, family, members | `route: /clients/:id/family-members`<br>`route: /customers/:id/family-members`<br>`table: membership_family_members` |
| [DIN-0021](https://docs.dingg.app/Clients/Clients/How_to_add_new_client) How to add new client | add, client | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [DIN-0024](https://docs.dingg.app/Clients/Clients/How_to_create_new_forms_for_clients_and_manange_it) How to create new forms for clients and manange it | clients, create, forms | `route: /clients/:id/forms/:definition_id/kiosk-token`<br>`route: /clients/forms/definitions`<br>`route: /appointments/:id/create-touchup` |
| [DIN-0025](https://docs.dingg.app/Clients/Clients/How_to_editdelete_the_client_) How to edit/delete the client  | client, delete, edit | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /pos/invoice-delete-requests` |
| [DIN-0026](https://docs.dingg.app/Clients/Clients/How_to_import_client_data) How to import client data | client, data, import | `route: /inventory/master-data`<br>`route: /inventory/master-data/values`<br>`route: /security/data-governance` |
| [DIN-0027](https://docs.dingg.app/Clients/Clients/How_to_view_and_manage_client's_forms) How to view and manage client's forms | client, forms, view | `route: /public/client-forms/:definition_id`<br>`route: /public/client-forms/:definition_id/submissions`<br>`route: /clients/return-tracker/:view` |
| [DIN-0028](https://docs.dingg.app/Clients/Clients/How_to_view_and_manage_client's_notes) How to view and manage client's notes | client, notes, view | `table: client_notes`<br>`table: client_soap_notes`<br>`route: /clients/return-tracker/:view` |
| [DIN-0029](https://docs.dingg.app/Clients/Clients/How_to_view_client's_history) How to view client's history | client, history, view | `route: /appointment-history/client/:client_id`<br>`table: client_merge_history`<br>`table: client_segment_history` |
| [DIN-0030](https://docs.dingg.app/Clients/Clients/How_to_view_client's_invoices_and_it's_details) How to view client's invoices and it's details | client, details, invoices, view | `route: /clients/return-tracker/:view`<br>`route: /public-booking/:token/details`<br>`route: /staff-attendance/:staff_id/details` |
| [DIN-0031](https://docs.dingg.app/Clients/Clients/How_to_view_client's_memberships_and_it's_details) How to view client's memberships and it's details | client, details, memberships, view | `table: client_memberships`<br>`route: /clients/return-tracker/:view`<br>`route: /public-booking/:token/details` |
| [DIN-0033](https://docs.dingg.app/Clients/Clients/How_to_view_client's_points_and_it's_history) How to view client's points and it's history | client, history, view | `route: /appointment-history/client/:client_id`<br>`table: client_merge_history`<br>`table: client_segment_history` |
| [DIN-0041](https://docs.dingg.app/Dashboard/Booking_Events/How_to_check_in_customer) How to check in customer | check, customer | `route: /customer/bookings/:id/check-in`<br>`route: /appointments/:id/check-in`<br>`route: /fitness/kiosk/check-in` |
| [DIN-0042](https://docs.dingg.app/Dashboard/Booking_Events/How_to_confirm_the_tentative_booking) How to confirm the tentative booking | booking, confirm | `route: /booking-groups/:id/confirm`<br>`route: /booking-portal/confirm`<br>`route: /booking-portal/v2/confirm` |
| [DIN-0043](https://docs.dingg.app/Dashboard/Booking_Events/How_to_view_notifications) How to view notifications | notifications, view | `route: /clients/return-tracker/:view`<br>`route: /customer/notifications`<br>`route: /customer/notifications/push-proof` |
| [DIN-0045](https://docs.dingg.app/Dashboard/Booking_Events/Start_&_complete_service) Start & complete service | complete, service, start | `route: /appointments/:id/start-service`<br>`route: /auth/sso/:provider/start`<br>`route: /pos/terminals/:id/sessions/start` |
| [DIN-0046](https://docs.dingg.app/Dashboard/Booking_Events/What_all_booking_status_are_available_and_how_to_change_it) What all booking status are available and how to change it | booking, change, status | `route: /booking-payments/:appointment_id/status`<br>`route: /auth/change-password`<br>`route: /membership-enterprise/active/:id/change-plan` |
| [DIN-0050](https://docs.dingg.app/Dashboard/Calendar/How_to_assign_appointment_to_other_staff) How to assign appointment to other staff | appointment, assign, staff | `route: /staff-enterprise/training/assign`<br>`route: /fitness/lockers/:id/assign`<br>`route: /staff-scribe/appointments/:appointment_id/sessions` |
| [DIN-0051](https://docs.dingg.app/Dashboard/Calendar/How_to_change_color_of_service_status) How to change color of service status | change, color, service, status | `route: /inventory/color-bowls/service-margins`<br>`route: /membership-enterprise/client/:client_id/self-service/status-link`<br>`route: /auth/change-password` |
| [DIN-0055](https://docs.dingg.app/Dashboard/Calendar/How_to_filter_appointments_by_service_status) How to filter appointments by service status | appointments, service, status | `route: /appointment-lifecycle/appointments/:id/status`<br>`route: /appointments/:id/status`<br>`route: /staff-self/appointments/:id/status` |
| [DIN-0064](https://docs.dingg.app/Dashboard/Expense/How_to_add_expenses) How to add expenses | add | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [DIN-0065](https://docs.dingg.app/Dashboard/Expense/How_to_edit_the_expenses) How to edit the expenses | edit | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs` |
| [DIN-0066](https://docs.dingg.app/Dashboard/Home/How_to_change_locationbranch) How to change location/branch | branch, change, location | `route: /auth/change-password`<br>`route: /membership-enterprise/active/:id/change-plan`<br>`route: /saas/subscriptions/:id/change-plan` |
| [DIN-0068](https://docs.dingg.app/Dashboard/Home/How_to_logout_of_the_software) How to logout of the software | logout | `route: /auth/logout`<br>`route: /customer/auth/logout` |
| [DIN-0070](https://docs.dingg.app/Dashboard/Home/View_Profile) View Profile | profile, view | `route: /clients/return-tracker/:view`<br>`route: /booking-profile/:tenant_slug`<br>`route: /booking-profile/:tenant_slug/:branch_slug` |
| [DIN-0071](https://docs.dingg.app/Dashboard/Home/View_Subscription) View Subscription | subscription, view | `route: /clients/return-tracker/:view`<br>`route: /staff/mobile/devices/:id/push-subscription`<br>`page: frontend-angular:layout/subscription-banner.component` |
| [DIN-0072](https://docs.dingg.app/Dashboard/Language/How_to_change_the_language) How to change the language | change, language | `route: /auth/change-password`<br>`route: /membership-enterprise/active/:id/change-plan`<br>`route: /saas/subscriptions/:id/change-plan` |
| [DIN-0074](https://docs.dingg.app/Dashboard/LoginLogout/How_to_reset_the_password?) How to reset the password? | password, reset | `route: /public/kiosk/reset`<br>`route: /auth/change-password`<br>`route: /staff/:id/password` |
| [DIN-0075](https://docs.dingg.app/Dashboard/Stats/How_to_fetch_today's_report) How to fetch today's report | report, today | `route: /staff/mobile/today`<br>`route: /ai/concierge/calls/report`<br>`route: /appointment-deposits/report` |
| [DIN-0079](https://docs.dingg.app/Enquiry/Enquiry/How_to_add_enquiry) How to add enquiry | add | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [DIN-0082](https://docs.dingg.app/Enquiry/Followups/How_to_follow_up_an_enquiry) How to follow up an enquiry | follow | `route: /reports/invoices/:id/follow-ups` |
| [DIN-0083](https://docs.dingg.app/Inventory/Auto_Consumption/Add_auto_consumption_for_a_service) Add auto consumption for a service | add, auto, consumption, service | `module: services/membership_auto_renew_service`<br>`route: /billing/invoices/:id/add-item`<br>`route: /pos/invoices/:id/consumption` |
| [DIN-0091](https://docs.dingg.app/Inventory/Orders/How_to_receive_the_order) How to receive the order | order, receive | `route: /inventory/transfers/:id/shipments/:shipment_id/receive`<br>`test: frontend-angular:tests/purchase-order-register.test.mjs`<br>`table: purchase_order_events` |
| [DIN-0093](https://docs.dingg.app/Inventory/Product/Export_your_inventory) Export your inventory | export, inventory | `route: /clients/:id/report/export`<br>`route: /clients/bulk/export`<br>`route: /clients/reports/:report_type/export` |
| [DIN-0094](https://docs.dingg.app/Inventory/Product/How_to_add_a_new_product) How to add a new product | add, product | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [DIN-0095](https://docs.dingg.app/Inventory/Product/How_to_delete_the_product) How to delete the product | delete, product | `route: /purchases/bill-drafts/:id/lines/:line_id/product`<br>`route: /staff-self/business/product-usage`<br>`table: historical_purchase_product_mappings` |
| [DIN-0096](https://docs.dingg.app/Inventory/Product/How_to_edit_the_product) How to edit the product | edit, product | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /purchases/bill-drafts/:id/lines/:line_id/product` |
| [DIN-0097](https://docs.dingg.app/Inventory/Product/How_to_import_inventory) How to import inventory | import, inventory | `route: /inventory/stock-audits/:id/counts/import`<br>`route: /clients/bulk/import`<br>`route: /pos/provider-reconciliations/import` |
| [DIN-0104](https://docs.dingg.app/Inventory/Stock_Adjustment/How_to_adjust_the_stock) How to adjust the stock | stock | `route: /inventory/negative-stock-requests`<br>`route: /inventory/negative-stock-requests/:id/review`<br>`route: /inventory/stock-audits` |
| [DIN-0105](https://docs.dingg.app/Inventory/Supplier/How_to_add_Supplier) How to add Supplier | add, supplier | `route: /billing/invoices/:id/add-item`<br>`route: /public/kiosk/add-on-request`<br>`test: frontend-angular:tests/availability-add-shift-drawer.test.mjs` |
| [DIN-0106](https://docs.dingg.app/Inventory/Supplier/How_to_edit_or_delete_Supplier) How to edit or delete Supplier | delete, edit, supplier | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /pos/invoice-delete-requests` |
| [DIN-0107](https://docs.dingg.app/Inventory/Supplier/How_to_mark_supplier_as_%22Active%22) How to mark supplier as "Active" | active, mark, supplier | `route: /staff-payroll/runs/:run_id/mark-paid`<br>`route: /membership-enterprise/active`<br>`route: /membership-enterprise/active/:id/auto-renew` |
| [DIN-0109](https://docs.dingg.app/Invoice/Invoice/How_to_add_or_remove_services_in_the_invoice) How to add or remove services in the invoice | add, invoice, remove, services | `route: /appointments/:id/remove-service`<br>`module: services/invoice_delivery`<br>`module: services/invoice_numbering_service` |
| [DIN-0111](https://docs.dingg.app/Invoice/Invoice/How_to_apply_Coupon) How to apply Coupon | apply, coupon | `route: /pos/happy-hours/auto-sunset/decisions/:id/apply`<br>`route: /staff/roster/drafts/:id/apply`<br>`route: /pos/happy-hours/coupon-abuse/alerts` |
| [DIN-0112](https://docs.dingg.app/Invoice/Invoice/How_to_apply_discount_in_invoice) How to apply discount in invoice | apply, discount, invoice | `route: /pos/happy-hours/auto-sunset/decisions/:id/apply`<br>`route: /staff/roster/drafts/:id/apply`<br>`route: /clients/:id/discount-decisions` |
| [DIN-0113](https://docs.dingg.app/Invoice/Invoice/How_to_cancel_the_invoice) How to cancel the invoice | cancel, invoice | `route: /ai/actions/drafts/:id/cancel`<br>`route: /appointments/:id/cancel`<br>`route: /birthday-anniversary/reminders/:id/cancel` |
| [DIN-0118](https://docs.dingg.app/Invoice/Invoice/How_to_edit_the_invoice) How to edit the invoice | edit, invoice | `page: customer-app:features/profile/profile-edit.page`<br>`test: frontend-angular:tests/staff-edit-layout-tabs-wiring.test.mjs`<br>`route: /invoice-notifications/contact-verifications/request` |
| [DIN-0124](https://docs.dingg.app/Invoice/Invoice/How_to_redeem_package) How to redeem package | package, redeem | `route: /birthday-anniversary/vouchers/:id/redeem`<br>`route: /clients/:id/win-back-offers/:offer_id/redeem`<br>`route: /customer/gift-cards/redeem` |
| [DIN-0125](https://docs.dingg.app/Invoice/Invoice/How_to_redeem_points) How to redeem points | redeem | `route: /birthday-anniversary/vouchers/:id/redeem`<br>`route: /clients/:id/win-back-offers/:offer_id/redeem`<br>`route: /customer/gift-cards/redeem` |
| [DIN-0133](https://docs.dingg.app/Invoice/Previous_Invoice/How_to_download_or_print_the_invoice) How to download or print the invoice | download, invoice, print | `route: /reports/exports/:id/download`<br>`route: /security/pii-exports/:export_id/download`<br>`route: /billing/invoices/:id/print` |
| [DIN-0137](https://docs.dingg.app/Invoice/Previous_Invoice/How_to_view_payment_status_of_an_invoice) How to view payment status of an invoice | invoice, payment, status, view | `route: /pos/invoice-outbox/:id/delivery-status`<br>`route: /pos/payment-platform/providers/:provider/status`<br>`route: /clients/return-tracker/:view` |

_33 more in the JSON report._

## Schema-only — finish it or drop the tables (1)

| DINGG capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [DIN-0005](https://dingg.app/features/salon-client-feedback-system) Client Feedback | client, feedback | `table: client_recommendation_feedback`<br>`route: /ai/concierge/sessions/:id/feedback`<br>`route: /clients/:id/recommendation-feedback` |

## No match — likely genuine gaps (5)

| DINGG capability | Matched | Strongest AuraShine candidates |
|---|---|---|
| [DIN-0002](https://dingg.app/features/dingg-ai-salon-software) DINGG AI Genius |  | — |
| [DIN-0067](https://docs.dingg.app/Dashboard/Home/How_to_expand_or_collapse_the_navigation_side_bar) How to expand or collapse the navigation side bar |  | — |
| [DIN-0073](https://docs.dingg.app/Dashboard/LoginLogout/How_to_log_in_DINGG?) How to log in DINGG? |  | — |
| [DIN-0140](https://docs.dingg.app/Marketing/Loyalty/How_to_set_Loyalty) How to set Loyalty |  | — |
| [DIN-0194](https://docs.dingg.app/Settings/Online_Booking/How_to_get_URL_for_the_Facebook_and_Webstie_integration) How to get URL for the Facebook and Webstie integration | integration | `table: integration_api_keys`<br>`table: integration_connector_connections`<br>`table: integration_connector_sync_jobs` |
