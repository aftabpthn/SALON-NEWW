use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{NaiveDate, NaiveTime};
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_leave_repository::{
            self, LeaveAccrualEventRecord, LeaveBalanceRecord, LeaveDayInput, LeaveRequestRecord,
        },
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
        .route("/staff-leave/accrual-history", get(list_accrual_history))
        .route("/staff-leave/requests/:id/approve", post(approve))
        .route("/staff-leave/requests/:id/reject", post(reject))
        .route("/staff-leave/requests/:id/withdraw", post(withdraw))
        .route("/staff-leave/requests/:id/cancel", post(cancel))
        .route("/staff-leave/requests/:id/restore", post(restore))
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
    #[serde(default)]
    day_parts: Vec<LeaveDayRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeaveDayRequest {
    date: NaiveDate,
    start_time: Option<String>,
    end_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    version: i32,
    review_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    version: i32,
    reason: String,
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

async fn list_accrual_history(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BalanceQuery>,
) -> ApiResult<Vec<LeaveAccrualEventRecord>> {
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
    let rows = staff_leave_service::accrual_history(
        &state.db, &tenant_id, &branch_id, query.year, &staff_id,
    )
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
    let day_parts = payload
        .day_parts
        .into_iter()
        .map(|part| {
            Ok(LeaveDayInput {
                leave_date: part.date,
                start_time: parse_leave_time(part.start_time.as_deref(), "startTime")?,
                end_time: parse_leave_time(part.end_time.as_deref(), "endTime")?,
                day_fraction: 1.0,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
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
        day_parts,
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

async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CancelRequest>,
) -> ApiResult<LeaveRequestRecord> {
    ensure_leave_request_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let current = staff_leave_repository::get_request(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load leave request"))?
        .ok_or_else(|| AppError::not_found("leave request not found"))?;
    let requested_staff_id = current.staff_id.as_str();
    let staff_id =
        scoped_leave_staff_id(&state, &claims, &tenant_id, &branch_id, requested_staff_id).await?;
    let row = staff_leave_service::cancel(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &staff_id,
        &claims.sub,
        payload.version,
        &payload.reason,
    )
    .await?;
    audit_leave_record(&state, &claims, &branch_id, "staff.leave.cancelled", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}

fn parse_leave_time(value: Option<&str>, field: &str) -> Result<Option<NaiveTime>, AppError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    NaiveTime::parse_from_str(value, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M:%S"))
        .map(Some)
        .map_err(|_| AppError::validation(format!("{field} must be HH:mm")))
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

async fn withdraw(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<LeaveRequestRecord> {
    ensure_leave_request_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_leave_service::withdraw(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &staff_id,
        &claims.sub,
        payload.version,
    )
    .await?;
    audit_leave_record(&state, &claims, &branch_id, "staff.leave.withdrawn", &row).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn restore(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<LeaveRequestRecord> {
    let (tenant_id, branch_id) = leave_context(&claims, &headers)?;
    let row = staff_leave_service::restore(&state.db, &tenant_id, &branch_id, &id, payload.version)
        .await?;
    audit_leave_record(&state, &claims, &branch_id, "staff.leave.restored", &row).await;
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
        &[
            "staff.leave.manage",
            "staff.self_manage",
            "staff_self.write",
        ],
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

async fn audit_leave_record(
    state: &AppState,
    claims: &AuthClaims,
    branch_id: &str,
    event_type: &str,
    row: &LeaveRequestRecord,
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
            details: json!({"leaveRequestId":row.id,"recordName":row.staff_name,"version":row.version,"restorable":event_type.ends_with("withdrawn")}),
        },
    )
    .await;
}
