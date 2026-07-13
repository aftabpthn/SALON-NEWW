# API Role-Gating Matrix (Current Rust Backend)

## 1) Public/Unauthenticated Routes

These routes must remain callable without auth middleware:

- `GET /health`
- `GET /`
- `/api` and `/api/v1` root health fallbacks routed by `routes::mod`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me` (token validated in handler, not middleware)
- `booking portal` and `booking extensions` public endpoints:
  - `GET /api/v1/booking-profile/:tenant_slug`
  - `GET /api/v1/booking-profile/:tenant_slug/:branch_slug`
  - `GET /api/v1/public-booking/:token/details`
  - `POST /api/v1/public-booking/:token/cancel`
  - `POST /api/v1/public-booking/:token/reschedule/options`
  - `POST /api/v1/public-booking/:token/reschedule/confirm`
  - `POST /api/v1/booking-portal/context`
  - `POST /api/v1/booking-portal/slots`
  - `POST /api/v1/booking-portal/confirm`
  - `PATCH /api/v1/booking-portal/appointments/:id/cancel`
  - `PATCH /api/v1/booking-portal/appointments/:id/reschedule`
  - `GET /api/v1/booking-portal/v2/public/:tenant_slug`
  - `POST /api/v1/booking-portal/v2/sessions`
  - `POST /api/v1/booking-portal/v2/sessions/:id/events`
  - `GET /api/v1/booking-portal/v2/services`
  - `GET /api/v1/booking-portal/v2/staff`
  - `POST /api/v1/booking-portal/v2/slots`
  - `POST /api/v1/booking-portal/v2/holds`
  - `POST /api/v1/booking-portal/v2/otps/send`
  - `POST /api/v1/booking-portal/v2/otps/verify`
  - `POST /api/v1/booking-portal/v2/multi-service/timeline`
  - `POST /api/v1/booking-portal/v2/multi-service/confirm`
  - `POST /api/v1/booking-portal/v2/confirm`
  - `GET /api/v1/booking-portal/v2/my-bookings`
  - `GET /api/v1/booking-portal/v2/sessions`
  - `GET /api/v1/booking-portal/v2/abandonments`

## 2) Authenticated Tenant Routes (Default)

All protected routes are on `/api` and `/api/v1` under `protected_api` and pass:

1. `require_auth`
2. `require_tenant_id`
3. `require_route_role`

If role is not matched: `403`.

### Tenant users (baseline roles)
- `owner`
- `admin`
- `manager`
- `analyst`
- `accountant`
- `receptionist` (`frontDesk`, `front-desk`, `front_desk`, `frontdesk`)
- `staff`
- `inventory manager` (`inventory_manager`, `inventoryManager`)
- Platform admins are not tenant users. `superadmin` / `superAdmin` / `super-admin` must authenticate inside the `platform` tenant and are accepted only on platform-only routes.

### Management write roles
- `owner`, `admin`, `manager`

### Front-desk write roles
- `owner`, `admin`, `manager`, `receptionist` (`frontDesk`, `front-desk`, `front_desk`, `frontdesk`)

### Inventory write roles
- `owner`, `admin`, `manager`, `inventory manager` (`inventory_manager`, `inventoryManager`)

### Finance write roles
- `owner`, `admin`, `manager`, `accountant`

### Report read roles
- `owner`, `admin`, `manager`, `analyst`, `accountant`

### Platform roles
- `superadmin`, `superAdmin`, `super-admin` with `tenant_id=platform`

## 3) Prefix Matrix (runtime gate from middleware)

### Platform-only (`require_platform_admin`)

Any HTTP method for methods in middleware:
- `/platform/*`
- `/super-admin/*`

### Management write (`require_management`)

Methods: `POST | PUT | PATCH | DELETE`

- `/availability`
- `/billing`
- `/blackouts`
- `/services`
- `/staff`
- `/settings/payment-methods`
- `/memberships`
- `/packages`
- `/jobs`
- `/calendar/tokens`
- `/appointment-deposits`

### Front-desk write (`require_role(front-desk write roles)`)

Methods: `POST | PUT | PATCH | DELETE`

- `/appointment-activity`
- `/appointment-sms`
- `/appointments`
- `/booking-groups`
- `/booking-wizard`
- `/clients`
- `/notifications`
- `/pos`
- `/sales`
- `/smart-booking`

POS lifecycle hardening:
- `DELETE /pos/sales/:id` no longer hard-deletes invoices. It soft-cancels only unpaid draft/open invoices and writes an actor-scoped invoice event.
- `POST /pos|billing/invoices/:id/void`, `/refund`, and `/credit-note` require a non-empty reason and persist authenticated `actor_user_id` in lifecycle and invoice-event audit rows.

### Inventory write (`require_role(inventory write roles)`)

Methods: `POST | PUT | PATCH | DELETE`

- `/inventory`

### Finance write (`require_role(finance write roles)`)

Methods: `POST | PUT | PATCH | DELETE`

- `/reports`
- `/wallets`

### Tenant-user default (`require_tenant_user`)

Everything else under protected routes that is not platform-only and not management-write:
- `GET /appointments`, `/appointments/:id`
- `GET /smart-booking/summary`
- `POST /smart-booking/recommend-slots` (currently in tenant-user flow)
- `POST /smart-booking/bookings`
- `POST /smart-booking/waitlist`
- `POST /smart-booking/online-request`
- `POST /smart-booking/qr-check-in`
- `GET /availability`
- `GET /pos/*`
- `GET /notifications/*`
- `/appointment-activity/*`
- and remaining non-mutating dashboard/report-lite endpoints

Unknown protected mutations now fail closed with `403 no permission mapping for this mutation`.

## 4) Tenant/Branch Isolation Runtime Checks

`require_tenant_id` currently:
- enforces `x-tenant-id` required for protected routes
- verifies token `tenant_id` == header `x-tenant-id`
- now also verifies `x-branch-id` (if both token branch and header branch exist) must match
- allows query/path-scoped branch override only where handlers explicitly use scoped helpers
- re-loads non-management branch assignment from the active user record and rejects mismatched branch headers/tokens
- allows platform-admin branchless context only when the authenticated tenant is `platform`

## 5) Public Booking Runtime Checks

- Booking v2 services and staff endpoints read active records from PostgreSQL; they no longer fabricate placeholder service/staff rows.
- Legacy `/booking-profile` and `/booking-portal/context` surfaces also read tenant, branch, service and staff records from PostgreSQL instead of fabricating IDs or empty arrays.
- Booking v2 slot recommendations require real active services and staff, then filter candidate times against existing appointment overlaps.
- Booking v2 holds are persisted in Redis for 5 minutes and include tenant, branch, service ids, start/end time, and optional mobile.
- Booking v2 confirm requires a valid public booking token, verified OTP mobile, and a non-expired hold for the same tenant/branch/mobile before creating an appointment.
- Multi-service confirm also requires a verified OTP mobile in the submitted service payload.

## 6) Recommended Hardening follow-up (after current merge)

The following sensitive routes are now visible as **potentially under-gated** because middleware is path-prefix-based:

- `POST /smart-booking/bookings`, `POST /smart-booking/waitlist`, `POST /smart-booking/online-request`, `POST /smart-booking/qr-check-in` should be reviewed against desired receptionist permissions.
- `/smart-booking/*` protected write routes should be reviewed against desired receptionist permissions.
- Route-specific named permissions should replace role bundles as the permission table matures.

## 7) Runtime verification commands (after latest binary/container)

```bash
# 1) build + run local backend first
# docker compose -f docker-compose.yml up -d --build api

# 2) health
curl -i http://127.0.0.1:8082/health

# 3) unauthenticated denied (except public routes)
curl -i http://127.0.0.1:8082/api/v1/clients

# 4) tenant isolation
curl -i -H "Authorization: Bearer <token_owner_tenant_1>" \
     -H "x-tenant-id: tenant-99" \
     -H "x-branch-id: branch-1" \
     http://127.0.0.1:8082/api/v1/clients

# 5) branch isolation
curl -i -H "Authorization: Bearer <token_owner_tenant_1>" \
     -H "x-tenant-id: tenant-1" \
     -H "x-branch-id: branch-99" \
     http://127.0.0.1:8082/api/v1/clients

# 6) sensitive role checks
curl -i -H "Authorization: Bearer <token_staff>" \
     -H "x-tenant-id: tenant-1" \
     -H "x-branch-id: branch-1" \
     -X POST http://127.0.0.1:8082/api/v1/appointments
```
