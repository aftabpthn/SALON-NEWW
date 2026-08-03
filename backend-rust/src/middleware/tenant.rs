use std::net::SocketAddr;

use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[allow(dead_code)]
use crate::{
    middleware::security_headers,
    models::common::AppError,
    repositories::{
        auth_repository::{self, AuthAuditInput},
        inventory_governance_repository,
    },
    services::{
        auth_service::{self, AuthClaims},
        entitlement_service, security_service,
    },
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
const TENANT_ADMIN_ROLES: &[&str] = &["owner", "admin"];
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
const STAFF_SELF_DASHBOARD_ROLES: &[&str] = &["owner", "admin", "manager", "staff", "accountant"];
const REPORT_READ_ROLES: &[&str] = &["owner", "admin", "manager", "analyst", "accountant"];

const PLATFORM_ROLES: &[&str] = &["superadmin", "superAdmin", "super-admin"];

const APPOINTMENT_PREFIXES: &[&str] = &[
    "/appointment-activity",
    "/appointment-history",
    "/appointment-lifecycle",
    "/appointment-resources",
    "/appointments",
    "/fitness",
    "/kiosk",
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
const CLIENT_PREFIXES: &[&str] = &["/clients", "/customers"];
const POS_PREFIXES: &[&str] = &[
    "/appointment-deposits",
    "/appointment-sms",
    "/billing",
    "/booking-payments",
    "/invoice-notifications",
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
struct RouteAccess {
    roles: &'static [&'static str],
    permissions: &'static [&'static str],
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
        if !role_matches_tenant_context(&claims.role, &tenant_id) {
            return Err(AppError::forbidden(
                "role does not match platform or tenant context",
            ));
        }
        if is_platform_role(&claims.role) {
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
    let audit_ip_address = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| security_headers::resolved_source_ip(peer.0.ip(), req.headers()));
    let audit_user_agent = header_text(req.headers(), header::USER_AGENT.as_str());
    let audit_device_id = header_text(req.headers(), "x-device-id");
    let audit_request_id =
        header_text(req.headers(), "x-request-id").unwrap_or_else(|| Uuid::new_v4().to_string());
    let audit_idempotency_key = header_text(req.headers(), "idempotency-key");
    let geofence_path = normalize_route_path(req.uri().path()).to_owned();
    let geofence_method = req.method().clone();
    let is_staff_app = req
        .headers()
        .get("x-staff-app")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == "1");
    let location = match (
        header_f64(&req, "x-staff-latitude"),
        header_f64(&req, "x-staff-longitude"),
    ) {
        (Some(latitude), Some(longitude))
            if (-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude) =>
        {
            Some((latitude, longitude))
        }
        _ => None,
    };
    let geofence_claims = req.extensions().get::<AuthClaims>().cloned();
    let geofence_result = enforce_staff_app_geofence(
        &state,
        is_staff_app,
        location,
        geofence_claims.as_ref(),
        &geofence_path,
        &geofence_method,
    )
    .await;
    let path = normalize_route_path(req.uri().path());
    let method = req.method();
    let audit_path = path.to_string();
    let audit_method = method.to_string();
    let audit_claims = req.extensions().get::<AuthClaims>().cloned();

    let result = if let Err(error) = geofence_result {
        Err(error)
    } else if requires_platform_access(path, method) {
        require_platform_admin(req, next).await
    } else if path_starts_with(path, "/auth") {
        require_authenticated_user(req, next).await
    } else if let Some(access) = route_access(path, method) {
        if access.permissions.is_empty()
            || auth_service::route_permissions_registered(access.permissions)
        {
            let feature_result = match (route_feature_key(path, access.permissions), &audit_claims)
            {
                (Some(feature_key), Some(claims)) => {
                    entitlement_service::ensure_feature(&state.db, &claims.tenant_id, feature_key)
                        .await
                }
                (Some(_), None) => Err(AppError::unauthenticated("missing auth claims")),
                (None, _) => Ok(()),
            };
            match feature_result {
                Ok(()) => {
                    require_role_or_permissions(req, next, access.roles, access.permissions).await
                }
                Err(error) => Err(error),
            }
        } else {
            Err(AppError::internal("route permission registry is invalid"))
        }
    } else {
        Err(AppError::forbidden(
            "no permission mapping for this endpoint",
        ))
    };

    if result.is_err() {
        if let Some(claims) = audit_claims {
            if auth_repository::audit(
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
                    ip_address: audit_ip_address.as_deref(),
                    user_agent: audit_user_agent.as_deref(),
                    details: serde_json::json!({
                        "method": audit_method,
                        "path": audit_path,
                        "deviceId": audit_device_id,
                        "requestId": audit_request_id,
                        "idempotencyKey": audit_idempotency_key
                    }),
                },
            )
            .await
            .is_err()
            {
                tracing::warn!("failed to persist permission denial audit event");
            }
        }
    } else if is_mutation_method(&audit_method) {
        if let (Ok(response), Some(claims)) = (&result, audit_claims.as_ref()) {
            if response.status().is_success() {
                if auth_repository::audit(
                    &state.db,
                    AuthAuditInput {
                        tenant_id: &claims.tenant_id,
                        user_id: Some(&claims.sub),
                        session_id: (!claims.session_id.is_empty())
                            .then_some(claims.session_id.as_str()),
                        branch_id: claims.branch_id.as_deref(),
                        identity: None,
                        event_type: if path_starts_with(&audit_path, "/inventory")
                            || path_starts_with(&audit_path, "/purchases")
                        {
                            "inventory.api.mutation"
                        } else {
                            "api.mutation"
                        },
                        outcome: "success",
                        ip_address: audit_ip_address.as_deref(),
                        user_agent: audit_user_agent.as_deref(),
                        details: serde_json::json!({
                            "method": audit_method,
                            "path": audit_path,
                            "status": response.status().as_u16(),
                            "deviceId": audit_device_id,
                            "requestId": audit_request_id,
                            "idempotencyKey": audit_idempotency_key
                        }),
                    },
                )
                .await
                .is_err()
                {
                    tracing::warn!("failed to persist API mutation audit event");
                }
            }
        }
    }
    result
}

