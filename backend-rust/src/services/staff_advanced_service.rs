use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::staff_advanced_repository::{
        self as repository, BiometricConsentRecord, BiometricDeviceInput, BiometricDeviceRecord,
        BiometricEventRecord, BiometricGatewayRecord, BiometricMappingRecord, IncentiveRuleInput,
        IncentiveRuleRecord, MobileAttendanceSummary, MobilePayrollSummary, MobileScheduleSummary,
        MobileStaffSummary, PayrollAdjustmentRuleInput, PayrollAdjustmentRuleRecord,
        PayrollStructureInput, PayrollStructureRecord, PerformanceSourceRecord,
        StaffMobileConflictRecord, StaffMobileDeviceAuthRecord, StaffMobileDeviceRecord,
        StaffMobileSyncRecord, StaffTaskCommentRecord, StaffTaskInput, StaffTaskRecord,
    },
    services::{auth_service, staff_attendance_service},
};

const TARGET_TYPES: &[&str] = &[
    "service",
    "product",
    "membership",
    "branch_admin",
    "admin",
    "all_transaction",
];
const ASSIGNEE_TYPES: &[&str] = &["staff", "branch", "standard"];
const ROLE_SCOPES: &[&str] = &["operator", "admin", "all"];
const ADJUSTMENT_KINDS: &[&str] = &["fine", "allowance", "deduction"];
const TRIGGER_TYPES: &[&str] = &[
    "manual",
    "late_count",
    "absent_day",
    "half_day",
    "short_hours",
    "no_clock_out",
    "weekend_penalty",
    "sandwich_penalty",
    "unpaid_week_off",
    "fixed",
];
const APPLICATION_MODES: &[&str] = &["per_occurrence", "fixed"];
const TASK_TYPES: &[&str] = &[
    "general",
    "training",
    "follow_up",
    "compliance",
    "performance",
];
const TASK_PRIORITIES: &[&str] = &["low", "medium", "high", "urgent"];
const TASK_STATUSES: &[&str] = &["open", "in_progress", "blocked", "completed", "cancelled"];
const BIOMETRIC_PROVIDERS: &[&str] = &[
    "zkteco",
    "realtime_biometrics",
    "mantra",
    "essl",
    "suprema",
    "camera",
    "rfid",
    "qr",
    "nfc",
    "manual",
];
const CONNECTION_MODES: &[&str] = &["gateway", "offline_sync", "browser_camera", "manual"];
const CONSENT_STATUSES: &[&str] = &["granted", "withdrawn"];
const MOBILE_PLATFORMS: &[&str] = &["android", "ios", "web", "windows"];
const MOBILE_ACTIONS: &[&str] = &[
    "clock_in",
    "clock_out",
    "request_leave",
    "complete_task",
    "start_service",
    "complete_service",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncentiveSlabRequest {
    pub from_paise: i64,
    pub to_paise: Option<i64>,
    pub incentive_basis_points: i32,
    pub incentive_paise: i64,
    pub employee_basis_points: Option<i32>,
    pub employee_paise: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncentiveRuleRequest {
    pub target_type: String,
    pub assignee_type: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub role_scope: String,
    pub slabs: Vec<IncentiveSlabRequest>,
    pub notes: Option<String>,
    pub active: Option<bool>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncentiveCopyTarget {
    pub assignee_type: String,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncentiveCopyRequest {
    pub targets: Vec<IncentiveCopyTarget>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollAdjustmentRuleRequest {
    pub kind: String,
    pub name: String,
    pub amount_paise: Option<i64>,
    pub trigger_type: Option<String>,
    pub trigger_count: Option<i32>,
    pub application_mode: Option<String>,
    pub auto_apply: Option<bool>,
    pub notes: Option<String>,
    pub active: Option<bool>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollStructureRequest {
    pub name: String,
    pub provident_fund: Value,
    pub professional_tax: Value,
    pub esic: Value,
    pub tds: Value,
    pub notes: Option<String>,
    pub active: Option<bool>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffTaskRequest {
    pub staff_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub task_type: Option<String>,
    pub priority: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
    pub status: Option<String>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceRow {
    pub staff_id: String,
    pub staff_name: String,
    pub score: Option<i32>,
    pub grade: String,
    pub appointments_count: i64,
    pub completed_appointments: i64,
    pub completion_percent: Option<i32>,
    pub revenue_paise: i64,
    pub target_revenue_paise: Option<i64>,
    pub revenue_target_percent: Option<i32>,
    pub utilization_percent: Option<i32>,
    pub unique_clients: i64,
    pub repeat_clients: i64,
    pub repeat_client_percent: Option<i32>,
    pub present_days: i64,
    pub absent_days: i64,
    pub worked_minutes: i64,
    pub overtime_minutes: i64,
    pub late_minutes: i64,
    pub early_leave_minutes: i64,
    pub burnout_risk: Option<RiskSignal>,
    pub retention_risk: Option<RiskSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskSignal {
    pub score: i32,
    pub level: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceSummary {
    pub staff_count: usize,
    pub scored_staff_count: usize,
    pub average_score: Option<i32>,
    pub total_revenue_paise: i64,
    pub high_risk_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceResponse {
    pub date_from: NaiveDate,
    pub date_to: NaiveDate,
    pub rows: Vec<StaffPerformanceRow>,
    pub summary: StaffPerformanceSummary,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricDeviceRequest {
    pub provider: String,
    pub device_code: String,
    pub device_name: String,
    pub connection_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricGatewayRequest {
    pub gateway_code: String,
    pub display_name: Option<String>,
    pub providers: Option<Vec<String>>,
    pub version_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricGatewayRegistration {
    pub gateway: BiometricGatewayRecord,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricMappingRequest {
    pub device_id: String,
    pub staff_id: String,
    pub external_user_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricConsentRequest {
    pub staff_id: String,
    pub purpose: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub version: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricEventRequest {
    pub device_code: String,
    pub external_user_id: String,
    pub external_event_id: String,
    pub punch_type: String,
    pub punch_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDeviceRequest {
    pub staff_id: String,
    pub device_uid: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDeviceRegistration {
    pub device: StaffMobileDeviceRecord,
    pub sync_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileMutationRequest {
    pub idempotency_key: String,
    pub action_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSyncRequest {
    pub device_id: String,
    pub mutations: Vec<MobileMutationRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSyncResponse {
    pub device_id: String,
    pub results: Vec<StaffMobileSyncRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileTodayResponse {
    pub business_date: NaiveDate,
    pub schedule: Option<MobileScheduleSummary>,
    pub attendance: Option<MobileAttendanceSummary>,
    pub tasks: Vec<StaffTaskRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDashboardResponse {
    pub generated_at: DateTime<Utc>,
    pub device_id: String,
    pub staff: MobileStaffSummary,
    pub today: MobileTodayResponse,
    pub payroll: Vec<MobilePayrollSummary>,
    pub targets: Vec<IncentiveRuleRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileClockPayload {
    business_date: NaiveDate,
    occurred_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileLeavePayload {
    leave_type: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileTaskPayload {
    task_id: String,
    version: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileServicePayload {
    appointment_id: String,
}

pub async fn list_incentive_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    target_type: &str,
    assignee_id: &str,
    active: Option<bool>,
) -> Result<Vec<IncentiveRuleRecord>, AppError> {
    let target_type = optional_enum(target_type, TARGET_TYPES, "target type")?;
    repository::list_incentive_rules(db, tenant_id, branch_id, &target_type, assignee_id, active)
        .await
        .map_err(internal("load incentive rules"))
}

pub async fn create_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: IncentiveRuleRequest,
) -> Result<IncentiveRuleRecord, AppError> {
    let input = incentive_input(request)?;
    repository::create_incentive_rule(db, tenant_id, branch_id, actor_user_id, &input)
        .await
        .map_err(database_write_error(
            "incentive rule already exists",
            "save incentive rule",
        ))
}

pub async fn update_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    request: IncentiveRuleRequest,
) -> Result<IncentiveRuleRecord, AppError> {
    let version = required_version(request.version)?;
    let input = incentive_input(request)?;
    repository::update_incentive_rule(db, tenant_id, branch_id, id.trim(), version, &input)
        .await
        .map_err(database_write_error(
            "incentive rule already exists",
            "update incentive rule",
        ))?
        .ok_or_else(stale_record)
}

pub async fn copy_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_id: &str,
    actor_user_id: &str,
    request: IncentiveCopyRequest,
) -> Result<Vec<IncentiveRuleRecord>, AppError> {
    if request.targets.is_empty() || request.targets.len() > 100 {
        return Err(AppError::validation(
            "copy targets must contain 1 to 100 entries",
        ));
    }
    let targets = request
        .targets
        .into_iter()
        .map(|target| {
            let assignee_type =
                required_enum(&target.assignee_type, ASSIGNEE_TYPES, "assignee type")?;
            let assignee_id = clean(
                target.assignee_id.as_deref().unwrap_or(""),
                120,
                "assignee id",
            )?;
            if assignee_type != "standard" && assignee_id.is_empty() {
                return Err(AppError::validation("assignee id is required"));
            }
            Ok((
                assignee_type,
                assignee_id,
                clean(
                    target.assignee_name.as_deref().unwrap_or(""),
                    160,
                    "assignee name",
                )?,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    repository::copy_incentive_rule(
        db,
        tenant_id,
        branch_id,
        source_id.trim(),
        actor_user_id,
        &targets,
    )
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::RowNotFound) {
            AppError::not_found("incentive rule not found")
        } else {
            AppError::internal(format!("failed to copy incentive rule: {error}"))
        }
    })
}

pub async fn list_adjustment_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
    active: Option<bool>,
) -> Result<Vec<PayrollAdjustmentRuleRecord>, AppError> {
    let kind = optional_enum(kind, ADJUSTMENT_KINDS, "adjustment kind")?;
    repository::list_adjustment_rules(db, tenant_id, branch_id, &kind, active)
        .await
        .map_err(internal("load payroll adjustment rules"))
}

pub async fn create_adjustment_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: PayrollAdjustmentRuleRequest,
) -> Result<PayrollAdjustmentRuleRecord, AppError> {
    let input = adjustment_input(request)?;
    repository::create_adjustment_rule(db, tenant_id, branch_id, actor_user_id, &input)
        .await
        .map_err(database_write_error(
            "payroll adjustment rule already exists",
            "save payroll adjustment rule",
        ))
}

pub async fn update_adjustment_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    request: PayrollAdjustmentRuleRequest,
) -> Result<PayrollAdjustmentRuleRecord, AppError> {
    let version = required_version(request.version)?;
    let input = adjustment_input(request)?;
    repository::update_adjustment_rule(db, tenant_id, branch_id, id.trim(), version, &input)
        .await
        .map_err(database_write_error(
            "payroll adjustment rule already exists",
            "update payroll adjustment rule",
        ))?
        .ok_or_else(stale_record)
}

pub async fn get_payroll_structure(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<PayrollStructureRecord>, AppError> {
    repository::get_payroll_structure(db, tenant_id, branch_id)
        .await
        .map_err(internal("load payroll structure"))
}

pub async fn save_payroll_structure(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: PayrollStructureRequest,
) -> Result<PayrollStructureRecord, AppError> {
    let input = PayrollStructureInput {
        name: required_text(&request.name, 160, "payroll structure name")?,
        provident_fund: payroll_block(request.provident_fund, "provident fund")?,
        professional_tax: payroll_block(request.professional_tax, "professional tax")?,
        esic: payroll_block(request.esic, "ESIC")?,
        tds: payroll_block(request.tds, "TDS")?,
        notes: clean(request.notes.as_deref().unwrap_or(""), 1000, "notes")?,
        active: request.active.unwrap_or(true),
    };
    repository::upsert_payroll_structure(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        request.version,
        &input,
    )
    .await
    .map_err(internal("save payroll structure"))?
    .ok_or_else(stale_record)
}

pub async fn list_biometric_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricDeviceRecord>, AppError> {
    repository::list_biometric_devices(db, tenant_id, branch_id)
        .await
        .map_err(internal("load biometric devices"))
}

pub async fn create_biometric_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: BiometricDeviceRequest,
) -> Result<BiometricDeviceRecord, AppError> {
    let input = BiometricDeviceInput {
        provider: required_enum(&request.provider, BIOMETRIC_PROVIDERS, "biometric provider")?,
        device_code: required_text(&request.device_code, 120, "device code")?,
        device_name: required_text(&request.device_name, 160, "device name")?,
        connection_mode: required_enum(
            request.connection_mode.as_deref().unwrap_or("gateway"),
            CONNECTION_MODES,
            "connection mode",
        )?,
    };
    repository::create_biometric_device(db, tenant_id, branch_id, actor_user_id, &input)
        .await
        .map_err(database_write_error(
            "biometric device code already exists",
            "save biometric device",
        ))
}

pub async fn register_biometric_gateway(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: BiometricGatewayRequest,
) -> Result<BiometricGatewayRegistration, AppError> {
    let gateway_code = required_text(&request.gateway_code, 120, "gateway code")?;
    let providers = request
        .providers
        .unwrap_or_default()
        .into_iter()
        .map(|provider| required_enum(&provider, BIOMETRIC_PROVIDERS, "biometric provider"))
        .collect::<Result<Vec<_>, AppError>>()?;
    let api_key = format!("agw_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let api_key_hash = auth_service::hash_password(&api_key)
        .map_err(|_| AppError::internal("failed to secure biometric gateway key"))?;
    let gateway = repository::create_biometric_gateway(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        &gateway_code,
        &clean(
            request.display_name.as_deref().unwrap_or(&gateway_code),
            160,
            "gateway name",
        )?,
        &api_key_hash,
        &json!(providers),
        &clean(
            request.version_label.as_deref().unwrap_or(""),
            80,
            "gateway version",
        )?,
    )
    .await
    .map_err(database_write_error(
        "biometric gateway code already exists",
        "register biometric gateway",
    ))?;
    Ok(BiometricGatewayRegistration { gateway, api_key })
}

pub async fn heartbeat_biometric_gateway(
    db: &PgPool,
    gateway_id: &str,
    api_key: &str,
    version_label: &str,
) -> Result<BiometricGatewayRecord, AppError> {
    authenticate_gateway(db, gateway_id, api_key).await?;
    repository::heartbeat_biometric_gateway(
        db,
        gateway_id,
        &clean(version_label, 80, "gateway version")?,
    )
    .await
    .map_err(internal("save biometric gateway heartbeat"))?
    .ok_or_else(|| AppError::not_found("biometric gateway not found"))
}

pub async fn list_biometric_mappings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricMappingRecord>, AppError> {
    repository::list_biometric_mappings(db, tenant_id, branch_id)
        .await
        .map_err(internal("load biometric mappings"))
}

pub async fn create_biometric_mapping(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: BiometricMappingRequest,
) -> Result<BiometricMappingRecord, AppError> {
    repository::create_biometric_mapping(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        &required_text(&request.device_id, 120, "device")?,
        &required_text(&request.staff_id, 120, "employee")?,
        &required_text(&request.external_user_id, 160, "external user id")?,
    )
    .await
    .map_err(database_write_error(
        "biometric mapping already exists",
        "save biometric mapping",
    ))?
    .ok_or_else(|| AppError::validation("biometric device or employee is invalid"))
}

pub async fn approve_biometric_mapping(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    version: i32,
) -> Result<BiometricMappingRecord, AppError> {
    repository::approve_biometric_mapping(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        required_version(Some(version))?,
        actor_user_id,
    )
    .await
    .map_err(internal("approve biometric mapping"))?
    .ok_or_else(stale_record)
}

pub async fn list_biometric_consents(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricConsentRecord>, AppError> {
    repository::list_biometric_consents(db, tenant_id, branch_id)
        .await
        .map_err(internal("load biometric consents"))
}

pub async fn save_biometric_consent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: BiometricConsentRequest,
) -> Result<BiometricConsentRecord, AppError> {
    let status = required_enum(&request.status, CONSENT_STATUSES, "consent status")?;
    repository::upsert_biometric_consent(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        &required_text(&request.staff_id, 120, "employee")?,
        &required_text(
            request.purpose.as_deref().unwrap_or("attendance"),
            80,
            "consent purpose",
        )?,
        &status,
        &clean(request.notes.as_deref().unwrap_or(""), 1000, "notes")?,
        request.version,
    )
    .await
    .map_err(internal("save biometric consent"))?
    .ok_or_else(stale_record)
}

pub async fn request_biometric_deletion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
) -> Result<BiometricConsentRecord, AppError> {
    repository::request_biometric_deletion(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        required_version(Some(version))?,
    )
    .await
    .map_err(internal("request biometric deletion"))?
    .ok_or_else(stale_record)
}

pub async fn process_biometric_event(
    db: &PgPool,
    gateway_id: &str,
    api_key: &str,
    request: BiometricEventRequest,
) -> Result<BiometricEventRecord, AppError> {
    let gateway = authenticate_gateway(db, gateway_id, api_key).await?;
    let device_code = required_text(&request.device_code, 120, "device code")?;
    let external_user_id = required_text(&request.external_user_id, 160, "external user id")?;
    let external_event_id = required_text(&request.external_event_id, 200, "external event id")?;
    let punch_type = required_enum(
        &request.punch_type,
        &["clock_in", "clock_out"],
        "punch type",
    )?;
    let payload_hash = sha256_text(&format!(
        "{}|{}|{}|{}|{}",
        device_code, external_user_id, external_event_id, punch_type, request.punch_at
    ));
    let inserted = repository::record_biometric_event(
        db,
        &gateway,
        &device_code,
        &external_user_id,
        &external_event_id,
        &punch_type,
        request.punch_at,
        &payload_hash,
    )
    .await
    .map_err(internal("record biometric event"))?;
    let Some(mut event) = inserted else {
        return repository::get_biometric_event(
            db,
            &gateway.tenant_id,
            gateway_id,
            &external_event_id,
        )
        .await
        .map_err(internal("load biometric event"))?
        .ok_or_else(|| AppError::validation("biometric device is not registered"));
    };
    if event.status == "rejected" {
        return Ok(event);
    }
    let staff_id = event
        .staff_id
        .as_deref()
        .ok_or_else(|| AppError::validation("biometric mapping is not approved"))?;
    let ist = FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("valid IST offset");
    let business_date = request.punch_at.with_timezone(&ist).date_naive();
    let attendance_result = if punch_type == "clock_in" {
        staff_attendance_service::clock_in(
            db,
            &gateway.tenant_id,
            &gateway.branch_id,
            staff_id,
            business_date,
            Some(request.punch_at),
            "biometric_gateway",
            "",
        )
        .await
    } else {
        staff_attendance_service::clock_out(
            db,
            &gateway.tenant_id,
            &gateway.branch_id,
            staff_id,
            business_date,
            Some(request.punch_at),
            0,
            "",
        )
        .await
    };
    let (status, reason) = if attendance_result.is_ok() {
        ("processed", "")
    } else {
        ("ignored", "attendance_state_conflict")
    };
    repository::set_biometric_event_status(db, &event.id, status, reason)
        .await
        .map_err(internal("finalize biometric event"))?;
    event.status = status.to_string();
    event.rejection_reason = reason.to_string();
    event.processed_at = Some(Utc::now());
    Ok(event)
}

pub async fn list_biometric_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<BiometricEventRecord>, AppError> {
    let status = optional_enum(
        status,
        &["received", "processed", "ignored", "rejected"],
        "biometric event status",
    )?;
    repository::list_biometric_events(db, tenant_id, branch_id, &status, false)
        .await
        .map_err(internal("load biometric events"))
}

pub async fn list_biometric_exceptions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricEventRecord>, AppError> {
    repository::list_biometric_events(db, tenant_id, branch_id, "", true)
        .await
        .map_err(internal("load biometric exceptions"))
}

async fn authenticate_gateway(
    db: &PgPool,
    gateway_id: &str,
    api_key: &str,
) -> Result<repository::BiometricGatewayAuthRecord, AppError> {
    let gateway = repository::biometric_gateway_auth(db, gateway_id.trim())
        .await
        .map_err(internal("authenticate biometric gateway"))?
        .filter(|gateway| gateway.active)
        .ok_or_else(|| AppError::forbidden("invalid biometric gateway credentials"))?;
    if api_key.is_empty() || !auth_service::verify_password(api_key, &gateway.api_key_hash) {
        return Err(AppError::forbidden("invalid biometric gateway credentials"));
    }
    Ok(gateway)
}

pub async fn register_mobile_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request: MobileDeviceRequest,
) -> Result<MobileDeviceRegistration, AppError> {
    let sync_token = format!(
        "msync_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let sync_token_hash = auth_service::hash_password(&sync_token)
        .map_err(|_| AppError::internal("failed to secure mobile sync token"))?;
    let device = repository::register_mobile_device(
        db,
        tenant_id,
        branch_id,
        &required_text(&request.staff_id, 120, "employee")?,
        &required_text(&request.device_uid, 200, "device uid")?,
        &required_enum(&request.platform, MOBILE_PLATFORMS, "mobile platform")?,
        &sync_token_hash,
    )
    .await
    .map_err(internal("register staff mobile device"))?
    .ok_or_else(|| AppError::validation("employee is invalid"))?;
    Ok(MobileDeviceRegistration { device, sync_token })
}

pub async fn mobile_dashboard(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sync_token: &str,
    device_id: &str,
    requested_date: Option<NaiveDate>,
) -> Result<MobileDashboardResponse, AppError> {
    let device =
        authenticate_mobile_device(db, tenant_id, branch_id, device_id, sync_token).await?;
    let business_date = mobile_business_date(requested_date, Utc::now());
    let (staff, schedule, attendance, tasks, payroll, targets) = tokio::try_join!(
        repository::mobile_staff_summary(db, &device),
        repository::mobile_schedule(db, &device, business_date),
        repository::mobile_attendance(db, &device, business_date),
        repository::mobile_tasks(db, &device),
        repository::mobile_payroll(db, &device),
        repository::mobile_targets(db, &device),
    )
    .map_err(internal("load staff mobile dashboard"))?;
    Ok(MobileDashboardResponse {
        generated_at: Utc::now(),
        device_id: device.id,
        staff: staff.ok_or_else(|| AppError::not_found("employee not found"))?,
        today: MobileTodayResponse {
            business_date,
            schedule,
            attendance,
            tasks,
        },
        payroll,
        targets,
    })
}

pub async fn sync_mobile_mutations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    sync_token: &str,
    request: MobileSyncRequest,
) -> Result<MobileSyncResponse, AppError> {
    if request.mutations.is_empty() || request.mutations.len() > 100 {
        return Err(AppError::validation(
            "mobile sync must contain 1 to 100 mutations",
        ));
    }
    let device =
        authenticate_mobile_device(db, tenant_id, branch_id, &request.device_id, sync_token)
            .await?;
    let mut results = Vec::with_capacity(request.mutations.len());
    for mutation in request.mutations {
        let idempotency_key =
            required_text(&mutation.idempotency_key, 200, "mobile idempotency key")?;
        let action_type = required_enum(&mutation.action_type, MOBILE_ACTIONS, "mobile action")?;
        let payload_hash = sha256_text(&mutation.payload.to_string());
        let started = repository::begin_mobile_sync(
            db,
            &device,
            &action_type,
            &idempotency_key,
            &payload_hash,
        )
        .await
        .map_err(internal("start mobile mutation"))?;
        let Some(started) = started else {
            if let Some(existing) =
                repository::get_mobile_sync(db, tenant_id, &device.id, &idempotency_key)
                    .await
                    .map_err(internal("load mobile mutation"))?
            {
                if existing.payload_hash != payload_hash || existing.action_type != action_type {
                    return Err(AppError::conflict(
                        "mobile idempotency key was already used for another payload",
                    ));
                }
                results.push(existing);
                continue;
            }
            return Err(AppError::internal("mobile mutation state is unavailable"));
        };
        let outcome = apply_mobile_mutation(
            db,
            &device,
            actor_user_id,
            &action_type,
            mutation.payload.clone(),
        )
        .await;
        let (status, result_json) = match outcome {
            Ok(result) => ("processed", result),
            Err(reason_code) => {
                let conflict = repository::create_mobile_conflict(
                    db,
                    &device,
                    &started.id,
                    &action_type,
                    &mutation.payload,
                    reason_code,
                )
                .await
                .map_err(internal("record mobile conflict"))?;
                (
                    "conflict",
                    json!({ "conflictId": conflict.id, "reasonCode": reason_code }),
                )
            }
        };
        repository::finish_mobile_sync(db, &started.id, &device.id, status, &result_json)
            .await
            .map_err(internal("finish mobile mutation"))?;
        results.push(
            repository::get_mobile_sync(db, tenant_id, &device.id, &idempotency_key)
                .await
                .map_err(internal("load mobile mutation result"))?
                .ok_or_else(|| AppError::internal("mobile mutation result is unavailable"))?,
        );
    }
    Ok(MobileSyncResponse {
        device_id: device.id,
        results,
    })
}

pub async fn list_mobile_conflicts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<StaffMobileConflictRecord>, AppError> {
    let status = optional_enum(status, &["open", "resolved"], "conflict status")?;
    repository::list_mobile_conflicts(db, tenant_id, branch_id, &status)
        .await
        .map_err(internal("load mobile conflicts"))
}

pub async fn resolve_mobile_conflict(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    version: i32,
    resolution: &str,
) -> Result<StaffMobileConflictRecord, AppError> {
    let resolution = required_enum(
        resolution,
        &["server_wins", "manual"],
        "conflict resolution",
    )?;
    repository::resolve_mobile_conflict(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        required_version(Some(version))?,
        &resolution,
        actor_user_id,
    )
    .await
    .map_err(internal("resolve mobile conflict"))?
    .ok_or_else(stale_record)
}

async fn authenticate_mobile_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    device_id: &str,
    sync_token: &str,
) -> Result<StaffMobileDeviceAuthRecord, AppError> {
    let device = repository::mobile_device_auth(db, tenant_id, branch_id, device_id.trim())
        .await
        .map_err(internal("authenticate mobile device"))?
        .filter(|device| device.active)
        .ok_or_else(|| AppError::forbidden("invalid mobile device credentials"))?;
    if sync_token.is_empty() || !auth_service::verify_password(sync_token, &device.sync_token_hash)
    {
        return Err(AppError::forbidden("invalid mobile device credentials"));
    }
    Ok(device)
}

fn mobile_business_date(requested: Option<NaiveDate>, now: DateTime<Utc>) -> NaiveDate {
    requested.unwrap_or_else(|| {
        now.with_timezone(&FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("valid IST offset"))
            .date_naive()
    })
}

async fn apply_mobile_mutation(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
    actor_user_id: &str,
    action_type: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    match action_type {
        "clock_in" | "clock_out" => {
            let payload: MobileClockPayload =
                serde_json::from_value(payload).map_err(|_| "invalid_payload")?;
            let result = if action_type == "clock_in" {
                staff_attendance_service::clock_in(
                    db,
                    &device.tenant_id,
                    &device.branch_id,
                    &device.staff_id,
                    payload.business_date,
                    payload.occurred_at,
                    "mobile_sync",
                    "",
                )
                .await
            } else {
                staff_attendance_service::clock_out(
                    db,
                    &device.tenant_id,
                    &device.branch_id,
                    &device.staff_id,
                    payload.business_date,
                    payload.occurred_at,
                    0,
                    "",
                )
                .await
            }
            .map_err(|_| "attendance_state_conflict")?;
            serde_json::to_value(result).map_err(|_| "serialization_failed")
        }
        "request_leave" => {
            let payload: MobileLeavePayload =
                serde_json::from_value(payload).map_err(|_| "invalid_payload")?;
            let result = crate::services::staff_leave_service::create_request(
                db,
                &device.tenant_id,
                &device.branch_id,
                actor_user_id,
                &device.staff_id,
                &payload.leave_type,
                payload.start_date,
                payload.end_date,
                payload.reason.as_deref().unwrap_or(""),
            )
            .await
            .map_err(|_| "leave_policy_conflict")?;
            serde_json::to_value(result).map_err(|_| "serialization_failed")
        }
        "complete_task" => {
            let payload: MobileTaskPayload =
                serde_json::from_value(payload).map_err(|_| "invalid_payload")?;
            let updated = repository::complete_mobile_task(
                db,
                &device.tenant_id,
                &device.branch_id,
                &device.staff_id,
                &payload.task_id,
                payload.version,
            )
            .await
            .map_err(|_| "task_update_failed")?;
            if updated {
                Ok(json!({ "taskId": payload.task_id, "status": "completed" }))
            } else {
                Err("task_version_conflict")
            }
        }
        "start_service" | "complete_service" => {
            let payload: MobileServicePayload =
                serde_json::from_value(payload).map_err(|_| "invalid_payload")?;
            let status = if action_type == "start_service" {
                "in-service"
            } else {
                "completed"
            };
            let updated = repository::update_mobile_appointment_status(
                db,
                &device.tenant_id,
                &device.branch_id,
                &device.staff_id,
                payload.appointment_id.trim(),
                status,
            )
            .await
            .map_err(|_| "appointment_update_failed")?;
            if updated {
                Ok(json!({ "appointmentId": payload.appointment_id, "status": status }))
            } else {
                Err("appointment_state_conflict")
            }
        }
        _ => Err("unsupported_action"),
    }
}

pub async fn list_tasks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffTaskRecord>, AppError> {
    let status = optional_enum(status, TASK_STATUSES, "task status")?;
    repository::list_tasks(db, tenant_id, branch_id, staff_id.trim(), &status)
        .await
        .map_err(internal("load staff tasks"))
}

pub async fn create_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: StaffTaskRequest,
) -> Result<StaffTaskRecord, AppError> {
    let input = task_input(request)?;
    repository::create_task(db, tenant_id, branch_id, actor_user_id, &input)
        .await
        .map_err(internal("save staff task"))?
        .ok_or_else(|| AppError::validation("assigned employee is invalid"))
}

pub async fn update_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    request: StaffTaskRequest,
) -> Result<StaffTaskRecord, AppError> {
    let version = required_version(request.version)?;
    let input = task_input(request)?;
    repository::update_task(db, tenant_id, branch_id, id.trim(), version, &input)
        .await
        .map_err(internal("update staff task"))?
        .ok_or_else(stale_record)
}

pub async fn add_task_comment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    task_id: &str,
    actor_user_id: &str,
    comment_text: &str,
) -> Result<StaffTaskCommentRecord, AppError> {
    let comment_text = required_text(comment_text, 2000, "comment")?;
    repository::add_task_comment(
        db,
        tenant_id,
        branch_id,
        task_id.trim(),
        actor_user_id,
        &comment_text,
    )
    .await
    .map_err(internal("save task comment"))?
    .ok_or_else(|| AppError::not_found("staff task not found"))
}

pub async fn performance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_id: &str,
) -> Result<StaffPerformanceResponse, AppError> {
    if date_to < date_from || (date_to - date_from).num_days() > 366 {
        return Err(AppError::validation(
            "performance period must be 367 days or less",
        ));
    }
    let sources = repository::performance_sources(
        db,
        tenant_id,
        branch_id,
        date_from,
        date_to,
        staff_id.trim(),
    )
    .await
    .map_err(internal("load staff performance"))?;
    let rows = sources.into_iter().map(performance_row).collect::<Vec<_>>();
    let scored = rows.iter().filter_map(|row| row.score).collect::<Vec<_>>();
    let summary = StaffPerformanceSummary {
        staff_count: rows.len(),
        scored_staff_count: scored.len(),
        average_score: (!scored.is_empty())
            .then(|| scored.iter().sum::<i32>() / scored.len() as i32),
        total_revenue_paise: rows.iter().map(|row| row.revenue_paise).sum(),
        high_risk_count: rows
            .iter()
            .filter(|row| {
                row.burnout_risk
                    .as_ref()
                    .is_some_and(|risk| risk.level == "high")
                    || row
                        .retention_risk
                        .as_ref()
                        .is_some_and(|risk| risk.level == "high")
            })
            .count(),
    };
    Ok(StaffPerformanceResponse {
        date_from,
        date_to,
        rows,
        summary,
    })
}

fn task_input(request: StaffTaskRequest) -> Result<StaffTaskInput, AppError> {
    let staff_id = clean(request.staff_id.as_deref().unwrap_or(""), 120, "staff id")?;
    Ok(StaffTaskInput {
        staff_id: (!staff_id.is_empty()).then_some(staff_id),
        title: required_text(&request.title, 200, "task title")?,
        description: clean(
            request.description.as_deref().unwrap_or(""),
            4000,
            "task description",
        )?,
        task_type: required_enum(
            request.task_type.as_deref().unwrap_or("general"),
            TASK_TYPES,
            "task type",
        )?,
        priority: required_enum(
            request.priority.as_deref().unwrap_or("medium"),
            TASK_PRIORITIES,
            "task priority",
        )?,
        due_at: request.due_at,
        status: required_enum(
            request.status.as_deref().unwrap_or("open"),
            TASK_STATUSES,
            "task status",
        )?,
    })
}

fn performance_row(source: PerformanceSourceRecord) -> StaffPerformanceRow {
    let completion_percent = ratio(source.completed_appointments, source.appointments_count);
    let utilization_percent = ratio(source.worked_minutes, source.scheduled_minutes);
    let repeat_client_percent = ratio(source.repeat_clients, source.unique_clients);
    let revenue_target_percent = source
        .target_revenue_paise
        .filter(|target| *target > 0)
        .map(|target| percentage(source.revenue_paise, target));
    let attendance_evidence = source.present_days + source.absent_days > 0;
    let attendance_score = attendance_evidence.then(|| {
        (100 - source.absent_days.saturating_mul(20) as i32
            - ((source.late_minutes + source.early_leave_minutes) / 30).min(10) as i32 * 5)
            .clamp(0, 100)
    });
    let score = weighted_score(&[
        (completion_percent, 25),
        (attendance_score, 25),
        (utilization_percent, 20),
        (repeat_client_percent, 15),
        (revenue_target_percent, 15),
    ]);
    let burnout_risk = (source.worked_minutes > 0).then(|| {
        let score = ((source.overtime_minutes * 200 / source.worked_minutes)
            + ((source.late_minutes + source.early_leave_minutes) / 30) * 3)
            .clamp(0, 100) as i32;
        RiskSignal {
            score,
            level: risk_level(score),
            evidence: vec![
                format!("{} overtime minutes", source.overtime_minutes),
                format!("{} worked minutes", source.worked_minutes),
            ],
        }
    });
    let retention_risk = score.map(|value| {
        let risk_score = (100 - value + (source.absent_days * 5).min(25) as i32).clamp(0, 100);
        RiskSignal {
            score: risk_score,
            level: risk_level(risk_score),
            evidence: vec![
                format!("performance score {value}"),
                format!("{} absent days", source.absent_days),
            ],
        }
    });
    StaffPerformanceRow {
        staff_id: source.staff_id,
        staff_name: source.staff_name,
        score,
        grade: score.map(score_grade).unwrap_or("no_data").to_string(),
        appointments_count: source.appointments_count,
        completed_appointments: source.completed_appointments,
        completion_percent,
        revenue_paise: source.revenue_paise,
        target_revenue_paise: source.target_revenue_paise,
        revenue_target_percent,
        utilization_percent,
        unique_clients: source.unique_clients,
        repeat_clients: source.repeat_clients,
        repeat_client_percent,
        present_days: source.present_days,
        absent_days: source.absent_days,
        worked_minutes: source.worked_minutes,
        overtime_minutes: source.overtime_minutes,
        late_minutes: source.late_minutes,
        early_leave_minutes: source.early_leave_minutes,
        burnout_risk,
        retention_risk,
    }
}

fn ratio(value: i64, total: i64) -> Option<i32> {
    (total > 0).then(|| percentage(value, total))
}

fn percentage(value: i64, total: i64) -> i32 {
    ((value.saturating_mul(100) / total.max(1)).clamp(0, 100)) as i32
}

fn weighted_score(components: &[(Option<i32>, i32)]) -> Option<i32> {
    let (points, weight) =
        components
            .iter()
            .fold((0, 0), |(points, weight), (value, item_weight)| {
                value.map_or((points, weight), |value| {
                    (points + value * item_weight, weight + item_weight)
                })
            });
    (weight > 0).then(|| points / weight)
}

fn score_grade(score: i32) -> &'static str {
    match score {
        85.. => "excellent",
        70..=84 => "good",
        50..=69 => "watch",
        _ => "critical",
    }
}

fn risk_level(score: i32) -> String {
    match score {
        70.. => "high",
        40..=69 => "medium",
        _ => "low",
    }
    .to_string()
}

fn sha256_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn incentive_input(request: IncentiveRuleRequest) -> Result<IncentiveRuleInput, AppError> {
    let target_type = required_enum(&request.target_type, TARGET_TYPES, "target type")?;
    let assignee_type = required_enum(&request.assignee_type, ASSIGNEE_TYPES, "assignee type")?;
    let role_scope = required_enum(&request.role_scope, ROLE_SCOPES, "role scope")?;
    let assignee_id = clean(
        request.assignee_id.as_deref().unwrap_or(""),
        120,
        "assignee id",
    )?;
    if assignee_type != "standard" && assignee_id.is_empty() {
        return Err(AppError::validation("assignee id is required"));
    }
    if request.slabs.is_empty() || request.slabs.len() > 50 {
        return Err(AppError::validation(
            "incentive slabs must contain 1 to 50 entries",
        ));
    }
    let mut previous_to = None;
    let mut slabs = Vec::with_capacity(request.slabs.len());
    for (index, slab) in request.slabs.into_iter().enumerate() {
        if slab.from_paise < 0
            || slab.to_paise.is_some_and(|to| to < slab.from_paise)
            || !(0..=10_000).contains(&slab.incentive_basis_points)
            || slab.incentive_paise < 0
            || slab
                .employee_basis_points
                .is_some_and(|value| !(0..=10_000).contains(&value))
            || slab.employee_paise.is_some_and(|value| value < 0)
        {
            return Err(AppError::validation("incentive slab values are invalid"));
        }
        if previous_to.is_some_and(|to| slab.from_paise <= to) {
            return Err(AppError::validation("incentive slabs cannot overlap"));
        }
        previous_to = slab.to_paise;
        slabs.push(json!({
            "sequence": index + 1,
            "fromPaise": slab.from_paise,
            "toPaise": slab.to_paise,
            "incentiveBasisPoints": slab.incentive_basis_points,
            "incentivePaise": slab.incentive_paise,
            "employeeBasisPoints": slab.employee_basis_points.unwrap_or(slab.incentive_basis_points),
            "employeePaise": slab.employee_paise.unwrap_or(slab.incentive_paise)
        }));
    }
    Ok(IncentiveRuleInput {
        target_type,
        assignee_type,
        assignee_id,
        assignee_name: clean(
            request.assignee_name.as_deref().unwrap_or(""),
            160,
            "assignee name",
        )?,
        role_scope,
        slabs: Value::Array(slabs),
        notes: clean(request.notes.as_deref().unwrap_or(""), 1000, "notes")?,
        active: request.active.unwrap_or(true),
    })
}

fn adjustment_input(
    request: PayrollAdjustmentRuleRequest,
) -> Result<PayrollAdjustmentRuleInput, AppError> {
    let kind = required_enum(&request.kind, ADJUSTMENT_KINDS, "adjustment kind")?;
    let trigger_type = required_enum(
        request
            .trigger_type
            .as_deref()
            .unwrap_or(if kind == "fine" { "manual" } else { "fixed" }),
        TRIGGER_TYPES,
        "trigger type",
    )?;
    let application_mode = required_enum(
        request
            .application_mode
            .as_deref()
            .unwrap_or("per_occurrence"),
        APPLICATION_MODES,
        "application mode",
    )?;
    let amount_paise = request.amount_paise.unwrap_or(0);
    let trigger_count = request.trigger_count.unwrap_or(1);
    if amount_paise < 0 || trigger_count < 1 {
        return Err(AppError::validation("amount or trigger count is invalid"));
    }
    Ok(PayrollAdjustmentRuleInput {
        kind,
        name: required_text(&request.name, 160, "adjustment name")?,
        amount_paise,
        trigger_type,
        trigger_count,
        application_mode,
        auto_apply: request.auto_apply.unwrap_or(false),
        notes: clean(request.notes.as_deref().unwrap_or(""), 1000, "notes")?,
        active: request.active.unwrap_or(true),
    })
}

fn payroll_block(value: Value, label: &str) -> Result<Value, AppError> {
    if !value.is_object() || value.to_string().len() > 32_000 {
        return Err(AppError::validation(format!(
            "{label} configuration is invalid"
        )));
    }
    Ok(value)
}

fn required_version(version: Option<i32>) -> Result<i32, AppError> {
    version
        .filter(|value| *value > 0)
        .ok_or_else(|| AppError::validation("version is required"))
}

fn required_text(value: &str, max: usize, label: &str) -> Result<String, AppError> {
    let value = clean(value, max, label)?;
    if value.is_empty() {
        Err(AppError::validation(format!("{label} is required")))
    } else {
        Ok(value)
    }
}

fn clean(value: &str, max: usize, label: &str) -> Result<String, AppError> {
    let value = value.trim().to_string();
    if value.chars().count() > max {
        Err(AppError::validation(format!("{label} is too long")))
    } else {
        Ok(value)
    }
}

fn optional_enum(value: &str, allowed: &[&str], label: &str) -> Result<String, AppError> {
    if value.trim().is_empty() {
        Ok(String::new())
    } else {
        required_enum(value, allowed, label)
    }
}

fn required_enum(value: &str, allowed: &[&str], label: &str) -> Result<String, AppError> {
    let normalized = value.trim().to_lowercase().replace([' ', '-'], "_");
    if allowed.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::validation(format!("{label} is invalid")))
    }
}

fn stale_record() -> AppError {
    AppError::conflict("record was updated by another request; refresh and try again")
}

fn internal(action: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| AppError::internal(format!("failed to {action}: {error}"))
}

fn database_write_error(
    duplicate_message: &'static str,
    action: &'static str,
) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| {
        if error
            .as_database_error()
            .and_then(|database_error| database_error.code())
            .is_some_and(|code| code == "23505")
        {
            AppError::conflict(duplicate_message)
        } else {
            AppError::internal(format!("failed to {action}: {error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        incentive_input, mobile_business_date, sha256_text, weighted_score, IncentiveRuleRequest,
        IncentiveSlabRequest,
    };
    use chrono::{DateTime, NaiveDate, Utc};

    #[test]
    fn incentive_slabs_reject_overlap() {
        let request = IncentiveRuleRequest {
            target_type: "service".into(),
            assignee_type: "staff".into(),
            assignee_id: Some("staff-1".into()),
            assignee_name: None,
            role_scope: "operator".into(),
            slabs: vec![
                IncentiveSlabRequest {
                    from_paise: 0,
                    to_paise: Some(10_000),
                    incentive_basis_points: 500,
                    incentive_paise: 0,
                    employee_basis_points: None,
                    employee_paise: None,
                },
                IncentiveSlabRequest {
                    from_paise: 10_000,
                    to_paise: None,
                    incentive_basis_points: 700,
                    incentive_paise: 0,
                    employee_basis_points: None,
                    employee_paise: None,
                },
            ],
            notes: None,
            active: None,
            version: None,
        };
        assert!(incentive_input(request).is_err());
    }

    #[test]
    fn performance_score_uses_only_available_evidence() {
        assert_eq!(weighted_score(&[(Some(80), 25), (None, 75)]), Some(80));
        assert_eq!(weighted_score(&[(None, 100)]), None);
    }

    #[test]
    fn sync_payload_hash_is_stable() {
        assert_eq!(sha256_text("event-1"), sha256_text("event-1"));
        assert_ne!(sha256_text("event-1"), sha256_text("event-2"));
    }

    #[test]
    fn mobile_date_uses_ist_day() {
        let now = "2026-07-13T20:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(
            mobile_business_date(None, now),
            NaiveDate::from_ymd_opt(2026, 7, 14).unwrap()
        );
    }
}
