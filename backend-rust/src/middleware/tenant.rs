use axum::{
    body::Body,
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::Response,
};

#[allow(dead_code)]
use crate::{
    models::common::AppError,
    repositories::auth_repository::{self, AuthAuditInput},
    services::auth_service::AuthClaims,
    state::AppState,
};

const TENANT_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "regional head",
    "regional_head",
    "regionalHead",
    "regionalhead",
    "analyst",
    "accountant",
    "receptionist",
    "cashier",
    "frontDesk",
    "front-desk",
    "front_desk",
    "frontdesk",
    "staff",
    "inventory manager",
    "inventory_manager",
    "inventoryManager",
    "marketing lead",
    "marketing_lead",
    "marketingLead",
];

const MANAGEMENT_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "regional head",
    "regional_head",
    "regionalHead",
    "regionalhead",
];
const OWNER_ROLES: &[&str] = &["owner"];
const AUTH_ADMIN_ROLES: &[&str] = &["owner", "admin", "superadmin", "superAdmin", "super-admin"];
const FRONT_DESK_WRITE_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "receptionist",
    "frontDesk",
    "front-desk",
    "front_desk",
    "frontdesk",
];
const CASH_DRAWER_WRITE_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "cashier",
    "receptionist",
    "frontDesk",
    "front-desk",
    "front_desk",
    "frontdesk",
];
const INVENTORY_WRITE_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "inventory manager",
    "inventory_manager",
    "inventoryManager",
];
const FINANCE_WRITE_ROLES: &[&str] = &["owner", "admin", "manager", "accountant"];
const PAYROLL_ROLES: &[&str] = &["owner", "admin", "accountant"];
const STAFF_SELF_WRITE_ROLES: &[&str] = &["owner", "admin", "manager", "staff"];
const REPORT_READ_ROLES: &[&str] = &["owner", "admin", "manager", "analyst", "accountant"];

const PLATFORM_ROLES: &[&str] = &["superadmin", "superAdmin", "super-admin"];

const APPOINTMENT_PREFIXES: &[&str] = &[
    "/appointment-activity",
    "/appointment-history",
    "/appointment-lifecycle",
    "/appointment-reschedule-requests",
    "/appointment-resources",
    "/appointments",
    "/audit/appointments",
];
const BOOKING_PREFIXES: &[&str] = &[
    "/availability",
    "/blackouts",
    "/booking-groups",
    "/booking-intelligence",
    "/booking-wizard",
    "/calendar",
    "/smart-booking",
];
const CLIENT_PREFIXES: &[&str] = &["/client-masters", "/clients", "/customers"];
const POS_PREFIXES: &[&str] = &[
    "/appointment-deposits",
    "/appointment-sms",
    "/billing",
    "/booking-payments",
    "/invoice-notifications",
    "/invoices",
    "/pos",
    "/sales",
];
const STAFF_PREFIXES: &[&str] = &[
    "/staff",
    "/staff-attendance",
    "/staff-enterprise",
    "/staff-leave",
    "/staff-os",
    "/staff-payroll",
    "/staff-schedule",
];
const REPORT_PREFIXES: &[&str] = &[
    "/appointment-reports",
    "/booking-analytics",
    "/profit-intelligence",
    "/reports",
];
const PLATFORM_PREFIXES: &[&str] = &["/platform", "/super-admin", "/saas/onboarding"];

#[derive(Clone, Copy)]
pub(crate) struct RouteAccess {
    roles: &'static [&'static str],
    permissions: &'static [&'static str],
}

impl RouteAccess {
    #[allow(dead_code)]
    pub(crate) fn role_keys(&self) -> &'static [&'static str] {
        self.roles
    }

    #[allow(dead_code)]
    pub(crate) fn permission_keys(&self) -> &'static [&'static str] {
        self.permissions
    }
}

const PLATFORM_METHODS: &[Method] = &[
    Method::GET,
    Method::POST,
    Method::PATCH,
    Method::DELETE,
    Method::PUT,
];
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TenantContext {
    pub tenant_id: String,
    pub branch_id: Option<String>,
}