pub async fn require_inventory_idempotency(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let method = req.method().clone();
    let route_path = normalize_route_path(req.uri().path()).to_string();
    if is_read_method(&method)
        || !(path_starts_with(&route_path, "/inventory")
            || path_starts_with(&route_path, "/purchases"))
    {
        return Ok(next.run(req).await);
    }
    let claims = req
        .extensions()
        .get::<AuthClaims>()
        .cloned()
        .ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;
    let branch_id = claims
        .branch_id
        .as_deref()
        .ok_or_else(|| AppError::forbidden("branch-scoped session is required"))?;
    if let Some(action) = inventory_stock_action(&route_path) {
        let policy =
            inventory_governance_repository::policy(&state.db, &claims.tenant_id, branch_id)
                .await
                .map_err(|_| {
                    AppError::internal("failed to enforce inventory stock-action policy")
                })?;
        if policy
            .as_ref()
            .and_then(|value| value.get("stockActionMatrix"))
            .and_then(|matrix| matrix.get(action))
            .and_then(serde_json::Value::as_bool)
            == Some(false)
        {
            return Err(AppError::forbidden(format!(
                "inventory {action} action is disabled for this branch"
            )));
        }
    }
    let request_path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or(req.uri().path())
        .to_string();
    let (parts, body) = req.into_parts();
    let body = to_bytes(body, 32 * 1024 * 1024)
        .await
        .map_err(|_| AppError::validation("inventory request body is too large"))?;
    let key = parts
        .headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| body_idempotency_key(&body))
        .ok_or_else(|| {
            AppError::validation("Idempotency-Key is required for inventory mutations")
        })?;
    if !valid_idempotency_key(&key) {
        return Err(AppError::validation(
            "Idempotency-Key must be 8 to 160 letters, numbers, dots, colons, hyphens, or underscores",
        ));
    }
    let mut request_hasher = Sha256::new();
    request_hasher.update(method.as_str().as_bytes());
    request_hasher.update([0]);
    request_hasher.update(request_path.as_bytes());
    request_hasher.update([0]);
    request_hasher.update(&body);
    let request_hash = format!("{:x}", request_hasher.finalize());
    let (created, saved) = auth_repository::begin_inventory_api_request(
        &state.db,
        &claims.tenant_id,
        branch_id,
        &claims.sub,
        &key,
        method.as_str(),
        &request_path,
        &request_hash,
    )
    .await
    .map_err(|_| AppError::internal("failed to reserve inventory request"))?;
    if saved.actor_user_id != claims.sub {
        return Err(AppError::conflict(
            "Idempotency-Key was already used by another inventory actor",
        ));
    }
    if saved.request_hash != request_hash {
        return Err(AppError::conflict(
            "Idempotency-Key was already used for a different inventory request",
        ));
    }
    if !created {
        if saved.status != "completed" {
            return Err(AppError::conflict(
                "an inventory request with this Idempotency-Key is still processing",
            ));
        }
        let status = saved
            .response_status
            .and_then(|value| u16::try_from(value).ok())
            .and_then(|value| StatusCode::from_u16(value).ok())
            .ok_or_else(|| AppError::internal("saved inventory response is invalid"))?;
        let mut response = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, saved.response_content_type)
            .header("x-idempotency-replayed", "true")
            .body(Body::from(saved.response_body.unwrap_or_default()))
            .map_err(|_| AppError::internal("failed to replay inventory response"))?;
        response.headers_mut().insert(
            "x-request-id",
            HeaderValue::from_str(
                parts
                    .headers
                    .get("x-request-id")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("replayed"),
            )
            .unwrap_or_else(|_| HeaderValue::from_static("replayed")),
        );
        return Ok(response);
    }
    let request = Request::from_parts(parts, Body::from(body));
    let response = next.run(request).await;
    let (mut response_parts, response_body) = response.into_parts();
    let response_body = to_bytes(response_body, 32 * 1024 * 1024)
        .await
        .map_err(|_| AppError::internal("inventory response body is too large"))?;
    let content_type = response_parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    if auth_repository::complete_inventory_api_request(
        &state.db,
        &claims.tenant_id,
        branch_id,
        &claims.sub,
        &key,
        &request_hash,
        i32::from(response_parts.status.as_u16()),
        &content_type,
        &response_body,
    )
    .await
    .map_err(|_| AppError::internal("failed to persist inventory request result"))?
    {
        response_parts
            .headers
            .insert("x-idempotency-replayed", HeaderValue::from_static("false"));
    }
    Ok(Response::from_parts(
        response_parts,
        Body::from(response_body),
    ))
}

