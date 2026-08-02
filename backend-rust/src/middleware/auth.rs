use std::{
    collections::BTreeSet,
    net::SocketAddr,
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};
use serde_json::Value;

use crate::{
    config::is_local_env,
    models::common::AppError,
    repositories::auth_repository::{self, AuthAuditInput},
    services::{
        auth_service::{self, AuthClaims},
        entitlement_service, security_service, staff_advanced_service,
    },
    state::{AppSessionCacheEntry, AppState},
};

const AUTH_CACHE_TTL: Duration = Duration::from_secs(30);
const AUTH_SESSION_CHECK_TTL: Duration = Duration::from_secs(15);

#[allow(dead_code)]
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("missing bearer token"))?;

    let mut claims = auth_service::decode_access_token(token, &state.settings.jwt_access_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired bearer token"))?;

    if claims.token_type != "access" {
        return Err(AppError::unauthenticated("invalid token type"));
    }

    let is_staff_app = req
        .headers()
        .get("x-staff-app")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == "1");
    let is_local_dev_admin = is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin";
    if is_local_dev_admin {
        require_loopback_dev_claim(&req)?;
    } else {
        let cache_key = auth_cache_key(
            &claims.tenant_id,
            &claims.sub,
            &claims.session_id,
            claims.branch_id.as_deref(),
        );
        let used_cache = if should_use_auth_cache(&claims.session_id, is_staff_app) {
            apply_auth_cache(&state, &mut claims, req.uri().path(), &cache_key).await?
        } else {
            false
        };
        if !used_cache {
            let user = auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
                .await
                .map_err(|_| AppError::internal("failed to validate user session"))?
                .ok_or_else(|| AppError::unauthenticated("user is not active"))?;

            if claims.permission_version != 0
                && claims.permission_version != user.permission_version
            {
                return Err(AppError::unauthenticated(
                    "user permissions changed; please sign in again",
                ));
            }
            if !claims.session_id.is_empty()
                && !auth_repository::is_session_active(
                    &state.db,
                    &claims.tenant_id,
                    &claims.sub,
                    &claims.session_id,
                )
                .await
                .map_err(|_| AppError::internal("failed to validate session"))?
            {
                return Err(AppError::unauthenticated("session is no longer active"));
            }
            if password_change_required(req.uri().path(), user.must_change_password) {
                return Err(AppError::forbidden(
                    "password change is required before using the application",
                ));
            }

            claims.tenant_id = user.tenant_id.clone();
            claims.permission_version = user.permission_version;
            if let Some(branch_id) = claims.branch_id.as_deref() {
                let access = auth_repository::find_branch_access(&state.db, &user, branch_id)
                    .await
                    .map_err(|_| AppError::internal("failed to validate branch access"))?
                    .ok_or_else(|| AppError::forbidden("current branch access was removed"))?;
                claims.role = access.role_name;
                claims.role_id = access.role_id;
                claims.permissions = access.permissions;
                claims.denied_permissions = access.denied_permissions;
                claims.masked_fields = access.masked_fields;
                claims.max_discount_paise = access.max_discount_paise;
                claims.max_refund_paise = access.max_refund_paise;
                claims.max_cash_movement_paise = access.max_cash_movement_paise;
                let elevated =
                    crate::repositories::security_repository::active_elevated_permissions(
                        &state.db,
                        &claims.tenant_id,
                        branch_id,
                        &claims.sub,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to validate temporary access"))?;
                for permission in elevated {
                    if !claims.denied_permissions.contains(&permission)
                        && !claims.permissions.contains(&permission)
                    {
                        claims.permissions.push(permission);
                    }
                }
            } else {
                claims.role = user.role_name;
                claims.role_id = user.role_id;
            }

            if mfa_enrollment_required(req.uri().path(), claims.mfa_enrollment_required) {
                return Err(AppError::forbidden(
                    "MFA setup is required before using the application",
                )
                .with_details(serde_json::json!({ "mfaEnrollmentRequired": true })));
            }

            if !claims.session_id.is_empty() {
                let now = Instant::now();
                let cache_entry = AppSessionCacheEntry {
                    tenant_id: claims.tenant_id.clone(),
                    user_id: claims.sub.clone(),
                    branch_id: claims.branch_id.clone(),
                    role_name: claims.role.clone(),
                    role_id: claims.role_id.clone(),
                    permissions: claims.permissions.clone(),
                    denied_permissions: claims.denied_permissions.clone(),
                    masked_fields: claims.masked_fields.clone(),
                    max_discount_paise: claims.max_discount_paise,
                    max_refund_paise: claims.max_refund_paise,
                    max_cash_movement_paise: claims.max_cash_movement_paise,
                    permission_version: user.permission_version,
                    must_change_password: user.must_change_password,
                    last_session_check: now,
                    expires_at: now + AUTH_CACHE_TTL,
                };
                let mut cache = state.auth_cache.write().await;
                cache.insert(cache_key, cache_entry);
            }
        }
    }

    if let Some((reason, message)) = scope_header_mismatch(req.headers(), &claims) {
        audit_denied(&state, &claims, reason).await;
        return Err(AppError::forbidden(message));
    }

    if is_staff_app
        && state.settings.staff_app_force_update_enabled
        && !req
            .uri()
            .path()
            .ends_with("/staff/self/mobile/release-policy")
    {
        let version = req
            .headers()
            .get("x-staff-app-version")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if !staff_advanced_service::staff_app_version_is_supported(&state.settings, version) {
            return Err(
                AppError::forbidden("Staff App update is required").with_details(
                    serde_json::json!({
                        "forceUpdate":true,
                        "minimumVersion":state.settings.staff_app_minimum_version.clone(),
                        "updateUrl":state.settings.staff_app_update_url.clone()
                    }),
                ),
            );
        }
    }

    if request_mutates_data(req.method()) {
        entitlement_service::ensure_can_write(&state.db, &claims.tenant_id).await?;
    }

    let tenant_header = HeaderValue::from_str(&claims.tenant_id)
        .map_err(|_| AppError::unauthenticated("invalid tenant claim"))?;
    req.headers_mut().insert("x-tenant-id", tenant_header);
    if let Some(branch_id) = claims
        .branch_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let branch_header = HeaderValue::from_str(branch_id)
            .map_err(|_| AppError::unauthenticated("invalid branch claim"))?;
        req.headers_mut().insert("x-branch-id", branch_header);
    }

    let request_path = req.uri().path().to_string();
    if masked_export_blocked(&request_path, &claims.masked_fields) {
        audit_field_mask_hits(
            &state,
            &claims,
            &request_path,
            &[("export".to_string(), "export".to_string())],
            "blocked_export",
            "masked_export_blocked",
        )
        .await;
        return Err(AppError::forbidden(
            "this role cannot export unmasked sensitive fields",
        ));
    }
    let masked_fields = claims.masked_fields.clone();
    let audit_claims = claims.clone();
    req.extensions_mut().insert(claims);
    mask_json_response(
        next.run(req).await,
        &state,
        &audit_claims,
        &request_path,
        &masked_fields,
    )
    .await
}

