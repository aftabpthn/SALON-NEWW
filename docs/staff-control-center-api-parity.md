# Staff Control Center — Frontend/Backend API Parity Matrix

## Current Status
- Scope: `frontend-angular/src/app/pages/staff/control-center/staff-control-center-page.component.ts`
- Goal: confirm every UI action maps to an existing backend route and expected payload shape.
- Result: **all mapped endpoints exist** and are wired through existing route handlers.
- Last verification command: `cargo check --bin aura-shine-backend` in `backend-rust` passes (no errors).

## Layout (Final Output Format)
- Top summary panel
  - Status: `PASS`
  - Fixed mismatches: `notes -> comments` for approval decision payload
  - Verification command result: `cargo check --bin aura-shine-backend` *(passes, unrelated warnings only)*
- Compact table grouped by workspace tab with columns:
  - `UI call`
  - `Backend route + handler`
  - `Service call + permission`
  - `Payload contract`

## Workspace Tab Matrix

### Command
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff-enterprise/command-center?periodStart&periodEnd` | `staff_enterprise::enterprise_command_center` (`src/routes/staff_enterprise.rs`) | `read` guard |
| `GET /staff-enterprise/floor-control?date=` | `staff_enterprise::floor_control` (`src/routes/staff_enterprise.rs`) | `read` guard |

### Workforce
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff/shift-swaps` | `staff_operations::list_shift_swaps` (`src/routes/staff_operations.rs`) | `ensure_staff_read` |
| `POST /staff/shift-swaps` | `staff_operations::create_shift_swap` | DTO `ShiftSwapRequest` (`scheduleId`, `toStaffId`, `reason`) |
| `POST /staff/shift-swaps/:id/decision` | `staff_operations::decide_shift_swap` | DTO `DecisionRequest` (`note`, `decision`, `version`) |
| `GET /staff/branch-transfers` | `staff_operations::list_branch_transfers` | `ensure_staff_manage` |
| `POST /staff/branch-transfers` | `staff_operations::create_branch_transfer` | DTO `BranchTransferRequest` |
| `POST /staff/branch-transfers/:id/decision` | `staff_operations::decide_branch_transfer` | DTO `DecisionRequest` |
| `GET /staff/roster/coverage?periodStart&periodEnd` | `staff_enterprise::roster_coverage` | `read` |
| `GET /staff/manpower/forecast?periodStart&periodEnd` | `staff_enterprise::manpower_forecast` | `read` |
| `GET /staff/intelligence/ai-analysis?periodStart&periodEnd` | `staff_enterprise::staff_ai_analysis` | `read` |
| `POST /staff/roster/optimize` | `staff_enterprise::optimize_roster` | `payroll` |
| `POST /staff/roster/drafts/:id/apply` | `staff_enterprise::apply_roster` | `payroll` |

### Development
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff-enterprise/skill-matrix` | `staff_enterprise::staff_skill_matrix` | `read` |
| `GET /staff/skill-licenses` | `staff_operations::list_skill_licenses` | `ensure_staff_read` |
| `POST /staff/skill-licenses` | `staff_operations::save_skill_license` | DTO `SkillLicenseRequest` |
| `GET /staff/performance-reviews` | `staff_operations::list_reviews` | `ensure_staff_read` |
| `POST /staff/performance-reviews` | `staff_operations::save_review` | DTO `PerformanceReviewRequest` |
| `GET /staff/coach/goals` | `staff_enterprise::list_coaching_goals` | `manager` |
| `GET /staff-enterprise/training` | `staff_enterprise::training_assignments` | `read` |
| `POST /staff-enterprise/training/assign` | `staff_enterprise::assign_training` | DTO `TrainingAssignmentRequest` |

### Systems
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff/biometric/devices` | `staff_advanced::list_biometric_devices` | `read` |
| `POST /staff/biometric/devices` | `staff_advanced::create_biometric_device` | DTO `BiometricDeviceRequest` |
| `GET /staff/biometric/gateways` | `staff_advanced::list_biometric_gateways` | `read` |
| `POST /staff/biometric/gateways` | `staff_advanced::register_biometric_gateway` | DTO `BiometricGatewayRequest` |
| `GET /staff/biometric/mappings` | `staff_advanced::list_biometric_mappings` | `read` |
| `POST /staff/biometric/mappings` | `staff_advanced::create_biometric_mapping` | DTO `BiometricMappingRequest` |
| `POST /staff/biometric/mappings/:id/approve` | `staff_advanced::approve_biometric_mapping` | `VersionRequest` style check |
| `GET /staff/biometric/consents` | `staff_advanced::list_biometric_consents` | `read` |
| `POST /staff/biometric/consents` | `staff_advanced::save_biometric_consent` | DTO `BiometricConsentRequest` |
| `POST /staff/biometric/consents/:id/deletion-request` | `staff_advanced::request_biometric_deletion` | `VersionRequest` |
| `GET /staff/biometric/exceptions` | `staff_advanced::list_biometric_exceptions` | `read` |
| `GET /staff/mobile/conflicts?status=open` | `staff_advanced::list_mobile_conflicts` | `read` |
| `GET /staff/mobile/dashboard` + `GET /staff-self/enterprise-os` | `staff_enterprise::staff_app_enterprise_os` and related methods | `mobile/read` |
| `GET /staff/self/dashboard?date=` | `staff_enterprise::self_dashboard` | `mobile/read`, optional 404 handled in UI |