fn header_text(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn body_idempotency_key(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()?
        .get("idempotencyKey")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn valid_idempotency_key(value: &str) -> bool {
    (8..=160).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'-' | b'_'))
}

async fn enforce_staff_app_geofence(
    state: &AppState,
    is_staff_app: bool,
    location: Option<(f64, f64)>,
    claims: Option<&AuthClaims>,
    path: &str,
    method: &Method,
) -> Result<(), AppError> {
    if !is_staff_app || staff_geofence_bypass(path) {
        return Ok(());
    }
    let claims = claims.ok_or_else(|| AppError::unauthenticated("missing auth claims"))?;
    let branch_id = claims
        .branch_id
        .as_deref()
        .ok_or_else(|| AppError::forbidden("branch-scoped session is required"))?;
    let policy = security_service::get_policy(&state.db, &claims.tenant_id, branch_id)
        .await?
        .settings;
    if policy.staff_app_geofence_mode == "full_access"
        || policy
            .staff_app_geofence_exempt_roles
            .iter()
            .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        return Ok(());
    }
    let branch_location = sqlx::query_as::<_, (Option<f64>, Option<f64>)>(
        "SELECT latitude,longitude FROM branches WHERE tenant_id=$1 AND id=$2 AND active=TRUE",
    )
    .bind(&claims.tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to verify Staff App geofence"))?;
    let inside = match (location, branch_location) {
        (Some((latitude, longitude)), Some((Some(branch_latitude), Some(branch_longitude)))) => {
            distance_meters(latitude, longitude, branch_latitude, branch_longitude)
                <= policy.staff_app_geofence_radius_meters as f64
        }
        _ => false,
    };
    if inside || policy.staff_app_geofence_mode == "read_only" && is_read_method(method) {
        return Ok(());
    }
    if policy.staff_app_geofence_mode == "read_only" {
        Err(AppError::forbidden(
            "Outside geofence: your Staff App access is read-only",
        ))
    } else {
        Err(AppError::forbidden(
            "Staff App access is blocked outside the configured geofence",
        ))
    }
}

