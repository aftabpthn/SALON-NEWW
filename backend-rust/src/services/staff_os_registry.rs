//! Advanced Staff OS capability map.
//!
//! Every Staff OS capability is delivered by extending one of the existing
//! staff router modules — there is no parallel staff module and no second
//! payroll surface. This registry records which module owns each capability
//! and the representative backend routes that deliver it, and the tests below
//! fail the build when:
//!
//! * a capability route stops being permission-mapped (it would fall through
//!   to the default deny and silently 403 in production),
//! * a capability is served from a module outside the known staff modules
//!   (i.e. somebody started a parallel duplicate module),
//! * two capabilities claim the same route (overlapping duplicate surfaces).

/// The staff router modules that may own capabilities. Adding a name here is
/// a deliberate architectural decision: prefer extending an existing module.
#[allow(dead_code)]
pub const STAFF_MODULES: &[&str] = &[
    "routes::staff",
    "routes::staff_advance",
    "routes::staff_advanced",
    "routes::staff_attendance",
    "routes::staff_enterprise",
    "routes::staff_leave",
    "routes::staff_operations",
    "routes::staff_payroll",
    "routes::staff_schedule",
];

#[allow(dead_code)]
pub struct StaffCapability {
    pub key: &'static str,
    pub label: &'static str,
    /// The existing module extended to deliver this capability.
    pub owner_module: &'static str,
    /// Representative `(METHOD, path)` routes. Verified to be permission-mapped.
    pub routes: &'static [(&'static str, &'static str)],
    /// Whether the Staff App (self-service) surfaces this capability.
    pub staff_app_surface: bool,
}