fn request_mutates_data(method: &axum::http::Method) -> bool {
    !matches!(
        *method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    )
}

fn auth_cache_key(
    tenant_id: &str,
    user_id: &str,
    session_id: &str,
    branch_id: Option<&str>,
) -> String {
    format!(
        "{}:{}:{}:{}",
        tenant_id,
        user_id,
        session_id,
        branch_id.unwrap_or("default"),
    )
}

async fn apply_auth_cache(
    state: &AppState,
    claims: &mut AuthClaims,
    request_path: &str,
    cache_key: &str,
) -> Result<bool, AppError> {
    let now = Instant::now();
    let mut cache_entry = {
        let cache = state.auth_cache.read().await;
        cache.get(cache_key).cloned()
    };
    let Some(mut cached) = cache_entry.take() else {
        return Ok(false);
    };

    if now > cached.expires_at {
        let mut cache = state.auth_cache.write().await;
        cache.remove(cache_key);
        return Ok(false);
    }

    let current_permission_version =
        auth_repository::find_active_permission_version(&state.db, &claims.tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to validate user permissions"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
    if current_permission_version != cached.permission_version
        || (claims.permission_version != 0
            && claims.permission_version != current_permission_version)
    {
        let mut cache = state.auth_cache.write().await;
        cache.remove(cache_key);
        return Err(AppError::unauthenticated(
            "user permissions changed; please sign in again",
        ));
    }

    if !claims.session_id.is_empty()
        && now.duration_since(cached.last_session_check) > AUTH_SESSION_CHECK_TTL
    {
        if !auth_repository::is_session_active(
            &state.db,
            &claims.tenant_id,
            &claims.sub,
            &claims.session_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate session"))?
        {
            let mut cache = state.auth_cache.write().await;
            cache.remove(cache_key);
            return Err(AppError::unauthenticated("session is no longer active"));
        }
        cached.last_session_check = now;
        cached.expires_at = now + AUTH_CACHE_TTL;
        let mut cache = state.auth_cache.write().await;
        cache.insert(cache_key.to_string(), cached.clone());
    }

    claims.tenant_id = cached.tenant_id;
    claims.permission_version = cached.permission_version;
    claims.role = cached.role_name;
    claims.role_id = cached.role_id;
    claims.permissions = cached.permissions;
    claims.denied_permissions = cached.denied_permissions;
    claims.masked_fields = cached.masked_fields;
    claims.max_discount_paise = cached.max_discount_paise;
    claims.max_refund_paise = cached.max_refund_paise;
    claims.max_cash_movement_paise = cached.max_cash_movement_paise;
    claims.branch_id = cached.branch_id;

    if password_change_required(request_path, cached.must_change_password) {
        return Err(AppError::forbidden(
            "password change is required before using the application",
        ));
    }

    Ok(true)
}

fn require_loopback_dev_claim(req: &Request<Body>) -> Result<(), AppError> {
    let is_loopback = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|connect_info| connect_info.0.ip().is_loopback())
        .unwrap_or(false);
    if is_loopback {
        Ok(())
    } else {
        Err(AppError::unauthenticated("invalid or expired bearer token"))
    }
}

async fn mask_json_response(
    response: Response,
    state: &AppState,
    claims: &AuthClaims,
    path: &str,
    masked_fields: &[String],
) -> Result<Response, AppError> {
    if masked_fields.is_empty()
        || !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"))
    {
        return Ok(response);
    }

    let (mut parts, body) = response.into_parts();
    let bytes = to_bytes(body, 16 * 1024 * 1024)
        .await
        .map_err(|_| AppError::internal("failed to apply response field masking"))?;
    let mut payload: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::internal("failed to apply response field masking"))?;
    let mut hits = BTreeSet::new();
    mask_value(&mut payload, path, masked_fields, &mut hits);
    parts.headers.remove(header::CONTENT_LENGTH);
    let body = serde_json::to_vec(&payload)
        .map_err(|_| AppError::internal("failed to apply response field masking"))?;
    audit_field_mask_hits(
        state,
        claims,
        path,
        &hits.into_iter().collect::<Vec<_>>(),
        "mask",
        "role_masked_field",
    )
    .await;
    Ok(Response::from_parts(parts, Body::from(body)))
}