#[allow(dead_code)]
pub async fn require_tenant_id(
    State(_state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let header_tenant_id = req
        .headers()
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let header_branch_id = req
        .headers()
        .get("x-branch-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let claims = req.extensions().get::<AuthClaims>().cloned();
    if let (Some(claims), Some(header_tenant_id)) = (&claims, header_tenant_id.as_deref()) {
        if claims.tenant_id != header_tenant_id {
            return Err(AppError::forbidden("tenant context does not match token"));
        }
    }

    let tenant_id = claims
        .as_ref()
        .map(|claims| claims.tenant_id.clone())
        .or(header_tenant_id)
        .ok_or_else(|| AppError::validation("x-tenant-id is required"))?;

    let claims_branch_id = claims
        .as_ref()
        .and_then(|claims| claims.branch_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if let (Some(claim_branch), Some(header_branch)) =
        (claims_branch_id.as_deref(), header_branch_id.as_deref())
    {
        if claim_branch != header_branch {
            return Err(AppError::forbidden("branch context does not match token"));
        }
    }

    let mut branch_id = claims_branch_id.clone();
    if let Some(claims) = claims.as_ref() {
        if is_platform_role(&claims.role) && tenant_id.eq_ignore_ascii_case("platform") {
            branch_id = None;
        } else if branch_id.is_none() {
            return Err(AppError::forbidden("branch-scoped session is required"));
        }
    }

    req.extensions_mut().insert(TenantContext {
        tenant_id,
        branch_id,
    });
    Ok(next.run(req).await)
}

#[allow(dead_code)]
pub async fn require_role(
    req: Request<Body>,
    next: Next,
    allowed_roles: &'static [&'static str],
) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<AuthClaims>()
        .ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;

    if !allowed_roles
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        return Err(AppError::forbidden("role is not allowed for this endpoint"));
    }

    Ok(next.run(req).await)
}

#[allow(dead_code)]
pub async fn require_tenant_user(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    require_role_or_permission(req, next, TENANT_ROLES, "tenant.read").await
}

pub async fn require_route_role(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let path = normalize_route_path(req.uri().path());
    let method = req.method();
    let audit_path = path.to_string();
    let audit_method = method.to_string();
    let audit_claims = req.extensions().get::<AuthClaims>().cloned();

    let result = if requires_platform_access(path, method) {
        require_platform_admin(req, next).await
    } else if path_starts_with(path, "/auth") {
        require_authenticated_user(req, next).await
    } else if let Some(access) = route_access(path, method) {
        require_role_or_permissions(req, next, access.roles, access.permissions).await
    } else {
        Err(AppError::forbidden(
            "no permission mapping for this endpoint",
        ))
    };

    if result.is_err() {
        if let Some(claims) = audit_claims {
            let _ = auth_repository::audit(
                &state.db,
                AuthAuditInput {
                    tenant_id: &claims.tenant_id,
                    user_id: Some(&claims.sub),
                    session_id: (!claims.session_id.is_empty())
                        .then_some(claims.session_id.as_str()),
                    branch_id: claims.branch_id.as_deref(),
                    identity: None,
                    event_type: "permission.denied",
                    outcome: "denied",
                    ip_address: None,
                    user_agent: None,
                    details: serde_json::json!({ "method": audit_method, "path": audit_path }),
                },
            )
            .await;
        }
    } else if is_mutation_method(&audit_method) {
        if let (Ok(response), Some(claims)) = (&result, audit_claims.as_ref()) {
            if response.status().is_success() {
                let _ = auth_repository::audit(
                    &state.db,
                    AuthAuditInput {
                        tenant_id: &claims.tenant_id,
                        user_id: Some(&claims.sub),
                        session_id: (!claims.session_id.is_empty())
                            .then_some(claims.session_id.as_str()),
                        branch_id: claims.branch_id.as_deref(),
                        identity: None,
                        event_type: "api.mutation",
                        outcome: "success",
                        ip_address: None,
                        user_agent: None,
                        details: serde_json::json!({
                            "method": audit_method,
                            "path": audit_path,
                            "status": response.status().as_u16()
                        }),
                    },
                )
                .await;
            }
        }
    }
    result
}

fn is_mutation_method(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

pub(crate) fn normalize_route_path(path: &str) -> &str {
    if let Some(rest) = path.strip_prefix("/api/v1") {
        return rest;
    }
    if let Some(rest) = path.strip_prefix("/api") {
        return rest;
    }
    path
}

#[inline]
fn path_starts_with(path: &str, prefix: &str) -> bool {
    path == prefix || (path.starts_with(prefix) && path.as_bytes().get(prefix.len()) == Some(&b'/'))
}

fn requires_platform_access(path: &str, method: &Method) -> bool {
    PLATFORM_METHODS
        .iter()
        .any(|method_candidate| method == method_candidate)
        && PLATFORM_PREFIXES
            .iter()
            .any(|prefix| path_starts_with(path, prefix))
}

fn is_read_method(method: &Method) -> bool {
    matches!(method, &Method::GET | &Method::HEAD | &Method::OPTIONS)
}

fn matches_route_prefix(path: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| path_starts_with(path, prefix))
}

