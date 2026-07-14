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
        staff_advanced_repository::{
            BiometricConsentRecord, BiometricDeviceRecord, BiometricEventRecord,
            BiometricMappingRecord, IncentiveRuleRecord, MobilePayrollSummary,
            PayrollAdjustmentRuleRecord, PayrollStructureRecord, StaffMobileConflictRecord,
            StaffTaskCommentRecord, StaffTaskRecord,
        },
    },
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        staff_advanced_service::{
            self, BiometricConsentRequest, BiometricDeviceRequest, BiometricEventRequest,
            BiometricGatewayRegistration, BiometricGatewayRequest, BiometricMappingRequest,
            IncentiveCopyRequest, IncentiveRuleRequest, MobileDashboardResponse,
            MobileDeviceRegistration, MobileDeviceRequest, MobileSyncRequest, MobileSyncResponse,
            MobileTodayResponse, PayrollAdjustmentRuleRequest, PayrollStructureRequest,
            StaffPerformanceResponse, StaffTaskRequest,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff/incentive-rules",
            get(list_incentive_rules).post(create_incentive_rule),
        )
        .route(
            "/staff/incentive-rules/:id",
            axum::routing::patch(update_incentive_rule),
        )
        .route("/staff/incentive-rules/:id/copy", post(copy_incentive_rule))
        .route(
            "/staff/payroll-adjustment-rules",
            get(list_adjustment_rules).post(create_adjustment_rule),
        )
        .route(
            "/staff/payroll-adjustment-rules/:id",
            axum::routing::patch(update_adjustment_rule),
        )
        .route(
            "/staff/payroll-structure",
            get(get_payroll_structure).put(save_payroll_structure),
        )
        .route("/staff/tasks", get(list_tasks).post(create_task))
        .route("/staff/tasks/:id", axum::routing::patch(update_task))
        .route("/staff/tasks/:id/comments", post(add_task_comment))
        .route("/staff/performance", get(get_performance))
        .route("/staff/performance/:staff_id", get(get_staff_performance))
        .route(
            "/staff/biometric/devices",
            get(list_biometric_devices).post(create_biometric_device),
        )
        .route(
            "/staff/biometric/gateways",
            post(register_biometric_gateway),
        )
        .route(
            "/staff/biometric/mappings",
            get(list_biometric_mappings).post(create_biometric_mapping),
        )
        .route(
            "/staff/biometric/mappings/:id/approve",
            post(approve_biometric_mapping),
        )
        .route(
            "/staff/biometric/consents",
            get(list_biometric_consents).post(save_biometric_consent),
        )
        .route(
            "/staff/biometric/consents/:id/deletion-request",
            post(request_biometric_deletion),
        )
        .route("/staff/biometric/events", get(list_biometric_events))
        .route(
            "/staff/biometric/exceptions",
            get(list_biometric_exceptions),
        )
        .route("/staff/mobile/dashboard", get(get_mobile_dashboard))
        .route("/staff/mobile/snapshot", get(get_mobile_dashboard))
        .route("/staff/mobile/today", get(get_mobile_today))
        .route("/staff/mobile/payroll", get(get_mobile_payroll))
        .route("/staff/mobile/targets", get(get_mobile_targets))
        .route("/staff/mobile/devices", post(register_mobile_device))
        .route("/staff/mobile/sync", post(sync_mobile_mutations))
        .route("/staff/mobile/conflicts", get(list_mobile_conflicts))
        .route(
            "/staff/mobile/conflicts/:id/resolve",
            post(resolve_mobile_conflict),
        )
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff/biometric/gateways/:id/heartbeat",
            post(heartbeat_biometric_gateway),
        )
        .route(
            "/staff/biometric/gateways/:id/events",
            post(process_biometric_event),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncentiveQuery {
    target_type: Option<String>,
    assignee_id: Option<String>,
    active: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct AdjustmentQuery {
    kind: Option<String>,
    active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskQuery {
    staff_id: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceQuery {
    date_from: NaiveDate,
    date_to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCommentRequest {
    comment_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionRequest {
    version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayHeartbeatRequest {
    version_label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MobileConflictQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BiometricEventQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MobileConflictResolutionRequest {
    version: i32,
    resolution: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileDashboardQuery {
    device_id: String,
    date: Option<NaiveDate>,
}

async fn list_incentive_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<IncentiveQuery>,
) -> ApiResult<Vec<IncentiveRuleRecord>> {
    ensure_read_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_incentive_rules(
        &state.db,
        &tenant_id,
        &branch_id,
        query.target_type.as_deref().unwrap_or(""),
        query.assignee_id.as_deref().unwrap_or(""),
        query.active,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_incentive_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<IncentiveRuleRequest>,
) -> ApiResult<IncentiveRuleRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::create_incentive_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.incentive.created",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_incentive_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<IncentiveRuleRequest>,
) -> ApiResult<IncentiveRuleRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::update_incentive_rule(
        &state.db, &tenant_id, &branch_id, &id, payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.incentive.updated",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn copy_incentive_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<IncentiveCopyRequest>,
) -> ApiResult<Vec<IncentiveRuleRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::copy_incentive_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.incentive.copied", &id).await;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_adjustment_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<AdjustmentQuery>,
) -> ApiResult<Vec<PayrollAdjustmentRuleRecord>> {
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_adjustment_rules(
        &state.db,
        &tenant_id,
        &branch_id,
        query.kind.as_deref().unwrap_or(""),
        query.active,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_adjustment_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PayrollAdjustmentRuleRequest>,
) -> ApiResult<PayrollAdjustmentRuleRecord> {
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::create_adjustment_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.payroll_rule.created",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_adjustment_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PayrollAdjustmentRuleRequest>,
) -> ApiResult<PayrollAdjustmentRuleRecord> {
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::update_adjustment_rule(
        &state.db, &tenant_id, &branch_id, &id, payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.payroll_rule.updated",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_payroll_structure(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Option<PayrollStructureRecord>> {
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        staff_advanced_service::get_payroll_structure(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn save_payroll_structure(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PayrollStructureRequest>,
) -> ApiResult<PayrollStructureRecord> {
    ensure_payroll_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::save_payroll_structure(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.payroll_structure.saved",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_biometric_devices(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<BiometricDeviceRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        staff_advanced_service::list_biometric_devices(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_biometric_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BiometricDeviceRequest>,
) -> ApiResult<BiometricDeviceRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::create_biometric_device(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_device.created",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn register_biometric_gateway(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BiometricGatewayRequest>,
) -> ApiResult<BiometricGatewayRegistration> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::register_biometric_gateway(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_gateway.registered",
        &row.gateway.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn heartbeat_biometric_gateway(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<GatewayHeartbeatRequest>,
) -> ApiResult<crate::repositories::staff_advanced_repository::BiometricGatewayRecord> {
    let row = staff_advanced_service::heartbeat_biometric_gateway(
        &state.db,
        &id,
        gateway_api_key(&headers)?,
        payload.version_label.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn process_biometric_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BiometricEventRequest>,
) -> ApiResult<BiometricEventRecord> {
    let row = staff_advanced_service::process_biometric_event(
        &state.db,
        &id,
        gateway_api_key(&headers)?,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_biometric_mappings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<BiometricMappingRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        staff_advanced_service::list_biometric_mappings(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_biometric_mapping(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BiometricMappingRequest>,
) -> ApiResult<BiometricMappingRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::create_biometric_mapping(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_mapping.created",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_biometric_mapping(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<VersionRequest>,
) -> ApiResult<BiometricMappingRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::approve_biometric_mapping(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload.version,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_mapping.approved",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_biometric_consents(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<BiometricConsentRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        staff_advanced_service::list_biometric_consents(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_biometric_consent(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BiometricConsentRequest>,
) -> ApiResult<BiometricConsentRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::save_biometric_consent(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_consent.saved",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn request_biometric_deletion(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<VersionRequest>,
) -> ApiResult<BiometricConsentRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::request_biometric_deletion(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.version,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.biometric_consent.deletion_requested",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

fn gateway_api_key(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("x-gateway-api-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::forbidden("biometric gateway API key is required"))
}

async fn list_biometric_events(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BiometricEventQuery>,
) -> ApiResult<Vec<BiometricEventRecord>> {
    ensure_read_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_biometric_events(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_biometric_exceptions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<BiometricEventRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_biometric_exceptions(&state.db, &tenant_id, &branch_id)
        .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_mobile_dashboard(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MobileDashboardQuery>,
) -> ApiResult<MobileDashboardResponse> {
    let row = mobile_dashboard_data(&state, &claims, &headers, query).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_mobile_today(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MobileDashboardQuery>,
) -> ApiResult<MobileTodayResponse> {
    let row = mobile_dashboard_data(&state, &claims, &headers, query).await?;
    Ok(Json(ApiResponse::ok(row.today)))
}

async fn get_mobile_payroll(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MobileDashboardQuery>,
) -> ApiResult<Vec<MobilePayrollSummary>> {
    let row = mobile_dashboard_data(&state, &claims, &headers, query).await?;
    Ok(Json(ApiResponse::ok(row.payroll)))
}

async fn get_mobile_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MobileDashboardQuery>,
) -> ApiResult<Vec<IncentiveRuleRecord>> {
    let row = mobile_dashboard_data(&state, &claims, &headers, query).await?;
    Ok(Json(ApiResponse::ok(row.targets)))
}

async fn mobile_dashboard_data(
    state: &AppState,
    claims: &AuthClaims,
    headers: &HeaderMap,
    query: MobileDashboardQuery,
) -> Result<MobileDashboardResponse, AppError> {
    ensure_mobile_access(claims)?;
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    staff_advanced_service::mobile_dashboard(
        &state.db,
        &tenant_id,
        &branch_id,
        device_sync_token(headers)?,
        &query.device_id,
        query.date,
    )
    .await
}

async fn register_mobile_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MobileDeviceRequest>,
) -> ApiResult<MobileDeviceRegistration> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        staff_advanced_service::register_mobile_device(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.mobile_device.registered",
        &row.device.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn sync_mobile_mutations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MobileSyncRequest>,
) -> ApiResult<MobileSyncResponse> {
    ensure_mobile_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::sync_mobile_mutations(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        device_sync_token(&headers)?,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_mobile_conflicts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MobileConflictQuery>,
) -> ApiResult<Vec<StaffMobileConflictRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_mobile_conflicts(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or("open"),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn resolve_mobile_conflict(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<MobileConflictResolutionRequest>,
) -> ApiResult<StaffMobileConflictRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::resolve_mobile_conflict(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload.version,
        &payload.resolution,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.mobile_conflict.resolved",
        &row.id,
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

fn device_sync_token(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("x-device-sync-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::forbidden("mobile device sync token is required"))
}

async fn list_tasks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<TaskQuery>,
) -> ApiResult<Vec<StaffTaskRecord>> {
    ensure_read_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_tasks(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_task(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffTaskRequest>,
) -> ApiResult<StaffTaskRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::create_task(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.task.created", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_task(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffTaskRequest>,
) -> ApiResult<StaffTaskRecord> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::update_task(&state.db, &tenant_id, &branch_id, &id, payload)
        .await?;
    audit(&state, &claims, &branch_id, "staff.task.updated", &row.id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn add_task_comment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TaskCommentRequest>,
) -> ApiResult<StaffTaskCommentRecord> {
    ensure_read_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::add_task_comment(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        &payload.comment_text,
    )
    .await?;
    audit(&state, &claims, &branch_id, "staff.task.commented", &id).await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_performance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<PerformanceQuery>,
) -> ApiResult<StaffPerformanceResponse> {
    ensure_read_access(&claims)?;
    performance_response(&state, &headers, query, "").await
}

async fn get_staff_performance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Query(query): Query<PerformanceQuery>,
) -> ApiResult<StaffPerformanceResponse> {
    ensure_read_access(&claims)?;
    performance_response(&state, &headers, query, &staff_id).await
}

async fn performance_response(
    state: &AppState,
    headers: &HeaderMap,
    query: PerformanceQuery,
    staff_id: &str,
) -> ApiResult<StaffPerformanceResponse> {
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    let response = staff_advanced_service::performance(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date_from,
        query.date_to,
        staff_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(response)))
}

fn ensure_read_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_role(claims, &["owner", "admin", "manager", "accountant"])
}

fn ensure_manager_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_role(claims, &["owner", "admin", "manager"])
}

fn ensure_payroll_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_role(claims, &["owner", "admin", "accountant"])
}

fn ensure_mobile_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_role(claims, &["owner", "admin", "manager", "staff"])
}

fn ensure_role(claims: &AuthClaims, roles: &[&str]) -> Result<(), AppError> {
    if roles
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff advanced access is restricted"))
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
            details: json!({ "entityId": entity_id }),
        },
    )
    .await;
}
