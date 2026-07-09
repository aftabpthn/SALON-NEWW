# RBAC Role Permission Matrix

Fixed system roles are enforced from `server/middleware/rbac.js`. They are capped in backend code and cannot be expanded by persisted `security_permissions` rows.

Custom roles are resolved from `role_definitions` and `security_permissions` and are the supported way to create owner-specific access profiles.

| Role | Type | Effective Access |
| --- | --- | --- |
| `owner` | System full control | `*` all resources/actions |
| `admin` | System full control | `*` all resources/actions |
| `superAdmin` | System full control | `*` all resources/actions |
| `manager` | Fixed system | Read dashboard, appointments, clients, services, products, inventory, sales, invoices, payments, staff, reports. Write clients, appointments, services, products, inventory, sales, invoices, payments, appointment deposits, staff. |
| `receptionist` | Fixed system | Read dashboard, appointments, clients, services, products, sales, invoices, payments, smart booking, booking portal. Write clients, appointments, sales, invoices, payments, appointment deposits, smart booking, booking portal. |
| `frontDesk` | Fixed system | Same as `receptionist`. |
| `cashier` | Fixed system | Read dashboard, clients, services, products, sales, invoices, payments, appointment deposits. Write clients, sales, invoices, payments, appointment deposits. |
| `accountant` | Fixed system | Read dashboard, finance, invoices, payments, appointment deposits, reports, analytics. Write finance, invoices, payments. |
| `inventoryManager` | Fixed system | Read dashboard, products, inventory, inventory intelligence, suppliers. Write products, inventory, inventory intelligence, suppliers. |
| `marketingLead` | System marketing | Read/write marketing, campaigns, leads, coupons, WhatsApp, notifications, reputation. Read dashboard, clients, reviews. |
| `staff` | Fixed system | Read appointments, clients, services, products. Write appointments. |
| `analyst` | System analytical | Broad read via `read:*`, analytics write, and selected AI/security/quality/deployment/finance/customer/workflow reads. |
| `customMarketingLead` | Custom role | Default seeded custom marketing role; editable through role definitions/security permissions. |

## Rules

- Fixed system roles: owner/admin/superAdmin are full-control; capped operational system roles ignore DB permission expansion.
- Custom roles: use these for tenant-specific access changes.
- Frontend: sidebar, app launcher, dashboard shortcuts, and direct authenticated routes are permission-filtered.
- Backend: protected APIs are default-deny when auth/access context is missing or permission checks fail.
- Public/token routes remain explicitly limited to booking/public/self-service token flows.
