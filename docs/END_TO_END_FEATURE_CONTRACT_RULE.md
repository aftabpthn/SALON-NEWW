# End-to-End Feature Contract and Dependency Rule

This rule applies to every new page, existing-page change, workflow, business logic, API, report, setting, and automation.

## 1. Mandatory Impact Analysis Before Implementation

Before editing code, inspect the existing implementation and present a concise Feature Contract containing:

- Feature purpose and user workflow.
- Existing components, services, routes, models, repositories, tables, and shared utilities that will be reused.
- Every applicable connected module and what data flows between them.
- UI field to API endpoint to backend handler/service/repository to PostgreSQL table mapping.
- Required buttons and actions, including their validation and resulting state.
- Tenant, branch, role, permission, and self-scope requirements.
- Applicable settings, business rules, notifications, audit history, exports, dashboards, and reports.
- Loading, empty, validation, permission-denied, conflict, offline, and API failure states.
- Clear acceptance criteria and the smallest useful verification.

Do not guess dependencies. Confirm them from current source code, database schema, API contracts, and active project documentation.

For genuinely new pages, follow the New Page Proposal and Visual Approval Rule before creating the route or page files. For existing pages or approved pages, continue implementation unless a genuine product decision is required.

## 2. Connected Module Rule

A feature is not complete merely because its UI renders.

Trace and implement every applicable connection end to end:

```text
Frontend page
-> shared models/services
-> authenticated API
-> Rust route
-> business service
-> repository
-> PostgreSQL
-> permissions and tenant/branch scope
-> related settings
-> reports/audit/notifications
-> frontend reload and visible saved result
```

Only add connections required by the real workflow. Do not create speculative features, duplicate flows, placeholder integrations, dead buttons, or fake data.

## 3. Action and Button Rule

Every visible action must be fully functional.

For every create, edit, save, assign, move, reschedule, cancel, delete, export, print, check-in, or status action:

- Define who can use it.
- Validate input on both frontend and backend.
- Persist through the existing real API/database path.
- Handle errors and conflicts clearly.
- Record audit/history when applicable.
- Reload affected API-backed data automatically.
- Update connected pages, counters, reports, or availability when applicable.
- Never leave a decorative or disconnected button in production UI.

Use safe domain behavior. For example, do not hard-delete records when existing business rules require cancellation, archival, reversal, or soft deletion.

## 4. Definition of Done

Before calling the task complete, provide a completion matrix with:

- Frontend UI and responsive behavior.
- Backend/API behavior.
- Database persistence and migration status.
- Connected modules and data flow.
- Permissions and tenant/branch isolation.
- Settings and business-rule integration.
- Reports, audit, notifications, print, or export integration where applicable.
- Loading, empty, validation, and error states.
- Automatic reload after actions.
- Exact verification performed and its result.
- Any item marked `PENDING` or `BLOCKED`, with the exact reason.

Do not say `complete`, `done`, or `production-ready` while any applicable layer is disconnected, mock-backed, unverified, or pending.

## Appointment Page Example

An appointment implementation must inspect and connect only the modules applicable to the current workflow:

```text
Appointments
|- Clients: customer identity, history, and contact
|- Services: duration, price, tax, and required resources
|- Staff: assignment, skill, and availability
|- Branch/Location: tenant and branch scope
|- Settings: booking rules, cancellation, timings, and conflicts
|- Packages/Memberships: eligibility, credit, and pricing
|- Payments/POS: checkout and invoice connection
|- Notifications: confirmation, reminder, and cancellation
|- Reports: booking, revenue, staff utilisation, and no-show
`- Actions: create, edit, move, reschedule, cancel, check-in, and checkout
```

This example is not permission to add every listed module automatically. Inspect the real code and workflow, then implement only the connections that are required and verified.
