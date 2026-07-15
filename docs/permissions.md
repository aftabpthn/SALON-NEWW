# Permission Catalog

The runtime catalog is defined in `backend-rust/src/services/auth_service.rs` and returned by `GET /api/v1/staff/auth-roles`. Custom roles can use only catalog entries; unknown or duplicate permissions are rejected.

| Domain | Read | Manage / elevated |
| --- | --- | --- |
| Appointments | `appointments.read` | `appointments.manage`, `appointments.settings.manage` |
| Bookings | `bookings.read` | `bookings.manage` |
| Clients | `clients.read`, `clients.audit.read` | `clients.manage`, `clients.consent.manage`, `clients.forms.manage`, `clients.merge`, `clients.reviews.link` |
| POS | `pos.read` | `pos.manage`, `pos.void`, `pos.refund` |
| Services | `services.read` | `services.manage` |
| Inventory and purchases | `inventory.read`, `purchases.read` | `inventory.manage`, `purchases.manage`, `purchases.approve` |
| Memberships | `memberships.read` | `memberships.manage` |
| Packages | `packages.read` | `packages.manage` |
| Staff | `staff.read`, `staff.attendance.read`, `staff.leave.read`, `staff.schedule.read`, `staff.payroll.read`, `staff.analytics.read` | `staff.manage`, `staff.attendance.manage`, `staff.leave.manage`, `staff.schedule.manage`, `staff.payroll.manage`, `staff.self_manage` |
| Finance and reports | `reports.read`, `finance.read` | `reports.export`, `finance.write` |
| Notifications | `notifications.read` | `notifications.manage` |
| Settings | `settings.read` | `settings.manage` |
| Security | `security.read` | `security.manage` |

Legacy permissions `tenant.read`, `front_desk.write`, `management.write`, `inventory.write`, and `staff_self.write` remain accepted for existing roles. New custom roles should use the domain permissions above.

Enforcement is centralized in `backend-rust/src/middleware/tenant.rs`. Built-in roles keep their existing access bundles; custom roles must carry an accepted named permission for the requested domain and action. Sensitive handlers add a second check where required. Unknown protected endpoints fail closed.

Role changes update `permissions_json`; the existing permission-version trigger invalidates affected sessions. The same custom role can then be assigned per branch through `user_branch_roles` without changing historical records.
