use std::collections::HashMap;

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        staff_advanced_repository::StaffTaskRecord,
        staff_enterprise_repository::{self as repository, *},
    },
    services::staff_advanced_service::{self, RiskSignal, StaffPerformanceRow, StaffTaskRequest},
};

const APPROVAL_ROLES: &[&str] = &["owner", "admin", "manager", "accountant"];
const RULE_TYPES: &[&str] = &[
    "provident_fund",
    "esic",
    "professional_tax",
    "tds",
    "gratuity",
    "bonus",
];
const ROUNDING_METHODS: &[&str] = &[
    "floor_paisa",
    "nearest_paisa",
    "ceil_paisa",
    "nearest_rupee",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicyRequest {
    pub policy_key: String,
    pub policy_name: String,
    pub request_type: String,
    pub amount_threshold_paise: Option<i64>,
    pub steps: Value,
    pub escalation_hours: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequestInput {
    pub request_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub amount_paise: Option<i64>,
    pub payload: Option<Value>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRequest {
    pub decision: String,
    pub version: i32,
    #[serde(alias = "notes")]
    pub comments: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDetail {
    pub request: ApprovalRequestRecord,
    pub actions: Vec<ApprovalActionRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyDepartureRequest {
    pub business_date: NaiveDate,
    pub requested_departure_time: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipPayoutRequest {
    pub staff_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub payout_reference: String,
    pub payout_method: Option<String>,
    pub provider_reference: Option<String>,
    pub status: Option<String>,
    pub sale_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipPayoutReconcileRequest {
    pub expected_status: String,
    pub status: String,
    pub provider_reference: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryRuleRequest {
    pub rule_type: String,
    pub state_code: Option<String>,
    pub jurisdiction_code: String,
    pub rounding_method: String,
    pub official_reference: String,
    pub rule: Value,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryCalculationRequest {
    pub payroll_run_id: String,
    pub staff_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatutorySummary {
    pub calculations: i64,
    pub employee_deduction_paise: i64,
    pub employer_contribution_paise: i64,
    pub accrual_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceExport {
    pub generated_at: DateTime<Utc>,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub rows: Vec<StatutoryCalculationRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryRevisionRequest {
    pub rate_type: String,
    pub new_amount_paise: i64,
    pub effective_date: NaiveDate,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterEntry {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub status: String,
    pub notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterOptimizeRequest {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
}

#[derive(Debug, Deserialize)]
pub struct VersionRequest {
    pub version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffRuleQuizQuestionRequest {
    pub id: Option<String>,
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffRuleDocumentRequest {
    pub document_key: Option<String>,
    pub document_type: String,
    pub category: String,
    pub title: String,
    pub content: String,
    pub effective_date: NaiveDate,
    pub expires_on: Option<NaiveDate>,
    pub mandatory_acknowledgement: Option<bool>,
    pub training_attachment_url: Option<String>,
    pub quiz: Option<Vec<StaffRuleQuizQuestionRequest>>,
    pub quiz_pass_score: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffRuleAcknowledgementRequest {
    pub answers: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffRuleViolationRequest {
    pub document_id: String,
    pub staff_id: String,
    pub details: String,
    pub occurred_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffRuleViolationResolutionRequest {
    pub version: i32,
    pub resolution_note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterCoverageResponse {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub active_staff: i64,
    pub scheduled_staff_days: i64,
    pub scheduled_minutes: i64,
    pub appointment_minutes: i64,
    pub uncovered_appointments: i64,
    pub coverage_percent: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManpowerForecastResult {
    pub id: Option<String>,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub history_start: NaiveDate,
    pub history_end: NaiveDate,
    pub projected_demand_minutes: i64,
    pub booked_demand_minutes: i64,
    pub available_capacity_minutes: Option<i64>,
    pub required_staff_count: Option<i32>,
    pub shortage_staff_count: Option<i32>,
    pub confidence: String,
    pub recommendation: Option<String>,
    pub shortage_alert_count: i64,
    pub overstaffing_alert_count: i64,
    pub leave_impact_alert_count: i64,
    pub skills_shortage_alert_count: i64,
    pub rows: Vec<ManpowerPlanningRow>,
    pub evidence: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManpowerPlanningRow {
    pub date: NaiveDate,
    pub hour_start: String,
    pub hour_end: String,
    pub shift: String,
    pub department: String,
    pub appointment_count: i64,
    pub demand_minutes: i64,
    pub required_staff_count: i64,
    pub scheduled_staff_count: i64,
    pub leave_staff_count: i64,
    pub leave_impact_count: i64,
    pub shortage_staff_count: i64,
    pub overstaffed_count: i64,
    pub resource_count: i64,
    pub resource_shortage_count: i64,
    pub qualified_staff_count: i64,
    pub skills_shortage_count: i64,
    pub alert: String,
    pub recommendation: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementRequest {
    pub appointment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestStaffRequest {
    pub date: NaiveDate,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub service_ids: Option<Vec<String>>,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub appointment_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStaffCandidate {
    pub staff_id: String,
    pub staff_name: String,
    pub performance_score: Option<i32>,
    pub workload_count: i64,
    pub workload_minutes: i64,
    pub department: String,
    pub department_match: bool,
    pub preferred_client: bool,
    pub utilization_percent: Option<i32>,
    pub rating: Option<f64>,
    pub completion_percent: Option<i32>,
    pub repeat_client_percent: Option<i32>,
    pub confidence: String,
    pub recommendation_reason: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementRecommendationResponse {
    pub recommendation: Option<ReplacementRecommendationRecord>,
    pub ranked_options: Vec<RankedStaffCandidate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceRiskRow {
    pub staff_id: String,
    pub staff_name: String,
    pub risk: RiskSignal,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffSalesReport {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub summary: Vec<StaffSalesSummaryRecord>,
    pub lines: Vec<StaffSalesLineRecord>,
    pub page: i64,
    pub page_size: i64,
    pub total_lines: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreferenceRequest {
    pub whatsapp_opt_in: bool,
    pub allow_payroll_amounts: Option<bool>,
    pub language_code: Option<String>,
    pub quiet_hours_start: Option<NaiveTime>,
    pub quiet_hours_end: Option<NaiveTime>,
    pub version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTemplateRequest {
    pub notification_type: String,
    pub language_code: Option<String>,
    pub title: String,
    pub body_template: String,
    pub sensitive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueNotificationRequest {
    pub staff_id: String,
    pub template_id: String,
    pub channel: String,
    pub variables: Option<HashMap<String, String>>,
    pub contains_payroll_amounts: Option<bool>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDeliveryRequest {
    pub version: i32,
    pub provider: String,
    pub provider_message_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffEnterpriseCommandCenter {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub generated_at: DateTime<Utc>,
    pub source_counts: Value,
    pub kpis: Value,
    pub top_staff: Vec<StaffPerformanceRow>,
    pub attention_queue: Value,
    pub recommendations: Value,
    pub equipment_intelligence: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingAssignmentRequest {
    pub staff_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseProfileRequest {
    pub skill_name: Option<String>,
    pub skill_level: Option<i16>,
    pub expected_minutes: Option<i32>,
    pub certification_valid_days: Option<i32>,
    pub version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseAssignmentRequest {
    pub staff_id: String,
    pub course_id: String,
    pub priority: Option<String>,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRequirementRequest {
    pub scope_type: String,
    pub scope_id: String,
    pub skill_name: String,
    pub required_level: Option<i16>,
    pub certification_required: Option<bool>,
    pub active: Option<bool>,
    pub version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificationRenewalRequest {
    pub version: i32,
    pub expires_on: NaiveDate,
    pub document_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachingGoalRequest {
    pub staff_id: String,
    pub goal_type: String,
    pub metric_unit: String,
    pub target_value: i64,
    pub current_value: Option<i64>,
    pub projected_impact_paise: Option<i64>,
    pub due_date: NaiveDate,
    pub action_title: String,
    pub action_description: Option<String>,
    pub priority: Option<String>,
}

pub async fn list_policies(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<ApprovalPolicyRecord>, AppError> {
    repository::list_approval_policies(db, t, b)
        .await
        .map_err(internal("load approval policies"))
}

pub async fn create_policy(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    r: ApprovalPolicyRequest,
) -> Result<ApprovalPolicyRecord, AppError> {
    let steps = approval_steps(r.steps)?;
    let threshold = r.amount_threshold_paise.unwrap_or(0);
    let hours = r.escalation_hours.unwrap_or(24);
    if threshold < 0 || hours < 1 {
        return Err(AppError::validation(
            "approval threshold or escalation hours is invalid",
        ));
    }
    repository::create_approval_policy(
        db,
        t,
        b,
        actor,
        &required(&r.policy_key, 100, "policy key")?,
        &required(&r.policy_name, 160, "policy name")?,
        &required(&r.request_type, 100, "request type")?,
        threshold,
        &steps,
        hours,
    )
    .await
    .map_err(db_write(
        "approval policy already exists",
        "create approval policy",
    ))
}

pub async fn list_approvals(
    db: &PgPool,
    t: &str,
    b: &str,
    status: &str,
) -> Result<Vec<ApprovalRequestRecord>, AppError> {
    let status = optional_enum(
        status,
        &["pending", "approved", "rejected", "escalated", "cancelled"],
        "approval status",
    )?;
    repository::list_approval_requests(db, t, b, &status)
        .await
        .map_err(internal("load approvals"))
}

pub async fn create_approval(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    role: &str,
    r: ApprovalRequestInput,
) -> Result<ApprovalRequestRecord, AppError> {
    let request_type = required(&r.request_type, 100, "request type")?;
    let amount = r.amount_paise.unwrap_or(0);
    if amount < 0 {
        return Err(AppError::validation("amount cannot be negative"));
    }
    let policy = repository::matching_policy(db, t, b, &request_type, amount)
        .await
        .map_err(internal("match approval policy"))?;
    let steps = policy
        .as_ref()
        .map(|p| p.steps.clone())
        .unwrap_or_else(|| json!([{"order":1,"role":"manager"}]));
    repository::create_approval_request(
        db,
        t,
        b,
        actor,
        policy.as_ref().map(|p| p.id.as_str()),
        &request_type,
        &required(&r.entity_type, 100, "entity type")?,
        &required(&r.entity_id, 160, "entity id")?,
        amount,
        &steps,
        &r.payload.unwrap_or_else(|| json!({})),
        r.expires_at,
        role,
    )
    .await
    .map_err(internal("create approval"))
}

pub async fn list_self_early_departures(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
) -> Result<Vec<ApprovalRequestRecord>, AppError> {
    repository::list_self_early_departure_requests(db, tenant, branch, actor)
        .await
        .map_err(internal("load early departure requests"))
}

pub async fn request_early_departure(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    role: &str,
    request: EarlyDepartureRequest,
) -> Result<ApprovalRequestRecord, AppError> {
    let reason = required(&request.reason, 500, "reason")?;
    let requested_departure_time =
        NaiveTime::parse_from_str(request.requested_departure_time.trim(), "%H:%M")
            .map_err(|_| AppError::validation("departure time must use HH:MM format"))?;
    let schedule =
        repository::early_departure_schedule(db, tenant, branch, actor, request.business_date)
            .await
            .map_err(internal("load scheduled shift"))?
            .ok_or_else(|| {
                AppError::validation("a working shift is required for the selected date")
            })?;
    let early_minutes = early_departure_minutes(
        schedule.shift_start,
        schedule.shift_end,
        requested_departure_time,
    )?;
    if repository::has_open_early_departure_request(
        db,
        tenant,
        branch,
        actor,
        request.business_date,
    )
    .await
    .map_err(internal("check early departure request"))?
    {
        return Err(AppError::conflict(
            "an active early departure request already exists for this date",
        ));
    }
    create_approval(
        db,
        tenant,
        branch,
        actor,
        role,
        ApprovalRequestInput {
            request_type: "early_departure".to_string(),
            entity_type: "staff".to_string(),
            entity_id: schedule.staff_id,
            amount_paise: Some(0),
            payload: Some(json!({
                "businessDate": request.business_date,
                "scheduledStartTime": schedule.shift_start.format("%H:%M").to_string(),
                "scheduledEndTime": schedule.shift_end.format("%H:%M").to_string(),
                "requestedDepartureTime": requested_departure_time.format("%H:%M").to_string(),
                "earlyMinutes": early_minutes,
                "reason": reason,
                "staffName": schedule.staff_name,
            })),
            expires_at: None,
        },
    )
    .await
}

pub async fn approval_detail(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
) -> Result<ApprovalDetail, AppError> {
    let request = repository::get_approval_request(db, t, b, id)
        .await
        .map_err(internal("load approval"))?
        .ok_or_else(|| AppError::not_found("approval not found"))?;
    let actions = repository::approval_actions(db, t, b, id)
        .await
        .map_err(internal("load approval actions"))?;
    Ok(ApprovalDetail { request, actions })
}

pub async fn decide_approval(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    actor: &str,
    actor_role: &str,
    r: DecisionRequest,
) -> Result<ApprovalRequestRecord, AppError> {
    let decision = required_enum(
        &r.decision,
        &["approved", "rejected", "escalated", "cancelled"],
        "decision",
    )?;
    let current = repository::get_approval_request(db, t, b, id)
        .await
        .map_err(internal("load approval"))?
        .ok_or_else(|| AppError::not_found("approval not found"))?;
    let step = current.steps.as_array().and_then(|steps| {
        steps.iter().find(|s| {
            s.get("order").and_then(Value::as_i64) == Some(i64::from(current.current_step))
        })
    });
    let required_role = step
        .and_then(|s| s.get("role"))
        .and_then(Value::as_str)
        .unwrap_or("manager");
    if decision != "cancelled"
        && !APPROVAL_ROLES
            .iter()
            .any(|v| v.eq_ignore_ascii_case(actor_role))
        && !required_role.eq_ignore_ascii_case(actor_role)
    {
        return Err(AppError::forbidden(
            "current role cannot decide this approval",
        ));
    }
    if decision == "cancelled" && current.requested_by != actor {
        return Err(AppError::forbidden("only requester can cancel approval"));
    }
    if decision != "cancelled" && current.requested_by == actor {
        return Err(AppError::forbidden(
            "you cannot decide your own approval request",
        ));
    }
    let next = if decision == "approved"
        && current.steps.as_array().is_some_and(|s| {
            s.iter().any(|x| {
                x.get("order").and_then(Value::as_i64) == Some(i64::from(current.current_step + 1))
            })
        }) {
        Some(current.current_step + 1)
    } else {
        None
    };
    repository::decide_approval(
        db,
        t,
        b,
        id,
        r.version,
        actor,
        actor_role,
        &decision,
        &clean(r.comments.as_deref().unwrap_or(""), 500, "comments")?,
        next,
    )
    .await
    .map_err(internal("decide approval"))?
    .ok_or_else(stale)
}

pub async fn list_audit(
    db: &PgPool,
    t: &str,
    b: &str,
    prefix: &str,
) -> Result<Vec<AuditRecord>, AppError> {
    repository::list_audit(db, t, b, &clean(prefix, 100, "event prefix")?)
        .await
        .map_err(internal("load staff audit"))
}

pub async fn self_dashboard(
    db: &PgPool,
    t: &str,
    b: &str,
    user: &str,
    date: Option<NaiveDate>,
) -> Result<SelfDashboardRecord, AppError> {
    let date = date.unwrap_or_else(|| {
        Utc::now()
            .with_timezone(&FixedOffset::east_opt(19800).unwrap())
            .date_naive()
    });
    repository::self_dashboard(db, t, b, user, date)
        .await
        .map_err(internal("load staff self dashboard"))?
        .ok_or_else(|| AppError::not_found("linked employee profile not found"))
}

pub async fn self_staff_id(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
) -> Result<String, AppError> {
    repository::linked_staff_id(db, tenant, branch, user)
        .await
        .map_err(internal("load linked employee profile"))?
        .ok_or_else(|| AppError::not_found("linked employee profile not found"))
}

pub async fn list_tips(
    db: &PgPool,
    t: &str,
    b: &str,
    staff: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StaffTipRecord>, AppError> {
    if to < from {
        return Err(AppError::validation("tip period is invalid"));
    }
    repository::list_tips(db, t, b, staff, from, to)
        .await
        .map_err(internal("load staff tips"))
}

pub async fn tip_summary(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StaffTipSummary>, AppError> {
    if to < from {
        return Err(AppError::validation("tip period is invalid"));
    }
    repository::tip_summary(db, t, b, from, to)
        .await
        .map_err(internal("load tip summary"))
}

pub async fn self_earnings_details(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
    from: NaiveDate,
    to: NaiveDate,
    basis: &str,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 366 {
        return Err(AppError::validation(
            "earnings period must contain at most 367 days",
        ));
    }
    if !matches!(basis, "sale_date" | "close_date") {
        return Err(AppError::validation(
            "earnings basis must be sale_date or close_date",
        ));
    }
    repository::self_earnings_details(db, tenant, branch, staff, from, to, basis)
        .await
        .map_err(internal("load staff earnings"))
}

pub async fn create_tip_dispute(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
    actor: &str,
    sale_id: Option<&str>,
    payout_id: Option<&str>,
    reason: &str,
) -> Result<Value, AppError> {
    let reason = reason.trim();
    if !(10..=1000).contains(&reason.chars().count()) || (sale_id.is_none() && payout_id.is_none())
    {
        return Err(AppError::validation(
            "tip dispute needs a sale or payout and a 10-1000 character reason",
        ));
    }
    repository::create_tip_dispute(db, tenant, branch, staff, actor, sale_id, payout_id, reason)
        .await
        .map_err(|error| {
            if matches!(error, sqlx::Error::RowNotFound) {
                AppError::not_found("tip or payout was not found")
            } else {
                internal("create tip dispute")(error)
            }
        })
}

pub async fn record_tip_payout(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    r: TipPayoutRequest,
) -> Result<String, AppError> {
    if r.period_end < r.period_start || r.sale_ids.is_empty() || r.sale_ids.len() > 500 {
        return Err(AppError::validation(
            "tip payout period or sales are invalid",
        ));
    }
    let payout_method = r
        .payout_method
        .as_deref()
        .unwrap_or("other")
        .trim()
        .to_ascii_lowercase();
    let status = r
        .status
        .as_deref()
        .unwrap_or("paid")
        .trim()
        .to_ascii_lowercase();
    let provider_reference = r.provider_reference.as_deref().unwrap_or("").trim();
    if !matches!(payout_method.as_str(), "cash" | "bank" | "upi" | "other")
        || !matches!(status.as_str(), "pending" | "processing" | "paid")
        || matches!(payout_method.as_str(), "bank" | "upi")
            && status == "paid"
            && provider_reference.is_empty()
    {
        return Err(AppError::validation(
            "tip payout method, status or provider reference is invalid",
        ));
    }
    repository::record_tip_payout(
        db,
        t,
        b,
        &required(&r.staff_id, 120, "employee")?,
        r.period_start,
        r.period_end,
        &required(&r.payout_reference, 160, "payout reference")?,
        &payout_method,
        &status,
        provider_reference,
        actor,
        &r.sale_ids,
    )
    .await
    .map_err(|e| {
        if matches!(e, sqlx::Error::RowNotFound) {
            AppError::conflict("one or more tips are invalid or already paid")
        } else {
            db_write("payout reference already exists", "record tip payout")(e)
        }
    })
}

pub async fn reconcile_tip_payout(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: TipPayoutReconcileRequest,
) -> Result<Value, AppError> {
    let expected = request.expected_status.trim().to_ascii_lowercase();
    let status = request.status.trim().to_ascii_lowercase();
    let provider_reference = request.provider_reference.as_deref().unwrap_or("").trim();
    if !matches!(
        status.as_str(),
        "processing" | "paid" | "failed" | "reversed"
    ) || status == "paid" && provider_reference.is_empty()
    {
        return Err(AppError::validation("tip payout reconciliation is invalid"));
    }
    repository::reconcile_tip_payout(
        db,
        tenant,
        branch,
        id,
        &expected,
        &status,
        provider_reference,
        actor,
    )
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::RowNotFound) {
            AppError::conflict("tip payout status changed or transition is invalid")
        } else {
            internal("reconcile tip payout")(error)
        }
    })
}

pub async fn list_rules(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<StatutoryRuleRecord>, AppError> {
    repository::list_statutory_rules(db, t, b)
        .await
        .map_err(internal("load statutory rules"))
}

pub async fn create_rule(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    r: StatutoryRuleRequest,
) -> Result<StatutoryRuleRecord, AppError> {
    let kind = required_enum(&r.rule_type, RULE_TYPES, "statutory rule type")?;
    let jurisdiction =
        required(&r.jurisdiction_code, 32, "jurisdiction code")?.to_ascii_uppercase();
    if !jurisdiction
        .bytes()
        .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(AppError::validation("jurisdiction code is invalid"));
    }
    let rounding = required_enum(
        &r.rounding_method,
        ROUNDING_METHODS,
        "statutory rounding method",
    )?;
    let official_reference = required(&r.official_reference, 500, "official reference")?;
    let mut state =
        clean(r.state_code.as_deref().unwrap_or(""), 20, "state code")?.to_ascii_uppercase();
    if state.is_empty() {
        state = jurisdiction
            .strip_prefix("IN-")
            .unwrap_or_default()
            .to_string();
    }
    validate_rule(&r.rule)?;
    if r.effective_to.is_some_and(|d| d < r.effective_from) {
        return Err(AppError::validation("effective date range is invalid"));
    }
    repository::create_statutory_rule(
        db,
        t,
        b,
        actor,
        &kind,
        &state,
        &jurisdiction,
        &rounding,
        &official_reference,
        &r.rule,
        r.effective_from,
        r.effective_to,
    )
    .await
    .map_err(db_write(
        "statutory rule already exists",
        "create statutory rule",
    ))
}

pub async fn decide_rule(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    id: &str,
    r: DecisionRequest,
) -> Result<StatutoryRuleRecord, AppError> {
    let decision = required_enum(
        &r.decision,
        &["approved", "rejected"],
        "statutory rule decision",
    )?;
    let comments = clean(r.comments.as_deref().unwrap_or(""), 500, "review comments")?;
    if decision == "rejected" && comments.is_empty() {
        return Err(AppError::validation("rejection comments are required"));
    }
    let current = repository::statutory_rule(db, t, b, id)
        .await
        .map_err(internal("load statutory rule"))?
        .ok_or_else(|| AppError::not_found("statutory rule not found"))?;
    if current.created_by == actor {
        return Err(AppError::forbidden(
            "statutory rule creator cannot approve or reject the same rule",
        ));
    }
    if current.approval_status != "pending" || current.version != r.version {
        return Err(stale());
    }
    repository::decide_statutory_rule(db, t, b, id, r.version, actor, &decision, &comments)
        .await
        .map_err(internal("decide statutory rule"))?
        .ok_or_else(stale)
}

pub async fn calculate_statutory(
    db: &PgPool,
    t: &str,
    b: &str,
    _actor: &str,
    r: StatutoryCalculationRequest,
) -> Result<StatutoryCalculationRecord, AppError> {
    let (item, _from, _to, _gross, _run_status) =
        repository::payroll_item(db, t, b, &r.payroll_run_id, &r.staff_id)
            .await
            .map_err(internal("load payroll item"))?
            .ok_or_else(|| AppError::not_found("payroll item not found"))?;
    repository::statutory_calculation_for_item(db, t, b, &item)
        .await
        .map_err(internal("load payroll statutory snapshot"))?
        .ok_or_else(|| {
            AppError::validation(
                "generate or regenerate payroll before loading statutory compliance",
            )
        })
}

pub async fn statutory_summary(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<StatutorySummary, AppError> {
    if to < from {
        return Err(AppError::validation("summary period is invalid"));
    }
    let r = repository::statutory_summary(db, t, b, from, to)
        .await
        .map_err(internal("load statutory summary"))?;
    Ok(StatutorySummary {
        calculations: r.0,
        employee_deduction_paise: r.1,
        employer_contribution_paise: r.2,
        accrual_paise: r.3,
    })
}

pub async fn compliance_export(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<ComplianceExport, AppError> {
    if to < from {
        return Err(AppError::validation("export period is invalid"));
    }
    let rows = repository::statutory_calculations(db, t, b, from, to)
        .await
        .map_err(internal("load statutory export"))?;
    Ok(ComplianceExport {
        generated_at: Utc::now(),
        period_start: from,
        period_end: to,
        rows,
    })
}

pub async fn salary_revisions(
    db: &PgPool,
    t: &str,
    b: &str,
    staff: &str,
) -> Result<Vec<SalaryRevisionRecord>, AppError> {
    repository::salary_revisions(db, t, b, staff)
        .await
        .map_err(internal("load salary revisions"))
}

pub async fn create_salary_revision(
    db: &PgPool,
    t: &str,
    b: &str,
    staff: &str,
    actor: &str,
    r: SalaryRevisionRequest,
) -> Result<SalaryRevisionRecord, AppError> {
    let rate = required_enum(&r.rate_type, &["hourly", "daily", "monthly"], "rate type")?;
    if r.new_amount_paise <= 0 {
        return Err(AppError::validation("new salary amount must be positive"));
    }
    repository::create_salary_revision(
        db,
        t,
        b,
        staff,
        actor,
        &rate,
        r.new_amount_paise,
        r.effective_date,
        &clean(r.reason.as_deref().unwrap_or(""), 500, "reason")?,
    )
    .await
    .map_err(internal("create salary revision"))?
    .ok_or_else(|| AppError::validation("employee is invalid"))
}

pub async fn decide_salary_revision(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    actor: &str,
    r: DecisionRequest,
) -> Result<SalaryRevisionRecord, AppError> {
    let decision = required_enum(&r.decision, &["approved", "rejected"], "decision")?;
    repository::decide_salary_revision(
        db,
        t,
        b,
        id,
        r.version,
        &decision,
        actor,
        &clean(r.comments.as_deref().unwrap_or(""), 500, "review note")?,
    )
    .await
    .map_err(internal("decide salary revision"))?
    .ok_or_else(stale)
}

pub async fn roster_coverage(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<RosterCoverageResponse, AppError> {
    validate_period(from, to, 31, "roster")?;
    let row = repository::roster_coverage(db, t, b, from, to)
        .await
        .map_err(internal("load roster coverage"))?;
    Ok(RosterCoverageResponse {
        period_start: from,
        period_end: to,
        active_staff: row.active_staff,
        scheduled_staff_days: row.scheduled_staff_days,
        scheduled_minutes: row.scheduled_minutes,
        appointment_minutes: row.appointment_minutes,
        uncovered_appointments: row.uncovered_appointments,
        coverage_percent: (row.appointment_minutes > 0).then(|| {
            ((row.scheduled_minutes.saturating_mul(100) / row.appointment_minutes).min(100)) as i32
        }),
    })
}

pub async fn optimize_roster(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: RosterOptimizeRequest,
) -> Result<RosterDraftRecord, AppError> {
    validate_period(request.period_start, request.period_end, 31, "roster")?;
    let sources = repository::roster_sources(db, t, b, request.period_start, request.period_end)
        .await
        .map_err(internal("load roster evidence"))?;
    let leave_conflicts = sources
        .iter()
        .filter(|row| row.approved_leave && row.appointments_count > 0)
        .map(|row| row.appointments_count)
        .sum::<i64>();
    let entries = sources.iter().filter_map(roster_entry).collect::<Vec<_>>();
    let proposed_minutes = entries.iter().map(entry_minutes).sum::<i64>();
    let coverage = repository::roster_coverage(db, t, b, request.period_start, request.period_end)
        .await
        .map_err(internal("load roster gaps"))?;
    let metrics = json!({
        "appointmentMinutes": coverage.appointment_minutes,
        "proposedScheduledMinutes": proposed_minutes,
        "currentlyUncoveredAppointments": coverage.uncovered_appointments,
        "leaveConflictAppointments": leave_conflicts
    });
    repository::create_roster_draft(
        db,
        t,
        b,
        request.period_start,
        request.period_end,
        &serde_json::to_value(&entries)
            .map_err(|_| AppError::internal("failed to encode roster"))?,
        &metrics,
        actor,
    )
    .await
    .map_err(internal("create roster draft"))
}

pub async fn publish_roster(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    actor: &str,
    version: i32,
) -> Result<RosterDraftRecord, AppError> {
    let draft = repository::get_roster_draft(db, t, b, id)
        .await
        .map_err(internal("load roster draft"))?
        .ok_or_else(|| AppError::not_found("roster draft not found"))?;
    let entries: Vec<RosterEntry> = serde_json::from_value(draft.entries_json.clone())
        .map_err(|_| AppError::internal("roster draft data is invalid"))?;
    repository::publish_roster_draft(
        db,
        t,
        b,
        id,
        version,
        actor,
        entries
            .into_iter()
            .map(|row| RosterScheduleInput {
                staff_id: row.staff_id,
                schedule_date: row.schedule_date,
                shift1_start: row.shift1_start,
                shift1_end: row.shift1_end,
                shift2_start: row.shift2_start,
                shift2_end: row.shift2_end,
                status: row.status,
                notes: row.notes,
            })
            .collect(),
    )
    .await
    .map_err(internal("publish roster draft"))?
    .ok_or_else(stale)
}

pub async fn manpower_forecast(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: Option<&str>,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<ManpowerForecastResult, AppError> {
    validate_period(from, to, 90, "forecast")?;
    let history_to = from
        .pred_opt()
        .ok_or_else(|| AppError::validation("forecast date is invalid"))?;
    let history_from = from - Duration::days(28);
    let source = repository::manpower_source(db, t, b, history_from, history_to, from, to)
        .await
        .map_err(internal("load manpower evidence"))?;
    let period_days = (to - from).num_days() + 1;
    let historical_daily = source.historical_appointment_minutes / 28;
    let projected = source
        .future_booked_minutes
        .max(historical_daily.saturating_mul(period_days));
    let capacity_per_staff_day = (source.attendance_staff_days > 0)
        .then(|| source.worked_minutes / source.attendance_staff_days)
        .filter(|minutes| *minutes > 0);
    let capacity = capacity_per_staff_day.map(|daily| {
        daily
            .saturating_mul(source.active_staff)
            .saturating_mul(period_days)
    });
    let required = capacity_per_staff_day.map(|daily| {
        ceil_div(projected, daily.saturating_mul(period_days)).min(i32::MAX as i64) as i32
    });
    let shortage = required.map(|count| (count - source.active_staff as i32).max(0));
    let confidence = forecast_confidence(&source);
    let rows = repository::manpower_planning_rows(db, t, b, from, to)
        .await
        .map_err(internal("load hourly manpower plan"))?
        .into_iter()
        .map(manpower_planning_row)
        .collect::<Vec<_>>();
    let shortage_alert_count = rows
        .iter()
        .filter(|row| row.shortage_staff_count > 0)
        .count() as i64;
    let overstaffing_alert_count =
        rows.iter().filter(|row| row.overstaffed_count > 0).count() as i64;
    let leave_impact_alert_count =
        rows.iter().filter(|row| row.leave_impact_count > 0).count() as i64;
    let skills_shortage_alert_count = rows
        .iter()
        .filter(|row| row.skills_shortage_count > 0)
        .count() as i64;
    let evidence = json!({
        "activeStaff": source.active_staff,
        "historicalAppointmentMinutes": source.historical_appointment_minutes,
        "historicalAppointmentDays": source.historical_appointment_days,
        "attendanceStaffDays": source.attendance_staff_days,
        "averageWorkedMinutesPerStaffDay": capacity_per_staff_day,
        "futureBookedMinutes": source.future_booked_minutes,
        "planningRows": &rows
    });
    let saved = if let Some(actor) = actor {
        Some(
            repository::create_manpower_forecast(
                db,
                t,
                b,
                from,
                to,
                history_from,
                history_to,
                projected,
                capacity,
                required,
                shortage,
                confidence,
                &evidence,
                actor,
            )
            .await
            .map_err(internal("save manpower forecast"))?,
        )
    } else {
        None
    };
    Ok(ManpowerForecastResult {
        id: saved.map(|row| row.id),
        period_start: from,
        period_end: to,
        history_start: history_from,
        history_end: history_to,
        projected_demand_minutes: projected,
        booked_demand_minutes: source.future_booked_minutes,
        available_capacity_minutes: capacity,
        required_staff_count: required,
        shortage_staff_count: shortage,
        confidence: confidence.to_string(),
        recommendation: shortage
            .filter(|count| *count > 0)
            .map(|_| "add_temporary_coverage_or_hire".to_string()),
        shortage_alert_count,
        overstaffing_alert_count,
        leave_impact_alert_count,
        skills_shortage_alert_count,
        rows,
        evidence,
    })
}

pub async fn recommend_replacement(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: ReplacementRequest,
) -> Result<ReplacementRecommendationResponse, AppError> {
    let appointment = required(&request.appointment_id, 120, "appointment id")?;
    let context = repository::replacement_context(db, t, b, &appointment)
        .await
        .map_err(internal("load replacement appointment"))?
        .ok_or_else(|| AppError::not_found("replaceable appointment not found"))?;
    let services = parse_service_ids(&context.service_ids_json)?;
    let ranked = rank_candidates(
        db,
        t,
        b,
        &context.absent_staff_id,
        &context.appointment_id,
        context.business_date,
        context.start_time,
        context.end_time,
        &services,
        &context.client_id,
    )
    .await?;
    let best = ranked
        .first()
        .ok_or_else(|| AppError::validation("no eligible replacement is available"))?;
    let saved = repository::create_replacement_recommendation(
        db,
        t,
        b,
        &context.absent_staff_id,
        &context.appointment_id,
        &best.staff_id,
        &serde_json::to_value(&ranked)
            .map_err(|_| AppError::internal("failed to encode replacement ranking"))?,
        &best.confidence,
        actor,
    )
    .await
    .map_err(internal("save replacement recommendation"))?;
    Ok(ReplacementRecommendationResponse {
        recommendation: Some(saved),
        ranked_options: ranked,
    })
}

pub async fn best_staff(
    db: &PgPool,
    t: &str,
    b: &str,
    request: BestStaffRequest,
) -> Result<Vec<RankedStaffCandidate>, AppError> {
    if request.end_time <= request.start_time {
        return Err(AppError::validation("staff search time range is invalid"));
    }
    rank_candidates(
        db,
        t,
        b,
        "",
        &request.appointment_id,
        request.date,
        request.start_time,
        request.end_time,
        &request.service_ids.unwrap_or_default(),
        &request.client_id,
    )
    .await
}

pub async fn best_staff_for_self_appointment(
    db: &PgPool,
    t: &str,
    b: &str,
    user_id: &str,
    appointment_id: &str,
) -> Result<Vec<RankedStaffCandidate>, AppError> {
    let staff_id = self_staff_id(db, t, b, user_id).await?;
    let context = repository::replacement_context(db, t, b, appointment_id)
        .await
        .map_err(internal("load appointment recommendation context"))?
        .ok_or_else(|| AppError::not_found("appointment not found"))?;
    if context.absent_staff_id != staff_id {
        return Err(AppError::not_found("appointment not found"));
    }
    rank_candidates(
        db,
        t,
        b,
        "",
        &context.appointment_id,
        context.business_date,
        context.start_time,
        context.end_time,
        &parse_service_ids(&context.service_ids_json)?,
        &context.client_id,
    )
    .await
}

pub async fn replacement_history(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<ReplacementRecommendationRecord>, AppError> {
    repository::replacement_history(db, t, b)
        .await
        .map_err(internal("load replacement history"))
}

pub async fn decide_replacement(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    actor: &str,
    request: DecisionRequest,
) -> Result<ReplacementRecommendationRecord, AppError> {
    let decision = required_enum(&request.decision, &["approved", "rejected"], "decision")?;
    repository::decide_replacement(
        db,
        t,
        b,
        id,
        request.version,
        &decision,
        actor,
        &clean(
            request.comments.as_deref().unwrap_or(""),
            500,
            "decision reason",
        )?,
    )
    .await
    .map_err(internal("decide replacement"))?
    .ok_or_else(|| AppError::conflict("replacement or appointment availability changed"))
}

pub async fn intelligence_risks(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
    retention: bool,
) -> Result<Vec<IntelligenceRiskRow>, AppError> {
    let performance = staff_advanced_service::performance(db, t, b, from, to, "").await?;
    Ok(performance
        .rows
        .into_iter()
        .filter_map(|row| {
            let risk = if retention {
                row.retention_risk
            } else {
                row.burnout_risk
            }?;
            Some(IntelligenceRiskRow {
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                risk,
            })
        })
        .collect())
}

pub async fn staff_sales_report(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
    page: i64,
    page_size: i64,
) -> Result<StaffSalesReport, AppError> {
    validate_period(from, to, 367, "staff sales")?;
    let page = page.max(1);
    let page_size = page_size.clamp(1, 200);
    let offset = (page - 1) * page_size;
    let (summary, lines, total_lines) = tokio::try_join!(
        repository::staff_sales_summary(db, t, b, from, to),
        repository::staff_sales_lines(db, t, b, from, to, offset, page_size),
        repository::staff_sales_line_count(db, t, b, from, to),
    )
    .map_err(internal("load staff sales report"))?;
    Ok(StaffSalesReport {
        period_start: from,
        period_end: to,
        summary,
        lines,
        page,
        page_size,
        total_lines,
    })
}

pub async fn operational_report(
    db: &PgPool,
    t: &str,
    b: &str,
    report_type: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, AppError> {
    validate_period(from, to, 367, "staff report")?;
    let report_type = required_enum(
        report_type,
        &[
            "revenue",
            "attendance",
            "payroll",
            "commission",
            "tips",
            "utilization",
            "training",
            "productivity",
        ],
        "report type",
    )?;
    let rows = match report_type.as_str() {
        "revenue" => serde_json::to_value(
            repository::staff_sales_summary(db, t, b, from, to)
                .await
                .map_err(internal("load staff revenue report"))?,
        ),
        "tips" => serde_json::to_value(
            repository::tip_summary(db, t, b, from, to)
                .await
                .map_err(internal("load staff tips report"))?,
        ),
        "utilization" | "productivity" => {
            serde_json::to_value(staff_advanced_service::performance(db, t, b, from, to, "").await?)
        }
        kind => serde_json::to_value(
            repository::staff_operational_report(db, t, b, from, to, kind)
                .await
                .map_err(internal("load staff operational report"))?,
        ),
    }
    .map_err(|e| AppError::internal(format!("failed to serialize staff report: {e}")))?;
    Ok(json!({"reportType":report_type,"periodStart":from,"periodEnd":to,"rows":rows}))
}

pub async fn notification_preference(
    db: &PgPool,
    t: &str,
    b: &str,
    staff_id: &str,
) -> Result<Option<StaffNotificationPreferenceRecord>, AppError> {
    repository::notification_preference(db, t, b, staff_id)
        .await
        .map_err(internal("load staff notification preference"))
}

pub async fn save_notification_preference(
    db: &PgPool,
    t: &str,
    b: &str,
    staff_id: &str,
    request: NotificationPreferenceRequest,
) -> Result<StaffNotificationPreferenceRecord, AppError> {
    repository::notification_context(db, t, b, staff_id)
        .await
        .map_err(internal("load staff notification context"))?
        .ok_or_else(|| AppError::not_found("staff member not found"))?;
    if request.quiet_hours_start.is_some() != request.quiet_hours_end.is_some() {
        return Err(AppError::validation(
            "quiet hours start and end must be provided together",
        ));
    }
    let language = required(
        request.language_code.as_deref().unwrap_or("en-IN"),
        16,
        "language code",
    )?;
    repository::save_notification_preference(
        db,
        t,
        b,
        staff_id,
        request.whatsapp_opt_in,
        request.allow_payroll_amounts.unwrap_or(false),
        &language,
        request.quiet_hours_start,
        request.quiet_hours_end,
        request.version.unwrap_or(0),
    )
    .await
    .map_err(internal("save staff notification preference"))?
    .ok_or_else(stale)
}

pub async fn list_notification_templates(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<StaffNotificationTemplateRecord>, AppError> {
    repository::list_notification_templates(db, t, b)
        .await
        .map_err(internal("load staff notification templates"))
}

pub async fn create_notification_template(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: NotificationTemplateRequest,
) -> Result<StaffNotificationTemplateRecord, AppError> {
    let notification_type = required_enum(
        &request.notification_type,
        &[
            "schedule",
            "attendance",
            "leave",
            "task",
            "training",
            "payroll",
            "payroll_finalized",
            "payroll_paid",
            "payroll_payslip_available",
            "payroll_fine_applied",
            "payroll_advance_recovered",
            "payroll_corrected",
            "compliance",
            "announcement",
        ],
        "notification type",
    )?;
    let language = required(
        request.language_code.as_deref().unwrap_or("en-IN"),
        16,
        "language code",
    )?;
    let title = required(&request.title, 160, "template title")?;
    let body = required(&request.body_template, 3000, "template body")?;
    let sensitive = request.sensitive.unwrap_or(false)
        || notification_type.starts_with("payroll")
        || notification_type == "compliance";
    repository::create_notification_template(
        db,
        t,
        b,
        actor,
        &notification_type,
        &language,
        &title,
        &body,
        sensitive,
    )
    .await
    .map_err(db_write(
        "notification template already exists",
        "create staff notification template",
    ))
}

pub async fn queue_notification(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: QueueNotificationRequest,
) -> Result<StaffNotificationQueueRecord, AppError> {
    let channel = required_enum(&request.channel, &["whatsapp", "in_app"], "channel")?;
    let context = repository::notification_context(db, t, b, &request.staff_id)
        .await
        .map_err(internal("load staff notification context"))?
        .ok_or_else(|| AppError::not_found("staff member not found"))?;
    let template = repository::notification_template(db, t, b, &request.template_id)
        .await
        .map_err(internal("load staff notification template"))?
        .ok_or_else(|| AppError::not_found("notification template not found"))?;
    if channel == "whatsapp" && context.whatsapp_opt_in != Some(true) {
        return Err(AppError::validation(
            "staff WhatsApp consent must be recorded before queueing",
        ));
    }
    let recipient = if channel == "whatsapp" {
        let digits = context
            .mobile_phone
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        if !(8..=15).contains(&digits.len()) {
            return Err(AppError::validation(
                "staff mobile phone is missing or invalid",
            ));
        }
        digits
    } else {
        context.staff_id.clone()
    };
    let contains_payroll_amounts = request.contains_payroll_amounts.unwrap_or(false);
    if contains_payroll_amounts && context.allow_payroll_amounts != Some(true) {
        return Err(AppError::validation(
            "staff consent for payroll amounts is required",
        ));
    }
    let mut variables = request.variables.unwrap_or_default();
    variables.insert("staff.firstName".into(), context.first_name);
    variables.insert("staff.displayName".into(), context.display_name);
    let title = render_template(&template.title, &variables)?;
    let body = render_template(&template.body_template, &variables)?;
    let sensitive = template.sensitive
        || contains_payroll_amounts
        || template.notification_type.starts_with("payroll")
        || template.notification_type == "compliance";
    let now = Utc::now();
    let mut scheduled_at = request.scheduled_at.unwrap_or(now).max(now);
    if channel == "whatsapp" {
        if let (Some(start), Some(end)) = (context.quiet_hours_start, context.quiet_hours_end) {
            let local_time = scheduled_at
                .with_timezone(&FixedOffset::east_opt(19800).unwrap())
                .time();
            scheduled_at += quiet_delay(local_time, start, end);
        }
    }
    let status = if sensitive {
        "approval_required"
    } else {
        "queued"
    };
    repository::create_notification_queue(
        db,
        t,
        b,
        actor,
        &context.staff_id,
        Some(&template.id),
        &channel,
        &template.notification_type,
        &recipient,
        &title,
        &body,
        sensitive,
        sensitive,
        status,
        scheduled_at,
        &request.metadata.unwrap_or_else(|| json!({})),
    )
    .await
    .map_err(internal("queue staff notification"))
}

pub async fn list_notification_queue(
    db: &PgPool,
    t: &str,
    b: &str,
    status: Option<&str>,
) -> Result<Vec<StaffNotificationQueueRecord>, AppError> {
    if let Some(status) = status {
        required_enum(
            status,
            &[
                "approval_required",
                "queued",
                "approved",
                "sent",
                "failed",
                "cancelled",
            ],
            "notification status",
        )?;
    }
    repository::list_notification_queue(db, t, b, status)
        .await
        .map_err(internal("load staff notification queue"))
}

pub async fn approve_notification(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    version: i32,
    actor: &str,
) -> Result<StaffNotificationQueueRecord, AppError> {
    repository::approve_notification(db, t, b, id, version, actor)
        .await
        .map_err(internal("approve staff notification"))?
        .ok_or_else(stale)
}

pub async fn record_notification_delivery(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    request: NotificationDeliveryRequest,
) -> Result<StaffNotificationQueueRecord, AppError> {
    let status = required_enum(&request.status, &["sent", "failed"], "delivery status")?;
    let provider = required(&request.provider, 80, "provider")?;
    let provider_message_id = clean(
        request.provider_message_id.as_deref().unwrap_or(""),
        240,
        "provider message id",
    )?;
    if status == "sent" && provider_message_id.is_empty() {
        return Err(AppError::validation(
            "provider message id is required for sent delivery",
        ));
    }
    let error = clean(
        request.error_message.as_deref().unwrap_or(""),
        1000,
        "delivery error",
    )?;
    repository::record_notification_delivery(
        db,
        t,
        b,
        id,
        request.version,
        &provider,
        &provider_message_id,
        &status,
        &error,
        &request.payload.unwrap_or_else(|| json!({})),
    )
    .await
    .map_err(internal("record staff notification delivery"))?
    .ok_or_else(stale)
}

pub async fn retry_notification(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    version: i32,
) -> Result<StaffNotificationQueueRecord, AppError> {
    repository::retry_notification(db, t, b, id, version)
        .await
        .map_err(internal("retry staff notification"))?
        .ok_or_else(stale)
}

pub async fn notification_delivery_logs(
    db: &PgPool,
    t: &str,
    b: &str,
    queue_id: Option<&str>,
) -> Result<Vec<StaffNotificationDeliveryLogRecord>, AppError> {
    repository::notification_delivery_logs(db, t, b, queue_id)
        .await
        .map_err(internal("load staff notification delivery logs"))
}

pub async fn enterprise_command_center(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<StaffEnterpriseCommandCenter, AppError> {
    validate_period(from, to, 367, "enterprise command center")?;
    let (
        performance,
        approvals,
        tasks,
        sales,
        mut recommendations,
        equipment_departments,
        equipment_resources,
    ) = tokio::try_join!(
        staff_advanced_service::performance(db, t, b, from, to, ""),
        async {
            repository::list_approval_requests(db, t, b, "")
                .await
                .map_err(internal("load command center approvals"))
        },
        staff_advanced_service::list_tasks(db, t, b, "", ""),
        async {
            repository::staff_sales_summary(db, t, b, from, to)
                .await
                .map_err(internal("load command center sales"))
        },
        async {
            repository::management_recommendations(db, t, b, from, to)
                .await
                .map_err(internal("load management recommendations"))
        },
        async {
            repository::equipment_department_rows(db, t, b, from, to, "")
                .await
                .map_err(internal("load equipment demand"))
        },
        async {
            repository::equipment_resource_rows(db, t, b, from, to, "")
                .await
                .map_err(internal("load equipment utilization"))
        },
    )?;
    let equipment_intelligence =
        build_equipment_intelligence(&equipment_departments, &equipment_resources, &approvals);
    let pending_approvals = approvals
        .iter()
        .filter(|row| row.status == "pending")
        .count();
    let training_due = tasks
        .iter()
        .filter(|row| is_due_training(&row.task_type, &row.status, row.due_at, Utc::now()))
        .count();
    if let Some(rows) = recommendations.as_array_mut() {
        rows.extend(sales.iter().filter(|row| row.invoice_count > 0).map(|row| {
            let conversion = retail_conversion_percent(row.product_invoice_count, row.invoice_count);
            json!({
                "type":"staff_product_performance",
                "title":format!("{} retail conversion: {}%", row.staff_name, conversion),
                "reason":"Attributed product invoices divided by all attributed invoices in the selected period",
                "priority":if conversion == 0 { "high" } else if conversion < 20 { "medium" } else { "low" },
                "evidence":{"staffId":row.staff_id,"productInvoices":row.product_invoice_count,"invoices":row.invoice_count,"productRevenuePaise":row.product_revenue_paise},
                "route":"/staff/control-center?tab=command"
            })
        }));
    }
    let mut top_staff = performance.rows.clone();
    top_staff.sort_by(|a, b| b.score.cmp(&a.score));
    top_staff.truncate(5);
    let risks = performance
        .rows
        .iter()
        .filter(|row| {
            row.burnout_risk
                .as_ref()
                .is_some_and(|risk| matches!(risk.level.as_str(), "high" | "critical"))
                || row
                    .retention_risk
                    .as_ref()
                    .is_some_and(|risk| matches!(risk.level.as_str(), "high" | "critical"))
        })
        .collect::<Vec<_>>();
    let attention_queue = json!({
        "riskSignals": risks,
        "pendingApprovals": approvals.iter().filter(|row| row.status == "pending").take(10).collect::<Vec<_>>(),
        "dueTraining": tasks.iter().filter(|row| is_due_training(&row.task_type, &row.status, row.due_at, Utc::now())).take(10).collect::<Vec<_>>()
    });
    Ok(StaffEnterpriseCommandCenter {
        period_start: from,
        period_end: to,
        generated_at: Utc::now(),
        source_counts: json!({"staff":performance.summary.staff_count,"salesStaff":sales.len(),"approvals":approvals.len(),"tasks":tasks.len()}),
        kpis: json!({"staffCount":performance.summary.staff_count,"totalRevenuePaise":performance.summary.total_revenue_paise,"highRiskSignals":risks.len(),"pendingApprovals":pending_approvals,"trainingDue":training_due}),
        top_staff,
        attention_queue,
        recommendations,
        equipment_intelligence,
    })
}

pub async fn staff_equipment_intelligence(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
) -> Result<Value, AppError> {
    let (departments, resources) = tokio::try_join!(
        async {
            repository::equipment_department_rows(db, t, b, from, to, staff_id)
                .await
                .map_err(internal("load staff equipment demand"))
        },
        async {
            repository::equipment_resource_rows(db, t, b, from, to, staff_id)
                .await
                .map_err(internal("load staff equipment utilization"))
        },
    )?;
    Ok(build_equipment_intelligence(&departments, &resources, &[]))
}

fn build_equipment_intelligence(
    departments: &[EquipmentDepartmentRecord],
    resources: &[EquipmentResourceRecord],
    approvals: &[ApprovalRequestRecord],
) -> Value {
    let mut recommendations = Vec::new();
    let department_rows = departments.iter().map(|row| {
        let shortage = (row.peak_hourly_demand - row.active_resources).max(0);
        let projected_revenue = row.equipment_lost_bookings * row.average_value_paise;
        let inactive = resources.iter().find(|resource| !resource.active && resource.department == row.department);
        let kind = row.resource_kinds.first().or(row.constraint_resource_kinds.first()).cloned().unwrap_or_default();
        let donor = if kind.is_empty() { None } else { resources.iter().find(|resource| {
            resource.active && resource.department != row.department && resource.kind == kind
                && utilization_percent(resource.booked_minutes, departments.iter().find(|department| department.department == resource.department).map_or(0, |department| department.demand_slots)).is_some_and(|value| value <= 20)
        }) };
        if shortage > 0 && row.equipment_lost_bookings > 0 {
            let (action, resource_id, resource_name, title) = if let Some(resource) = donor {
                ("transfer", resource.id.clone(), resource.name.clone(), format!("Transfer {} capacity to {}", resource.name, row.department))
            } else if let Some(resource) = inactive {
                ("maintenance", resource.id.clone(), resource.name.clone(), format!("Restore {} for {} demand", resource.name, row.department))
            } else if !kind.is_empty() {
                ("purchase", row.department.clone(), kind.clone(), format!("Add {} capacity for {}", kind, row.department))
            } else {
                ("configure", row.department.clone(), String::new(), format!("Configure {} resource types", row.department))
            };
            let key = format!("equipment:{action}:{}", resource_id.to_lowercase().replace(' ', "-"));
            let approval = approvals.iter().find(|approval| approval.entity_type == "equipment_recommendation" && approval.entity_id == key);
            recommendations.push(json!({
                "key":key,"actionType":action,"approvalRequired":action != "configure",
                "approvalStatus":approval.map(|item| item.status.as_str()),"approvalId":approval.map(|item| item.id.as_str()),
                "title":title,"reason":"Persisted equipment-related lost bookings coincide with peak resource shortage.",
                "priority":"critical","department":row.department,"equipmentKind":if action == "purchase" { resource_name } else { kind.clone() },
                "estimatedAdditionalAppointments":row.equipment_lost_bookings,"estimatedRevenuePaise":projected_revenue,
                "evidence":{"lostBookings":row.equipment_lost_bookings,"peakHourlyDemand":row.peak_hourly_demand,"activeResources":row.active_resources,"shortage":shortage,"averageAppointmentValuePaise":row.average_value_paise},
                "route":"/appointments"
            }));
        } else if row.appointment_count > 0 && row.active_resources == 0 && row.inactive_resources == 0 {
            recommendations.push(json!({
                "key":format!("equipment:configure:{}", row.department.to_lowercase().replace(' ', "-")),
                "actionType":"configure","approvalRequired":false,"approvalStatus":Value::Null,
                "title":format!("Configure {} appointment resources", row.department),
                "reason":"Appointments exist but no department resource is configured; an exact equipment purchase cannot be inferred.",
                "priority":"high","department":row.department,"equipmentKind":"",
                "estimatedAdditionalAppointments":0,"estimatedRevenuePaise":0,
                "evidence":{"appointments":row.appointment_count,"unassignedAppointments":row.unassigned_appointments,"peakHourlyDemand":row.peak_hourly_demand},
                "route":"/appointments"
            }));
        }
        json!({
            "department":row.department,"appointments":row.appointment_count,"unassignedAppointments":row.unassigned_appointments,
            "bookedMinutes":row.booked_minutes,"peakHourlyDemand":row.peak_hourly_demand,"activeResources":row.active_resources,
            "inactiveResources":row.inactive_resources,"capacityShortage":shortage,"equipmentLostBookings":row.equipment_lost_bookings,
            "estimatedAdditionalAppointments":row.equipment_lost_bookings,"estimatedRevenuePaise":projected_revenue
        })
    }).collect::<Vec<_>>();
    let resource_rows = resources.iter().map(|row| {
        let demand_slots = departments.iter().find(|department| department.department == row.department).map_or(0, |department| department.demand_slots);
        json!({"id":row.id,"name":row.name,"kind":row.kind,"department":row.department,"active":row.active,
          "appointments":row.appointment_count,"bookedMinutes":row.booked_minutes,"demandWindowUtilizationPercent":utilization_percent(row.booked_minutes,demand_slots)})
    }).collect::<Vec<_>>();
    json!({
        "summary":{
            "activeResources":departments.iter().map(|row| row.active_resources).sum::<i64>(),
            "unassignedAppointments":departments.iter().map(|row| row.unassigned_appointments).sum::<i64>(),
            "shortageDepartments":departments.iter().filter(|row| row.peak_hourly_demand > row.active_resources).count(),
            "equipmentLostBookings":departments.iter().map(|row| row.equipment_lost_bookings).sum::<i64>(),
            "estimatedAdditionalAppointments":departments.iter().map(|row| row.equipment_lost_bookings).sum::<i64>(),
            "estimatedRevenuePaise":departments.iter().map(|row| row.equipment_lost_bookings * row.average_value_paise).sum::<i64>()
        },
        "departments":department_rows,"resources":resource_rows,"recommendations":recommendations
    })
}

fn utilization_percent(booked_minutes: i64, demand_slots: i64) -> Option<i64> {
    (demand_slots > 0).then(|| (booked_minutes.max(0) * 100 / (demand_slots * 60)).clamp(0, 100))
}

fn retail_conversion_percent(product_invoices: i64, invoices: i64) -> i64 {
    if invoices > 0 {
        (product_invoices.max(0) * 100 / invoices).clamp(0, 100)
    } else {
        0
    }
}

pub async fn staff_skill_matrix(
    db: &PgPool,
    t: &str,
    b: &str,
) -> Result<Vec<StaffSkillMatrixRecord>, AppError> {
    repository::staff_skill_matrix(db, t, b)
        .await
        .map_err(internal("load staff skill matrix"))
}

pub async fn staff_digital_twins(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, AppError> {
    let performance = staff_advanced_service::performance(db, t, b, from, to, "").await?;
    let skills = staff_skill_matrix(db, t, b).await?;
    let tasks = staff_advanced_service::list_tasks(db, t, b, "", "").await?;
    let items = performance
        .rows
        .into_iter()
        .map(|row| {
            let skill = skills.iter().find(|item| item.staff_id == row.staff_id);
            let actions = tasks
                .iter()
                .filter(|task| task.staff_id.as_deref() == Some(row.staff_id.as_str()))
                .collect::<Vec<_>>();
            json!({"staffId":row.staff_id,"staffName":row.staff_name,"performance":row,"skillMatrix":skill,"actions":actions})
        })
        .collect::<Vec<_>>();
    Ok(json!({"periodStart":from,"periodEnd":to,"items":items}))
}

pub async fn staff_digital_twin(
    db: &PgPool,
    t: &str,
    b: &str,
    staff_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, AppError> {
    let response = staff_digital_twins(db, t, b, from, to).await?;
    response["items"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["staffId"].as_str() == Some(staff_id))
        })
        .cloned()
        .ok_or_else(|| AppError::not_found("staff member not found"))
}

pub async fn floor_control(
    db: &PgPool,
    t: &str,
    b: &str,
    date: NaiveDate,
) -> Result<Vec<StaffFloorControlRecord>, AppError> {
    repository::staff_floor_control(db, t, b, date)
        .await
        .map_err(internal("load staff floor control"))
}

pub async fn training_assignments(
    db: &PgPool,
    t: &str,
    b: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffTaskRecord>, AppError> {
    Ok(
        staff_advanced_service::list_tasks(db, t, b, staff_id, status)
            .await?
            .into_iter()
            .filter(|task| matches!(task.task_type.as_str(), "training" | "performance"))
            .collect(),
    )
}

pub async fn assign_training(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: TrainingAssignmentRequest,
) -> Result<StaffTaskRecord, AppError> {
    staff_advanced_service::create_task(
        db,
        t,
        b,
        actor,
        StaffTaskRequest {
            client_id: None,
            appointment_id: None,
            staff_id: Some(request.staff_id),
            title: request.title,
            description: request.description,
            task_type: Some("training".into()),
            priority: request.priority,
            due_at: request.due_at,
            status: Some("open".into()),
            version: None,
        },
    )
    .await
}

pub async fn lms_dashboard(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    repository::lms_dashboard(db, tenant, branch)
        .await
        .map_err(internal("load learning and skills dashboard"))
}

pub async fn save_course_profile(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    document_id: &str,
    actor: &str,
    request: CourseProfileRequest,
) -> Result<Value, AppError> {
    let skill_name = clean(
        request.skill_name.as_deref().unwrap_or(""),
        200,
        "skill name",
    )?;
    let skill_level = request.skill_level.unwrap_or(1);
    let expected_minutes = request.expected_minutes.unwrap_or(0);
    let certification_valid_days = request.certification_valid_days.unwrap_or(0);
    if !(1..=5).contains(&skill_level) {
        return Err(AppError::validation("skill level must be between 1 and 5"));
    }
    if !(0..=10_080).contains(&expected_minutes) {
        return Err(AppError::validation(
            "expected minutes must be between 0 and 10080",
        ));
    }
    if !(0..=3_650).contains(&certification_valid_days)
        || (certification_valid_days > 0 && skill_name.is_empty())
    {
        return Err(AppError::validation(
            "certification validity requires a skill and must be between 0 and 3650 days",
        ));
    }
    repository::save_course_profile(
        db,
        tenant,
        branch,
        document_id.trim(),
        &skill_name,
        skill_level,
        expected_minutes,
        certification_valid_days,
        actor,
        request.version,
    )
    .await
    .map_err(internal("save course profile"))?
    .ok_or_else(stale)
}

pub async fn assign_course(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: CourseAssignmentRequest,
) -> Result<Value, AppError> {
    let staff_id = required(&request.staff_id, 120, "staff")?;
    let course_id = required(&request.course_id, 120, "course")?;
    let priority = required_enum(
        request.priority.as_deref().unwrap_or("medium"),
        &["low", "medium", "high", "urgent"],
        "priority",
    )?;
    repository::assign_course(
        db,
        tenant,
        branch,
        &staff_id,
        &course_id,
        &priority,
        request.due_at,
        actor,
    )
    .await
    .map_err(internal("assign course"))?
    .ok_or_else(|| AppError::conflict("course is invalid or already actively assigned"))
}

pub async fn save_skill_requirement(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: SkillRequirementRequest,
) -> Result<Value, AppError> {
    let scope_type = required_enum(
        &request.scope_type,
        &["role", "service"],
        "requirement scope",
    )?;
    let scope_id = required(&request.scope_id, 120, "scope")?;
    let skill_name = required(&request.skill_name, 200, "skill name")?;
    let required_level = request.required_level.unwrap_or(1);
    if !(1..=5).contains(&required_level) {
        return Err(AppError::validation(
            "required level must be between 1 and 5",
        ));
    }
    repository::save_skill_requirement(
        db,
        tenant,
        branch,
        &scope_type,
        &scope_id,
        &skill_name,
        required_level,
        request.certification_required.unwrap_or(true),
        request.active.unwrap_or(true),
        actor,
        request.version,
    )
    .await
    .map_err(internal("save skill requirement"))?
    .ok_or_else(|| AppError::conflict("requirement scope is invalid, duplicated or stale"))
}

pub async fn renew_certification(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: CertificationRenewalRequest,
) -> Result<Value, AppError> {
    if request.expires_on <= Utc::now().date_naive() {
        return Err(AppError::validation("renewal expiry must be in the future"));
    }
    let document_url = clean(
        request.document_url.as_deref().unwrap_or(""),
        2000,
        "document URL",
    )?;
    repository::renew_certification(
        db,
        tenant,
        branch,
        id.trim(),
        request.version,
        request.expires_on,
        &document_url,
        actor,
    )
    .await
    .map_err(internal("renew certification"))?
    .ok_or_else(stale)
}

pub async fn create_staff_rule_document(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: StaffRuleDocumentRequest,
) -> Result<StaffRuleDocumentRecord, AppError> {
    let document_type = required_enum(
        &request.document_type,
        &[
            "rule",
            "sop",
            "policy",
            "course",
            "document",
            "announcement",
        ],
        "document type",
    )?;
    let category = required_enum(
        &request.category,
        &[
            "service",
            "hygiene",
            "attendance",
            "behavior",
            "safety",
            "company",
            "training",
        ],
        "rule category",
    )?;
    let title = required(&request.title, 180, "title")?;
    let content = required(&request.content, 20_000, "content")?;
    if request
        .expires_on
        .is_some_and(|date| date < request.effective_date)
    {
        return Err(AppError::validation(
            "expiry must be on or after the effective date",
        ));
    }
    let attachment = clean(
        request.training_attachment_url.as_deref().unwrap_or(""),
        1000,
        "training attachment URL",
    )?;
    if !attachment.is_empty()
        && !attachment.starts_with("https://")
        && !attachment.starts_with("http://")
        && !attachment.starts_with('/')
    {
        return Err(AppError::validation("training attachment URL is invalid"));
    }
    let questions = request.quiz.unwrap_or_default();
    if questions.len() > 20 {
        return Err(AppError::validation(
            "quiz can contain at most 20 questions",
        ));
    }
    let mut quiz = Vec::with_capacity(questions.len());
    for (index, question) in questions.into_iter().enumerate() {
        let prompt = required(&question.question, 500, "quiz question")?;
        if !(2..=6).contains(&question.options.len())
            || question.correct_index >= question.options.len()
        {
            return Err(AppError::validation(
                "quiz options or correct answer are invalid",
            ));
        }
        let options = question
            .options
            .iter()
            .map(|option| required(option, 200, "quiz option"))
            .collect::<Result<Vec<_>, _>>()?;
        let question_id = clean(question.id.as_deref().unwrap_or(""), 100, "question ID")?;
        quiz.push(json!({
            "id": if question_id.is_empty() { format!("q{}", index + 1) } else { question_id },
            "question": prompt,
            "options": options,
            "correctIndex": question.correct_index
        }));
    }
    let pass_score = if quiz.is_empty() {
        0
    } else {
        request.quiz_pass_score.unwrap_or(80)
    };
    if !quiz.is_empty() && !(1..=100).contains(&pass_score) {
        return Err(AppError::validation(
            "quiz pass score must be between 1 and 100",
        ));
    }
    let document_key = match request.document_key.as_deref() {
        Some(value) if !value.trim().is_empty() => required(value, 100, "document key")?,
        _ => uuid::Uuid::new_v4().to_string(),
    };
    repository::create_staff_rule_document(
        db,
        tenant,
        branch,
        actor,
        &document_key,
        &document_type,
        &category,
        &title,
        &content,
        request.effective_date,
        request.expires_on,
        request.mandatory_acknowledgement.unwrap_or(true),
        &attachment,
        &Value::Array(quiz),
        pass_score,
    )
    .await
    .map_err(db_write(
        "rule version already exists",
        "create staff rule document",
    ))
}

pub async fn list_staff_rules_center(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, AppError> {
    repository::list_staff_rules_center(db, tenant, branch)
        .await
        .map_err(internal("load staff rules center"))
}

pub async fn publish_staff_rule_document(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
) -> Result<StaffRuleDocumentRecord, AppError> {
    repository::publish_staff_rule_document(db, tenant, branch, id, version, actor)
        .await
        .map_err(internal("publish staff rule document"))?
        .ok_or_else(stale)
}

pub async fn unpublish_staff_rule_document(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
) -> Result<StaffRuleDocumentRecord, AppError> {
    repository::unpublish_staff_rule_document(db, tenant, branch, id, version, actor)
        .await
        .map_err(internal("unpublish staff rule document"))?
        .ok_or_else(stale)
}

pub async fn list_self_staff_rules(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
) -> Result<Value, AppError> {
    repository::list_self_staff_rules(db, tenant, branch, staff_id)
        .await
        .map_err(internal("load staff rules"))
}

pub async fn mark_staff_rule_read(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    document_id: &str,
    staff_id: &str,
) -> Result<StaffRuleStatusRecord, AppError> {
    repository::mark_staff_rule_read(db, tenant, branch, document_id, staff_id)
        .await
        .map_err(internal("mark staff rule read"))?
        .ok_or_else(|| AppError::not_found("current rule not found"))
}

pub async fn acknowledge_staff_rule(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    document_id: &str,
    staff_id: &str,
    actor: &str,
    request: StaffRuleAcknowledgementRequest,
) -> Result<StaffRuleStatusRecord, AppError> {
    let document =
        repository::staff_rule_document_for_acknowledgement(db, tenant, branch, document_id)
            .await
            .map_err(internal("load staff rule"))?
            .ok_or_else(|| AppError::not_found("current rule not found"))?;
    let answers = request.answers.unwrap_or_default();
    let (score, passed) = quiz_result(&document.quiz_json, &answers, document.quiz_pass_score)?;
    repository::acknowledge_staff_rule(
        db,
        tenant,
        branch,
        document_id,
        staff_id,
        &json!(answers),
        score,
        passed,
        actor,
    )
    .await
    .map_err(internal("acknowledge staff rule"))
}

pub async fn create_staff_rule_violation(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: StaffRuleViolationRequest,
) -> Result<StaffRuleViolationRecord, AppError> {
    let details = required(&request.details, 4000, "violation details")?;
    repository::create_staff_rule_violation(
        db,
        tenant,
        branch,
        &required(&request.document_id, 100, "document ID")?,
        &required(&request.staff_id, 100, "staff ID")?,
        &details,
        request.occurred_at.unwrap_or_else(Utc::now),
        actor,
    )
    .await
    .map_err(internal("record staff rule violation"))?
    .ok_or_else(|| AppError::not_found("staff member or rule not found"))
}

pub async fn resolve_staff_rule_violation(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: StaffRuleViolationResolutionRequest,
) -> Result<StaffRuleViolationRecord, AppError> {
    let note = required(&request.resolution_note, 4000, "resolution note")?;
    repository::resolve_staff_rule_violation(db, tenant, branch, id, request.version, &note, actor)
        .await
        .map_err(internal("resolve staff rule violation"))?
        .ok_or_else(stale)
}

fn quiz_result(quiz: &Value, answers: &[i32], pass_score: i32) -> Result<(i32, bool), AppError> {
    let questions = quiz
        .as_array()
        .ok_or_else(|| AppError::internal("stored quiz is invalid"))?;
    if questions.is_empty() {
        return Ok((0, true));
    }
    if answers.len() != questions.len() || answers.iter().any(|answer| *answer < 0) {
        return Err(AppError::validation("answer every quiz question"));
    }
    let correct = questions
        .iter()
        .zip(answers)
        .filter(|(question, answer)| question["correctIndex"].as_i64() == Some(i64::from(**answer)))
        .count();
    let score = ((correct * 100) / questions.len()) as i32;
    Ok((score, score >= pass_score))
}

pub async fn coaching_insights(
    db: &PgPool,
    t: &str,
    b: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
) -> Result<Value, AppError> {
    let rows = staff_advanced_service::performance(db, t, b, from, to, staff_id)
        .await?
        .rows
        .into_iter()
        .filter(|row| row.burnout_risk.is_some() || row.retention_risk.is_some())
        .collect::<Vec<_>>();
    serde_json::to_value(rows)
        .map_err(|e| AppError::internal(format!("failed to serialize coaching insights: {e}")))
}

pub async fn list_coaching_goals(
    db: &PgPool,
    t: &str,
    b: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<CoachingGoalRecord>, AppError> {
    let status = optional_enum(status, &["active", "completed", "cancelled"], "goal status")?;
    repository::list_coaching_goals(db, t, b, staff_id.trim(), &status)
        .await
        .map_err(internal("load coaching goals"))
}

pub async fn create_coaching_goal(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    request: CoachingGoalRequest,
) -> Result<CoachingGoalRecord, AppError> {
    if request.target_value <= 0
        || request.current_value.is_some_and(|value| value < 0)
        || request
            .projected_impact_paise
            .is_some_and(|value| value < 0)
    {
        return Err(AppError::validation("coaching goal values are invalid"));
    }
    let goal_type = required_enum(
        &request.goal_type,
        &[
            "revenue",
            "appointments",
            "rebooking",
            "product_upsell",
            "package_membership",
            "client_retention",
            "service_mix",
            "average_bill",
            "attendance",
            "training",
            "utilization",
            "custom",
        ],
        "goal type",
    )?;
    let metric_unit = required_enum(
        &request.metric_unit,
        &["count", "percent", "minutes", "paise"],
        "metric unit",
    )?;
    let action_title = required(&request.action_title, 200, "action title")?;
    let action_description = clean(
        request.action_description.as_deref().unwrap_or(""),
        4000,
        "action description",
    )?;
    let priority = required_enum(
        request.priority.as_deref().unwrap_or("medium"),
        &["low", "medium", "high", "urgent"],
        "priority",
    )?;
    repository::create_coaching_goal(
        db,
        t,
        b,
        actor,
        &request.staff_id,
        &goal_type,
        &metric_unit,
        request.target_value,
        request.current_value,
        request.projected_impact_paise,
        request.due_date,
        &action_title,
        &action_description,
        &priority,
    )
    .await
    .map_err(internal("create coaching goal"))?
    .ok_or_else(|| AppError::validation("assigned employee is invalid"))
}

pub async fn complete_coaching_action(
    db: &PgPool,
    t: &str,
    b: &str,
    id: &str,
    version: i32,
) -> Result<CoachingActionRecord, AppError> {
    repository::complete_coaching_action(db, t, b, id, version)
        .await
        .map_err(internal("complete coaching action"))?
        .ok_or_else(stale)
}

fn is_due_training(
    task_type: &str,
    status: &str,
    due_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> bool {
    matches!(task_type, "training" | "performance")
        && !matches!(status, "completed" | "cancelled")
        && due_at.is_some_and(|due| due <= now)
}

fn render_template(
    template: &str,
    variables: &HashMap<String, String>,
) -> Result<String, AppError> {
    let mut rendered = template.to_string();
    for (key, value) in variables {
        if key.is_empty()
            || key.len() > 80
            || !key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_'))
            || value.chars().count() > 500
        {
            return Err(AppError::validation("template variable is invalid"));
        }
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }
    if rendered.contains("{{") || rendered.contains("}}") {
        return Err(AppError::validation(
            "notification template has unresolved variables",
        ));
    }
    Ok(rendered)
}

fn quiet_delay(now: NaiveTime, start: NaiveTime, end: NaiveTime) -> Duration {
    let in_quiet = if start < end {
        now >= start && now < end
    } else {
        now >= start || now < end
    };
    if !in_quiet {
        return Duration::zero();
    }
    let seconds = if now < end {
        end.signed_duration_since(now).num_seconds()
    } else {
        86_400 - now.num_seconds_from_midnight() as i64 + end.num_seconds_from_midnight() as i64
    };
    Duration::seconds(seconds.max(0))
}

fn roster_entry(source: &RosterSourceRecord) -> Option<RosterEntry> {
    let (status, shift1_start, shift1_end, shift2_start, shift2_end) = if source.approved_leave {
        ("leave".to_string(), None, None, None, None)
    } else if let Some(status) = source.existing_status.clone() {
        (
            status,
            source.shift1_start,
            source.shift1_end,
            source.shift2_start,
            source.shift2_end,
        )
    } else if source.appointments_count > 0 {
        (
            "working".to_string(),
            source.appointment_start,
            source.appointment_end,
            None,
            None,
        )
    } else {
        return None;
    };
    Some(RosterEntry {
        staff_id: source.staff_id.clone(),
        staff_name: source.staff_name.clone(),
        schedule_date: source.schedule_date,
        shift1_start,
        shift1_end,
        shift2_start,
        shift2_end,
        status,
        notes: source.existing_notes.clone().unwrap_or_default(),
    })
}

fn entry_minutes(row: &RosterEntry) -> i64 {
    [
        (row.shift1_start, row.shift1_end),
        (row.shift2_start, row.shift2_end),
    ]
    .into_iter()
    .filter_map(|(start, end)| Some(end?.signed_duration_since(start?).num_minutes().max(0)))
    .sum()
}

fn validate_period(
    from: NaiveDate,
    to: NaiveDate,
    max_days: i64,
    label: &str,
) -> Result<(), AppError> {
    if to < from || (to - from).num_days() >= max_days {
        Err(AppError::validation(format!(
            "{label} period must be {max_days} days or less"
        )))
    } else {
        Ok(())
    }
}

fn ceil_div(value: i64, divisor: i64) -> i64 {
    if value <= 0 || divisor <= 0 {
        0
    } else {
        1 + (value - 1) / divisor
    }
}

fn manpower_planning_row(row: ManpowerPlanningRecord) -> ManpowerPlanningRow {
    let required = ceil_div(row.demand_minutes, 60);
    let shortage = (required - row.scheduled_staff_count).max(0);
    let overstaffed = (row.scheduled_staff_count - required).max(0);
    let leave_impact =
        shortage - (required - row.scheduled_staff_count - row.leave_staff_count).max(0);
    let resource_shortage = (required - row.resource_count).max(0);
    let skills_shortage = (required - row.qualified_staff_count).max(0);
    let alert = if shortage > 0 || resource_shortage > 0 || skills_shortage > 0 {
        "shortage"
    } else if overstaffed > 0 {
        "overstaffed"
    } else {
        "balanced"
    };
    let mut actions = Vec::new();
    if shortage > 0 {
        actions.push(format!("Add {shortage} scheduled staff"));
    }
    if leave_impact > 0 {
        actions.push(format!("Approved leave creates {leave_impact} gap"));
    }
    if resource_shortage > 0 {
        actions.push(format!("Add {resource_shortage} workstation/resource"));
    }
    if skills_shortage > 0 {
        actions.push(format!("Assign or train {skills_shortage} qualified staff"));
    }
    if shortage == 0 && overstaffed > 0 {
        actions.push(format!(
            "Move {overstaffed} available staff to a shortage slot"
        ));
    }
    let hour = row.hour_start.hour();
    ManpowerPlanningRow {
        date: row.slot_date,
        hour_start: format!("{:02}:00", hour),
        hour_end: format!("{:02}:00", hour + 1),
        shift: if (6..14).contains(&hour) {
            "Morning"
        } else if (14..22).contains(&hour) {
            "Evening"
        } else {
            "Night"
        }
        .to_string(),
        department: row.department,
        appointment_count: row.appointment_count,
        demand_minutes: row.demand_minutes,
        required_staff_count: required,
        scheduled_staff_count: row.scheduled_staff_count,
        leave_staff_count: row.leave_staff_count,
        leave_impact_count: leave_impact,
        shortage_staff_count: shortage,
        overstaffed_count: overstaffed,
        resource_count: row.resource_count,
        resource_shortage_count: resource_shortage,
        qualified_staff_count: row.qualified_staff_count,
        skills_shortage_count: skills_shortage,
        alert: alert.to_string(),
        recommendation: if actions.is_empty() {
            "Coverage is balanced".to_string()
        } else {
            actions.join("; ")
        },
    }
}

fn forecast_confidence(source: &ManpowerSourceRecord) -> &'static str {
    if source.historical_appointment_days >= 14 && source.attendance_staff_days >= 14 {
        "high"
    } else if source.historical_appointment_days >= 7 && source.attendance_staff_days >= 7 {
        "medium"
    } else if source.future_booked_minutes > 0 || source.historical_appointment_minutes > 0 {
        "low"
    } else {
        "no_data"
    }
}

fn parse_service_ids(value: &str) -> Result<Vec<String>, AppError> {
    serde_json::from_str(value).map_err(|_| AppError::internal("appointment services are invalid"))
}

#[allow(clippy::too_many_arguments)]
async fn rank_candidates(
    db: &PgPool,
    t: &str,
    b: &str,
    absent_staff: &str,
    appointment: &str,
    date: NaiveDate,
    start: NaiveTime,
    end: NaiveTime,
    services: &[String],
    client_id: &str,
) -> Result<Vec<RankedStaffCandidate>, AppError> {
    let candidates = repository::replacement_candidates(
        db,
        t,
        b,
        absent_staff,
        appointment,
        date,
        start,
        end,
        services,
        client_id,
    )
    .await
    .map_err(internal("load replacement candidates"))?;
    let performance =
        staff_advanced_service::performance(db, t, b, date - Duration::days(30), date, "").await?;
    let performance = performance
        .rows
        .into_iter()
        .map(|row| (row.staff_id.clone(), row))
        .collect::<HashMap<_, _>>();
    let mut ranked = candidates
        .into_iter()
        .filter(|row| {
            row.schedule_match
                && row.leave_free
                && row.slot_free
                && row.service_match
                && row.blackout_free
        })
        .map(|row| {
            let metrics = performance.get(&row.staff_id);
            let performance_score = metrics.and_then(|value| value.score);
            let confidence = if performance_score.is_some() && !services.is_empty() {
                "high"
            } else if performance_score.is_some() || !services.is_empty() {
                "medium"
            } else {
                "low"
            };
            let mut evidence = vec![
                "scheduled_for_requested_slot".to_string(),
                "no_leave_or_booking_conflict".to_string(),
                "no_blackout".to_string(),
            ];
            if !services.is_empty() {
                evidence.push("all_requested_services_assigned".to_string());
            }
            if let Some(score) = performance_score {
                evidence.push(format!("performance_score_{score}"));
            }
            if row.department_match && !row.department.is_empty() {
                evidence.push("department_match".to_string());
            }
            if row.preferred_client {
                evidence.push("preferred_client_relationship".to_string());
            }
            let mut reasons = Vec::new();
            if row.preferred_client {
                reasons.push("Client preferred staff".to_string());
            }
            if row.department_match && !row.department.is_empty() {
                reasons.push(format!("{} department match", row.department));
            }
            if !services.is_empty() {
                reasons.push("Assigned to requested service".to_string());
            }
            reasons.push("Roster available; no leave, blackout or booking conflict".to_string());
            if let Some(value) = metrics.and_then(|item| item.rating) {
                reasons.push(format!("{value:.1} rating"));
            }
            if let Some(value) = metrics.and_then(|item| item.completion_percent) {
                reasons.push(format!("{value}% completion"));
            }
            reasons.push(format!(
                "{} appointment{} / {} min booked today",
                row.workload_count,
                if row.workload_count == 1 { "" } else { "s" },
                row.workload_minutes
            ));
            RankedStaffCandidate {
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                performance_score,
                workload_count: row.workload_count,
                workload_minutes: row.workload_minutes,
                department: row.department,
                department_match: row.department_match,
                preferred_client: row.preferred_client,
                utilization_percent: metrics.and_then(|item| item.utilization_percent),
                rating: metrics.and_then(|item| item.rating),
                completion_percent: metrics.and_then(|item| item.completion_percent),
                repeat_client_percent: metrics.and_then(|item| item.repeat_client_percent),
                confidence: confidence.to_string(),
                recommendation_reason: reasons.join(" · "),
                evidence,
            }
        })
        .collect::<Vec<_>>();
    sort_ranked_candidates(&mut ranked);
    Ok(ranked)
}

fn sort_ranked_candidates(ranked: &mut [RankedStaffCandidate]) {
    ranked.sort_by(|a, b| {
        b.preferred_client
            .cmp(&a.preferred_client)
            .then(b.department_match.cmp(&a.department_match))
            .then(b.performance_score.cmp(&a.performance_score))
            .then(
                b.rating
                    .unwrap_or(-1.0)
                    .total_cmp(&a.rating.unwrap_or(-1.0)),
            )
            .then(b.completion_percent.cmp(&a.completion_percent))
            .then(b.repeat_client_percent.cmp(&a.repeat_client_percent))
            .then(b.utilization_percent.cmp(&a.utilization_percent))
            .then(a.workload_minutes.cmp(&b.workload_minutes))
            .then(a.workload_count.cmp(&b.workload_count))
            .then(a.staff_name.cmp(&b.staff_name))
    });
}

fn early_departure_minutes(
    start: NaiveTime,
    end: NaiveTime,
    requested: NaiveTime,
) -> Result<i64, AppError> {
    if requested <= start || requested >= end {
        return Err(AppError::validation(
            "departure time must be inside the scheduled shift and before shift end",
        ));
    }
    Ok(i64::from(end.num_seconds_from_midnight() - requested.num_seconds_from_midnight()) / 60)
}

fn approval_steps(value: Value) -> Result<Value, AppError> {
    let steps = value
        .as_array()
        .ok_or_else(|| AppError::validation("approval steps must be an array"))?;
    if steps.is_empty() || steps.len() > 10 {
        return Err(AppError::validation(
            "approval steps must contain 1 to 10 entries",
        ));
    }
    for (i, s) in steps.iter().enumerate() {
        if s.get("order").and_then(Value::as_i64) != Some((i + 1) as i64)
            || s.get("role").and_then(Value::as_str).is_none()
        {
            return Err(AppError::validation(
                "approval steps must be sequential and include role",
            ));
        }
    }
    Ok(value)
}
fn validate_rule(v: &Value) -> Result<(), AppError> {
    let o = v
        .as_object()
        .ok_or_else(|| AppError::validation("statutory rule must be an object"))?;
    let recognized = [
        "employeeBasisPoints",
        "employerBasisPoints",
        "accrualBasisPoints",
        "employeeFixedPaise",
        "employerFixedPaise",
        "accrualFixedPaise",
    ];
    if !recognized.iter().any(|key| o.contains_key(*key)) {
        return Err(AppError::validation(
            "statutory rule requires a rate or fixed amount",
        ));
    }
    for k in [
        "employeeBasisPoints",
        "employerBasisPoints",
        "accrualBasisPoints",
    ] {
        if o.get(k)
            .and_then(Value::as_i64)
            .is_some_and(|n| !(0..=10000).contains(&n))
        {
            return Err(AppError::validation("statutory basis points are invalid"));
        }
    }
    for k in [
        "employeeFixedPaise",
        "employerFixedPaise",
        "accrualFixedPaise",
        "wageCapPaise",
        "eligibilityCapPaise",
    ] {
        if o.get(k).and_then(Value::as_i64).is_some_and(|n| n < 0) {
            return Err(AppError::validation("statutory amount or cap is invalid"));
        }
    }
    Ok(())
}
pub(crate) fn calculate_rule(gross: i64, v: &Value) -> Result<(i64, i64, i64), AppError> {
    calculate_rule_with_rounding(gross, v, "floor_paisa")
}
pub(crate) fn calculate_rule_with_rounding(
    gross: i64,
    v: &Value,
    rounding_method: &str,
) -> Result<(i64, i64, i64), AppError> {
    validate_rule(v)?;
    let rounding_method = required_enum(
        rounding_method,
        ROUNDING_METHODS,
        "statutory rounding method",
    )?;
    let cap = v
        .get("wageCapPaise")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0)
        .unwrap_or(gross);
    let eligible = v
        .get("eligibilityCapPaise")
        .and_then(Value::as_i64)
        .map_or(true, |n| gross <= n);
    if !eligible {
        return Ok((0, 0, 0));
    }
    let wage = gross.min(cap);
    let calc = |key: &str, fixed: &str| {
        v.get(fixed)
            .and_then(Value::as_i64)
            .unwrap_or_else(|| {
                rounded_basis_points(
                    wage,
                    v.get(key).and_then(Value::as_i64).unwrap_or(0),
                    &rounding_method,
                )
            })
            .max(0)
    };
    Ok((
        calc("employeeBasisPoints", "employeeFixedPaise"),
        calc("employerBasisPoints", "employerFixedPaise"),
        calc("accrualBasisPoints", "accrualFixedPaise"),
    ))
}
fn rounded_basis_points(amount: i64, basis_points: i64, method: &str) -> i64 {
    let numerator = i128::from(amount.max(0)) * i128::from(basis_points.max(0));
    let value = match method {
        "nearest_paisa" => (numerator + 5_000) / 10_000,
        "ceil_paisa" if numerator > 0 => (numerator + 9_999) / 10_000,
        "nearest_rupee" => ((numerator + 500_000) / 1_000_000) * 100,
        _ => numerator / 10_000,
    };
    value.min(i128::from(i64::MAX)) as i64
}
fn required(v: &str, max: usize, label: &str) -> Result<String, AppError> {
    let v = clean(v, max, label)?;
    if v.is_empty() {
        Err(AppError::validation(format!("{label} is required")))
    } else {
        Ok(v)
    }
}
fn clean(v: &str, max: usize, label: &str) -> Result<String, AppError> {
    let v = v.trim().to_string();
    if v.chars().count() > max {
        Err(AppError::validation(format!("{label} is too long")))
    } else {
        Ok(v)
    }
}
fn required_enum(v: &str, allowed: &[&str], label: &str) -> Result<String, AppError> {
    let v = v.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    if allowed.contains(&v.as_str()) {
        Ok(v)
    } else {
        Err(AppError::validation(format!("{label} is invalid")))
    }
}
fn optional_enum(v: &str, a: &[&str], l: &str) -> Result<String, AppError> {
    if v.trim().is_empty() {
        Ok(String::new())
    } else {
        required_enum(v, a, l)
    }
}
fn stale() -> AppError {
    AppError::conflict("record was updated by another request; refresh and try again")
}
fn internal(a: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |e| AppError::internal(format!("failed to {a}: {e}"))
}
fn db_write(duplicate: &'static str, a: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |e| {
        if e.as_database_error()
            .and_then(|d| d.code())
            .is_some_and(|c| c == "23505")
        {
            AppError::conflict(duplicate)
        } else {
            AppError::internal(format!("failed to {a}: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_equipment_intelligence, ceil_div, early_departure_minutes, forecast_confidence,
        is_due_training, manpower_planning_row, quiet_delay, quiz_result, render_template,
        retail_conversion_percent, sort_ranked_candidates, EquipmentDepartmentRecord,
        ManpowerPlanningRecord, ManpowerSourceRecord, RankedStaffCandidate,
    };
    use super::{calculate_rule, calculate_rule_with_rounding};
    use chrono::{NaiveDate, NaiveTime};
    use serde_json::json;
    use std::collections::HashMap;
    #[test]
    fn statutory_money_uses_basis_points_and_caps() {
        assert_eq!(calculate_rule(2_000_000,&json!({"wageCapPaise":1_500_000,"employeeBasisPoints":1200,"employerBasisPoints":1200})).unwrap(),(180_000,180_000,0));
        assert_eq!(
            calculate_rule_with_rounding(101, &json!({"employeeBasisPoints":100}), "floor_paisa")
                .unwrap()
                .0,
            1
        );
        assert_eq!(
            calculate_rule_with_rounding(101, &json!({"employeeBasisPoints":100}), "ceil_paisa")
                .unwrap()
                .0,
            2
        );
        assert_eq!(
            calculate_rule_with_rounding(
                15_050,
                &json!({"employeeBasisPoints":10_000}),
                "nearest_rupee"
            )
            .unwrap()
            .0,
            15_100
        );
    }

    #[test]
    fn workforce_forecast_uses_only_available_evidence() {
        assert_eq!(ceil_div(601, 300), 3);
        assert_eq!(
            forecast_confidence(&ManpowerSourceRecord {
                active_staff: 2,
                historical_appointment_minutes: 0,
                historical_appointment_days: 0,
                future_booked_minutes: 0,
                worked_minutes: 0,
                attendance_staff_days: 0,
            }),
            "no_data"
        );
    }

    #[test]
    fn hourly_manpower_plan_reports_leave_resource_and_skill_gaps() {
        let row = manpower_planning_row(ManpowerPlanningRecord {
            slot_date: NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
            hour_start: NaiveTime::from_hms_opt(11, 0, 0).unwrap(),
            department: "Hair".to_string(),
            appointment_count: 2,
            demand_minutes: 120,
            scheduled_staff_count: 1,
            leave_staff_count: 1,
            resource_count: 1,
            qualified_staff_count: 1,
        });
        assert_eq!((row.required_staff_count, row.shortage_staff_count), (2, 1));
        assert_eq!(
            (
                row.leave_impact_count,
                row.resource_shortage_count,
                row.skills_shortage_count
            ),
            (1, 1, 1)
        );
        assert_eq!(row.alert, "shortage");
    }

    #[test]
    fn staff_notifications_render_known_values_and_defer_quiet_hours() {
        let variables = HashMap::from([
            ("staff.firstName".to_string(), "Aftab".to_string()),
            ("shift".to_string(), "10:00".to_string()),
        ]);
        assert_eq!(
            render_template("Hi {{staff.firstName}}, shift {{shift}}", &variables).unwrap(),
            "Hi Aftab, shift 10:00"
        );
        assert!(render_template("Hi {{missing}}", &variables).is_err());
        assert_eq!(
            quiet_delay(
                NaiveTime::from_hms_opt(23, 0, 0).unwrap(),
                NaiveTime::from_hms_opt(22, 0, 0).unwrap(),
                NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            )
            .num_hours(),
            8
        );
    }

    #[test]
    fn command_center_only_flags_real_due_training_work() {
        let now = chrono::Utc::now();
        assert!(is_due_training(
            "training",
            "open",
            Some(now - chrono::Duration::minutes(1)),
            now
        ));
        assert!(!is_due_training(
            "training",
            "completed",
            Some(now - chrono::Duration::minutes(1)),
            now
        ));
        assert!(!is_due_training("general", "open", Some(now), now));
    }

    #[test]
    fn retail_conversion_uses_product_invoices_and_handles_empty_periods() {
        assert_eq!(retail_conversion_percent(2, 8), 25);
        assert_eq!(retail_conversion_percent(0, 0), 0);
        assert_eq!(retail_conversion_percent(12, 10), 100);
    }

    #[test]
    fn equipment_recommendations_require_real_loss_evidence() {
        let department = |lost| EquipmentDepartmentRecord {
            department: "Hair".to_string(),
            appointment_count: 8,
            unassigned_appointments: 3,
            booked_minutes: 480,
            average_value_paise: 1_500_00,
            peak_hourly_demand: 3,
            demand_slots: 8,
            active_resources: 1,
            inactive_resources: 0,
            resource_kinds: vec!["chair".to_string()],
            constraint_resource_kinds: Vec::new(),
            equipment_lost_bookings: lost,
        };
        assert_eq!(
            build_equipment_intelligence(&[department(0)], &[], &[])["recommendations"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        let intelligence = build_equipment_intelligence(&[department(2)], &[], &[]);
        assert_eq!(intelligence["recommendations"][0]["actionType"], "purchase");
        assert_eq!(
            intelligence["recommendations"][0]["estimatedRevenuePaise"],
            300_000
        );
    }

    #[test]
    fn rule_quiz_blocks_acknowledgement_until_passed() {
        let quiz = json!([
            {"correctIndex":1},
            {"correctIndex":0}
        ]);
        assert_eq!(quiz_result(&quiz, &[1, 1], 80).unwrap(), (50, false));
        assert_eq!(quiz_result(&quiz, &[1, 0], 80).unwrap(), (100, true));
        assert!(quiz_result(&quiz, &[1], 80).is_err());
    }

    #[test]
    fn early_departure_must_be_inside_shift() {
        let start = NaiveTime::from_hms_opt(11, 0, 0).unwrap();
        let end = NaiveTime::from_hms_opt(20, 0, 0).unwrap();
        assert_eq!(
            early_departure_minutes(start, end, NaiveTime::from_hms_opt(18, 0, 0).unwrap())
                .unwrap(),
            120
        );
        assert!(early_departure_minutes(start, end, end).is_err());
    }

    #[test]
    fn best_staff_prefers_client_relationship_then_department_and_performance() {
        let candidate = |id: &str, preferred_client: bool, department_match: bool, score: i32| {
            RankedStaffCandidate {
                staff_id: id.to_string(),
                staff_name: id.to_string(),
                performance_score: Some(score),
                workload_count: 0,
                workload_minutes: 0,
                department: "Hair".to_string(),
                department_match,
                preferred_client,
                utilization_percent: Some(80),
                rating: Some(4.5),
                completion_percent: Some(90),
                repeat_client_percent: Some(60),
                confidence: "high".to_string(),
                recommendation_reason: String::new(),
                evidence: Vec::new(),
            }
        };
        let mut ranked = vec![
            candidate("highest-score", false, true, 99),
            candidate("preferred", true, false, 60),
            candidate("department", false, true, 80),
        ];
        sort_ranked_candidates(&mut ranked);
        assert_eq!(
            ranked
                .iter()
                .map(|row| row.staff_id.as_str())
                .collect::<Vec<_>>(),
            ["preferred", "highest-score", "department"]
        );
    }
}
