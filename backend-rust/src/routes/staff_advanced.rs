use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{FixedOffset, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_advanced_repository::{
            BiometricConsentRecord, BiometricDeviceRecord, BiometricEventRecord,
            BiometricGatewayRecord, BiometricMappingRecord, IncentiveRuleRecord,
            MobilePayrollSummary, PayrollAdjustmentRuleRecord, PayrollStructureRecord,
            StaffMobileConflictRecord, StaffServiceTargetRecord, StaffTaskCommentRecord,
            StaffTaskRecord,
        },
    },
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        staff_advanced_service::{
            self, BiometricConsentRequest, BiometricDeviceRequest, BiometricEventRequest,
            BiometricGatewayRegistration, BiometricGatewayRequest, BiometricMappingRequest,
            IncentiveCopyRequest, IncentiveRuleRequest, MobileCrashReportRequest,
            MobileDashboardResponse, MobileDeviceRegistration, MobileDeviceRequest,
            MobilePushSubscriptionRequest, MobileSyncRequest, MobileSyncResponse,
            MobileTodayResponse, PayrollAdjustmentRuleRequest, PayrollStructureRequest,
            SelfPushSubscriptionRequest, StaffPerformanceResponse, StaffServiceTargetRequest,
            StaffTaskRequest,
        },
        staff_app_service, staff_enterprise_service,
    },
    state::{AppState, TeamChatEvent},
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
        .route(
            "/staff/service-targets",
            get(list_service_targets).post(create_service_targets),
        )
        .route(
            "/staff/self/service-targets",
            get(list_self_service_targets),
        )
        .route("/staff/tasks/:id", axum::routing::patch(update_task))
        .route("/staff/self/tasks", get(list_self_tasks))
        .route("/staff/self/roster", get(list_self_roster))
        .route("/staff/self/calendar", get(list_self_calendar))
        .route("/staff/self/targets", get(get_self_targets))
        .route("/staff/self/mobile/push-config", get(get_self_push_config))
        .route(
            "/staff/self/mobile/release-policy",
            get(get_self_release_policy),
        )
        .route(
            "/staff/self/mobile/devices",
            post(register_self_push_device),
        )
        .route(
            "/staff/self/mobile/push-subscriptions",
            post(save_self_push_subscription),
        )
        .route(
            "/staff/self/mobile/crash-reports",
            post(save_mobile_crash_report),
        )
        .route(
            "/staff/self/mobile/telemetry",
            post(save_mobile_device_telemetry),
        )
        .route(
            "/staff/self/tasks/:id/status",
            axum::routing::patch(update_self_task_status),
        )
        .route(
            "/staff-self/calendar/:id",
            axum::routing::patch(update_self_schedule),
        )
        .route("/staff-self/calendar", post(create_self_schedule))
        .route("/staff/tasks/:id/comments", post(add_task_comment))
        .route("/staff/performance", get(get_performance))
        .route("/staff/performance/:staff_id", get(get_staff_performance))
        .route(
            "/staff/biometric/devices",
            get(list_biometric_devices).post(create_biometric_device),
        )
        .route(
            "/staff/biometric/gateways",
            get(list_biometric_gateways).post(register_biometric_gateway),
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
        .route(
            "/staff/mobile/devices/:id/push-subscription",
            post(save_mobile_push_subscription),
        )
        .route("/staff/mobile/sync", post(sync_mobile_mutations))
        .route("/staff/mobile/conflicts", get(list_mobile_conflicts))
        .route("/staff/mobile/telemetry", get(list_mobile_device_telemetry))
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
struct SelfTaskStatusRequest {
    status: String,
    version: i32,
}

#[derive(Debug, Deserialize)]
struct SelfPushDeviceRequest {
    id: String,
    platform: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfPushConfigResponse {
    configured: bool,
    public_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelfScheduleUpdateRequest {
    version: i32,
    schedule_date: Option<NaiveDate>,
    start_time: Option<String>,
    end_time: Option<String>,
    status: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelfScheduleCreateRequest {
    schedule_date: NaiveDate,
    start_time: String,
    end_time: String,
    notes: Option<String>,
    room_id: Option<String>,
    role_id: Option<String>,
    job_title: Option<String>,
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
    ensure_payroll_read_access(&claims)?;
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
    ensure_payroll_manage_access(&claims)?;
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
    ensure_payroll_manage_access(&claims)?;
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
    ensure_payroll_read_access(&claims)?;
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
    ensure_payroll_manage_access(&claims)?;
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

async fn list_biometric_gateways(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<BiometricGatewayRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        staff_advanced_service::list_biometric_gateways(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
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

async fn save_mobile_push_subscription(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
    Json(payload): Json<MobilePushSubscriptionRequest>,
) -> ApiResult<crate::repositories::staff_advanced_repository::MobilePushSubscriptionRecord> {
    ensure_mobile_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_advanced_service::save_mobile_push_subscription(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &device_id,
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

#[derive(Debug, Deserialize)]
struct SelfScheduleRangeQuery {
    from: NaiveDate,
    to: NaiveDate,
}

async fn list_self_tasks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<StaffTaskRecord>> {
    ensure_staff_app_access(
        &claims,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write", "read:staff"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let rows = staff_advanced_service::list_tasks(&state.db, &tenant_id, &branch_id, &staff_id, "")
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
    publish_task_event(&state, &tenant_id, &branch_id, &claims.sub, &row.id);
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_service_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<TaskQuery>,
) -> ApiResult<Vec<StaffServiceTargetRecord>> {
    ensure_read_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::list_service_targets(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_service_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffServiceTargetRequest>,
) -> ApiResult<Vec<StaffServiceTargetRecord>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_advanced_service::create_service_targets(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    for row in &rows {
        audit(
            &state,
            &claims,
            &branch_id,
            "staff.service_target.created",
            &row.id,
        )
        .await;
    }
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_self_service_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<StaffServiceTargetRecord>> {
    ensure_staff_app_access(
        &claims,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let rows = staff_advanced_service::list_service_targets(
        &state.db, &tenant_id, &branch_id, &staff_id, "",
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
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
    publish_task_event(&state, &tenant_id, &branch_id, &claims.sub, &row.id);
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_self_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<IncentiveRuleRecord>> {
    ensure_staff_app_access(
        &claims,
        "staff.app.tasks.read",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let rows =
        staff_advanced_service::self_targets(&state.db, &tenant_id, &branch_id, &staff_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_self_push_config(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<SelfPushConfigResponse> {
    ensure_staff_app_access(
        &claims,
        "staff.app.notifications.read",
        &["notifications.read", "staff.self_manage"],
    )?;
    let public_key = state
        .settings
        .mobile_push_public_key
        .clone()
        .unwrap_or_default();
    Ok(Json(ApiResponse::ok(SelfPushConfigResponse {
        configured: state.settings.mobile_push_provider_enabled() && !public_key.is_empty(),
        public_key,
    })))
}

#[derive(Debug, Deserialize)]
struct ReleasePolicyQuery {
    version: String,
}

async fn get_self_release_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Query(query): Query<ReleasePolicyQuery>,
) -> ApiResult<staff_advanced_service::StaffAppReleasePolicy> {
    ensure_mobile_access(&claims)?;
    let policy = staff_advanced_service::staff_app_release_policy(&state.settings, &query.version)?;
    Ok(Json(ApiResponse::ok(policy)))
}

async fn register_self_push_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SelfPushDeviceRequest>,
) -> ApiResult<crate::repositories::staff_advanced_repository::StaffMobileDeviceRecord> {
    ensure_staff_app_access(
        &claims,
        "staff.app.notifications.read",
        &["notifications.read", "staff.self_manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_advanced_service::register_self_push_device(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &payload.id,
        &payload.platform,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn save_self_push_subscription(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SelfPushSubscriptionRequest>,
) -> ApiResult<crate::repositories::staff_advanced_repository::MobilePushSubscriptionRecord> {
    ensure_staff_app_access(
        &claims,
        "staff.app.notifications.read",
        &["notifications.read", "staff.self_manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_advanced_service::save_self_push_subscription(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &staff_id,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn save_mobile_crash_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MobileCrashReportRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_staff_app_access(
        &claims,
        "staff.app.dashboard.read",
        &["staff.self_manage", "appointments.read"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let id = staff_advanced_service::save_mobile_crash_report(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &claims.sub,
        payload,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.mobile.crash_reported",
        &id,
    )
    .await;
    Ok(Json(ApiResponse::ok(json!({ "id": id }))))
}

async fn save_mobile_device_telemetry(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_advanced_service::MobileDeviceTelemetryRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_staff_app_access(
        &claims,
        "staff.app.dashboard.read",
        &["staff.self_manage", "appointments.read"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let id = staff_advanced_service::record_mobile_device_telemetry(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({ "id": id }))))
}

async fn list_mobile_device_telemetry(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<serde_json::Value>> {
    ensure_manager_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_advanced_service::list_mobile_device_telemetry(&state.db, &tenant_id, &branch_id)
            .await?,
    )))
}

async fn update_self_task_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SelfTaskStatusRequest>,
) -> ApiResult<StaffTaskRecord> {
    ensure_staff_app_access(
        &claims,
        "staff.app.tasks.manage",
        &["staff.self_manage", "staff_self.write"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row = staff_advanced_service::update_self_task_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &id,
        &payload.status,
        payload.version,
    )
    .await?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.task.self_updated",
        &row.id,
    )
    .await;
    publish_task_event(&state, &tenant_id, &branch_id, &claims.sub, &row.id);
    Ok(Json(ApiResponse::ok(row)))
}

fn publish_task_event(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    task_id: &str,
) {
    let _ = state.team_chat_events.send(TeamChatEvent {
        tenant_id: tenant_id.to_string(),
        branch_id: branch_id.to_string(),
        event_type: "staff.task.updated".into(),
        message_id: task_id.to_string(),
        sender_user_id: user_id.to_string(),
    });
}

async fn create_self_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SelfScheduleCreateRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_staff_app_access(
        &claims,
        "staff.app.roster.manage",
        &[
            "staff.app.calendar.manage",
            "staff.self_manage",
            "staff_self.write",
        ],
    )?;
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("valid IST offset"))
        .date_naive();
    if payload.schedule_date < today {
        return Err(AppError::validation(
            "self-service schedule creation is limited to today or a future date",
        ));
    }
    let start_time = parse_self_schedule_time(Some(&payload.start_time), "startTime")?
        .ok_or_else(|| AppError::validation("schedule start time is required"))?;
    let end_time = parse_self_schedule_time(Some(&payload.end_time), "endTime")?
        .ok_or_else(|| AppError::validation("schedule end time is required"))?;
    if start_time >= end_time {
        return Err(AppError::validation(
            "schedule start and end time are invalid",
        ));
    }
    let notes = payload.notes.as_deref().unwrap_or("").trim();
    if notes.chars().count() > 500 {
        return Err(AppError::validation(
            "schedule notes cannot exceed 500 characters",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row=sqlx::query_scalar::<_,serde_json::Value>(r#"INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,shift1_start,shift1_end,status,notes,room_id,role_id,job_title,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,'working',$7,NULLIF($8,''),NULLIF($9,''),$10,$11)
      ON CONFLICT(tenant_id,branch_id,staff_id,schedule_date) DO NOTHING
      RETURNING jsonb_build_object('id',id,'staffId',staff_id,'date',schedule_date,'startTime',shift1_start,'endTime',shift1_end,'status',status,'notes',notes,'roomId',room_id,'roleId',role_id,'jobTitle',job_title,'version',version)"#)
      .bind(&tenant_id).bind(&branch_id).bind(&staff_id).bind(payload.schedule_date).bind(start_time).bind(end_time).bind(notes)
      .bind(payload.room_id.as_deref().unwrap_or("").trim()).bind(payload.role_id.as_deref().unwrap_or("").trim())
      .bind(payload.job_title.as_deref().unwrap_or("").trim()).bind(&claims.sub)
      .fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to create staff schedule"))?
      .ok_or_else(|| AppError::conflict("a schedule already exists for this date; edit it instead"))?;
    audit(
        &state,
        &claims,
        &branch_id,
        "staff.schedule.self_created",
        row.get("id").and_then(|value| value.as_str()).unwrap_or(""),
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_self_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(schedule_id): Path<String>,
    Json(payload): Json<SelfScheduleUpdateRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_staff_app_access(
        &claims,
        "staff.app.roster.manage",
        &[
            "staff.app.calendar.manage",
            "staff.self_manage",
            "staff_self.write",
            "write:staff",
            "update:staff",
        ],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    if payload.version < 1 {
        return Err(AppError::validation("schedule version is invalid"));
    }
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("valid IST offset"))
        .date_naive();
    if payload.schedule_date.is_some_and(|date| date < today) {
        return Err(AppError::validation(
            "self-service schedule changes are limited to today or a future date",
        ));
    }
    let start_time = parse_self_schedule_time(payload.start_time.as_deref(), "startTime")?;
    let end_time = parse_self_schedule_time(payload.end_time.as_deref(), "endTime")?;
    if start_time.is_some() != end_time.is_some()
        || matches!((start_time, end_time), (Some(start), Some(end)) if start >= end)
    {
        return Err(AppError::validation(
            "schedule start and end time are invalid",
        ));
    }
    let status = payload.status.as_deref().map(str::trim).unwrap_or("");
    if !status.is_empty()
        && !matches!(
            status,
            "working"
                | "annual_leave"
                | "jury_duty"
                | "leave"
                | "sick_leave"
                | "special_leave"
                | "weekly_off"
                | "working_other_center"
                | "not_set"
        )
    {
        return Err(AppError::validation("schedule status is invalid"));
    }
    let notes = payload
        .notes
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .chars()
        .take(500)
        .collect::<String>();
    let row = sqlx::query_scalar::<_, serde_json::Value>(
        r#"UPDATE staff_schedules SET
              schedule_date=COALESCE($6,schedule_date),
              shift1_start=CASE WHEN $7::TIME IS NULL THEN shift1_start ELSE $7 END,
              shift1_end=CASE WHEN $8::TIME IS NULL THEN shift1_end ELSE $8 END,
              status=CASE WHEN $9='' THEN status ELSE $9 END,
              notes=CASE WHEN $10='' THEN notes ELSE $10 END,
              version=version+1,updated_by=$11,updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND version=$5 AND schedule_date>=$12
            RETURNING jsonb_build_object(
              'id',id,'staffId',staff_id,'scheduleDate',schedule_date,
              'startTime',shift1_start,'endTime',shift1_end,'status',status,'notes',notes,'version',version
            )"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .bind(schedule_id.trim())
    .bind(payload.version)
    .bind(payload.schedule_date)
    .bind(start_time)
    .bind(end_time)
    .bind(status)
    .bind(notes)
    .bind(&claims.sub)
    .bind(today)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to update staff schedule"))?
    .ok_or_else(|| AppError::conflict("schedule changed; reload and try again"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_self_roster(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<SelfScheduleRangeQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    ensure_staff_app_access(
        &claims,
        "staff.app.roster.read",
        &["staff.schedule.read", "staff.self_manage", "read:staff"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_app_service::self_roster(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        query.from,
        query.to,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_self_calendar(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<SelfScheduleRangeQuery>,
) -> ApiResult<Vec<serde_json::Value>> {
    ensure_staff_app_access(
        &claims,
        "staff.app.calendar.read",
        &["staff.schedule.read", "staff.self_manage", "read:staff"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_app_service::self_roster(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        query.from,
        query.to,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

fn parse_self_schedule_time(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveTime>, AppError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    NaiveTime::parse_from_str(value, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M:%S"))
        .map(Some)
        .map_err(|_| AppError::validation(format!("{field} must be HH:mm")))
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

fn ensure_payroll_read_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_payroll_permission(
        claims,
        &["owner", "admin", "accountant"],
        &["staff.payroll.read", "staff.payroll.manage"],
    )
}

fn ensure_payroll_manage_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_payroll_permission(
        claims,
        &["owner", "admin", "accountant"],
        &["staff.payroll.manage"],
    )
}

fn ensure_payroll_permission(
    claims: &AuthClaims,
    roles: &[&str],
    permissions: &[&str],
) -> Result<(), AppError> {
    let denied = claims.denied_permissions.iter().any(|denied| {
        permissions
            .iter()
            .any(|permission| denied.as_str() == *permission)
    });
    if !denied
        && (roles
            .iter()
            .any(|role| role.eq_ignore_ascii_case(&claims.role))
            || claims.permissions.iter().any(|allowed| {
                permissions
                    .iter()
                    .any(|permission| allowed.as_str() == *permission)
            }))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff advanced access is restricted"))
    }
}

fn ensure_mobile_access(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_role(claims, &["owner", "admin", "manager", "staff"])
}

fn ensure_staff_app_access(
    claims: &AuthClaims,
    permission: &str,
    legacy_permissions: &[&str],
) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        permission,
        &["owner", "admin", "manager", "staff"],
        legacy_permissions,
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden("Staff App permission is required"))
    }
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