fn staff_geofence_bypass(path: &str) -> bool {
    matches!(
        path,
        "/auth/logout" | "/auth/switch-branch" | "/staff/self/preferred-branch"
    ) || path.starts_with("/staff/self/security")
}

fn header_f64(req: &Request<Body>, name: &str) -> Option<f64> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

fn distance_meters(
    latitude: f64,
    longitude: f64,
    other_latitude: f64,
    other_longitude: f64,
) -> f64 {
    let radius = 6_371_000.0_f64;
    let latitude_delta = (other_latitude - latitude).to_radians();
    let longitude_delta = (other_longitude - longitude).to_radians();
    let a = (latitude_delta / 2.0).sin().powi(2)
        + latitude.to_radians().cos()
            * other_latitude.to_radians().cos()
            * (longitude_delta / 2.0).sin().powi(2);
    2.0 * radius * a.sqrt().atan2((1.0 - a).sqrt())
}

fn is_mutation_method(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
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

fn inventory_stock_action(path: &str) -> Option<&'static str> {
    let path = normalize_route_path(path);
    if path_starts_with(path, "/purchases/grn") {
        Some("receipt")
    } else if path_starts_with(path, "/purchases/returns") || path.contains("/quarantine/") {
        Some("returns")
    } else if path_starts_with(path, "/inventory/transfers") {
        Some("transfer")
    } else if path_starts_with(path, "/inventory/adjustments")
        || path_starts_with(path, "/inventory/negative-stock-requests")
    {
        Some("adjustment")
    } else if path_starts_with(path, "/inventory/stock-audits") {
        Some("audit")
    } else if path_starts_with(path, "/inventory/backbar-usage")
        || path_starts_with(path, "/inventory/color-bowls")
        || path_starts_with(path, "/inventory/checkouts")
        || path_starts_with(path, "/inventory/conversions")
    {
        Some("consumption")
    } else if path.ends_with("/kit") || path.ends_with("/assemble") || path.ends_with("/unbundle") {
        Some("kit")
    } else {
        None
    }
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

fn route_feature_key(path: &str, permissions: &[&str]) -> Option<&'static str> {
    if path_starts_with(path, "/staff/biometric") {
        Some("staff.biometric")
    } else if path_starts_with(path, "/settings/integrations/api-keys") {
        Some("staff.api")
    } else if path_starts_with(path, "/staff-payroll")
        || path_starts_with(path, "/staff/payroll")
        || path_starts_with(path, "/staff/tips")
        || path_starts_with(path, "/staff/self/payslips")
        || path == "/staff/mobile/payroll"
        || path.contains("/salary-revisions")
    {
        Some("staff.payroll")
    } else if path_starts_with(path, "/staff/intelligence")
        || path_starts_with(path, "/staff/coach")
        || path_starts_with(path, "/staff-os/coach")
    {
        Some("staff.ai")
    } else {
        auth_service::feature_key_for_permissions(permissions)
    }
}

