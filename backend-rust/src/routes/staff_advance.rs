use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::staff_advance_repository::{AdvanceRecoveryRecord, StaffAdvanceRecord},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        security_service,
        staff_advance_service::{
            self, AdvanceCancelInput, AdvanceDecisionInput, AdvanceDisbursementInput,
            AdvanceRequestInput, AdvanceWaiverInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-advances", get(list_advances).post(create_advance))
        .route("/staff-advances/:id", get(get_advance))
        .route("/staff-advances/:id/decision", post(decide_advance))
        .route("/staff-advances/:id/cancel", post(cancel_advance))
        .route("/staff-advances/:id/disburse", post(disburse_advance))
        .route("/staff-advances/:id/waive", post(waive_advance))
        .route(
            "/staff-advances/:id/recoveries",
            get(list_advance_recoveries),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    staff_id: Option<String>,
    status: Option<String>,
}

async fn list_advances(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<StaffAdvanceRecord>> {
    let (tenant_id, branch_id) = advance_read_context(&claims, &headers)?;
    let rows = staff_advance_service::list_advances(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or("").trim(),
        query.status.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_read_context(&claims, &headers)?;
    let row = staff_advance_service::get_advance(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_advance_recoveries(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<AdvanceRecoveryRecord>> {
    let (tenant_id, branch_id) = advance_read_context(&claims, &headers)?;
    let rows =
        staff_advance_service::advance_recoveries(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<AdvanceRequestInput>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_manage_context(&claims, &headers)?;
    let row = staff_advance_service::request_advance(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdvanceDecisionInput>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_manage_context(&claims, &headers)?;
    let row = staff_advance_service::decide_advance(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn cancel_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdvanceCancelInput>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_manage_context(&claims, &headers)?;
    let row = staff_advance_service::cancel_advance(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn disburse_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdvanceDisbursementInput>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_manage_context(&claims, &headers)?;
    require_advance_action_mfa(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.mfa_code.as_deref(),
        "payroll.advance.disburse",
    )
    .await?;
    let row = staff_advance_service::disburse_advance(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn waive_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AdvanceWaiverInput>,
) -> ApiResult<StaffAdvanceRecord> {
    let (tenant_id, branch_id) = advance_manage_context(&claims, &headers)?;
    require_advance_action_mfa(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.mfa_code.as_deref(),
        "payroll.advance.waive",
    )
    .await?;
    let row = staff_advance_service::waive_advance(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn require_advance_action_mfa(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    code: Option<&str>,
    action: &str,
) -> Result<(), AppError> {
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        tenant_id,
        branch_id,
        &claims.sub,
        &claims.session_id,
        code,
        action,
    )
    .await
}

fn advance_read_context(
    claims: &AuthClaims,
    headers: &axum::http::HeaderMap,
) -> Result<(String, String), AppError> {
    advance_context(
        claims,
        headers,
        &["staff.payroll.read", "staff.payroll.manage"],
    )
}

fn advance_manage_context(
    claims: &AuthClaims,
    headers: &axum::http::HeaderMap,
) -> Result<(String, String), AppError> {
    advance_context(claims, headers, &["staff.payroll.manage"])
}

fn advance_context(
    claims: &AuthClaims,
    headers: &axum::http::HeaderMap,
    permissions: &[&str],
) -> Result<(String, String), AppError> {
    ensure_advance_access(claims, permissions)?;
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    if tenant_id != claims.tenant_id {
        return Err(AppError::forbidden("tenant context does not match token"));
    }
    if claims.branch_id.as_deref() != Some(branch_id.as_str()) {
        return Err(AppError::forbidden("branch context does not match token"));
    }
    Ok((tenant_id, branch_id))
}

fn ensure_advance_access(claims: &AuthClaims, permissions: &[&str]) -> Result<(), AppError> {
    const ALLOWED_ROLES: &[&str] = &["owner", "admin", "accountant"];
    let denied = claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.iter().any(|required| denied == required));
    let role_allowed = ALLOWED_ROLES
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    let permission_allowed = claims
        .permissions
        .iter()
        .any(|allowed| permissions.iter().any(|required| allowed == required));
    if !denied && (role_allowed || permission_allowed) {
        Ok(())
    } else {
        Err(AppError::forbidden("salary advance access is restricted"))
    }
}
