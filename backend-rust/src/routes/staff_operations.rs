use chrono::NaiveDate;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::auth_repository::{self, AuthAuditInput},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        staff_operations_service::{
            self, BranchTransferRequest, DecisionRequest, OperationAttendanceRequest,
            OperationAutomationRequest, OperationSchedulePatchRequest, OperationScheduleRequest,
            OperationTaskPatchRequest, OperationTaskRequest, OperationTemplateRequest,
            PerformanceReviewRequest, ShiftSwapRequest, SkillLicenseRequest,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff/operations/templates",
            get(list_operation_templates).post(create_operation_template),
        )
        .route(
            "/staff/operations/schedules",
            get(list_operation_schedules).post(create_operation_schedules),
        )
        .route(
            "/staff/operations/schedules/:id",
            patch(update_operation_schedule),
        )
        .route("/staff/operations/tasks", get(list_operation_tasks))
        .route("/staff/operations/:id/tasks", post(create_operation_task))
        .route("/staff/operations/tasks/:id", patch(update_operation_task))
        .route(
            "/staff/operations/attendance",
            get(list_operation_attendance),
        )
        .route(
            "/staff/operations/:id/attendance",
            post(upsert_operation_attendance),
        )
        .route("/staff/operations/reports", get(operation_report))
        .route(
            "/staff/operations/automations/run",
            post(run_operation_automations),
        )
        .route(
            "/staff/shift-swaps",
            get(list_shift_swaps).post(create_shift_swap),
        )
        .route("/staff/shift-swaps/:id/decision", post(decide_shift_swap))
        .route(
            "/staff/shift-swaps/:id/employee-decision",
            post(decide_shift_swap_target),
        )
        .route(
            "/staff/branch-transfers",
            get(list_branch_transfers).post(create_branch_transfer),
        )
        .route(
            "/staff/branch-transfers/:id/decision",
            post(decide_branch_transfer),
        )
        .route(
            "/staff/skill-licenses",
            get(list_skill_licenses).post(save_skill_license),
        )
        .route(
            "/staff/performance-reviews",
            get(list_reviews).post(save_review),
        )
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffQuery {
    staff_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationTemplateQuery {
    operation_type: Option<String>,
    active_only: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationScheduleQuery {
    from: NaiveDate,
    to: NaiveDate,
    status: Option<String>,
    operation_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationChildQuery {
    operation_id: Option<String>,
    staff_id: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationReportQuery {
    from: NaiveDate,
    to: NaiveDate,
    staff_id: Option<String>,
    operation_type: Option<String>,
}

async fn list_operation_templates(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OperationTemplateQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::StaffOperationTemplateRecord>>
{
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_operation_templates(
        &state.db,
        &tenant_id,
        &branch_id,
        query.operation_type.as_deref().unwrap_or(""),
        query.active_only.unwrap_or(true),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_operation_template(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationTemplateRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::StaffOperationTemplateRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::create_operation_template(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_operation_schedules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OperationScheduleQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::StaffOperationScheduleRecord>>
{
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_operation_schedules(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        query.status.as_deref().unwrap_or(""),
        query.operation_type.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_operation_schedules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationScheduleRequest>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::StaffOperationScheduleRecord>>
{
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::create_operation_schedules(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn update_operation_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OperationSchedulePatchRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::StaffOperationScheduleRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::update_operation_schedule(
        &state.db, &tenant_id, &branch_id, &id, payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_operation_tasks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OperationChildQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::StaffOperationTaskRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_operation_tasks(
        &state.db,
        &tenant_id,
        &branch_id,
        query.operation_id.as_deref().unwrap_or(""),
        query.staff_id.as_deref().unwrap_or(""),
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_operation_task(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OperationTaskRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::StaffOperationTaskRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::create_operation_task(
        &state.db, &tenant_id, &branch_id, &id, payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_operation_task(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OperationTaskPatchRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::StaffOperationTaskRecord> {
    ensure_staff_read(&claims)?;
    let manager_action = is_staff_manager(&claims);
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::update_operation_task(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        manager_action,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_operation_attendance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OperationChildQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::StaffOperationAttendanceRecord>>
{
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_operation_attendance(
        &state.db,
        &tenant_id,
        &branch_id,
        query.operation_id.as_deref().unwrap_or(""),
        query.staff_id.as_deref().unwrap_or(""),
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn upsert_operation_attendance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OperationAttendanceRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::StaffOperationAttendanceRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::upsert_operation_attendance(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn operation_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OperationReportQuery>,
) -> ApiResult<staff_operations_service::OperationReportResponse> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = staff_operations_service::operation_report(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        query.staff_id.as_deref().unwrap_or(""),
        query.operation_type.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn run_operation_automations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OperationAutomationRequest>,
) -> ApiResult<staff_operations_service::OperationAutomationRunResponse> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = staff_operations_service::run_operation_automations(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_shift_swaps(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::ShiftSwapRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = if is_staff_manager(&claims) {
        String::new()
    } else {
        crate::services::staff_enterprise_service::self_staff_id(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
        )
        .await?
    };
    let rows = staff_operations_service::list_shift_swaps(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
        &staff_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_shift_swap(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ShiftSwapRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::ShiftSwapRecord> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let source_staff_id = if is_staff_manager(&claims) {
        String::new()
    } else {
        crate::services::staff_enterprise_service::self_staff_id(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
        )
        .await?
    };
    let row = staff_operations_service::create_shift_swap(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &source_staff_id,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.shift_swap.requested",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_shift_swap_target(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::ShiftSwapRecord> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = crate::services::staff_enterprise_service::self_staff_id(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
    )
    .await?;
    let row = staff_operations_service::decide_shift_swap_target(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &staff_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.shift_swap.employee_decided",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_shift_swap(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::ShiftSwapRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::decide_shift_swap(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.shift_swap.manager_decided",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_branch_transfers(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::BranchTransferRecord>> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_branch_transfers(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_branch_transfer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BranchTransferRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::BranchTransferRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::create_branch_transfer(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_branch_transfer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::BranchTransferRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::decide_branch_transfer(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_skill_licenses(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::SkillLicenseRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_skill_licenses(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_skill_license(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SkillLicenseRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::SkillLicenseRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::save_skill_license(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_reviews(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::PerformanceReviewRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_reviews(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_review(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PerformanceReviewRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::PerformanceReviewRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::save_review(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

fn ensure_staff_read(claims: &AuthClaims) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &[
        "owner",
        "admin",
        "manager",
        "accountant",
        "receptionist",
        "staff",
    ];
    if ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff access is restricted"))
    }
}

fn is_staff_manager(claims: &AuthClaims) -> bool {
    const ALLOWED: &[&str] = &["owner", "admin", "manager"];
    ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
}

fn ensure_staff_manage(claims: &AuthClaims) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &["owner", "admin", "manager"];
    if ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff management access is restricted"))
    }
}

async fn audit(
    state: &AppState,
    claims: &AuthClaims,
    branch_id: &str,
    event_type: &str,
    entity_id: &str,
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
            details: json!({"entityId":entity_id}),
        },
    )
    .await;
}