/// Whether a request path is covered by one of the three protection branches
/// used by `require_route_role`: platform-admin gating, authenticated-user
/// gating for `/auth`, or an explicit permission mapping. Anything else falls
/// through to the default deny and is unreachable in production.
#[allow(dead_code)]
pub(crate) fn route_protection_resolved(path: &str, method: &Method) -> bool {
    let path = normalize_route_path(path);
    requires_platform_access(path, method)
        || path_starts_with(path, "/auth")
        || route_access(path, method).is_some()
}

pub(crate) fn route_access(path: &str, method: &Method) -> Option<RouteAccess> {
    if path_starts_with(path, "/finance/outgoing-funds") {
        return Some(if path == "/finance/outgoing-funds/export" {
            access(FINANCE_WRITE_ROLES, &["reports.export", "finance.write"])
        } else if is_read_method(method) {
            access(
                REPORT_READ_ROLES,
                &["finance.read", "reports.read", "tenant.read"],
            )
        } else {
            access(FINANCE_WRITE_ROLES, &["finance.write"])
        });
    }
    if path_starts_with(path, "/balance-sheet") {
        return Some(if is_read_method(method) {
            access(
                REPORT_READ_ROLES,
                &["finance.read", "reports.read", "tenant.read"],
            )
        } else {
            access(FINANCE_WRITE_ROLES, &["finance.write"])
        });
    }
    if path_starts_with(path, "/settings/branches")
        || path_starts_with(path, "/settings/franchise-controls")
    {
        return Some(if is_read_method(method) {
            access(OWNER_ROLES, &["settings.read", "tenant.read"])
        } else {
            access(OWNER_ROLES, &["settings.manage", "management.write"])
        });
    }
    if path_starts_with(path, "/security") || path_starts_with(path, "/settings/security") {
        return Some(if is_read_method(method) {
            access(AUTH_ADMIN_ROLES, &["security.read", "security.manage"])
        } else {
            access(AUTH_ADMIN_ROLES, &["security.manage"])
        });
    }
    if matches_route_prefix(path, REPORT_PREFIXES) {
        return Some(
            if path == "/reports/custom/preview"
                || (path_starts_with(path, "/reports/custom/") && path.ends_with("/run"))
            {
                access(
                    REPORT_READ_ROLES,
                    &["reports.read", "finance.read", "tenant.read"],
                )
            } else if path.contains("/export") {
                access(
                    REPORT_READ_ROLES,
                    &["reports.export", "finance.read", "tenant.read"],
                )
            } else if is_read_method(method) {
                access(
                    REPORT_READ_ROLES,
                    &["reports.read", "finance.read", "tenant.read"],
                )
            } else {
                access(FINANCE_WRITE_ROLES, &["finance.write"])
            },
        );
    }
    if path_starts_with(path, "/staff-payroll")
        || path_starts_with(path, "/staff-advances")
        || path_starts_with(path, "/staff/payroll-compliance")
        || path_starts_with(path, "/staff/tips/payouts")
        || path.contains("/salary-revisions")
    {
        return Some(if is_read_method(method) {
            access(
                PAYROLL_ROLES,
                &["staff.payroll.read", "staff.payroll.manage"],
            )
        } else {
            access(PAYROLL_ROLES, &["staff.payroll.manage"])
        });
    }
    if path_starts_with(path, "/staff-attendance") {
        let self_action =
            path == "/staff-attendance/clock-in" || path == "/staff-attendance/clock-out";
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &[
                    "staff.attendance.read",
                    "staff.attendance.manage",
                    "staff.read",
                    "tenant.read",
                ],
            )
        } else if self_action {
            access(
                STAFF_SELF_WRITE_ROLES,
                &["staff.self_manage", "staff_self.write"],
            )
        } else {
            access(
                MANAGEMENT_ROLES,
                &["staff.attendance.manage", "management.write"],
            )
        });
    }
    if path_starts_with(path, "/staff-leave") {
        let self_action = path == "/staff-leave/requests" && method == &Method::POST;
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &[
                    "staff.leave.read",
                    "staff.leave.manage",
                    "staff.read",
                    "tenant.read",
                ],
            )
        } else if self_action {
            access(
                STAFF_SELF_WRITE_ROLES,
                &["staff.self_manage", "staff_self.write"],
            )
        } else {
            access(
                MANAGEMENT_ROLES,
                &["staff.leave.manage", "management.write"],
            )
        });
    }
    if path_starts_with(path, "/staff-schedule") {
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &[
                    "staff.schedule.read",
                    "staff.schedule.manage",
                    "staff.read",
                    "tenant.read",
                ],
            )
        } else {
            access(
                MANAGEMENT_ROLES,
                &["staff.schedule.manage", "management.write"],
            )
        });
    }
    if path_starts_with(path, "/staff/mobile")
        || path_starts_with(path, "/staff/self")
        || path_starts_with(path, "/staff-self")
        || path_starts_with(path, "/staff/approvals")
    {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &["staff.self_manage", "staff_self.write", "tenant.read"],
        ));
    }
    if path_starts_with(path, "/team-chat") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &["staff.self_manage", "staff_self.write", "tenant.read"],
        ));
    }
    if path_starts_with(path, "/staff/performance")
        || path_starts_with(path, "/staff/intelligence")
        || path_starts_with(path, "/staff/reports")
        || path_starts_with(path, "/staff/coach")
        || path_starts_with(path, "/staff-enterprise")
        || path_starts_with(path, "/staff-os")
    {
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &["staff.analytics.read", "staff.read", "tenant.read"],
            )
        } else {
            access(MANAGEMENT_ROLES, &["staff.manage", "management.write"])
        });
    }
    if matches_route_prefix(path, STAFF_PREFIXES) {
        return Some(if is_read_method(method) {
            access(TENANT_ROLES, &["staff.read", "staff.manage", "tenant.read"])
        } else {
            access(MANAGEMENT_ROLES, &["staff.manage", "management.write"])
        });
    }
    if path_starts_with(path, "/purchases") {
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &[
                    "purchases.read",
                    "purchases.manage",
                    "inventory.read",
                    "tenant.read",
                ],
            )
        } else if path.contains("/approve") {
            access(
                INVENTORY_WRITE_ROLES,
                &["purchases.approve", "inventory.manage", "inventory.write"],
            )
        } else {
            access(
                INVENTORY_WRITE_ROLES,
                &["purchases.manage", "inventory.manage", "inventory.write"],
            )
        });
    }
    if path_starts_with(path, "/inventory") {
        if path_starts_with(path, "/inventory/transfer-optimizer") {
            return Some(access(
                TENANT_ROLES,
                &[
                    "purchases.manage",
                    "inventory.read",
                    "inventory.manage",
                    "tenant.read",
                ],
            ));
        }
        if (path_starts_with(path, "/inventory/backbar-usage")
            || path_starts_with(path, "/inventory/backbar-overrides")
            || path_starts_with(path, "/inventory/negative-stock-requests")
            || path_starts_with(path, "/inventory/exception-recommendations")
            || path_starts_with(path, "/inventory/autonomous-operations/actions"))
            && path.ends_with("/review")
            && !is_read_method(method)
        {
            return Some(access(OWNER_ROLES, &["inventory.approve"]));
        }
        if path_starts_with(path, "/inventory/supplier-governance/communications")
            && path.ends_with("/retry")
            && !is_read_method(method)
        {
            return Some(access(
                INVENTORY_WRITE_ROLES,
                &["inventory.manage", "inventory.write"],
            ));
        }
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &["inventory.read", "inventory.manage", "tenant.read"],
            )
        } else {
            access(
                INVENTORY_WRITE_ROLES,
                &["inventory.manage", "inventory.write"],
            )
        });
    }
    if path_starts_with(path, "/memberships") || path_starts_with(path, "/membership-enterprise") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["memberships.read", "memberships.manage", "tenant.read"],
            &["memberships.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/packages") || path_starts_with(path, "/package-enterprise") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["packages.read", "packages.manage", "tenant.read"],
            &["packages.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/services") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["services.read", "services.manage", "tenant.read"],
            &["services.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/settings/booking") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["bookings.read", "bookings.manage", "tenant.read"],
            &["bookings.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/settings/invoice")
        || path_starts_with(path, "/settings/payment-methods")
    {
        return Some(if is_read_method(method) {
            access(TENANT_ROLES, &["pos.read", "pos.manage", "tenant.read"])
        } else {
            access(MANAGEMENT_ROLES, &["pos.manage", "management.write"])
        });
    }
    if path_starts_with(path, "/settings/integrations/import")
        || path.starts_with("/settings/integrations/import-")
    {
        let is_sensitive_export = (path.contains("/proof-pack")
            || path.contains("/failed-rows")
            || path.contains("/evidence"))
            && is_read_method(method);
        return Some(if is_sensitive_export {
            access(AUTH_ADMIN_ROLES, &["data_migration.export"])
        } else if is_read_method(method) {
            access(
                MANAGEMENT_ROLES,
                &["data_migration.read", "data_migration.manage"],
            )
        } else {
            access(MANAGEMENT_ROLES, &["data_migration.manage"])
        });
    }
    if path_starts_with(path, "/settings") || path_starts_with(path, "/jobs") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["settings.read", "settings.manage", "tenant.read"],
            &["settings.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/saas") {
        return Some(domain_access(
            method,
            MANAGEMENT_ROLES,
            MANAGEMENT_ROLES,
            &["settings.read", "settings.manage", "tenant.read"],
            &["settings.manage", "management.write"],
        ));
    }
    // Outcall and marketplace operations: branch teams read, management
    // approves listings, moderates reviews, and dispatches jobs.
    if path_starts_with(path, "/operations/outcall")
        || path_starts_with(path, "/operations/marketplace")
    {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["settings.read", "bookings.read", "tenant.read"],
            &["settings.manage", "bookings.manage", "management.write"],
        ));
    }
    // Campaign planning and message templates are marketing surfaces; the
    // hyphenated prefixes do not match "/whatsapp" or "/notifications".
    if path_starts_with(path, "/whatsapp-campaign-planner") {
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &["marketing.read", "analytics.read", "tenant.read"],
            )
        } else if path.ends_with("/approve") {
            access(
                MANAGEMENT_ROLES,
                &["marketing.approve", "marketing.manage", "management.write"],
            )
        } else {
            access(
                MANAGEMENT_ROLES,
                &["marketing.send", "marketing.manage", "management.write"],
            )
        });
    }
    if path_starts_with(path, "/message-templates") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            FRONT_DESK_WRITE_ROLES,
            &[
                "notifications.read",
                "marketing.read",
                "templates.manage",
                "tenant.read",
            ],
            &["templates.manage", "notifications.manage", "marketing.manage"],
        ));
    }
    if path_starts_with(path, "/notifications") || path_starts_with(path, "/whatsapp") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            FRONT_DESK_WRITE_ROLES,
            &[
                "notifications.read",
                "notifications.manage",
                "marketing.read",
                "analytics.read",
                "tenant.read",
            ],
            &[
                "notifications.manage",
                "marketing.manage",
                "marketing.approve",
                "marketing.send",
                "templates.manage",
                "front_desk.write",
            ],
        ));
    }
    if path_starts_with(path, "/birthday-anniversary")
        || path_starts_with(path, "/birthday-campaign")
    {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &["marketing.read", "tenant.read"],
            &["marketing.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/ai") {
        return Some(access(
            TENANT_ROLES,
            &["ai.read", "ai.manage", "tenant.read"],
        ));
    }
    if path_starts_with(path, "/retention") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &[
                "clients.read",
                "memberships.read",
                "pos.read",
                "tenant.read",
            ],
            &[
                "clients.manage",
                "memberships.manage",
                "pos.manage",
                "management.write",
            ],
        ));
    }
    if path_starts_with(path, "/marketing") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &[
                "marketing.read",
                "analytics.read",
                "clients.read",
                "tenant.read",
            ],
            &[
                "marketing.manage",
                "marketing.approve",
                "marketing.send",
                "offers.approve",
                "templates.manage",
                "clients.manage",
                "management.write",
            ],
        ));
    }
    if matches_route_prefix(path, CLIENT_PREFIXES) {
        return Some(client_access(path, method));
    }
    if matches_route_prefix(path, POS_PREFIXES) {
        if path_starts_with(path, "/appointment-deposits")
            || path_starts_with(path, "/booking-payments")
            || path_starts_with(path, "/billing")
        {
            return Some(if is_read_method(method) {
                access(TENANT_ROLES, &["pos.read", "pos.manage", "tenant.read"])
            } else {
                access(MANAGEMENT_ROLES, &["pos.manage", "management.write"])
            });
        }
        return Some(pos_access(path, method));
    }
    if matches_route_prefix(path, APPOINTMENT_PREFIXES) {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            FRONT_DESK_WRITE_ROLES,
            &["appointments.read", "appointments.manage", "tenant.read"],
            &["appointments.manage", "front_desk.write"],
        ));
    }
    if path_starts_with(path, "/appointment-settings") {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &[
                "appointments.read",
                "appointments.settings.manage",
                "tenant.read",
            ],
            &["appointments.settings.manage", "management.write"],
        ));
    }
    if path_starts_with(path, "/availability")
        || path_starts_with(path, "/blackouts")
        || path_starts_with(path, "/calendar")
    {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            MANAGEMENT_ROLES,
            &[
                "bookings.read",
                "bookings.manage",
                "appointments.read",
                "tenant.read",
            ],
            &["bookings.manage", "management.write"],
        ));
    }
    if matches_route_prefix(path, BOOKING_PREFIXES) {
        return Some(domain_access(
            method,
            TENANT_ROLES,
            FRONT_DESK_WRITE_ROLES,
            &[
                "bookings.read",
                "bookings.manage",
                "appointments.read",
                "tenant.read",
            ],
            &["bookings.manage", "front_desk.write"],
        ));
    }
    None
}