fn mask_value(
    value: &mut Value,
    path: &str,
    masked_fields: &[String],
    hits: &mut BTreeSet<(String, String)>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                mask_value(value, path, masked_fields, hits);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if let Some(field_group) = matched_mask(key, path, masked_fields) {
                    hits.insert((field_group.to_string(), key.to_string()));
                    *value = if is_contact_field(key) {
                        Value::String("[masked]".into())
                    } else {
                        Value::Null
                    };
                } else {
                    mask_value(value, path, masked_fields, hits);
                }
            }
        }
        _ => {}
    }
}

fn matched_mask<'a>(key: &str, path: &str, masked_fields: &'a [String]) -> Option<&'a str> {
    let normalized_key = key.to_ascii_lowercase();
    let has_mask = |mask: &str| masked_fields.iter().any(|value| value == mask);
    if has_mask("client.contact") && is_contact_field(key) {
        Some("client.contact")
    } else if has_mask("staff.payroll")
        && path.contains("staff-payroll")
        && is_money_field(&normalized_key)
    {
        Some("staff.payroll")
    } else if has_mask("inventory.cost")
        && ["inventory", "products", "purchases"]
            .iter()
            .any(|domain| path.contains(domain))
        && (normalized_key.contains("cost") || normalized_key.contains("purchaseprice"))
    {
        Some("inventory.cost")
    } else if has_mask("finance.amounts")
        && ["reports", "finance", "balance-sheet", "accounting"]
            .iter()
            .any(|domain| path.contains(domain))
        && is_money_field(&normalized_key)
    {
        Some("finance.amounts")
    } else {
        None
    }
}