fn route_access(path: &str, method: &Method) -> Option<RouteAccess> {
    if path_starts_with(path, "/operations") {
        return Some(access(MANAGEMENT_ROLES, &["management.write"]));
    }
    if path_starts_with(path, "/staff/self/profile") {
        return Some(if is_read_method(method) {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.profile.read",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        } else {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.profile.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        });
    }
    if path == "/staff/self/security-context" || path == "/staff/self/security/pin/verify" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.settings.read",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path_starts_with(path, "/staff/self/security") || path == "/staff/self/preferred-branch" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.settings.manage",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path == "/staff/self/roster" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.roster.read",
                "staff.schedule.read",
                "staff.self_manage",
            ],
        ));
    }
    if path == "/staff/self/calendar" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.calendar.read",
                "staff.schedule.read",
                "staff.self_manage",
            ],
        ));
    }
    if path == "/staff/self/dashboard" {
        return Some(access(
            STAFF_SELF_DASHBOARD_ROLES,
            &[
                "staff.app.dashboard.read",
                "staff.app.appointments.read",
                "staff.app.payroll.read",
                "staff.app.profile.read",
                "staff.app.settings.read",
                "staff.payroll.read",
                "staff.payroll.manage",
                "finance.read",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path == "/staff-self/enterprise-os" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.dashboard.read",
                "staff.app.appointments.read",
                "staff.app.business.read",
                "staff.app.tasks.read",
                "staff.app.calendar.read",
                "staff.app.roster.read",
                "staff.app.notifications.read",
                "staff.app.performance.read",
                "staff.app.leaderboard.read",
                "staff.app.reports.read",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path == "/staff-self/performance" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.performance.read",
                "staff.analytics.read",
                "staff.self_manage",
            ],
        ));
    }
    if path_starts_with(path, "/staff-self/appointments") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &["staff.app.appointments.manage", "appointments.manage"],
        ));
    }
    if path == "/staff-self/business" && method == Method::GET {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.business.read",
                "staff.app.reports.read",
                "appointments.read",
                "reports.read",
                "staff.self_manage",
            ],
        ));
    }
    if path_starts_with(path, "/staff-self/business") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.business.read",
                "appointments.read",
                "staff.self_manage",
            ],
        ));
    }
    if path_starts_with(path, "/staff-self/offers") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.offers.read",
                "marketing.read",
                "appointments.read",
            ],
        ));
    }
    if path_starts_with(path, "/staff-self/rules") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.rules.read",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path == "/staff-self/feedback" {
        return Some(if is_read_method(method) {
            access(
                STAFF_SELF_WRITE_ROLES,
                &["staff.app.feedback.read", "staff.self_manage"],
            )
        } else {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.feedback.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        });
    }
    if path == "/staff-self/workspace-preferences" {
        return Some(if is_read_method(method) {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.settings.read",
                    "staff.app.settings.manage",
                    "staff.self_manage",
                ],
            )
        } else {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.settings.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        });
    }
    if path_starts_with(path, "/staff/self/payslips") {
        return Some(access(
            PAYROLL_ROLES,
            &[
                "staff.app.payroll.read",
                "staff.payroll.read",
                "staff.payroll.manage",
            ],
        ));
    }
    if path == "/staff/self/targets" {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &["staff.app.tasks.read", "staff.self_manage"],
        ));
    }
    if path_starts_with(path, "/staff/self/tasks") {
        return Some(if is_read_method(method) {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.tasks.read",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        } else {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.tasks.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        });
    }
    if path_starts_with(path, "/staff-self/calendar") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.roster.manage",
                "staff.app.calendar.manage",
                "staff.self_manage",
                "staff_self.write",
            ],
        ));
    }
    if path_starts_with(path, "/staff-self/notifications") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.notifications.manage",
                "notifications.read",
                "staff.self_manage",
            ],
        ));
    }
    if path_starts_with(path, "/staff/self/mobile") {
        return Some(access(
            STAFF_SELF_WRITE_ROLES,
            &[
                "staff.app.notifications.read",
                "notifications.read",
                "staff.self_manage",
            ],
        ));
    }
    if path_starts_with(path, "/team-chat") {
        return Some(if is_read_method(method) {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.chat.read",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        } else {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.chat.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
            )
        });
    }
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
    if path_starts_with(path, "/settings/organization") {
        return Some(if is_read_method(method) {
            access(TENANT_ADMIN_ROLES, &["settings.read", "settings.manage"])
        } else {
            access(TENANT_ADMIN_ROLES, &["settings.manage"])
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
                || (path_starts_with(path, "/reports/custom") && path.ends_with("/run"))
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
        let self_action = matches!(
            path,
            "/staff-attendance/clock-in"
                | "/staff-attendance/biometric/begin"
                | "/staff-attendance/clock-out"
                | "/staff-attendance/break-start"
                | "/staff-attendance/break-end"
        );
        return Some(if is_read_method(method) {
            access(
                TENANT_ROLES,
                &[
                    "staff.app.attendance.read",
                    "staff.app.attendance.manage",
                    "staff.attendance.read",
                    "staff.attendance.manage",
                    "staff.read",
                    "tenant.read",
                ],
            )
        } else if self_action {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.attendance.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
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
                    "staff.app.leaves.read",
                    "staff.leave.read",
                    "staff.leave.manage",
                    "staff.read",
                    "tenant.read",
                ],
            )
        } else if self_action {
            access(
                STAFF_SELF_WRITE_ROLES,
                &[
                    "staff.app.leaves.manage",
                    "staff.self_manage",
                    "staff_self.write",
                ],
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
    if path_starts_with(path, "/staff/rules") {
        return Some(if is_read_method(method) {
            access(
                MANAGEMENT_ROLES,
                &[
                    "staff.governance.read",
                    "staff.governance.manage",
                    "staff.read",
                    "staff.manage",
                ],
            )
        } else {
            access(
                MANAGEMENT_ROLES,
                &[
                    "staff.governance.manage",
                    "staff.manage",
                    "management.write",
                ],
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
            access(MANAGEMENT_ROLES, &["staff.read", "staff.manage"])
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
        if (((path_starts_with(path, "/inventory/backbar-usage")
            || path_starts_with(path, "/inventory/backbar-overrides")
            || path_starts_with(path, "/inventory/floor-closings")
            || path_starts_with(path, "/inventory/adjustments")
            || path_starts_with(path, "/inventory/negative-stock-requests")
            || path_starts_with(path, "/inventory/exception-recommendations")
            || path_starts_with(path, "/inventory/autonomous-operations/actions"))
            && path.ends_with("/review"))
            || (path_starts_with(path, "/inventory/stock-audits")
                && (path.ends_with("/approve") || path.ends_with("/reject"))))
            && !is_read_method(method)
        {
            return Some(access(OWNER_ROLES, &["inventory.approve"]));
        }
        if path_starts_with(path, "/inventory/transfers")
            && (path.ends_with("/approve") || path.ends_with("/reject"))
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
        return Some(access(TENANT_ADMIN_ROLES, &[]));
    }
    if path_starts_with(path, "/notifications")
        || path_starts_with(path, "/whatsapp")
        || path_starts_with(path, "/whatsapp-campaign-planner")
    {
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
        if path_starts_with(path, "/pos/payment-platform") {
            if is_read_method(method) {
                return Some(access(
                    FINANCE_WRITE_ROLES,
                    &["finance.read", "pos.manage", "tenant.read"],
                ));
            }
            if path_starts_with(path, "/pos/payment-platform/payouts") {
                return Some(access(PAYROLL_ROLES, &["finance.write", "pos.manage"]));
            }
            return Some(access(
                MANAGEMENT_ROLES,
                &["finance.write", "pos.manage", "management.write"],
            ));
        }
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
    if path.contains("/merge") {
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

fn role_matches_tenant_context(role: &str, tenant_id: &str) -> bool {
    is_platform_role(role) == tenant_id.eq_ignore_ascii_case("platform")
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

fn role_or_permissions_allowed(
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
        body_idempotency_key, distance_meters, inventory_stock_action, normalize_route_path,
        requires_platform_access, role_matches_tenant_context, role_or_permissions_allowed,
        route_access, staff_geofence_bypass, valid_idempotency_key, MANAGEMENT_ROLES,
        TENANT_ADMIN_ROLES, TENANT_ROLES,
    };
    use crate::services::auth_service::AuthClaims;
    use axum::http::Method;

    #[test]
    fn inventory_mutations_map_to_branch_stock_actions() {
        assert_eq!(
            inventory_stock_action("/api/v1/purchases/grn"),
            Some("receipt")
        );
        assert_eq!(
            inventory_stock_action("/api/v1/inventory/transfers/1/ship"),
            Some("transfer")
        );
        assert_eq!(
            inventory_stock_action("/api/v1/inventory/stock-audits/1/approve"),
            Some("audit")
        );
        assert_eq!(inventory_stock_action("/api/v1/inventory/1"), None);
    }

    #[test]
    fn organization_control_plane_requires_tenant_admin_or_settings_permission() {
        let read = route_access("/settings/organization/control-plane", &Method::GET).unwrap();
        let write = route_access("/settings/organization/profile", &Method::PUT).unwrap();
        assert_eq!(read.roles, TENANT_ADMIN_ROLES);
        assert_eq!(write.roles, TENANT_ADMIN_ROLES);
        assert!(read.permissions.contains(&"settings.read"));
        assert!(write.permissions.contains(&"settings.manage"));
    }

    #[test]
    fn phase1_staff_geofence_distance_and_recovery_paths_are_safe() {
        assert!(distance_meters(28.6139, 77.2090, 28.6139, 77.2090) < 0.01);
        assert!(distance_meters(28.6139, 77.2090, 28.6148, 77.2090) > 90.0);
        assert!(staff_geofence_bypass("/auth/logout"));
        assert!(staff_geofence_bypass(
            "/staff/self/security/sessions/1/revoke"
        ));
        assert!(!staff_geofence_bypass("/staff/self/profile"));
    }

    #[test]
    fn phase13_inventory_idempotency_keys_are_strict_and_body_compatible() {
        assert!(valid_idempotency_key("inventory:request-123"));
        assert!(!valid_idempotency_key("short"));
        assert!(!valid_idempotency_key("inventory request 123"));
        assert_eq!(
            body_idempotency_key(br#"{"idempotencyKey":"inventory:request-123"}"#).as_deref(),
            Some("inventory:request-123")
        );
    }

    #[test]
    fn phase13_inventory_review_routes_require_approver_permission() {
        for path in [
            "/inventory/transfers/transfer-1/approve",
            "/inventory/stock-audits/audit-1/approve",
            "/inventory/stock-audits/audit-1/reject",
            "/inventory/backbar-usage/usage-1/review",
            "/inventory/backbar-overrides/override-1/review",
            "/inventory/floor-closings/closing-1/review",
            "/inventory/adjustments/adjustment-1/review",
            "/inventory/negative-stock-requests/request-1/review",
            "/inventory/autonomous-operations/actions/action-1/review",
        ] {
            let access = route_access(path, &Method::POST).expect("inventory route is mapped");
            assert!(access.permissions.contains(&"inventory.approve"), "{path}");
        }
    }

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
    fn platform_and_tenant_roles_cannot_cross_contexts() {
        assert!(role_matches_tenant_context("superadmin", "platform"));
        assert!(role_matches_tenant_context("owner", "tenant_aura"));
        assert!(!role_matches_tenant_context("superadmin", "tenant_aura"));
        assert!(!role_matches_tenant_context("owner", "platform"));
    }

    #[test]
    fn protected_domains_have_named_permission_mappings() {
        for (path, method, permission) in [
            ("/api/v1/appointments", Method::GET, "appointments.read"),
            ("/api/v1/fitness/summary", Method::GET, "appointments.read"),
            (
                "/api/v1/fitness/class-sessions",
                Method::POST,
                "appointments.manage",
            ),
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
                "/api/v1/inventory/adjustments/1/review",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/stock-audits/1/approve",
                Method::POST,
                "inventory.approve",
            ),
            (
                "/api/v1/inventory/stock-audits/1/reject",
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
    fn phase_three_security_control_plane_is_fail_closed_and_permission_mapped() {
        for (path, method, permission) in [
            (
                "/api/v1/security/data-governance",
                Method::GET,
                "security.read",
            ),
            (
                "/api/v1/security/pii-exports",
                Method::POST,
                "security.manage",
            ),
            (
                "/api/v1/security/privacy-requests/request-1/execute-deletion",
                Method::POST,
                "security.manage",
            ),
            (
                "/api/v1/security/compliance-evidence/soc2/access-control",
                Method::PUT,
                "security.manage",
            ),
            (
                "/api/v1/security/pen-test-findings/finding-1",
                Method::PATCH,
                "security.manage",
            ),
        ] {
            let access = route_access(normalize_route_path(path), &method)
                .unwrap_or_else(|| panic!("{path} is not permission mapped"));
            assert!(access.permissions.contains(&permission), "{path}");
        }
        assert!(route_access("/unregistered-privileged-action", &Method::POST).is_none());
    }

    #[test]
    fn tenant_saas_is_owner_or_admin_only() {
        let access = route_access(normalize_route_path("/api/v1/saas/context"), &Method::GET)
            .expect("tenant SaaS route is mapped");
        assert!(access.roles.contains(&"owner"));
        assert!(access.roles.contains(&"admin"));
        assert!(!access.roles.contains(&"manager"));
        assert!(access.permissions.is_empty());
    }

    #[test]
    fn operations_routes_require_management_access() {
        for (path, method) in [
            ("/api/v1/operations/outcall", Method::GET),
            ("/api/v1/operations/outcall/jobs", Method::POST),
            (
                "/api/v1/operations/marketplace/listing/1/approval",
                Method::PATCH,
            ),
        ] {
            let access = route_access(normalize_route_path(path), &method)
                .unwrap_or_else(|| panic!("{path} is not permission mapped"));
            assert!(access.roles.contains(&"owner"));
            assert!(access.roles.contains(&"admin"));
            assert!(access.roles.contains(&"manager"));
            assert!(access.permissions.contains(&"management.write"));
        }
    }

    #[test]
    fn kiosk_management_routes_require_appointment_management() {
        for (path, method) in [
            ("/api/v1/kiosk/devices", Method::GET),
            ("/api/v1/kiosk/devices", Method::POST),
            ("/api/v1/kiosk/devices/device-1", Method::PATCH),
            ("/api/v1/kiosk/devices/device-1/revoke", Method::POST),
        ] {
            let access = route_access(normalize_route_path(path), &method)
                .unwrap_or_else(|| panic!("{path} is not permission mapped"));
            assert!(
                access.permissions.contains(&"appointments.manage"),
                "{path}"
            );
        }
    }

    #[test]
    fn staff_reports_can_read_business_data_without_product_usage_access() {
        let report = route_access("/staff-self/business", &Method::GET)
            .expect("staff report data route is mapped");
        assert!(report.permissions.contains(&"staff.app.reports.read"));

        let product_usage = route_access("/staff-self/business/product-usage", &Method::POST)
            .expect("staff product usage route is mapped");
        assert!(!product_usage
            .permissions
            .contains(&"staff.app.reports.read"));
    }

    #[test]
    fn staff_shared_dashboard_and_settings_keep_page_permissions_separate() {
        let dashboard = route_access("/staff/self/dashboard", &Method::GET)
            .expect("staff dashboard route is mapped");
        for permission in [
            "staff.app.payroll.read",
            "staff.app.profile.read",
            "staff.app.settings.read",
        ] {
            assert!(dashboard.permissions.contains(&permission));
        }
        assert!(dashboard.roles.contains(&"accountant"));

        let settings_read = route_access("/staff-self/workspace-preferences", &Method::GET)
            .expect("settings read route is mapped");
        let settings_write = route_access("/staff-self/workspace-preferences", &Method::PUT)
            .expect("settings write route is mapped");
        assert!(settings_read
            .permissions
            .contains(&"staff.app.settings.read"));
        assert!(!settings_write
            .permissions
            .contains(&"staff.app.settings.read"));
        assert!(settings_write
            .permissions
            .contains(&"staff.app.settings.manage"));

        let profile_read = route_access("/staff/self/profile", &Method::GET)
            .expect("profile read route is mapped");
        let profile_write = route_access(
            "/staff/self/profile/contact-verification/request",
            &Method::POST,
        )
        .expect("profile verification route is mapped");
        let security_write = route_access("/staff/self/security/pin", &Method::POST)
            .expect("security write route is mapped");
        assert!(profile_read.permissions.contains(&"staff.app.profile.read"));
        assert!(profile_write
            .permissions
            .contains(&"staff.app.profile.manage"));
        assert!(security_write
            .permissions
            .contains(&"staff.app.settings.manage"));
    }

    #[test]
    fn staff_directory_requires_management_or_staff_read() {
        let access = route_access(normalize_route_path("/api/v1/staff"), &Method::GET)
            .expect("staff directory route is mapped");
        assert!(access.roles.contains(&"manager"));
        assert!(!access.roles.contains(&"staff"));
        assert!(access.permissions.contains(&"staff.read"));
        assert!(!access.permissions.contains(&"tenant.read"));
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