### Governance
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff/approvals?status=pending` | `staff_enterprise::list_approvals` | `read` |
| `POST /staff/approvals/:id/decision` | `staff_enterprise::decide_approval` | DTO now accepts both `comments` and legacy `notes` |
| `GET /staff/audit?eventPrefix=staff.` | `staff_enterprise::list_audit` | `manager` |
| `GET /staff/notifications` | `staff_enterprise::list_notification_queue` | `manager` |
| `GET /staff/notification-delivery-logs` | `staff_enterprise::notification_logs` | `manager` |
| `GET /staff/tips/summary?periodStart&periodEnd` | `staff_enterprise::tip_summary` | `read` |
| `GET /staff/payroll-compliance/summary?periodStart&periodEnd` | `staff_enterprise::statutory_summary` | `payroll` |
| `POST /staff/payroll-compliance/calculate` | `staff_enterprise::calculate_statutory` | `payroll` |
| `POST /staff/payroll-compliance/export` | `staff_enterprise::compliance_export` | `payroll` |
| `POST /staff/tips/payouts` | `staff_enterprise::record_tip_payout` | `payroll` |
| `POST /staff/notification-templates` | `staff_enterprise::create_notification_template` | `manager` |
| `PUT /staff/:staffId/notification-preferences` | `staff_enterprise::save_notification_preference` | DTO `NotificationPreferenceRequest` |

### Content
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff/rules` | `staff_enterprise::list_staff_rules_center` | Version history, read/acknowledgement counts, and violations; governance read permission |
| `POST /staff/rules` | `staff_enterprise::create_staff_rule_document` | Creates a validated draft version for service, hygiene, attendance, behavior, or safety |
| `POST /staff/rules/:id/publish` / `unpublish` | `staff_enterprise` publish workflow | Optimistic version check; publication notifies linked active Staff App users |
| `POST /staff/rules/violations` / `:id/resolve` | `staff_enterprise` violation workflow | Tenant/branch/staff scoped and audit logged |
| `GET /staff/tasks` | `staff_advanced::list_tasks` | Loads current task records in the Content tab |
| `POST /staff/tasks` | `staff_advanced::create_task` | Creates a staff-visible task |
| `GET /marketing/offers` | `marketing_leads::list_marketing_offers` | Loads current offer records in the Content tab |
| `POST /marketing/offers` | `marketing_leads::create_marketing_offer` | Creates a CRM offer that staff app reads from `pos_coupons` |
| `GET /staff/payroll-adjustment-rules` | `staff_advanced::list_adjustment_rules` | Loads current fine / allowance / deduction rules in the Content tab |
| `POST /staff/payroll-adjustment-rules` | `staff_advanced::create_adjustment_rule` | Creates fine / allowance / deduction rules staff can see through payroll and attendance |

### Staff App Rules/SOP
| UI call | Backend route | Notes |
| --- | --- | --- |
| `GET /staff-self/rules` | `staff_enterprise::list_self_staff_rules` | Current effective published versions only; correct quiz answers are excluded |
| `POST /staff-self/rules/:id/read` | `staff_enterprise::mark_staff_rule_read` | Idempotent first/last-read tracking for the linked employee |
| `POST /staff-self/rules/:id/acknowledge` | `staff_enterprise::acknowledge_staff_rule` | Server-scored quiz; acknowledgement is recorded only after the configured pass score |

## Fixed Payload Mismatch
- UI sent `notes` for approval decision while backend expected `comments` (`DecisionRequest::comments`) in staff enterprise service.
- Fix applied:
  - `frontend-angular/src/app/pages/staff/control-center/staff-control-center-page.component.ts`
  - `backend-rust/src/services/staff_enterprise_service.rs`

## Notes / Follow-up
- `cargo check --bin aura-shine-backend` now passes after adding missing membership service wrappers in `backend-rust/src/services/membership_service.rs`.
- No new UI layout changes or component additions were needed for this parity pass because existing control-center screen already hosts all actions above.

## Automated Parity Smoke Checklist
- `cargo test --test staff_control_center_api_parity -- --nocapture` checks that required control-center endpoints still exist in the backend route table.
- File: `backend-rust/tests/staff_control_center_api_parity.rs`
- GitHub check: `Staff quality gate / staff-contracts` runs this parity test and the complete staff-app Vitest suite on pull requests and `main` pushes.
- CRM control-center content actions now cover task, offer, and penalty-rule creation without adding a new duplicate module.
- Current scope:
  - UI route coverage grouped by tab (`command`, `workforce`, `development`, `systems`, `governance`, `content`).
  - Endpoint presence for each required method (`GET`/`POST`/`PUT`/`PATCH`).
  - `DecisionRequest` compatibility check for alias support (`comments` + legacy `notes`).

## Changelog Note
- `2026-07-25` — Staff approval decision endpoint contract now accepts both `comments` and legacy `notes` payload keys.
  - Frontend continues to send `comments`.
  - Backend service now uses `#[serde(alias = "notes")]` on `DecisionRequest::comments` for backward-compatible clients.
