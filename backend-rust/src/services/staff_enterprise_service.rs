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
pub struct TipPayoutRequest {
    pub staff_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub payout_reference: String,
    pub sale_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryRuleRequest {
    pub rule_type: String,
    pub state_code: Option<String>,
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
    pub evidence: Value,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStaffCandidate {
    pub staff_id: String,
    pub staff_name: String,
    pub performance_score: Option<i32>,
    pub workload_count: i64,
    pub confidence: String,
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
pub struct CoachingGoalRequest {
    pub staff_id: String,
    pub goal_type: String,
    pub metric_unit: String,
    pub target_value: i64,
    pub current_value: Option<i64>,
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
    repository::record_tip_payout(
        db,
        t,
        b,
        &required(&r.staff_id, 120, "employee")?,
        r.period_start,
        r.period_end,
        &required(&r.payout_reference, 160, "payout reference")?,
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
        &clean(r.state_code.as_deref().unwrap_or(""), 20, "state code")?,
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

pub async fn calculate_statutory(
    db: &PgPool,
    t: &str,
    b: &str,
    actor: &str,
    r: StatutoryCalculationRequest,
) -> Result<StatutoryCalculationRecord, AppError> {
    let (item, from, to, gross, run_status) =
        repository::payroll_item(db, t, b, &r.payroll_run_id, &r.staff_id)
            .await
            .map_err(internal("load payroll item"))?
            .ok_or_else(|| AppError::not_found("payroll item not found"))?;
    if matches!(run_status.as_str(), "finalized" | "paid") {
        return Err(AppError::conflict(
            "finalized payroll statutory snapshot cannot be recalculated",
        ));
    }
    let rules = repository::effective_rules(db, t, b, to)
        .await
        .map_err(internal("load effective statutory rules"))?;
    if rules.is_empty() {
        return Err(AppError::validation("active statutory rules are required"));
    }
    let mut employee = 0;
    let mut employer = 0;
    let mut accrual = 0;
    let mut breakdown = serde_json::Map::new();
    for rule in rules {
        let result = calculate_rule(gross, &rule.rule_json)?;
        employee += result.0;
        employer += result.1;
        accrual += result.2;
        breakdown.insert(rule.rule_type,json!({"ruleId":rule.id,"employeePaise":result.0,"employerPaise":result.1,"accrualPaise":result.2}));
    }
    repository::save_statutory_calculation(
        db,
        t,
        b,
        &r.payroll_run_id,
        &item,
        &r.staff_id,
        from,
        to,
        gross,
        employee,
        employer,
        accrual,
        &Value::Object(breakdown),
        actor,
    )
    .await
    .map_err(internal("save statutory calculation"))
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
    let evidence = json!({
        "activeStaff": source.active_staff,
        "historicalAppointmentMinutes": source.historical_appointment_minutes,
        "historicalAppointmentDays": source.historical_appointment_days,
        "attendanceStaffDays": source.attendance_staff_days,
        "averageWorkedMinutesPerStaffDay": capacity_per_staff_day,
        "futureBookedMinutes": source.future_booked_minutes
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
        "",
        request.date,
        request.start_time,
        request.end_time,
        &request.service_ids.unwrap_or_default(),
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
        || matches!(notification_type.as_str(), "payroll" | "compliance");
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
        || matches!(
            template.notification_type.as_str(),
            "payroll" | "compliance"
        );
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
    let (performance, approvals, tasks, sales) = tokio::try_join!(
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
    )?;
    let pending_approvals = approvals
        .iter()
        .filter(|row| row.status == "pending")
        .count();
    let training_due = tasks
        .iter()
        .filter(|row| is_due_training(&row.task_type, &row.status, row.due_at, Utc::now()))
        .count();
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
    })
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
    if request.target_value <= 0 || request.current_value.is_some_and(|value| value < 0) {
        return Err(AppError::validation("coaching goal values are invalid"));
    }
    let goal_type = required_enum(
        &request.goal_type,
        &[
            "revenue",
            "appointments",
            "rebooking",
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
    )
    .await
    .map_err(internal("load replacement candidates"))?;
    let performance =
        staff_advanced_service::performance(db, t, b, date - Duration::days(30), date, "").await?;
    let scores = performance
        .rows
        .into_iter()
        .map(|row| (row.staff_id, row.score))
        .collect::<HashMap<_, _>>();
    let mut ranked = candidates
        .into_iter()
        .filter(|row| row.schedule_match && row.leave_free && row.slot_free && row.service_match)
        .map(|row| {
            let performance_score = scores.get(&row.staff_id).copied().flatten();
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
            ];
            if !services.is_empty() {
                evidence.push("all_requested_services_assigned".to_string());
            }
            if let Some(score) = performance_score {
                evidence.push(format!("performance_score_{score}"));
            }
            RankedStaffCandidate {
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                performance_score,
                workload_count: row.workload_count,
                confidence: confidence.to_string(),
                evidence,
            }
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        b.performance_score
            .cmp(&a.performance_score)
            .then(a.workload_count.cmp(&b.workload_count))
            .then(a.staff_name.cmp(&b.staff_name))
    });
    Ok(ranked)
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
    validate_rule(v)?;
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
                wage.saturating_mul(v.get(key).and_then(Value::as_i64).unwrap_or(0)) / 10000
            })
            .max(0)
    };
    Ok((
        calc("employeeBasisPoints", "employeeFixedPaise"),
        calc("employerBasisPoints", "employerFixedPaise"),
        calc("accrualBasisPoints", "accrualFixedPaise"),
    ))
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
    use super::calculate_rule;
    use super::{
        ceil_div, forecast_confidence, is_due_training, quiet_delay, render_template,
        ManpowerSourceRecord,
    };
    use chrono::NaiveTime;
    use serde_json::json;
    use std::collections::HashMap;
    #[test]
    fn statutory_money_uses_basis_points_and_caps() {
        assert_eq!(calculate_rule(2_000_000,&json!({"wageCapPaise":1_500_000,"employeeBasisPoints":1200,"employerBasisPoints":1200})).unwrap(),(180_000,180_000,0));
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
}
