# Aura Salon CRM/POS PRD: Levels 17-22

## Goal

Extend Aura into a production-grade salon SaaS suite with documented product requirements, a reusable design system, a real automation workflow engine, serious finance operations, customer 360 intelligence, and a customer-facing online booking portal.

## User Roles

- Super admin: manages all salons, platform controls, tenant health, feature access, global analytics and SaaS plans.
- Owner: controls one tenant, finance, workflow automation, white-label settings, reports and staff payouts.
- Admin: manages daily operations, settings, workflow rules, online booking and customer intelligence.
- Manager: manages branch operations, staff, appointments, cash drawer, daily closing, expenses and local workflows.
- Front desk: creates appointments, handles check-in, POS billing, partial payments, refunds, customer notes and booking portal requests.
- Staff: views assigned appointments, client preferences, customer 360 highlights and personal payout status.
- Analyst: reads reports, customer 360, workflow performance and finance summaries.
- Customer: uses online booking portal to choose service, staff and slot, confirm booking, cancel or reschedule.

## User Journeys

- Owner creates an inactive-client workflow: chooses trigger, sets 30-day condition, selects WhatsApp offer action, activates workflow, then reviews runs and generated notifications.
- Front desk closes the day: opens cash drawer, records payments and expenses, adds cash counts, closes drawer, and reviews variance.
- Manager handles refund: selects invoice, records refund amount and reason, invoice balance/outstanding updates, audit-ready record persists.
- Staff opens customer 360 before visit: sees lifetime value, favorite service, average spend, risk score, preferred staff and next best action.
- Customer books online: selects branch, service, staff, slot, enters contact details, confirms booking, receives confirmation, can later cancel or reschedule.
- Admin updates design standards: uses system tokens and reusable UI patterns for consistent buttons, cards, tables, forms, empty states and errors.

## Page List

- `/prd`: Product requirements summary for roles, journeys, pages, data flow and success metrics.
- `/design-system`: Design system tokens, typography, buttons, cards, tables, forms, empty states, error states and mobile layout.
- `/workflows`: Workflow engine for triggers, conditions, delays and WhatsApp/SMS/Email actions.
- `/finance`: Finance engine for daily closing, cash drawer, expenses, profit/loss, staff payout, refunds, partial payments and outstanding balances.
- `/customer-360`: Customer intelligence dashboard and detail view.
- `/book`: Customer-facing online booking portal.

## Data Flow

- Angular pages call tenant-aware REST APIs through `ApiService`, passing tenant, branch and role headers.
- Route modules validate permissions and delegate business behavior to service classes.
- Services read/write SQLite through repositories and reuse existing POS, appointment, notification, staff, invoice and smart-booking logic.
- Workflow actions create persisted notifications and workflow run logs.
- Finance actions create persisted finance records and update invoice/payment state where relevant.
- Customer 360 calculates from persisted clients, sales, invoices, payments, memberships, appointments and timeline notes, then stores intelligence snapshots.
- Online booking portal uses real service/staff/slot selection and creates real appointment records through the smart booking engine.

## Business Rules

- Workflows must not send to clients outside tenant scope.
- Workflow delay is stored as a schedule decision; immediate demo execution only runs due actions.
- Finance daily closing must calculate from real payments, sales, refunds, expenses and staff payouts.
- Refund amount cannot exceed paid invoice amount.
- Partial payment creates a payment record and recalculates invoice status.
- Customer 360 risk score rises with inactivity, no-shows and low repeat behavior.
- Online booking cannot double-book the same staff or chair.
- Cancel/reschedule must update the original appointment, not create hidden duplicates.
- Every primary button must call a real API or be disabled with visible reason.

## Edge Cases

- No services, staff, clients or slots available.
- Client has no sales history or no prior visits.
- Invoice is fully unpaid, partially paid, fully paid or already refunded.
- Cash drawer already open for the branch.
- Workflow has no matching audience.
- Workflow condition is malformed or unsupported.
- Customer reschedules into a conflicting slot.
- Customer attempts to cancel an already completed appointment.
- Offline-created or externally created data appears in finance/customer calculations.

## Success Metrics

- Build passes with no Angular or Node errors.
- New API endpoints persist records in SQLite.
- Workflow example sends at least one queued notification when matching clients exist.
- Finance summary ties to saved payments, invoices, expenses, refunds and payout records.
- Customer 360 returns intelligence for every persisted client.
- Booking portal can confirm, cancel and reschedule a real appointment.
- Pages render without console errors and provide empty/error states.