const fn access(
    roles: &'static [&'static str],
    permissions: &'static [&'static str],
) -> RouteAccess {
    RouteAccess { roles, permissions }
}

fn domain_access(
    method: &Method,
    read_roles: &'static [&'static str],
    write_roles: &'static [&'static str],
    read_permissions: &'static [&'static str],
    write_permissions: &'static [&'static str],
) -> RouteAccess {
    if is_read_method(method) {
        access(read_roles, read_permissions)
    } else {
        access(write_roles, write_permissions)
    }
}

fn client_access(path: &str, method: &Method) -> RouteAccess {
    if path.contains("/wallet") {
        return if is_read_method(method) {
            access(
                TENANT_ROLES,
                &["finance.read", "clients.read", "tenant.read"],
            )
        } else {
            access(
                FRONT_DESK_WRITE_ROLES,
                &["finance.write", "clients.manage", "front_desk.write"],
            )
        };
    }
    if path.ends_with("/audit") {
        return access(
            TENANT_ROLES,
            &[
                "clients.audit.read",
                "clients.read",
                "clients.manage",
                "tenant.read",
            ],
        );
    }
    if path.contains("/form-submissions") || path_starts_with(path, "/clients/forms") {
        return access(
            MANAGEMENT_ROLES,
            &["clients.forms.manage", "clients.manage", "management.write"],
        );
    }
    if path.ends_with("/contact-preferences") {
        return access(
            MANAGEMENT_ROLES,
            &[
                "clients.consent.manage",
                "clients.manage",
                "front_desk.write",
            ],
        );
    }
    if path.ends_with("/merge") {
        return access(
            MANAGEMENT_ROLES,
            &["clients.merge", "clients.manage", "front_desk.write"],
        );
    }
    if path.ends_with("/reviews") && !is_read_method(method) {
        return access(
            MANAGEMENT_ROLES,
            &["clients.reviews.link", "clients.manage", "front_desk.write"],
        );
    }
    domain_access(
        method,
        TENANT_ROLES,
        FRONT_DESK_WRITE_ROLES,
        &["clients.read", "clients.manage", "tenant.read"],
        &["clients.manage", "front_desk.write"],
    )
}