fn is_contact_field(key: &str) -> bool {
    matches!(
        key,
        "phone"
            | "normalizedPhone"
            | "mobilePhone"
            | "homePhone"
            | "workPhone"
            | "email"
            | "recipient"
    )
}

fn is_money_field(normalized_key: &str) -> bool {
    normalized_key.ends_with("paise")
        || ["amount", "total", "balance", "revenue", "profit", "tax"]
            .iter()
            .any(|value| normalized_key.contains(value))
}

fn masked_export_blocked(path: &str, masked_fields: &[String]) -> bool {
    if !path.contains("export") && !path.contains("payslip") {
        return false;
    }
    masked_fields.iter().any(|mask| match mask.as_str() {
        "client.contact" => path.contains("client"),
        "staff.payroll" => path.contains("staff-payroll") || path.contains("payslip"),
        "inventory.cost" => {
            path.contains("inventory") || path.contains("products") || path.contains("purchases")
        }
        "finance.amounts" => {
            path.contains("reports")
                || path.contains("finance")
                || path.contains("balance-sheet")
                || path.contains("accounting")
        }
        _ => false,
    })
}

async fn audit_field_mask_hits(
    state: &AppState,
    claims: &AuthClaims,
    path: &str,
    hits: &[(String, String)],
    access_type: &str,
    reason: &str,
) {
    for (field_group, field_name) in hits {
        if let Err(error) = security_service::record_field_audit(
            &state.db,
            &claims.tenant_id,
            claims.branch_id.as_deref(),
            &claims.sub,
            "api_response",
            path,
            field_group,
            field_name,
            access_type,
            true,
            reason,
        )
        .await
        {
            tracing::warn!(error = ?error, field_group, field_name, "field audit write failed");
        }
    }
}

fn password_change_required(path: &str, must_change_password: bool) -> bool {
    must_change_password && !path.ends_with("/auth/change-password")
}

fn mfa_enrollment_required(path: &str, required: bool) -> bool {
    required && !path.contains("/auth/mfa/") && !path.ends_with("/auth/change-password")
}

fn should_use_auth_cache(session_id: &str, is_staff_app: bool) -> bool {
    !session_id.is_empty() && !is_staff_app
}

fn scope_header_mismatch(
    headers: &axum::http::HeaderMap,
    claims: &AuthClaims,
) -> Option<(&'static str, &'static str)> {
    let tenant = headers
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if tenant.is_some_and(|tenant| tenant != claims.tenant_id) {
        return Some((
            "tenant_header_mismatch",
            "tenant context does not match token",
        ));
    }

    let branch = headers
        .get("x-branch-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match claims
        .branch_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(claim_branch) if branch.is_some_and(|branch| branch != claim_branch) => Some((
            "branch_header_mismatch",
            "branch context does not match token",
        )),
        None if branch.is_some() => Some((
            "unscoped_token_branch_request",
            "branch context requires a branch-scoped token",
        )),
        _ => None,
    }
}

async fn audit_denied(state: &AppState, claims: &AuthClaims, reason: &str) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: claims.branch_id.as_deref(),
            identity: None,
            event_type: "permission.denied",
            outcome: "denied",
            ip_address: None,
            user_agent: None,
            details: serde_json::json!({ "reason": reason }),
        },
    )
    .await;
}