#[allow(dead_code)]
pub const STAFF_OS_CAPABILITIES: &[StaffCapability] = &[
    StaffCapability {
        key: "staff.master_and_documents",
        label: "Staff master and documents",
        owner_module: "routes::staff",
        routes: &[
            ("GET", "/staff"),
            ("POST", "/staff"),
            ("GET", "/staff/masters"),
            ("POST", "/staff/1/documents"),
            ("POST", "/staff/1/files"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.skills_and_service_assignments",
        label: "Skills and service assignments",
        owner_module: "routes::staff_operations",
        routes: &[
            ("GET", "/staff/skill-licenses"),
            ("POST", "/staff/skill-licenses"),
            ("PUT", "/staff/1/configuration"),
            ("GET", "/staff-enterprise/skill-matrix"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.shift_templates_and_schedules",
        label: "Shift templates and schedules",
        owner_module: "routes::staff_schedule",
        routes: &[
            ("GET", "/staff-schedule"),
            ("PUT", "/staff-schedule"),
            ("POST", "/staff-schedule/copy"),
            ("POST", "/staff/operations/templates"),
            ("POST", "/staff/operations/schedules"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.shift_swaps",
        label: "Shift swaps",
        owner_module: "routes::staff_operations",
        routes: &[
            ("GET", "/staff/shift-swaps"),
            ("POST", "/staff/shift-swaps"),
            ("POST", "/staff/shift-swaps/1/decision"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.attendance_and_overtime_approval",
        label: "Attendance and overtime approval",
        owner_module: "routes::staff_attendance",
        routes: &[
            ("GET", "/staff-attendance/summary"),
            ("POST", "/staff-attendance/clock-in"),
            ("POST", "/staff-attendance/clock-out"),
            ("GET", "/staff-attendance/overtime"),
            ("POST", "/staff-attendance/overtime/1/decision"),
            ("PATCH", "/staff-attendance/1/2026-07-01/correction"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.leave_policies_balances_approvals",
        label: "Leave policies, balances and approvals",
        owner_module: "routes::staff_leave",
        routes: &[
            ("GET", "/staff-leave/requests"),
            ("POST", "/staff-leave/requests"),
            ("GET", "/staff-leave/balances"),
            ("POST", "/staff-leave/requests/1/approve"),
            ("POST", "/staff-leave/requests/1/reject"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.branch_transfers",
        label: "Branch transfers",
        owner_module: "routes::staff_operations",
        routes: &[
            ("GET", "/staff/branch-transfers"),
            ("POST", "/staff/branch-transfers"),
            ("POST", "/staff/branch-transfers/1/decision"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.salary_structures_and_revisions",
        label: "Salary structures and revisions",
        owner_module: "routes::staff_enterprise",
        routes: &[
            ("GET", "/staff/payroll-structure"),
            ("POST", "/staff/payroll-structure"),
            ("GET", "/staff/salary-revisions"),
            ("POST", "/staff/salary-revisions"),
            ("POST", "/staff/salary-revisions/1/decision"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.salary_advance_ledger",
        label: "Salary advance ledger",
        owner_module: "routes::staff_advance",
        routes: &[
            ("GET", "/staff-advances"),
            ("POST", "/staff-advances"),
            ("POST", "/staff-advances/1/decision"),
            ("POST", "/staff-advances/1/disburse"),
            ("POST", "/staff-advances/1/waive"),
            ("GET", "/staff-advances/1/recoveries"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.payroll_lifecycle",
        label: "Payroll calculation, review, finalization and payment",
        owner_module: "routes::staff_payroll",
        routes: &[
            ("POST", "/staff-payroll/preview"),
            ("POST", "/staff-payroll/runs"),
            ("POST", "/staff-payroll/runs/1/review"),
            ("POST", "/staff-payroll/runs/1/finalize"),
            ("POST", "/staff-payroll/runs/1/mark-paid"),
            ("POST", "/staff-payroll/runs/1/payout"),
            ("POST", "/staff-payroll/periods/lock"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.commission_and_tips",
        label: "Commission and tips",
        owner_module: "routes::staff_payroll",
        routes: &[
            ("POST", "/staff-payroll/commissions/calculate"),
            ("GET", "/staff/tips"),
            ("GET", "/staff/tips/summary"),
            ("POST", "/staff/tips/payouts"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.targets_and_incentives",
        label: "Targets and incentives",
        owner_module: "routes::staff_advanced",
        routes: &[
            ("GET", "/staff/incentive-rules"),
            ("POST", "/staff/incentive-rules"),
            ("POST", "/staff/incentive-rules/1/copy"),
            ("GET", "/staff/self/targets"),
            ("GET", "/staff/mobile/targets"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.authorized_fines_and_deductions",
        label: "Authorized fines and deductions",
        owner_module: "routes::staff_advanced",
        routes: &[
            ("GET", "/staff/payroll-adjustment-rules"),
            ("POST", "/staff/payroll-adjustment-rules"),
            ("PATCH", "/staff/payroll-adjustment-rules/1"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.performance_history",
        label: "Performance history",
        owner_module: "routes::staff_advanced",
        routes: &[
            ("GET", "/staff/performance"),
            ("GET", "/staff/performance/1"),
            ("GET", "/staff/1/hr-history"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.manager_feedback",
        label: "Manager feedback",
        owner_module: "routes::staff_operations",
        routes: &[
            ("GET", "/staff/performance-reviews"),
            ("POST", "/staff/performance-reviews"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.tasks_and_learning",
        label: "Tasks and learning",
        owner_module: "routes::staff_advanced",
        routes: &[
            ("GET", "/staff/tasks"),
            ("POST", "/staff/tasks"),
            ("POST", "/staff/tasks/1/comments"),
            ("PATCH", "/staff/self/tasks/1/status"),
            ("GET", "/staff-enterprise/training"),
            ("POST", "/staff-enterprise/training/assign"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.replacement_recommendations",
        label: "Replacement recommendations",
        owner_module: "routes::staff_enterprise",
        routes: &[
            ("POST", "/staff/replacement/recommend"),
            ("POST", "/staff/replacement/1/decision"),
            ("GET", "/staff/replacement/history"),
            ("GET", "/staff/intelligence/replacement-suggestion"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.roster_optimization",
        label: "Roster optimization",
        owner_module: "routes::staff_enterprise",
        routes: &[
            ("POST", "/staff/roster/optimize"),
            ("GET", "/staff/roster/coverage"),
            ("GET", "/staff/roster/gaps"),
            ("POST", "/staff/roster/drafts/1/apply"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.manpower_forecasting",
        label: "Manpower forecasting",
        owner_module: "routes::staff_enterprise",
        routes: &[
            ("GET", "/staff/manpower/forecast"),
            ("POST", "/staff/manpower/recalculate"),
            ("GET", "/staff/manpower/hiring-recommendations"),
        ],
        staff_app_surface: false,
    },
    StaffCapability {
        key: "staff.notifications",
        label: "Staff notifications",
        owner_module: "routes::staff_enterprise",
        routes: &[
            ("GET", "/staff/notifications"),
            ("POST", "/staff/notifications"),
            ("POST", "/staff/notifications/1/retry"),
            ("GET", "/staff/notification-templates"),
            ("GET", "/staff/notification-delivery-logs"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.payslip_and_payroll_history",
        label: "Payslip and payroll history",
        owner_module: "routes::staff_payroll",
        routes: &[
            ("GET", "/staff-payroll/history"),
            ("GET", "/staff-payroll/history/export"),
            ("GET", "/staff-payroll/runs/1/payslips/2"),
            ("GET", "/staff/self/payslips/1"),
            ("GET", "/staff/mobile/payroll"),
        ],
        staff_app_surface: true,
    },
    StaffCapability {
        key: "staff.audit_and_corrections",
        label: "Audit and correction/reversal",
        owner_module: "routes::staff_payroll",
        routes: &[
            ("GET", "/staff/audit"),
            ("POST", "/staff-payroll/runs/1/corrections"),
            ("POST", "/staff-payroll/corrections/1/decision"),
            ("POST", "/staff-payroll/corrections/1/post"),
            ("POST", "/staff-payroll/corrections/1/cancel"),
        ],
        staff_app_surface: false,
    },
];

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use axum::http::Method;

    use super::*;
    use crate::middleware::tenant::{normalize_route_path, route_access};

    fn method(name: &str) -> Method {
        name.parse().expect("valid http method")
    }

    /// Every capability route must resolve to a permission mapping. A route
    /// that falls through `route_access` hits the default deny in
    /// `require_route_role` and 403s for every caller — which is how the
    /// unmapped `/staff-advances` ledger was found.
    #[test]
    fn every_capability_route_is_permission_mapped() {
        for capability in STAFF_OS_CAPABILITIES {
            for (route_method, route_path) in capability.routes {
                assert!(
                    route_access(normalize_route_path(route_path), &method(route_method)).is_some(),
                    "capability {} route {route_method} {route_path} has no permission mapping and would be denied for everyone",
                    capability.key
                );
            }
        }
    }

    /// Capabilities are delivered by extending the known staff modules; a new
    /// owner module name means a parallel staff surface was started.
    #[test]
    fn capabilities_extend_existing_modules_only() {
        for capability in STAFF_OS_CAPABILITIES {
            assert!(
                STAFF_MODULES.contains(&capability.owner_module),
                "capability {} is owned by {}, which is not an existing staff module — extend one instead of adding a parallel module",
                capability.key,
                capability.owner_module
            );
        }
    }

    /// No two capabilities may serve the same route: overlapping ownership is
    /// how duplicate surfaces creep in.
    #[test]
    fn capability_routes_do_not_overlap() {
        let mut owner_by_route: BTreeMap<(&str, &str), &str> = BTreeMap::new();
        for capability in STAFF_OS_CAPABILITIES {
            for route in capability.routes {
                if let Some(existing) = owner_by_route.insert(*route, capability.key) {
                    panic!(
                        "route {} {} is claimed by both {} and {}",
                        route.0, route.1, existing, capability.key
                    );
                }
            }
        }
    }

    #[test]
    fn every_advertised_capability_is_registered_exactly_once() {
        let mut keys = BTreeSet::new();
        for capability in STAFF_OS_CAPABILITIES {
            assert!(
                keys.insert(capability.key),
                "duplicate capability key {}",
                capability.key
            );
            assert!(!capability.routes.is_empty(), "{} has no routes", capability.key);
            assert!(!capability.label.is_empty());
        }
        // The Advanced Staff OS scope: all 22 capability areas are covered.
        assert_eq!(keys.len(), 22);
        for required in [
            "staff.master_and_documents",
            "staff.skills_and_service_assignments",
            "staff.shift_templates_and_schedules",
            "staff.shift_swaps",
            "staff.attendance_and_overtime_approval",
            "staff.leave_policies_balances_approvals",
            "staff.branch_transfers",
            "staff.salary_structures_and_revisions",
            "staff.salary_advance_ledger",
            "staff.payroll_lifecycle",
            "staff.commission_and_tips",
            "staff.targets_and_incentives",
            "staff.authorized_fines_and_deductions",
            "staff.performance_history",
            "staff.manager_feedback",
            "staff.tasks_and_learning",
            "staff.replacement_recommendations",
            "staff.roster_optimization",
            "staff.manpower_forecasting",
            "staff.notifications",
            "staff.payslip_and_payroll_history",
            "staff.audit_and_corrections",
        ] {
            assert!(keys.contains(required), "capability {required} is missing");
        }
    }

    /// Staff App capabilities must reuse the existing self-service surfaces
    /// (`/staff/self`, `/staff/mobile`, `/staff-self`, or a self-scoped
    /// operational route) rather than a separate mobile API.
    #[test]
    fn staff_app_capabilities_reuse_self_service_surfaces() {
        let self_service_prefixes = ["/staff/self", "/staff/mobile", "/staff-self"];
        let self_scoped_routes = [
            "/staff-attendance/clock-in",
            "/staff-attendance/clock-out",
            "/staff-leave/requests",
            "/staff-schedule",
            "/staff/shift-swaps",
            "/staff/tasks",
            "/staff/notifications",
            "/staff/performance",
            "/staff/incentive-rules",
            "/staff/operations/templates",
            "/staff-enterprise/training",
        ];
        for capability in STAFF_OS_CAPABILITIES.iter().filter(|c| c.staff_app_surface) {
            let reuses = capability.routes.iter().any(|(_, path)| {
                self_service_prefixes
                    .iter()
                    .any(|prefix| path.starts_with(prefix))
                    || self_scoped_routes.iter().any(|route| path.starts_with(route))
            });
            assert!(
                reuses,
                "Staff App capability {} does not reuse an existing self-service surface",
                capability.key
            );
        }
    }
}