fn pos_access(path: &str, method: &Method) -> RouteAccess {
    if is_read_method(method) && path.contains("/z-reports") && path.contains("/export") {
        return access(
            TENANT_ROLES,
            &["reports.export", "finance.read", "tenant.read"],
        );
    }
    if !is_read_method(method) && path.contains("/provider-reconciliations") {
        return access(MANAGEMENT_ROLES, &["management.write", "finance.write"]);
    }
    if !is_read_method(method) && path.contains("/cash-drawer") {
        return access(CASH_DRAWER_WRITE_ROLES, &["pos.manage", "front_desk.write"]);
    }
    if !is_read_method(method) && path.contains("/refund") {
        return access(
            FRONT_DESK_WRITE_ROLES,
            &["pos.refund", "pos.manage", "front_desk.write"],
        );
    }
    if !is_read_method(method) && (path.contains("/void") || path.contains("/credit-note")) {
        return access(
            FRONT_DESK_WRITE_ROLES,
            &["pos.void", "pos.manage", "front_desk.write"],
        );
    }
    domain_access(
        method,
        TENANT_ROLES,
        FRONT_DESK_WRITE_ROLES,
        &["pos.read", "pos.manage", "tenant.read"],
        &["pos.manage", "front_desk.write"],
    )
}

fn is_platform_role(role: &str) -> bool {
    PLATFORM_ROLES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(role))
}

