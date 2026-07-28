use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_leave_repository::{LeaveBalanceRecord, LeaveRequestRecord},
    },
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        staff_enterprise_service, staff_leave_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff-leave/requests",
            get(list_requests).post(create_request),
        )
        .route("/staff-leave/balances", get(list_balances))
        .route("/staff-leave/requests/:id/approve", post(approve))
        .route("/staff-leave/requests/:id/reject", post(reject))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeaveQuery {
    year: i32,
    month: u32,
    staff_id: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BalanceQuery {
    year: i32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLeaveRequest {
    staff_id: String,
    leave_type: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    version: i32,
    review_note: Option<String>,
}

async fn list_requests(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<LeaveQuery>,
) -> ApiResult<Vec<LeaveRequestRecord>> {
    ensure_leave_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_leave_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    let rows = staff_leave_service::list_requests(
        &state.db,
        &tenant_id,
        &branch_id,
        query.year,
        query.month,
        &staff_id,
        query
            .status
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_lowercase()
            .as_str(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_balances(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BalanceQuery>,
) -> ApiResult<Vec<LeaveBalanceRecord>> {
    ensure_leave_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_leave_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    let rows =
        staff_leave_service::balances(&state.db, &tenant_id, &branch_id, query.year, &staff_id)
            .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_request(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CreateLeaveRequest>,
) -> ApiResult<LeaveRequestRecord> {
    ensure_leave_request_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        scoped_leave_staff_id(&state, &claims, &tenant_id, &branch_id, &payload.staff_id).await?;
    let row = staff_leave_service::create_request(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &staff_id,
        &payload.leave_type,
        payload.start_date,
        payload.end_date,
        payload.reason.as_deref().unwrap_or(""),
    )
    .await?;
    audit_leave(
        &state,
        &claims,
        &branch_id,
        "staff.leave.requested",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<LeaveRequestRecord> {
    let (tenant_id, branch_id) = leave_context(&claims, &headers)?;
    let row = staff_leave_service::approve(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload.version,
        payload.review_note.as_deref().unwrap_or(""),
    )
    .await?;
    audit_leave(&state, &claims, &branch_id, "staff.leave.approved", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn reject(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<LeaveRequestRecord> {
    let (tenant_id, branch_id) = leave_context(&claims, &headers)?;
    let row = staff_leave_service::reject(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload.version,
        payload.review_note.as_deref().unwrap_or(""),
    )
    .await?;
    audit_leave(&state, &claims, &branch_id, "staff.leave.rejected", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

fn leave_context(claims: &AuthClaims, headers: &HeaderMap) -> Result<(String, String), AppError> {
    ensure_leave_manage_access(claims)?;
    tenant_branch(headers)
}

fn ensure_leave_access(claims: &AuthClaims) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        "staff.app.leaves.read",
        &["owner", "admin", "manager", "staff"],
        &[
            "staff.leave.read",
            "staff.leave.manage",
            "staff.self_manage",
            "staff_self.write",
        ],
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "Staff App leave permission is required",
        ))
    }
}

fn ensure_leave_request_access(claims: &AuthClaims) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        "staff.app.leaves.manage",
        &["owner", "admin", "manager", "staff"],
        &["staff.self_manage", "staff_self.write"],
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "Staff App leave request permission is required",
        ))
    }
}

fn ensure_leave_manage_access(claims: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
        || (claims
            .permissions
            .iter()
            .any(|permission| permission == "staff.leave.manage")
            && !claims
                .denied_permissions
                .iter()
                .any(|permission| permission == "staff.leave.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("leave management access is restricted"))
    }
}

async fn scoped_leave_staff_id(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested_staff_id: &str,
) -> Result<String, AppError> {
    if !["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        staff_enterprise_service::self_staff_id(&state.db, tenant_id, branch_id, &claims.sub).await
    } else {
        Ok(requested_staff_id.trim().to_string())
    }
}

async fn audit_leave(
    state: &AppState,
    claims: &AuthClaims,
    branch_id: &str,
    event_type: &str,
    request_id: &str,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "leaveRequestId": request_id }),
        },
    )
    .await;
}
