//! Phase 1 verification: authoritative staff permission registry and backend
//! route enforcement.
//!
//! These tests exercise the real production guards — not reimplementations —
//! so they fail if enforcement regresses:
//!
//! | Guarantee | Production function under test |
//! | --- | --- |
//! | Privileged roles are not Staff App employee roles | `permission_registry::is_privileged_role_name` |
//! | Staff cannot reach another staff member's data | `staff_identity_service::can_act_for_other_staff` / `can_view_other_staff` |
//! | Manager cannot reach an unassigned branch | `middleware::auth::scope_header_mismatch` |
//! | A revoked permission is rejected | `middleware::tenant::role_or_permissions_allowed` |
//! | Permission version change invalidates the session | `routes::auth::validate_permission_version` |
//! | Every protected staff route maps to a registered permission | `middleware::tenant::route_access` + `permission_registry` |

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, Method};

    use crate::{
        middleware::{
            auth::scope_header_mismatch,
            tenant::{normalize_route_path, role_or_permissions_allowed, route_access},
        },
        repositories::auth_repository::AuthUser,
        routes::auth::validate_permission_version,
        services::{
            auth_service::AuthClaims,
            permission_registry::{self, PermissionScope},
            route_coverage_audit::PROTECTED_ROUTES,
            staff_identity_service,
            staff_os_registry::STAFF_OS_CAPABILITIES,
        },
    };

    fn claims(role: &str, branch: Option<&str>) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: branch.map(str::to_string),
            role: role.into(),
            role_id: None,
            permissions: Vec::new(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            mfa_enrollment_required: false,
            session_id: "session-1".into(),
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        }
    }

    fn user(permission_version: i64) -> AuthUser {
        AuthUser {
            id: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role_id: None,
            role_name: "manager".into(),
            login_id: Some("manager1".into()),
            email: "manager@example.com".into(),
            password_hash: String::new(),
            locked_until: None,
            permission_version,
            must_change_password: false,
        }
    }

    fn method(name: &str) -> Method {
        name.parse().expect("valid http method")
    }

    // 1 ────────────────────────────────────────────────────────────────────
    #[test]
    fn owner_admin_super_admin_are_not_assignable_as_staff_app_employee_roles() {
        for name in [
            "owner",
            "Owner",
            "OWNER",
            "admin",
            "Admin",
            "super_admin",
            "Super Admin",
            "super-admin",
            "superadmin",
        ] {
            assert!(
                permission_registry::is_privileged_role_name(name),
                "{name} must be rejected for a Staff App employee login"
            );
        }
        // Real employee roles stay assignable.
        for name in [
            "manager",
            "Front Desk",
            "cashier",
            "staff",
            "accountant",
            "Inventory Manager",
            "Senior Stylist",
        ] {
            assert!(
                !permission_registry::is_privileged_role_name(name),
                "{name} must remain assignable to an employee login"
            );
        }
        // The role templates agree: privileged roles are not Staff App selectable.
        for role_key in ["super_admin", "owner", "admin"] {
            let template =
                permission_registry::role_template(role_key).expect("system role template");
            assert!(
                !template.staff_app_selectable,
                "{role_key} must not be selectable in the Staff App role picker"
            );
        }
        // super_admin is platform scope and holds no salon permissions.
        let super_admin = permission_registry::role_template("super_admin").expect("template");
        assert_eq!(super_admin.scope, PermissionScope::Platform);
        assert_eq!(super_admin.permissions, Some(&[] as &[&str]));
    }

    // 2 ────────────────────────────────────────────────────────────────────
    #[test]
    fn staff_cannot_reach_another_staff_members_data() {
        const ATTENDANCE: &[&str] = &["staff.attendance.manage"];
        const LEAVE: &[&str] = &["staff.leave.manage"];

        let mut staff = claims("staff", Some("branch-1"));
        staff.permissions = vec![
            "staff.attendance.read".into(),
            "staff.leave.read".into(),
            "staff.self_manage".into(),
            "staff_self.write".into(),
        ];
        for domain in [ATTENDANCE, LEAVE] {
            assert!(
                !staff_identity_service::can_act_for_other_staff(&staff, domain),
                "a staff role must never write another employee's record"
            );
            assert!(
                !staff_identity_service::can_view_other_staff(&staff, domain),
                "a staff role must never read another employee's record"
            );
        }

        // A custom self-service role is equally self-scoped: holding
        // staff.self_manage does not confer access to other employees, so a
        // forged staffId in the request body cannot widen scope.
        let mut stylist = claims("Senior Stylist", Some("branch-1"));
        stylist.permissions = vec!["staff.self_manage".into(), "appointments.read".into()];
        assert!(!staff_identity_service::can_act_for_other_staff(
            &stylist, ATTENDANCE
        ));
        assert!(!staff_identity_service::can_view_other_staff(
            &stylist, ATTENDANCE
        ));

        // Only an explicit management grant crosses the boundary.
        let mut supervisor = claims("Shift Supervisor", Some("branch-1"));
        supervisor.permissions = vec!["staff.attendance.manage".into()];
        assert!(staff_identity_service::can_act_for_other_staff(
            &supervisor,
            ATTENDANCE
        ));
    }

    // 3 ────────────────────────────────────────────────────────────────────
    #[test]
    fn manager_cannot_reach_an_unassigned_branch() {
        let manager = claims("manager", Some("branch-1"));

        // A manager scoped to branch-1 requesting branch-2 is rejected: the
        // branch comes from the token, and a forged header cannot override it.
        let mut headers = HeaderMap::new();
        headers.insert("x-tenant-id", HeaderValue::from_static("tenant-1"));
        headers.insert("x-branch-id", HeaderValue::from_static("branch-2"));
        assert_eq!(
            scope_header_mismatch(&headers, &manager).map(|mismatch| mismatch.0),
            Some("branch_header_mismatch"),
            "a manager must not reach a branch outside their session scope"
        );

        // Their own assigned branch is allowed.
        headers.insert("x-branch-id", HeaderValue::from_static("branch-1"));
        assert!(scope_header_mismatch(&headers, &manager).is_none());

        // Cross-tenant is rejected regardless of branch.
        headers.insert("x-tenant-id", HeaderValue::from_static("tenant-2"));
        assert_eq!(
            scope_header_mismatch(&headers, &manager).map(|mismatch| mismatch.0),
            Some("tenant_header_mismatch")
        );

        // An unscoped token cannot address any branch: cross-branch access
        // requires an explicit branch assignment selected at login.
        let unscoped = claims("manager", None);
        let mut headers = HeaderMap::new();
        headers.insert("x-branch-id", HeaderValue::from_static("branch-1"));
        assert_eq!(
            scope_header_mismatch(&headers, &unscoped).map(|mismatch| mismatch.0),
            Some("unscoped_token_branch_request")
        );
    }

    // 4 ────────────────────────────────────────────────────────────────────
    #[test]
    fn revoked_permission_is_rejected() {
        const REQUIRED: &[&str] = &["staff.payroll.manage"];
        let mut actor = claims("Payroll Officer", Some("branch-1"));
        actor.permissions = vec!["staff.payroll.manage".into()];
        assert!(
            role_or_permissions_allowed(&actor, &[], REQUIRED),
            "the granted permission should pass before revocation"
        );

        // Revoking wins over the grant.
        actor.denied_permissions = vec!["staff.payroll.manage".into()];
        assert!(
            !role_or_permissions_allowed(&actor, &[], REQUIRED),
            "a revoked permission must be rejected"
        );

        // Revoking also wins over a role that would otherwise be allowed, so
        // a deny cannot be bypassed by role membership.
        let mut owner = claims("owner", Some("branch-1"));
        owner.denied_permissions = vec!["staff.payroll.manage".into()];
        assert!(
            !role_or_permissions_allowed(&owner, &["owner"], REQUIRED),
            "a revoked permission must outrank role membership"
        );
    }

    // 5 ────────────────────────────────────────────────────────────────────
    #[test]
    fn permission_version_change_invalidates_the_old_session() {
        let mut session = claims("manager", Some("branch-1"));
        session.permission_version = 1;

        // Same version: the session stays valid.
        assert!(validate_permission_version(&user(1), &session).is_ok());

        // A role permission change bumps users.permission_version; the token
        // minted before the change no longer matches and is rejected, forcing
        // re-authentication.
        let rejected = validate_permission_version(&user(2), &session)
            .expect_err("stale session must be rejected after a permission change");
        let rejected = format!("{rejected:?}").to_lowercase();
        assert!(
            rejected.contains("sign in again") || rejected.contains("permissions changed"),
            "unexpected rejection: {rejected}"
        );
        assert!(
            rejected.contains("unauthenticated") || rejected.contains("401"),
            "a stale session must be rejected as unauthenticated: {rejected}"
        );

        // Backward compatibility: legacy tokens minted without a version
        // claim (0) are not force-expired by this check.
        let mut legacy = claims("manager", Some("branch-1"));
        legacy.permission_version = 0;
        assert!(validate_permission_version(&user(7), &legacy).is_ok());
    }

    // 6 ────────────────────────────────────────────────────────────────────
    #[test]
    fn every_protected_staff_route_maps_to_a_registered_permission() {
        let staff_prefixes = ["/staff", "/staff-"];
        let mut checked = 0usize;
        let mut unmapped = Vec::new();
        let mut unregistered = Vec::new();

        for (method_name, path) in PROTECTED_ROUTES {
            if !staff_prefixes
                .iter()
                .any(|prefix| path.starts_with(prefix))
            {
                continue;
            }
            checked += 1;
            let method = method(method_name);
            let Some(access) = route_access(normalize_route_path(path), &method) else {
                unmapped.push(format!("{method_name} {path}"));
                continue;
            };
            for permission in access.permission_keys() {
                if !permission_registry::is_registered(permission) {
                    unregistered.push(format!("{method_name} {path} -> {permission}"));
                }
            }
        }

        assert!(
            checked > 150,
            "expected the staff route surface to be substantial, checked {checked}"
        );
        assert!(
            unmapped.is_empty(),
            "{} staff route(s) have no permission mapping:\n{}",
            unmapped.len(),
            unmapped.join("\n")
        );
        assert!(
            unregistered.is_empty(),
            "{} staff route(s) enforce an unregistered permission:\n{}",
            unregistered.len(),
            unregistered.join("\n")
        );

        // The Staff OS capability map must also resolve end to end.
        for capability in STAFF_OS_CAPABILITIES {
            for (route_method, route_path) in capability.routes {
                let access = route_access(normalize_route_path(route_path), &method(route_method))
                    .unwrap_or_else(|| {
                        panic!(
                            "capability {} route {route_method} {route_path} is unmapped",
                            capability.key
                        )
                    });
                for permission in access.permission_keys() {
                    assert!(
                        permission_registry::is_registered(permission),
                        "capability {} route {route_method} {route_path} enforces unregistered {permission}",
                        capability.key
                    );
                }
            }
        }
    }

    /// Every registry entry carries the full typed contract Phase 1 requires:
    /// key, module, action, scope, sensitive flag, and feature entitlement.
    #[test]
    fn registry_entries_declare_the_full_typed_contract() {
        for spec in permission_registry::PERMISSION_REGISTRY {
            assert!(!spec.key.is_empty(), "permission key is empty");
            assert!(!spec.module.is_empty(), "{} has no module", spec.key);
            assert!(!spec.label.is_empty(), "{} has no label", spec.key);
            assert!(
                !spec.feature_key.is_empty(),
                "{} has no feature entitlement",
                spec.key
            );
            assert!(
                !spec.action.as_str().is_empty() && !spec.scope.as_str().is_empty(),
                "{} has an incomplete action/scope contract",
                spec.key
            );
        }

        // Backward compatibility: the legacy permission keys that existing
        // tenants already hold remain registered and enforceable.
        for legacy in [
            "tenant.read",
            "front_desk.write",
            "management.write",
            "inventory.write",
            "staff_self.write",
        ] {
            let spec = permission_registry::find(legacy)
                .unwrap_or_else(|| panic!("legacy permission {legacy} must stay registered"));
            assert_eq!(
                spec.module, "Compatibility",
                "{legacy} should be grouped as a compatibility key"
            );
        }
    }
}