async fn require_role_or_permission(
    req: Request<Body>,
    next: Next,
    allowed_roles: &'static [&'static str],
    permission: &'static str,
) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<AuthClaims>()
        .ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;
    if !role_or_permissions_allowed(claims, allowed_roles, &[permission]) {
        return Err(AppError::forbidden(
            "permission is not allowed for this endpoint",
        ));
    }
    Ok(next.run(req).await)
}

pub(crate) fn role_or_permissions_allowed(
    claims: &AuthClaims,
    allowed_roles: &[&str],
    permissions: &[&str],
) -> bool {
    if claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.iter().any(|required| denied == required))
    {
        return false;
    }
    allowed_roles
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
        || claims
            .permissions
            .iter()
            .any(|allowed| permissions.iter().any(|required| allowed == required))
}

async fn require_role_or_permissions(
    req: Request<Body>,
    next: Next,
    allowed_roles: &'static [&'static str],
    permissions: &'static [&'static str],
) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<AuthClaims>()
        .ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;
    if !role_or_permissions_allowed(claims, allowed_roles, permissions) {
        return Err(AppError::forbidden(
            "permission is not allowed for this endpoint",
        ));
    }
    Ok(next.run(req).await)
}

async fn require_authenticated_user(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    if req.extensions().get::<AuthClaims>().is_none() {
        return Err(AppError::unauthenticated("missing auth claims"));
    }
    Ok(next.run(req).await)
}

