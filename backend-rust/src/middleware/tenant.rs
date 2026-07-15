use axum::{
    body::Body,
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::Response,
};

#[allow(dead_code)]
use crate::{models::common::AppError, services::auth_service::AuthClaims, state::AppState};

const TENANT_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "analyst",
    "accountant",
    "receptionist",
    "frontDesk",
    "front-desk",
    "front_desk",
    "frontdesk",
    "staff",
    "inventory manager",
    "inventory_manager",
    "inventoryManager",
];

const MANAGEMENT_ROLES: &[&str] = &["owner", "admin", "manager"];
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
const INVENTORY_WRITE_ROLES: &[&str] = &[
    "owner",
    "admin",
    "manager",
    "inventory manager",
    "inventory_manager",
    "inventoryManager",
];
const FINANCE_WRITE_ROLES: &[&str] = &["owner", "admin", "manager", "accountant"];
const REPORT_READ_ROLES: &[&str] = &["owner", "admin", "manager", "analyst", "accountant"];

const PLATFORM_ROLES: &[&str] = &["superadmin", "superAdmin", "super-admin"];

const FRONT_DESK_WRITE_PREFIXES: &[&str] = &[
    "/appointment-activity",
    "/appointment-sms",
    "/appointments",
    "/booking-groups",
    "/booking-wizard",
    "/clients",
    "/notifications",
    "/pos",
    "/sales",
    "/smart-booking",
];
const MANAGEMENT_WRITE_PREFIXES: &[&str] = &[
    "/appointment-deposits",
    "/appointment-settings",
    "/availability",
    "/billing",
    "/blackouts",
    "/calendar/tokens",
    "/jobs",
    "/memberships",
    "/packages",
    "/services",
    "/settings",
    "/staff",
    "/staff-schedule",
];
const INVENTORY_WRITE_PREFIXES: &[&str] = &["/inventory", "/purchases"];
const FINANCE_WRITE_PREFIXES: &[&str] = &["/balance-sheet", "/reports", "/wallets"];
const PLATFORM_PREFIXES: &[&str] = &["/platform", "/super-admin"];

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
    State(state): State<AppState>,
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

    let mut branch_id = claims_branch_id.or(header_branch_id.clone());
    if let Some(claims) = claims.as_ref() {
        if is_platform_role(&claims.role) && tenant_id.eq_ignore_ascii_case("platform") {
            branch_id = None;
        } else if !is_management_role(&claims.role) {
            let assigned_branch_id = sqlx::query_scalar::<_, Option<String>>(
                "SELECT branch_id FROM users WHERE id=$1 AND tenant_id=$2 AND active = true",
            )
            .bind(&claims.sub)
            .bind(&tenant_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to validate branch assignment"))?
            .flatten()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::forbidden("branch assignment is required for this role"))?;
            if branch_id
                .as_deref()
                .is_some_and(|selected_branch| selected_branch != assigned_branch_id.as_str())
            {
                return Err(AppError::forbidden(
                    "branch context does not match assigned branch",
                ));
            }
            branch_id = Some(assigned_branch_id);
        }

        if let (Some(header_branch), Some(selected_branch)) =
            (header_branch_id.as_deref(), branch_id.as_deref())
        {
            if header_branch != selected_branch && !is_management_role(&claims.role) {
                return Err(AppError::forbidden(
                    "branch context does not match assigned branch",
                ));
            }
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
    require_role(req, next, TENANT_ROLES).await
}

pub async fn require_route_role(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    let path = normalize_route_path(req.uri().path());
    let method = req.method();

    if requires_platform_access(path, method) {
        return require_platform_admin(req, next).await;
    }

    if is_read_method(method) {
        if path_starts_with(path, "/reports") {
            return require_role(req, next, REPORT_READ_ROLES).await;
        }
        return require_tenant_user(req, next).await;
    }

    if matches_write_prefix(path, FRONT_DESK_WRITE_PREFIXES) {
        return require_role(req, next, FRONT_DESK_WRITE_ROLES).await;
    }

    if matches_write_prefix(path, INVENTORY_WRITE_PREFIXES) {
        return require_role(req, next, INVENTORY_WRITE_ROLES).await;
    }

    if matches_write_prefix(path, FINANCE_WRITE_PREFIXES) {
        return require_role(req, next, FINANCE_WRITE_ROLES).await;
    }

    if matches_write_prefix(path, MANAGEMENT_WRITE_PREFIXES) {
        return require_management(req, next).await;
    }

    Err(AppError::forbidden(
        "no permission mapping for this mutation",
    ))
}

fn normalize_route_path(path: &str) -> &str {
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

fn matches_write_prefix(path: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| path_starts_with(path, prefix))
}

fn is_management_role(role: &str) -> bool {
    MANAGEMENT_ROLES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(role))
}

fn is_platform_role(role: &str) -> bool {
    PLATFORM_ROLES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(role))
}

#[allow(dead_code)]
pub async fn require_management(req: Request<Body>, next: Next) -> Result<Response, AppError> {
    require_role(req, next, MANAGEMENT_ROLES).await
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
