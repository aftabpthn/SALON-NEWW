# AuraSalon Brain

Use this file as the fast execution brain for AuraSalon Enterprise v1. Keep work scoped, production-ready, and backward compatible.

## Prime Directive
- Preserve existing behavior, data, APIs, routes, and UI workflows.
- Enhance with add-only or wrapper changes; avoid rewrites unless explicitly requested.
- Never modify protected backend files: `smart-booking.service.js`, `booking-portal.service.js`, `operations.routes.js`, `db.js`.
- Keep Angular + Express JS + SQLite `better-sqlite3` with ES modules only.
- Store money as integer paise. Never store rupee floats.

## Fast Workflow
1. Identify the exact file and dependency path needed for the task.
2. Read only those files. Do not scan the full repo unless the target is unknown.
3. Make the smallest complete change that preserves current behavior.
4. Verify only the changed surface: related test for backend, build/page check for UI.
5. Report only changed files, database impact, risks, and manual test steps.

## Token Rules
- Trust these invariants; do not rediscover them.
- Avoid repeated reads of large files.
- Prefer `rg` for search and exact path reads for context.
- Output diffs or concise summaries, not full unchanged files.
- Stop after 2-3 failed tool cycles and report the blocker with the next best action.

## Architecture Rules
- Backend entry: `server/app.js`.
- Backend repositories: `server/repositories/`.
- Frontend pages: `src/app/pages/`.
- Use named `better-sqlite3` parameters only.
- Every tenant-owned table needs `tenantId` and `branchId` in camelCase.
- Preserve JWT refresh tokens, realtime WebSocket behavior, and multi-tenancy headers:
  `x-tenant-id`, `x-branch-id`, `x-user-role`.
- Use IST business dates for salon operations.

## Enterprise Feature Rules
- Keep support for single location, multi-branch, franchise, white-label, mobile, and integrations.
- Major screens should support search, filtering, sorting, pagination, bulk actions, and export where relevant.
- Always consider RBAC, permission checks, audit logs, validation, auth protection, API authorization, and rate limits.
- Catalog changes must preserve links across services, memberships, products, inventory, POS, and online booking.

## Catalog Engine Guardrails
Maintain compatibility with:
- Categories, variants, add-ons, staff pricing, branch pricing, dynamic pricing.
- Membership benefits, inventory linkage, barcode support, tax rules, commission rules.
- Multi-branch sync and AI pricing recommendations.

## AI Guardrails
Preserve and extend:
- AI Upsell Engine, Campaign Writer, No-Show Prediction, Staff Scheduling.
- Revenue Forecasting, Retention Engine, VIP Intelligence, Business Insights, Chat Assistant.

## Database Change Protocol
Before any schema change:
1. Analyze impact and existing data.
2. Add a migration.
3. Preserve foreign keys and tenant isolation.
4. Avoid destructive migrations unless explicitly requested.

## Runtime Rules
- Check existing servers before starting:
  - Backend: `http://127.0.0.1:4000/health`
  - Frontend: `http://127.0.0.1:4300`
- Start only if down:
  - Backend: `npm run api`
  - Frontend: `npm run client`
- Do not restart running servers unless reload fails.
- Run `npm install` only when `package.json` changes.

## Output Contract
For every completed coding task, provide:
- Summary of changes
- Files affected
- Database impact
- Risks
- Implementation status
- Testing checklist

Keep the response short unless the task is high-risk or cross-module.