#[allow(dead_code)]
pub fn current_claims(req: &Request<Body>) -> Option<&AuthClaims> {
    req.extensions().get::<AuthClaims>()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use axum::http::{HeaderMap, HeaderValue};

    use super::{
        mask_value, masked_export_blocked, mfa_enrollment_required, password_change_required,
        request_mutates_data, scope_header_mismatch, should_use_auth_cache,
    };
    use crate::services::auth_service::AuthClaims;

    fn claims(branch_id: Option<&str>) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: branch_id.map(str::to_string),
            role: "Owner".into(),
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

    #[test]
    fn forced_password_change_allows_only_password_endpoint() {
        assert!(password_change_required("/api/v1/staff", true));
        assert!(!password_change_required(
            "/api/v1/auth/change-password",
            true
        ));
        assert!(!password_change_required("/api/v1/staff", false));
    }

    #[test]
    fn write_requests_require_active_entitlement() {
        assert!(!request_mutates_data(&axum::http::Method::GET));
        assert!(!request_mutates_data(&axum::http::Method::HEAD));
        assert!(request_mutates_data(&axum::http::Method::POST));
        assert!(request_mutates_data(&axum::http::Method::PATCH));
    }

    #[test]
    fn phase1_staff_app_sessions_always_use_authoritative_revocation_state() {
        assert!(!should_use_auth_cache("session-1", true));
        assert!(should_use_auth_cache("session-1", false));
        assert!(!should_use_auth_cache("", false));
    }

    #[test]
    fn mfa_enrollment_gate_allows_only_setup_and_password_change() {
        assert!(mfa_enrollment_required("/api/v1/staff", true));
        assert!(!mfa_enrollment_required("/api/v1/auth/mfa/setup", true));
        assert!(!mfa_enrollment_required(
            "/api/v1/auth/change-password",
            true
        ));
        assert!(!mfa_enrollment_required("/api/v1/staff", false));
    }

    #[test]
    fn forged_scope_headers_are_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert("x-tenant-id", HeaderValue::from_static("tenant-2"));
        assert_eq!(
            scope_header_mismatch(&headers, &claims(Some("branch-1"))).map(|mismatch| mismatch.0),
            Some("tenant_header_mismatch")
        );

        headers.insert("x-tenant-id", HeaderValue::from_static("tenant-1"));
        headers.insert("x-branch-id", HeaderValue::from_static("branch-2"));
        assert_eq!(
            scope_header_mismatch(&headers, &claims(Some("branch-1"))).map(|mismatch| mismatch.0),
            Some("branch_header_mismatch")
        );
        assert_eq!(
            scope_header_mismatch(&headers, &claims(None)).map(|mismatch| mismatch.0),
            Some("unscoped_token_branch_request")
        );

        headers.insert("x-branch-id", HeaderValue::from_static("branch-1"));
        assert!(scope_header_mismatch(&headers, &claims(Some("branch-1"))).is_none());
    }

    #[test]
    fn configured_profiles_mask_only_sensitive_fields() {
        let mut payload = serde_json::json!({
            "data": { "name": "Real Name", "phone": "9999999999", "grossPaise": 2500 }
        });
        let mut hits = BTreeSet::new();
        mask_value(
            &mut payload,
            "/api/v1/staff-payroll/runs/1",
            &["client.contact".into(), "staff.payroll".into()],
            &mut hits,
        );
        assert_eq!(payload["data"]["name"], "Real Name");
        assert_eq!(payload["data"]["phone"], "[masked]");
        assert!(payload["data"]["grossPaise"].is_null());
        assert!(hits.contains(&("client.contact".into(), "phone".into())));
        assert!(hits.contains(&("staff.payroll".into(), "grossPaise".into())));
        assert!(masked_export_blocked(
            "/api/v1/staff-payroll/runs/1/export",
            &["staff.payroll".into()]
        ));
    }
}
