//! Staff identity and scope resolution.
//!
//! A staff profile and its login account are separate records linked through
//! `staff.user_id` (staff_profile -> staff_user_link -> user -> role/branch
//! assignments). Staff identity is never trusted from a request body: for
//! self-scoped actors the `staff_id` is derived from the authenticated
//! session's linked profile in the current tenant and branch. Only callers
//! who may manage other staff can address a different staff profile, and
//! cross-branch access still requires an explicit branch assignment because
//! every session is branch-scoped.

use sqlx::PgPool;

use crate::{
    models::common::AppError, repositories::staff_enterprise_repository,
    services::auth_service::AuthClaims,
};

/// Roles that manage staff in their assigned branches.
const MANAGEMENT_ROLE_NAMES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "superadmin",
    "superAdmin",
    "super-admin",
    "regional head",
    "regional_head",
    "regionalHead",
    "regionalhead",
];

/// Named operational roles that may view records of other staff members
/// (reporting, front desk, finance). The `staff` role is deliberately absent:
/// staff only see their own attendance, leave, payroll, schedule and targets.
const NON_SELF_ROLE_NAMES: &[&str] = &[
    "analyst",
    "accountant",
    "receptionist",
    "frontDesk",
    "front-desk",
    "front_desk",
    "frontdesk",
    "cashier",
    "inventory manager",
    "inventory_manager",
    "inventoryManager",
    "marketing lead",
    "marketing_lead",
    "marketingLead",
];

fn role_in(claims: &AuthClaims, roles: &[&str]) -> bool {
    roles.iter().any(|role| role.eq_ignore_ascii_case(&claims.role))
}

fn has_any_permission(claims: &AuthClaims, permissions: &[&str]) -> bool {
    permissions.iter().any(|permission| {
        !claims
            .denied_permissions
            .iter()
            .any(|denied| denied == permission)
            && claims
                .permissions
                .iter()
                .any(|granted| granted == permission)
    })
}

/// Whether the caller may perform staff-domain writes on behalf of another
/// staff member. Management roles qualify, as does any role explicitly
/// granted a domain manage permission (or the broad staff/management grants).
pub fn can_act_for_other_staff(claims: &AuthClaims, manage_permissions: &[&str]) -> bool {
    role_in(claims, MANAGEMENT_ROLE_NAMES)
        || has_any_permission(claims, manage_permissions)
        || has_any_permission(claims, &["staff.manage", "management.write"])
}

/// Whether the caller may view staff-domain records of other staff members.
pub fn can_view_other_staff(claims: &AuthClaims, view_permissions: &[&str]) -> bool {
    can_act_for_other_staff(claims, view_permissions)
        || role_in(claims, NON_SELF_ROLE_NAMES)
        || has_any_permission(claims, &["staff.analytics.read"])
}

async fn linked_self_staff_id(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
) -> Result<String, AppError> {
    staff_enterprise_repository::linked_staff_id(db, tenant_id, branch_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to resolve linked employee profile"))?
        .ok_or_else(|| AppError::not_found("linked employee profile not found"))
}

/// Resolves the staff identity a write action applies to. Callers who cannot
/// manage other staff always act on their own session-linked profile — any
/// `staffId` in the request body is ignored, not validated.
pub async fn resolve_write_scope(
    db: &PgPool,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested_staff_id: &str,
    manage_permissions: &[&str],
) -> Result<String, AppError> {
    let requested = requested_staff_id.trim();
    if can_act_for_other_staff(claims, manage_permissions) && !requested.is_empty() {
        return Ok(requested.to_string());
    }
    linked_self_staff_id(db, tenant_id, branch_id, claims).await
}

/// Resolves the staff filter for read endpoints. Privileged viewers keep the
/// requested filter (empty means all staff in the branch); self-scoped actors
/// are forced onto their own linked profile regardless of what they asked for.
pub async fn resolve_read_filter(
    db: &PgPool,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested_staff_id: &str,
    view_permissions: &[&str],
) -> Result<String, AppError> {
    if can_view_other_staff(claims, view_permissions) {
        return Ok(requested_staff_id.trim().to_string());
    }
    linked_self_staff_id(db, tenant_id, branch_id, claims).await
}

#[cfg(test)]
mod tests {
    use super::{can_act_for_other_staff, can_view_other_staff};
    use crate::services::auth_service::AuthClaims;

    fn claims(role: &str, permissions: &[&str], denied: &[&str]) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            denied_permissions: denied.iter().map(|value| value.to_string()).collect(),
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

    const ATTENDANCE_MANAGE: &[&str] = &["staff.attendance.manage"];

    #[test]
    fn staff_role_never_acts_or_views_for_others() {
        let staff = claims(
            "staff",
            &["staff.attendance.read", "staff.self_manage", "staff_self.write"],
            &[],
        );
        assert!(!can_act_for_other_staff(&staff, ATTENDANCE_MANAGE));
        assert!(!can_view_other_staff(&staff, ATTENDANCE_MANAGE));
    }

    #[test]
    fn custom_self_service_role_is_self_scoped_despite_body_identity() {
        let stylist = claims(
            "Senior Stylist",
            &["staff.self_manage", "staff_self.write", "appointments.read"],
            &[],
        );
        assert!(!can_act_for_other_staff(&stylist, ATTENDANCE_MANAGE));
        assert!(!can_view_other_staff(&stylist, ATTENDANCE_MANAGE));
    }

    #[test]
    fn managers_and_explicit_grants_manage_other_staff() {
        assert!(can_act_for_other_staff(
            &claims("manager", &[], &[]),
            ATTENDANCE_MANAGE
        ));
        assert!(can_act_for_other_staff(
            &claims("Shift Supervisor", &["staff.attendance.manage"], &[]),
            ATTENDANCE_MANAGE
        ));
        assert!(!can_act_for_other_staff(
            &claims(
                "Shift Supervisor",
                &["staff.attendance.manage"],
                &["staff.attendance.manage"]
            ),
            ATTENDANCE_MANAGE
        ));
    }

    #[test]
    fn reporting_roles_keep_read_access_without_write_rights() {
        let analyst = claims("analyst", &["staff.analytics.read"], &[]);
        assert!(can_view_other_staff(&analyst, ATTENDANCE_MANAGE));
        assert!(!can_act_for_other_staff(&analyst, ATTENDANCE_MANAGE));

        let receptionist = claims("receptionist", &["front_desk.write"], &[]);
        assert!(can_view_other_staff(&receptionist, &["staff.schedule.manage"]));
        assert!(!can_act_for_other_staff(&receptionist, &["staff.schedule.manage"]));
    }
}