#[allow(dead_code)]
pub async fn require_management(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    require_role_or_permission(req, next, MANAGEMENT_ROLES, "management.write").await
}

#[allow(dead_code)]
pub async fn require_platform_admin(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<AuthClaims>()
        .ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;
    if !claims.tenant_id.eq_ignore_ascii_case("platform") {
        return Err(AppError::forbidden("platform tenant context is required"));
    }
    require_role(req, next, PLATFORM_ROLES).await
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_route_path, requires_platform_access, role_or_permissions_allowed, route_access,
        MANAGEMENT_ROLES, TENANT_ROLES,
    };
    use crate::services::auth_service::AuthClaims;
    use axum::http::Method;


    #[test]
    fn salon_onboarding_requires_platform_admin() {
        assert!(requires_platform_access(
            normalize_route_path("/api/saas/onboarding"),
            &Method::POST,
        ));
        assert!(!requires_platform_access(
            normalize_route_path("/api/saas/context"),
            &Method::GET,
        ));
    }

    #[test]
    fn protected_domains_have_named_permission_mappings() {
        for (path, method, permission) in [
            ("/api/v1/appointments", Method::GET, "appointments.read"),
            (
                "/api/v1/appointments/1/no-show-charge",
                Method::POST,
                "appointments.manage",
            ),
            ("/api/v1/clients", Method::POST, "clients.manage"),
            ("/api/v1/pos/invoices/1/refund", Method::POST, "pos.refund"),
            (
                "/api/v1/pos/payment-instruments/1/revoke",
                Method::POST,
                "pos.manage",
            ),
            (
                "/api/v1/inventory/transfers",
                Method::POST,
                "inventory.manage",
            ),
            (
                "/api/v1/inventory/transfer-optimizer",
                Method::POST,
                "purchases.manage",
            ),
            (
                "/api/v1/inventory/backbar-usage/1/review",
                Method::PATCH,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/backbar-overrides/1/review",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/negative-stock-requests/1/review",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/autonomous-operations/actions/1/review",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/exception-recommendations/missing-recipe/review",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/supplier-governance/communications/1/retry",
                Method::POST,
                "inventory.manage",
            ),
            (
                "/api/v1/purchases/1/approve",
                Method::POST,
                "purchases.approve",
            ),
            (
                "/api/v1/staff-payroll/runs",
                Method::POST,
                "staff.payroll.manage",
            ),
            ("/api/v1/reports/sales", Method::GET, "reports.read"),
            (
                "/api/v1/profit-intelligence/advanced",
                Method::GET,
                "reports.read",
            ),
            (
                "/api/v1/profit-intelligence/allocation-rules",
                Method::POST,
                "finance.write",
            ),
            (
                "/api/v1/profit-intelligence/governance/approvals/1/approve",
                Method::POST,
                "finance.write",
            ),
            ("/api/v1/balance-sheet/live", Method::GET, "finance.read"),
            (
                "/api/v1/balance-sheet/journals",
                Method::POST,
                "finance.write",
            ),
            (
                "/api/v1/finance/outgoing-funds",
                Method::GET,
                "finance.read",
            ),
            (
                "/api/v1/finance/outgoing-funds",
                Method::POST,
                "finance.write",
            ),
            (
                "/api/v1/finance/outgoing-funds/export",
                Method::GET,
                "reports.export",
            ),
            ("/api/v1/saas/context", Method::GET, "settings.read"),
            ("/api/v1/saas/tickets", Method::POST, "settings.manage"),
            (
                "/api/v1/birthday-anniversary/overview",
                Method::GET,
                "marketing.read",
            ),
            (
                "/api/v1/birthday-anniversary/reminders/1/approve",
                Method::POST,
                "marketing.manage",
            ),
            (
                "/api/v1/birthday-campaign/send-bulk",
                Method::POST,
                "marketing.manage",
            ),
            (
                "/api/v1/settings/integrations/import-jobs",
                Method::GET,
                "data_migration.read",
            ),
            (
                "/api/v1/settings/integrations/import-jobs",
                Method::POST,
                "data_migration.manage",
            ),
            (
                "/api/v1/settings/integrations/import-jobs/job-1/proof-pack",
                Method::GET,
                "data_migration.export",
            ),
            (
                "/api/v1/settings/integrations/import-source-files/file-1/evidence",
                Method::GET,
                "data_migration.export",
            ),
        ] {
            let access = route_access(normalize_route_path(path), &method)
                .unwrap_or_else(|| panic!("{path} is not permission mapped"));
            assert!(
                access.permissions.contains(&permission),
                "{path} must require {permission}"
            );
        }
    }

    #[test]
    fn manager_needs_explicit_payroll_permission() {
        let access = route_access(
            normalize_route_path("/api/v1/staff-payroll/runs"),
            &Method::POST,
        )
        .expect("staff payroll route is mapped");
        let mut claims = AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: "manager".into(),
            role_id: None,
            permissions: Vec::new(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: "session-1".into(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        };
        assert!(!role_or_permissions_allowed(
            &claims,
            access.roles,
            access.permissions
        ));
        claims.permissions.push("staff.payroll.manage".into());
        assert!(role_or_permissions_allowed(
            &claims,
            access.roles,
            access.permissions
        ));
    }

    #[test]
    fn custom_role_requires_exact_permission() {
        let mut claims = AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: "Regional Lead".into(),
            role_id: Some("role-1".into()),
            permissions: vec!["clients.read".into()],
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
        };
        assert!(role_or_permissions_allowed(
            &claims,
            &[],
            &["clients.read", "clients.manage"]
        ));
        assert!(!role_or_permissions_allowed(
            &claims,
            MANAGEMENT_ROLES,
            &["staff.manage", "management.write"]
        ));
        claims.permissions.push("staff.manage".into());
        assert!(role_or_permissions_allowed(
            &claims,
            MANAGEMENT_ROLES,
            &["staff.manage", "management.write"]
        ));
        claims.denied_permissions.push("staff.manage".into());
        assert!(!role_or_permissions_allowed(
            &claims,
            MANAGEMENT_ROLES,
            &["staff.manage", "management.write"]
        ));

        for role in ["Cashier", "Marketing Lead"] {
            claims.role = role.into();
            claims.denied_permissions.clear();
            assert!(role_or_permissions_allowed(&claims, TENANT_ROLES, &[]));
        }
    }

    #[test]
    fn cash_drawer_role_matrix_keeps_operations_and_approvals_separate() {
        let operations = route_access(
            normalize_route_path("/api/v1/pos/cash-drawer/open"),
            &Method::POST,
        )
        .expect("cash drawer operations are mapped");
        for role in ["owner", "manager", "cashier", "receptionist"] {
            assert!(
                operations.roles.contains(&role),
                "{role} must operate a drawer"
            );
        }
        assert!(!operations.roles.contains(&"staff"));

        let reconciliation = route_access(
            normalize_route_path("/api/v1/pos/provider-reconciliations"),
            &Method::POST,
        )
        .expect("provider reconciliation is mapped");
        for role in ["owner", "manager"] {
            assert!(reconciliation.roles.contains(&role));
        }
        for role in ["cashier", "receptionist"] {
            assert!(!reconciliation.roles.contains(&role));
        }
    }
}
