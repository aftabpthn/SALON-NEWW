use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicyRecord {
    pub id: String,
    pub policy_key: String,
    pub policy_name: String,
    pub request_type: String,
    pub amount_threshold_paise: i64,
    pub steps: Value,
    pub escalation_hours: i32,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequestRecord {
    pub id: String,
    pub policy_id: Option<String>,
    pub request_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub amount_paise: i64,
    pub status: String,
    pub current_step: i32,
    pub steps: Value,
    pub payload_json: Value,
    pub requested_by: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct EarlyDepartureSchedule {
    pub staff_id: String,
    pub staff_name: String,
    pub shift_start: NaiveTime,
    pub shift_end: NaiveTime,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalActionRecord {
    pub id: String,
    pub approval_request_id: String,
    pub step_order: Option<i32>,
    pub action: String,
    pub actor_user_id: String,
    pub actor_role: String,
    pub comments: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryRuleRecord {
    pub id: String,
    pub rule_type: String,
    pub state_code: String,
    pub jurisdiction_code: String,
    pub rounding_method: String,
    pub official_reference: String,
    pub rule_json: Value,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub active: bool,
    pub approval_status: String,
    pub created_by: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub review_note: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryCalculationRecord {
    pub id: String,
    pub payroll_run_id: String,
    pub payroll_item_id: String,
    pub staff_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub gross_paise: i64,
    pub employee_deduction_paise: i64,
    pub employer_contribution_paise: i64,
    pub accrual_paise: i64,
    pub breakdown_json: Value,
    pub calculated_by: String,
    pub calculated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SalaryRevisionRecord {
    pub id: String,
    pub staff_id: String,
    pub rate_type: String,
    pub old_amount_paise: Option<i64>,
    pub new_amount_paise: i64,
    pub effective_date: NaiveDate,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_note: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffTipRecord {
    pub sale_id: String,
    pub invoice_number: String,
    pub staff_id: String,
    pub staff_name: String,
    pub business_date: NaiveDate,
    pub amount_paise: i64,
    pub payout_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffTipSummary {
    pub staff_id: String,
    pub staff_name: String,
    pub tip_count: i64,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub unpaid_paise: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub id: String,
    pub user_id: Option<String>,
    pub event_type: String,
    pub outcome: String,
    pub details_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SelfDashboardRecord {
    pub staff: Value,
    pub schedule: Option<Value>,
    pub attendance: Option<Value>,
    pub tasks: Value,
    pub appointments: Value,
    pub sales: Value,
    pub leave_requests: Value,
    pub payroll_profile: Value,
    pub payroll: Value,
    pub payroll_rules: Value,
    pub holidays: Value,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RosterSourceRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub existing_status: Option<String>,
    pub existing_notes: Option<String>,
    pub approved_leave: bool,
    pub appointments_count: i64,
    pub appointment_minutes: i64,
    pub appointment_start: Option<NaiveTime>,
    pub appointment_end: Option<NaiveTime>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RosterDraftRecord {
    pub id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub entries_json: Value,
    pub metrics_json: Value,
    pub status: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RosterCoverageRecord {
    pub active_staff: i64,
    pub scheduled_staff_days: i64,
    pub scheduled_minutes: i64,
    pub appointment_minutes: i64,
    pub uncovered_appointments: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ManpowerSourceRecord {
    pub active_staff: i64,
    pub historical_appointment_minutes: i64,
    pub historical_appointment_days: i64,
    pub future_booked_minutes: i64,
    pub worked_minutes: i64,
    pub attendance_staff_days: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ManpowerForecastRecord {
    pub id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub history_start: NaiveDate,
    pub history_end: NaiveDate,
    pub projected_demand_minutes: i64,
    pub available_capacity_minutes: Option<i64>,
    pub required_staff_count: Option<i32>,
    pub shortage_staff_count: Option<i32>,
    pub confidence: String,
    pub evidence_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ReplacementContextRecord {
    pub appointment_id: String,
    pub absent_staff_id: String,
    pub client_id: String,
    pub business_date: NaiveDate,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub service_ids_json: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementCandidateRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_match: bool,
    pub leave_free: bool,
    pub slot_free: bool,
    pub service_match: bool,
    pub department: String,
    pub department_match: bool,
    pub preferred_client: bool,
    pub blackout_free: bool,
    pub workload_count: i64,
    pub workload_minutes: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementRecommendationRecord {
    pub id: String,
    pub absent_staff_id: Option<String>,
    pub appointment_id: Option<String>,
    pub recommended_staff_id: String,
    pub ranked_options_json: Value,
    pub confidence: String,
    pub status: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_reason: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct RosterScheduleInput {
    pub staff_id: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub status: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffSalesSummaryRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub invoice_count: i64,
    pub client_count: i64,
    pub line_count: i64,
    pub service_revenue_paise: i64,
    pub product_revenue_paise: i64,
    pub membership_revenue_paise: i64,
    pub package_revenue_paise: i64,
    pub other_revenue_paise: i64,
    pub total_revenue_paise: i64,
    pub discount_paise: i64,
    pub commission_paise: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffSalesLineRecord {
    pub sale_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub staff_id: String,
    pub staff_name: String,
    pub client_id: String,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub split_bps: i32,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub commission_paise: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffNotificationPreferenceRecord {
    pub id: String,
    pub staff_id: String,
    pub whatsapp_opt_in: bool,
    pub allow_payroll_amounts: bool,
    pub language_code: String,
    pub quiet_hours_start: Option<NaiveTime>,
    pub quiet_hours_end: Option<NaiveTime>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffNotificationTemplateRecord {
    pub id: String,
    pub notification_type: String,
    pub language_code: String,
    pub title: String,
    pub body_template: String,
    pub sensitive: bool,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffNotificationQueueRecord {
    pub id: String,
    pub staff_id: String,
    pub template_id: Option<String>,
    pub channel: String,
    pub notification_type: String,
    pub recipient: String,
    pub title: String,
    pub message_body: String,
    pub sensitive: bool,
    pub requires_approval: bool,
    pub status: String,
    pub scheduled_at: DateTime<Utc>,
    pub requested_by: String,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub provider: String,
    pub provider_message_id: String,
    pub last_error: String,
    pub delivery_attempts: i32,
    pub max_delivery_attempts: i32,
    pub next_attempt_at: DateTime<Utc>,
    pub metadata_json: Value,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffNotificationDeliveryLogRecord {
    pub id: String,
    pub queue_id: String,
    pub provider: String,
    pub provider_message_id: String,
    pub delivery_status: String,
    pub error_message: String,
    pub payload_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffNotificationContext {
    pub staff_id: String,
    pub first_name: String,
    pub display_name: String,
    pub mobile_phone: String,
    pub whatsapp_opt_in: Option<bool>,
    pub allow_payroll_amounts: Option<bool>,
    pub language_code: String,
    pub quiet_hours_start: Option<NaiveTime>,
    pub quiet_hours_end: Option<NaiveTime>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffSkillMatrixRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub job_title: String,
    pub roles: Value,
    pub services: Value,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffFloorControlRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub schedule_id: Option<String>,
    pub schedule_status: Option<String>,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub attendance_status: Option<String>,
    pub clock_in_at: Option<DateTime<Utc>>,
    pub clock_out_at: Option<DateTime<Utc>>,
    pub late_minutes: i32,
    pub overtime_minutes: i32,
    pub appointment_count: i64,
    pub appointment_minutes: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CoachingGoalRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub goal_type: String,
    pub metric_unit: String,
    pub target_value: i64,
    pub current_value: Option<i64>,
    pub due_date: NaiveDate,
    pub status: String,
    pub created_by: String,
    pub actions: Value,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CoachingActionRecord {
    pub id: String,
    pub coaching_goal_id: String,
    pub staff_id: Option<String>,
    pub title: String,
    pub status: String,
    pub version: i32,
    pub completed_at: Option<DateTime<Utc>>,
}

pub async fn list_approval_policies(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ApprovalPolicyRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,policy_key,policy_name,request_type,amount_threshold_paise,steps,escalation_hours,active,version,created_at,updated_at FROM staff_approval_policies WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,policy_name")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_approval_policy(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    key: &str,
    name: &str,
    request_type: &str,
    threshold: i64,
    steps: &Value,
    escalation_hours: i32,
) -> Result<ApprovalPolicyRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_approval_policies(tenant_id,branch_id,policy_key,policy_name,request_type,amount_threshold_paise,steps,escalation_hours,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,policy_key,policy_name,request_type,amount_threshold_paise,steps,escalation_hours,active,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(key).bind(name).bind(request_type).bind(threshold).bind(steps).bind(escalation_hours).bind(actor).fetch_one(db).await
}

pub async fn matching_policy(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    request_type: &str,
    amount: i64,
) -> Result<Option<ApprovalPolicyRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,policy_key,policy_name,request_type,amount_threshold_paise,steps,escalation_hours,active,version,created_at,updated_at FROM staff_approval_policies WHERE tenant_id=$1 AND branch_id=$2 AND request_type=$3 AND active=TRUE AND amount_threshold_paise<=$4 ORDER BY amount_threshold_paise DESC LIMIT 1")
        .bind(tenant).bind(branch).bind(request_type).bind(amount).fetch_optional(db).await
}

pub async fn list_approval_requests(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: &str,
) -> Result<Vec<ApprovalRequestRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,policy_id,request_type,entity_type,entity_id,amount_paise,status,current_step,steps,payload_json,requested_by,expires_at,version,created_at,updated_at FROM staff_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR status=$3) ORDER BY created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(status).fetch_all(db).await
}

pub async fn list_self_early_departure_requests(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
) -> Result<Vec<ApprovalRequestRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,policy_id,request_type,entity_type,entity_id,amount_paise,status,current_step,steps,payload_json,requested_by,expires_at,version,created_at,updated_at FROM staff_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND requested_by=$3 AND request_type='early_departure' ORDER BY created_at DESC LIMIT 50")
        .bind(tenant).bind(branch).bind(actor).fetch_all(db).await
}

pub async fn early_departure_schedule(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    business_date: NaiveDate,
) -> Result<Option<EarlyDepartureSchedule>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT s.id staff_id,
                  COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))) staff_name,
                  COALESCE(sc.shift1_start,sc.shift2_start) shift_start,
                  COALESCE(sc.shift2_end,sc.shift1_end) shift_end
             FROM staff s
             JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id AND u.active=TRUE
             JOIN staff_schedules sc ON sc.tenant_id=s.tenant_id AND sc.branch_id=s.branch_id AND sc.staff_id=s.id AND sc.schedule_date=$4 AND sc.status='working'
            WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.user_id=$3 AND s.active=TRUE"#,
    )
    .bind(tenant).bind(branch).bind(actor).bind(business_date).fetch_optional(db).await
}

pub async fn has_open_early_departure_request(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    business_date: NaiveDate,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND requested_by=$3 AND request_type='early_departure' AND status IN ('pending','escalated','approved') AND payload_json->>'businessDate'=$4)")
        .bind(tenant).bind(branch).bind(actor).bind(business_date.to_string()).fetch_one(db).await
}

pub async fn create_approval_request(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    policy_id: Option<&str>,
    request_type: &str,
    entity_type: &str,
    entity_id: &str,
    amount: i64,
    steps: &Value,
    payload: &Value,
    expires_at: Option<DateTime<Utc>>,
    role: &str,
) -> Result<ApprovalRequestRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: ApprovalRequestRecord=sqlx::query_as("INSERT INTO staff_approval_requests(tenant_id,branch_id,policy_id,request_type,entity_type,entity_id,amount_paise,steps,payload_json,requested_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,policy_id,request_type,entity_type,entity_id,amount_paise,status,current_step,steps,payload_json,requested_by,expires_at,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(policy_id).bind(request_type).bind(entity_type).bind(entity_id).bind(amount).bind(steps).bind(payload).bind(actor).bind(expires_at).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_approval_actions(tenant_id,branch_id,approval_request_id,step_order,action,actor_user_id,actor_role) VALUES($1,$2,$3,1,'requested',$4,$5)")
        .bind(tenant).bind(branch).bind(&row.id).bind(actor).bind(role).execute(&mut *tx).await?;
    let permission = if request_type == "early_departure" {
        "staff.attendance.manage"
    } else {
        "staff.governance.manage"
    };
    let alternate_permission = if request_type == "early_departure" {
        "staff.app.attendance.manage"
    } else {
        "staff.manage"
    };
    let request_label = request_type.replace('_', " ");
    let staff_name = payload
        .get("staffName")
        .and_then(Value::as_str)
        .unwrap_or("A staff member");
    let title = format!("{} request", request_label);
    let body = format!("{staff_name} submitted a {request_label} request for approval.");
    let metadata = json!({"deepLink":"/staff/control-center?tab=governance","status":"pending","requestType":request_type});
    sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
           SELECT $1,$2,u.id,$3,'staff_approval',$5,$6,'staff_approval_request',$7,$8
             FROM users u
             LEFT JOIN user_branch_roles ubr ON ubr.tenant_id=u.tenant_id AND ubr.user_id=u.id AND ubr.branch_id=$2 AND ubr.active=TRUE
             LEFT JOIN roles r ON r.tenant_id=u.tenant_id AND r.id=COALESCE(ubr.role_id,u.role_id)
            WHERE u.tenant_id=$1 AND u.active=TRUE AND u.id<>$3
              AND COALESCE(ubr.branch_id,u.branch_id)=$2
              AND (REGEXP_REPLACE(LOWER(COALESCE(ubr.role_name,u.role_name)), '[-_ ]', '', 'g') IN ('owner','admin','manager','regionalhead')
                   OR ((COALESCE(r.permissions_json,'[]'::jsonb) ? $4 OR COALESCE(r.permissions_json,'[]'::jsonb) ? $9)
                       AND NOT (COALESCE(r.denied_permissions_json,'[]'::jsonb) ? $4)
                       AND NOT (COALESCE(r.denied_permissions_json,'[]'::jsonb) ? $9)))"#,
    )
    .bind(tenant).bind(branch).bind(actor).bind(permission).bind(title).bind(body).bind(&row.id).bind(metadata).bind(alternate_permission)
    .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn get_approval_request(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<ApprovalRequestRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,policy_id,request_type,entity_type,entity_id,amount_paise,status,current_step,steps,payload_json,requested_by,expires_at,version,created_at,updated_at FROM staff_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn decide_approval(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
    role: &str,
    decision: &str,
    comments: &str,
    next_step: Option<i32>,
) -> Result<Option<ApprovalRequestRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let status = if decision == "approved" && next_step.is_some() {
        "pending"
    } else {
        decision
    };
    let row: Option<ApprovalRequestRecord>=sqlx::query_as("UPDATE staff_approval_requests SET status=$5,current_step=COALESCE($6,current_step),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status IN ('pending','escalated') RETURNING id,policy_id,request_type,entity_type,entity_id,amount_paise,status,current_step,steps,payload_json,requested_by,expires_at,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(status).bind(next_step).fetch_optional(&mut *tx).await?;
    if row.is_some() {
        sqlx::query("INSERT INTO staff_approval_actions(tenant_id,branch_id,approval_request_id,step_order,action,actor_user_id,actor_role,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant).bind(branch).bind(id).bind(next_step.map(|step|step-1).or_else(||row.as_ref().map(|r|r.current_step))).bind(decision).bind(actor).bind(role).bind(comments).execute(&mut *tx).await?;
        if let Some(request) = row.as_ref().filter(|request| request.status != "pending") {
            sqlx::query("UPDATE notifications SET is_read=TRUE,metadata_json=jsonb_set(metadata_json,'{status}',to_jsonb($4::TEXT),TRUE),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND resource_type='staff_approval_request' AND resource_id=$3")
                .bind(tenant).bind(branch).bind(id).bind(&request.status).execute(&mut *tx).await?;
            let label = request.request_type.replace('_', " ");
            let title = format!("{label} {}", request.status);
            let body = format!("Your {label} request was {}.", request.status);
            let deep_link = if request.request_type == "early_departure" {
                "/staff/attendance"
            } else {
                "/staff/dashboard"
            };
            sqlx::query("INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json) VALUES($1,$2,$3,$4,'staff_approval_decision',$5,$6,'staff_approval_request',$7,$8)")
                .bind(tenant).bind(branch).bind(&request.requested_by).bind(actor).bind(title).bind(body).bind(id)
                .bind(json!({"deepLink":deep_link,"status":request.status,"requestType":request.request_type})).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn approval_actions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Vec<ApprovalActionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,approval_request_id,step_order,action,actor_user_id,actor_role,comments,created_at FROM staff_approval_actions WHERE tenant_id=$1 AND branch_id=$2 AND approval_request_id=$3 ORDER BY created_at")
        .bind(tenant).bind(branch).bind(id).fetch_all(db).await
}

pub async fn list_audit(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    event_prefix: &str,
) -> Result<Vec<AuditRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,user_id,event_type,outcome,details_json,created_at FROM auth_audit_logs WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR event_type LIKE $3 || '%') ORDER BY created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(event_prefix).fetch_all(db).await
}

pub async fn self_dashboard(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
    date: NaiveDate,
) -> Result<Option<SelfDashboardRecord>, sqlx::Error> {
    sqlx::query_as(r#"SELECT
      jsonb_build_object(
        'id',s.id,'employeeCode',s.employee_code,
        'fullName',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))),
        'displayName',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))),
        'firstName',s.first_name,'lastName',s.last_name,
        'mobile',s.mobile_phone,'email',s.email,'jobTitle',s.job_title,
        'department',COALESCE(profile.department,''),
        'designation',COALESCE(NULLIF(profile.designation,''),s.job_title),
        'status',CASE WHEN s.active THEN 'active' ELSE 'inactive' END
      ) staff,
      (SELECT to_jsonb(sc)-'tenant_id'-'branch_id'-'staff_id' FROM staff_schedules sc WHERE sc.tenant_id=s.tenant_id AND sc.branch_id=s.branch_id AND sc.staff_id=s.id AND sc.schedule_date=$4) schedule,
      (SELECT to_jsonb(a)-'tenant_id'-'branch_id'-'staff_id' FROM staff_attendance_records a WHERE a.tenant_id=s.tenant_id AND a.branch_id=s.branch_id AND a.staff_id=s.id AND a.business_date=$4) attendance,
      COALESCE((SELECT jsonb_agg(to_jsonb(t)-'tenant_id'-'branch_id' ORDER BY t.due_at NULLS LAST,t.updated_at DESC,t.created_at DESC) FROM staff_tasks t WHERE t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id AND t.staff_id=s.id AND (t.status IN ('open','in_progress','blocked') OR (t.status='completed' AND COALESCE(t.completed_at,t.updated_at,t.created_at)::DATE=$4))),'[]'::jsonb) tasks,
      COALESCE((SELECT jsonb_agg(to_jsonb(ap)-'tenant_id'-'branch_id') FROM appointments ap WHERE ap.tenant_id=s.tenant_id AND ap.branch_id=s.branch_id AND ap.staff_id=s.id AND ap.start_at::DATE=$4),'[]'::jsonb) appointments,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',sale.id,'totalPaise',COALESCE(attribution.base_paise,sale.total_paise),
        'commissionPaise',COALESCE(attribution.commission_paise,0),
        'status',sale.status,'createdAt',sale.created_at
      ) ORDER BY sale.created_at DESC)
        FROM pos_sales sale
        LEFT JOIN LATERAL (
          SELECT sale_id,SUM(base_paise)::BIGINT base_paise,SUM(commission_paise)::BIGINT commission_paise
          FROM pos_staff_commission_snapshots
          WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=s.id AND business_date=$4
          GROUP BY sale_id
        ) attribution ON attribution.sale_id=sale.id
        WHERE sale.tenant_id=s.tenant_id AND sale.branch_id=s.branch_id
          AND COALESCE(sale.business_date,sale.created_at::DATE)=$4
          AND LOWER(sale.status) NOT IN ('draft','cancelled','canceled','voided')
          AND (sale.staff_id=s.id OR attribution.sale_id IS NOT NULL)
      ),'[]'::jsonb) sales,
      COALESCE((SELECT jsonb_agg(to_jsonb(l)-'tenant_id'-'branch_id' ORDER BY l.created_at DESC) FROM (SELECT * FROM staff_leave_requests lr WHERE lr.tenant_id=s.tenant_id AND lr.branch_id=s.branch_id AND lr.staff_id=s.id ORDER BY lr.created_at DESC LIMIT 20) l),'[]'::jsonb) leave_requests,
      COALESCE((SELECT jsonb_build_object('rateType',pr.rate_type,'amountPaise',pr.amount_paise,'effectiveFrom',pr.effective_from) FROM staff_pay_rates pr WHERE pr.tenant_id=s.tenant_id AND pr.branch_id=s.branch_id AND pr.staff_id=s.id AND pr.active=TRUE AND pr.effective_from<=$4 ORDER BY pr.effective_from DESC,pr.created_at DESC LIMIT 1),'{}'::jsonb) payroll_profile,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'runId',r.id,'periodStart',r.period_start,'periodEnd',r.period_end,'status',r.status,
        'presentDaysX2',COALESCE((i.calculation_json->'salaryRow'->>'presentDaysX2')::INTEGER,i.attendance_days_x2),
        'absentDaysX2',COALESCE((i.calculation_json->'salaryRow'->>'absentDaysX2')::INTEGER,0),
        'halfDayCount',COALESCE((i.calculation_json->'salaryRow'->>'halfDayCount')::INTEGER,0),
        'paidLeaveDaysX2',i.paid_leave_days_x2,
        'workedMinutes',i.worked_minutes,'scheduledMinutes',COALESCE((i.calculation_json->'salaryRow'->>'scheduledMinutes')::INTEGER,0),
        'lateMinutes',COALESCE((i.calculation_json->'salaryRow'->>'lateMinutes')::INTEGER,0),
        'earlyLeaveMinutes',COALESCE((i.calculation_json->'salaryRow'->>'earlyLeaveMinutes')::INTEGER,0),
        'earnedSalaryPaise',i.earned_salary_paise,'overtimePaise',i.overtime_paise,
        'approvedOvertimeMinutes',COALESCE((i.calculation_json->'salaryRow'->>'approvedOvertimeMinutes')::INTEGER,0),
        'overtimeRatePaisePerHour',COALESCE((i.calculation_json->'salaryRow'->>'overtimeRatePaisePerHour')::BIGINT,0),
        'commissionPaise',i.commission_paise,
        'serviceCommissionPaise',COALESCE((i.calculation_json->'salaryRow'->>'serviceCommissionPaise')::BIGINT,0),
        'productCommissionPaise',COALESCE((i.calculation_json->'salaryRow'->>'productCommissionPaise')::BIGINT,0),
        'membershipCommissionPaise',COALESCE((i.calculation_json->'salaryRow'->>'membershipCommissionPaise')::BIGINT,0),
        'packageCommissionPaise',COALESCE((i.calculation_json->'salaryRow'->>'packageCommissionPaise')::BIGINT,0),
        'serviceSalesPaise',COALESCE((i.calculation_json->'salaryRow'->>'serviceSalesPaise')::BIGINT,0),
        'productSalesPaise',COALESCE((i.calculation_json->'salaryRow'->>'productSalesPaise')::BIGINT,0),
        'membershipSalesPaise',COALESCE((i.calculation_json->'salaryRow'->>'membershipSalesPaise')::BIGINT,0),
        'packageSalesPaise',COALESCE((i.calculation_json->'salaryRow'->>'packageSalesPaise')::BIGINT,0),
        'attendancePenaltyPaise',COALESCE((i.calculation_json->'salaryRow'->>'attendancePenaltyPaise')::BIGINT,i.penalty_paise),
        'ruleFinePaise',COALESCE((i.calculation_json->'salaryRow'->>'ruleFinePaise')::BIGINT,0),
        'ruleDeductionPaise',COALESCE((i.calculation_json->'salaryRow'->>'ruleDeductionPaise')::BIGINT,0),
        'lateDeductionPaise',COALESCE((i.calculation_json->'salaryRow'->>'lateDeductionPaise')::BIGINT,0),
        'absenceDeductionPaise',COALESCE((i.calculation_json->'salaryRow'->>'absenceDeductionPaise')::BIGINT,0),
        'fineDeductionPaise',COALESCE((i.calculation_json->'salaryRow'->>'fineDeductionPaise')::BIGINT,(i.calculation_json->'salaryRow'->>'ruleFinePaise')::BIGINT,0),
        'statutoryEmployeePaise',COALESCE((i.calculation_json->'salaryRow'->>'statutoryEmployeePaise')::BIGINT,0),
        'advanceRecoveryPaise',COALESCE((i.calculation_json->'salaryRow'->>'advanceRecoveryPaise')::BIGINT,0),
        'adjustmentPaise',i.adjustment_paise,'grossPaise',i.gross_paise,'deductionsPaise',i.deductions_paise,'netPaise',i.net_paise,
        'paymentMethod',COALESCE(p.payment_method,''),'reference',COALESCE(p.reference,''),'paidAt',p.paid_at,'finalizedAt',r.finalized_at,
        'payslipPath','/staff/self/payslips/'||r.id
      ) ORDER BY r.period_end DESC) FROM staff_payroll_items i JOIN staff_payroll_runs r ON r.id=i.payroll_run_id AND r.tenant_id=i.tenant_id AND r.branch_id=i.branch_id LEFT JOIN staff_payroll_payouts p ON p.payroll_item_id=i.id AND p.tenant_id=i.tenant_id AND p.branch_id=i.branch_id WHERE i.tenant_id=s.tenant_id AND i.branch_id=s.branch_id AND i.staff_id=s.id AND r.status IN ('finalized','partially_paid','paid')),'[]'::jsonb) payroll,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'kind',pr.kind,'amountPaise',pr.amount_paise,'triggerType',pr.trigger_type,'triggerCount',pr.trigger_count,'applicationMode',pr.application_mode,'autoApply',pr.auto_apply,'notes',pr.notes) ORDER BY pr.name,pr.id) FROM staff_payroll_adjustment_rules pr WHERE pr.tenant_id=s.tenant_id AND pr.branch_id=s.branch_id AND pr.active=TRUE),'[]'::jsonb) payroll_rules,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'holidayDate',h.holiday_date,'name',h.name,'isPaid',h.is_paid) ORDER BY h.holiday_date) FROM staff_holidays h WHERE h.tenant_id=s.tenant_id AND h.branch_id=s.branch_id AND h.active=TRUE AND h.holiday_date BETWEEN $4-INTERVAL '30 days' AND $4+INTERVAL '365 days'),'[]'::jsonb) holidays
      FROM staff s
      JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id AND u.active=TRUE
      LEFT JOIN staff_profiles profile ON profile.tenant_id=s.tenant_id AND profile.branch_id=s.branch_id AND profile.staff_id=s.id
      WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.user_id=$3 AND s.active=TRUE
        AND REGEXP_REPLACE(LOWER(u.role_name), '[-_ ]', '', 'g') NOT IN ('owner','admin','superadmin')"#)
      .bind(tenant).bind(branch).bind(user).bind(date).fetch_optional(db).await
}

pub async fn linked_staff_id(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT s.id FROM staff s JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id AND u.active=TRUE WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.user_id=$3 AND s.active=TRUE AND REGEXP_REPLACE(LOWER(u.role_name), '[-_ ]', '', 'g') NOT IN ('owner','admin','superadmin')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(user)
    .fetch_optional(db)
    .await
}

pub async fn list_tips(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StaffTipRecord>, sqlx::Error> {
    sqlx::query_as("SELECT ps.id sale_id,ps.invoice_number,ps.staff_id,COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))) staff_name,COALESCE(ps.business_date,ps.created_at::DATE) business_date,ps.tip_paise amount_paise,pi.payout_id FROM pos_sales ps JOIN staff s ON s.id=ps.staff_id AND s.tenant_id=ps.tenant_id AND s.branch_id=ps.branch_id LEFT JOIN staff_tip_payout_items pi ON pi.tenant_id=ps.tenant_id AND pi.branch_id=ps.branch_id AND pi.sale_id=ps.id WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.tip_paise>0 AND ps.status NOT IN ('draft','voided','cancelled','refunded') AND ($3='' OR ps.staff_id=$3) AND COALESCE(ps.business_date,ps.created_at::DATE) BETWEEN $4 AND $5 ORDER BY business_date DESC,ps.created_at DESC")
      .bind(tenant).bind(branch).bind(staff).bind(from).bind(to).fetch_all(db).await
}

pub async fn tip_summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StaffTipSummary>, sqlx::Error> {
    sqlx::query_as("SELECT ps.staff_id,COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))) staff_name,COUNT(*)::BIGINT tip_count,COALESCE(SUM(ps.tip_paise),0)::BIGINT total_paise,COALESCE(SUM(CASE WHEN pi.payout_id IS NOT NULL THEN ps.tip_paise ELSE 0 END),0)::BIGINT paid_paise,COALESCE(SUM(CASE WHEN pi.payout_id IS NULL THEN ps.tip_paise ELSE 0 END),0)::BIGINT unpaid_paise FROM pos_sales ps JOIN staff s ON s.id=ps.staff_id AND s.tenant_id=ps.tenant_id AND s.branch_id=ps.branch_id LEFT JOIN staff_tip_payout_items pi ON pi.tenant_id=ps.tenant_id AND pi.branch_id=ps.branch_id AND pi.sale_id=ps.id WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.tip_paise>0 AND ps.status NOT IN ('draft','voided','cancelled','refunded') AND COALESCE(ps.business_date,ps.created_at::DATE) BETWEEN $3 AND $4 GROUP BY ps.staff_id,s.appointment_display_name,s.first_name,s.last_name ORDER BY staff_name")
        .bind(tenant).bind(branch).bind(from).bind(to).fetch_all(db).await
}

pub async fn record_tip_payout(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
    from: NaiveDate,
    to: NaiveDate,
    reference: &str,
    actor: &str,
    sale_ids: &[String],
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows:Vec<(String,i64)>=sqlx::query_as("SELECT ps.id,ps.tip_paise FROM pos_sales ps WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.staff_id=$3 AND ps.id=ANY($4) AND ps.tip_paise>0 AND COALESCE(ps.business_date,ps.created_at::DATE) BETWEEN $5 AND $6 AND NOT EXISTS(SELECT 1 FROM staff_tip_payout_items i WHERE i.tenant_id=ps.tenant_id AND i.branch_id=ps.branch_id AND i.sale_id=ps.id) FOR UPDATE")
      .bind(tenant).bind(branch).bind(staff).bind(sale_ids).bind(from).bind(to).fetch_all(&mut *tx).await?;
    if rows.len() != sale_ids.len() {
        tx.rollback().await?;
        return Err(sqlx::Error::RowNotFound);
    }
    let total = rows.iter().map(|r| r.1).sum::<i64>();
    let id:String=sqlx::query_scalar("INSERT INTO staff_tip_payouts(tenant_id,branch_id,staff_id,period_start,period_end,amount_paise,payout_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
      .bind(tenant).bind(branch).bind(staff).bind(from).bind(to).bind(total).bind(reference).bind(actor).fetch_one(&mut *tx).await?;
    for (sale, amount) in rows {
        sqlx::query("INSERT INTO staff_tip_payout_items(tenant_id,branch_id,payout_id,sale_id,amount_paise) VALUES($1,$2,$3,$4,$5)").bind(tenant).bind(branch).bind(&id).bind(sale).bind(amount).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(id)
}

pub async fn list_statutory_rules(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<StatutoryRuleRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by,approved_by,approved_at,review_note,version,created_at,updated_at FROM staff_payroll_statutory_rules WHERE tenant_id=$1 AND branch_id=$2 ORDER BY effective_from DESC,rule_type")
      .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_statutory_rule(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    rule_type: &str,
    state: &str,
    jurisdiction: &str,
    rounding_method: &str,
    official_reference: &str,
    rule: &Value,
    from: NaiveDate,
    to: Option<NaiveDate>,
) -> Result<StatutoryRuleRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_payroll_statutory_rules(tenant_id,branch_id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,'pending',$11) RETURNING id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by,approved_by,approved_at,review_note,version,created_at,updated_at")
      .bind(tenant).bind(branch).bind(rule_type).bind(state).bind(jurisdiction).bind(rounding_method).bind(official_reference).bind(rule).bind(from).bind(to).bind(actor).fetch_one(db).await
}

pub async fn statutory_rule(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<StatutoryRuleRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by,approved_by,approved_at,review_note,version,created_at,updated_at FROM staff_payroll_statutory_rules WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn decide_statutory_rule(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
    decision: &str,
    comments: &str,
) -> Result<Option<StatutoryRuleRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE staff_payroll_statutory_rules SET approval_status=$6,active=($6='approved'),approved_by=$5,approved_at=NOW(),review_note=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND approval_status='pending' AND created_by<>$5 RETURNING id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by,approved_by,approved_at,review_note,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).bind(decision).bind(comments).fetch_optional(db).await
}

pub async fn payroll_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    run: &str,
    staff: &str,
) -> Result<Option<(String, NaiveDate, NaiveDate, i64, String)>, sqlx::Error> {
    sqlx::query_as("SELECT item.id,run.period_start,run.period_end,item.gross_paise,run.status FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id AND run.tenant_id=item.tenant_id AND run.branch_id=item.branch_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3 AND item.staff_id=$4")
      .bind(tenant).bind(branch).bind(run).bind(staff).fetch_optional(db).await
}

/// All active statutory rules effective on `date`, one row per (rule_type, state_code) —
/// this does not collapse multiple state-scoped rules of the same `rule_type`
/// (e.g. professional_tax) into a single arbitrary row.
pub async fn effective_rules_all(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Vec<StatutoryRuleRecord>, sqlx::Error> {
    sqlx::query_as("SELECT DISTINCT ON(rule_type,state_code) id,rule_type,state_code,jurisdiction_code,rounding_method,official_reference,rule_json,effective_from,effective_to,active,approval_status,created_by,approved_by,approved_at,review_note,version,created_at,updated_at FROM staff_payroll_statutory_rules WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND approval_status='approved' AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$3) ORDER BY rule_type,state_code,effective_from DESC")
      .bind(tenant).bind(branch).bind(date).fetch_all(db).await
}

pub async fn statutory_calculation_for_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    item: &str,
) -> Result<Option<StatutoryCalculationRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,payroll_run_id,payroll_item_id,staff_id,period_start,period_end,gross_paise,employee_deduction_paise,employer_contribution_paise,accrual_paise,breakdown_json,calculated_by,calculated_at FROM staff_payroll_statutory_calculations WHERE tenant_id=$1 AND branch_id=$2 AND payroll_item_id=$3")
        .bind(tenant).bind(branch).bind(item).fetch_optional(db).await
}

pub async fn statutory_summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<(i64, i64, i64, i64), sqlx::Error> {
    sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(employee_deduction_paise),0)::BIGINT,COALESCE(SUM(employer_contribution_paise),0)::BIGINT,COALESCE(SUM(accrual_paise),0)::BIGINT FROM staff_payroll_statutory_calculations WHERE tenant_id=$1 AND branch_id=$2 AND period_start>=$3 AND period_end<=$4")
      .bind(tenant).bind(branch).bind(from).bind(to).fetch_one(db).await
}

pub async fn statutory_calculations(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StatutoryCalculationRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,payroll_run_id,payroll_item_id,staff_id,period_start,period_end,gross_paise,employee_deduction_paise,employer_contribution_paise,accrual_paise,breakdown_json,calculated_by,calculated_at FROM staff_payroll_statutory_calculations WHERE tenant_id=$1 AND branch_id=$2 AND period_start>=$3 AND period_end<=$4 ORDER BY period_start DESC,staff_id")
        .bind(tenant).bind(branch).bind(from).bind(to).fetch_all(db).await
}

pub async fn salary_revisions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
) -> Result<Vec<SalaryRevisionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,rate_type,old_amount_paise,new_amount_paise,effective_date,reason,status,requested_by,reviewed_by,reviewed_at,review_note,version,created_at,updated_at FROM staff_salary_revisions WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR staff_id=$3) ORDER BY effective_date DESC,created_at DESC")
      .bind(tenant).bind(branch).bind(staff).fetch_all(db).await
}

pub async fn create_salary_revision(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff: &str,
    actor: &str,
    rate_type: &str,
    amount: i64,
    date: NaiveDate,
    reason: &str,
) -> Result<Option<SalaryRevisionRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_salary_revisions(tenant_id,branch_id,staff_id,rate_type,old_amount_paise,new_amount_paise,effective_date,reason,requested_by) SELECT $1,$2,$3,$4,(SELECT amount_paise FROM staff_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND active=TRUE ORDER BY effective_from DESC NULLS LAST,created_at DESC LIMIT 1),$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE) RETURNING id,staff_id,rate_type,old_amount_paise,new_amount_paise,effective_date,reason,status,requested_by,reviewed_by,reviewed_at,review_note,version,created_at,updated_at")
      .bind(tenant).bind(branch).bind(staff).bind(rate_type).bind(amount).bind(date).bind(reason).bind(actor).fetch_optional(db).await
}

pub async fn decide_salary_revision(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    decision: &str,
    actor: &str,
    note: &str,
) -> Result<Option<SalaryRevisionRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row:Option<SalaryRevisionRecord>=sqlx::query_as("UPDATE staff_salary_revisions SET status=$5,reviewed_by=$6,reviewed_at=NOW(),review_note=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='pending' RETURNING id,staff_id,rate_type,old_amount_paise,new_amount_paise,effective_date,reason,status,requested_by,reviewed_by,reviewed_at,review_note,version,created_at,updated_at")
      .bind(tenant).bind(branch).bind(id).bind(version).bind(decision).bind(actor).bind(note).fetch_optional(&mut *tx).await?;
    if let Some(r) = row.as_ref().filter(|r| r.status == "approved") {
        sqlx::query("UPDATE staff_pay_rates SET active=FALSE WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND active=TRUE").bind(tenant).bind(branch).bind(&r.staff_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO staff_pay_rates(tenant_id,branch_id,staff_id,rate_type,amount_paise,effective_from,active) VALUES($1,$2,$3,$4,$5,$6,TRUE)").bind(tenant).bind(branch).bind(&r.staff_id).bind(&r.rate_type).bind(r.new_amount_paise).bind(r.effective_date).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn roster_sources(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<RosterSourceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH days AS (SELECT GENERATE_SERIES($3::DATE,$4::DATE,'1 day')::DATE schedule_date)
        SELECT s.id staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),s.id) staff_name,
          d.schedule_date,sc.shift1_start,sc.shift1_end,sc.shift2_start,sc.shift2_end,
          sc.status existing_status,sc.notes existing_notes,
          EXISTS(SELECT 1 FROM staff_leave_requests lr WHERE lr.tenant_id=$1 AND lr.branch_id=$2 AND lr.staff_id=s.id AND lr.status='approved' AND d.schedule_date BETWEEN lr.start_date AND lr.end_date) approved_leave,
          COUNT(ap.id)::BIGINT appointments_count,
          COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (ap.end_at-ap.start_at))/60)),0)::BIGINT appointment_minutes,
          (MIN(ap.start_at) AT TIME ZONE 'Asia/Kolkata')::TIME appointment_start,
          (MAX(ap.end_at) AT TIME ZONE 'Asia/Kolkata')::TIME appointment_end
        FROM staff s CROSS JOIN days d
        LEFT JOIN staff_schedules sc ON sc.tenant_id=s.tenant_id AND sc.branch_id=s.branch_id AND sc.staff_id=s.id AND sc.schedule_date=d.schedule_date
        LEFT JOIN appointments ap ON ap.tenant_id=s.tenant_id AND ap.branch_id=s.branch_id AND ap.staff_id=s.id AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=d.schedule_date AND LOWER(ap.status) NOT IN ('cancelled','canceled','void','no_show')
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE
        GROUP BY s.id,s.appointment_display_name,s.first_name,s.last_name,d.schedule_date,sc.shift1_start,sc.shift1_end,sc.shift2_start,sc.shift2_end,sc.status,sc.notes
        ORDER BY d.schedule_date,staff_name,s.id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn roster_coverage(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<RosterCoverageRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          (SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE)::BIGINT active_staff,
          (SELECT COUNT(*) FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4 AND status='working')::BIGINT scheduled_staff_days,
          COALESCE((SELECT SUM(COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)+COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0)) FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4 AND status='working'),0)::BIGINT scheduled_minutes,
          COALESCE((SELECT SUM(GREATEST(0,EXTRACT(EPOCH FROM (end_at-start_at))/60)) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4 AND LOWER(status) NOT IN ('cancelled','canceled','void','no_show')),0)::BIGINT appointment_minutes,
          (SELECT COUNT(*) FROM appointments ap
            WHERE ap.tenant_id=$1 AND ap.branch_id=$2
              AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
              AND LOWER(ap.status) NOT IN ('cancelled','canceled','void','no_show')
              AND (COALESCE(ap.staff_id,'')='' OR NOT EXISTS(
                SELECT 1 FROM staff_schedules sc
                 WHERE sc.tenant_id=ap.tenant_id AND sc.branch_id=ap.branch_id AND sc.staff_id=ap.staff_id
                   AND sc.schedule_date=(ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE AND sc.status='working'
                   AND ((sc.shift1_start<=(ap.start_at AT TIME ZONE 'Asia/Kolkata')::TIME AND sc.shift1_end>=(ap.end_at AT TIME ZONE 'Asia/Kolkata')::TIME)
                     OR (sc.shift2_start<=(ap.start_at AT TIME ZONE 'Asia/Kolkata')::TIME AND sc.shift2_end>=(ap.end_at AT TIME ZONE 'Asia/Kolkata')::TIME))
              )))::BIGINT uncovered_appointments"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(from)
    .bind(to)
    .fetch_one(db)
    .await
}

pub async fn create_roster_draft(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
    entries: &Value,
    metrics: &Value,
    actor: &str,
) -> Result<RosterDraftRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_roster_drafts(tenant_id,branch_id,period_start,period_end,entries_json,metrics_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,period_start,period_end,entries_json,metrics_json,status,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(from).bind(to).bind(entries).bind(metrics).bind(actor).fetch_one(db).await
}

pub async fn get_roster_draft(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<RosterDraftRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,period_start,period_end,entries_json,metrics_json,status,version,created_at,updated_at FROM staff_roster_drafts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn publish_roster_draft(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
    entries: Vec<RosterScheduleInput>,
) -> Result<Option<RosterDraftRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated: Option<RosterDraftRecord> = sqlx::query_as("UPDATE staff_roster_drafts SET status='published',published_by=$5,published_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='draft' RETURNING id,period_start,period_end,entries_json,metrics_json,status,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).fetch_optional(&mut *tx).await?;
    if updated.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }
    for entry in entries {
        let saved = sqlx::query("INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,shift1_start,shift1_end,shift2_start,shift2_end,status,notes) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE) ON CONFLICT(tenant_id,branch_id,staff_id,schedule_date) DO UPDATE SET shift1_start=EXCLUDED.shift1_start,shift1_end=EXCLUDED.shift1_end,shift2_start=EXCLUDED.shift2_start,shift2_end=EXCLUDED.shift2_end,status=EXCLUDED.status,notes=EXCLUDED.notes,updated_at=NOW()")
            .bind(tenant).bind(branch).bind(entry.staff_id).bind(entry.schedule_date).bind(entry.shift1_start).bind(entry.shift1_end).bind(entry.shift2_start).bind(entry.shift2_end).bind(entry.status).bind(entry.notes).execute(&mut *tx).await?;
        if saved.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
    }
    tx.commit().await?;
    Ok(updated)
}

pub async fn manpower_source(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    history_from: NaiveDate,
    history_to: NaiveDate,
    future_from: NaiveDate,
    future_to: NaiveDate,
) -> Result<ManpowerSourceRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          (SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE)::BIGINT active_staff,
          COALESCE((SELECT SUM(GREATEST(0,EXTRACT(EPOCH FROM (end_at-start_at))/60)) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4 AND LOWER(status) IN ('completed','paid','closed')),0)::BIGINT historical_appointment_minutes,
          (SELECT COUNT(DISTINCT (start_at AT TIME ZONE 'Asia/Kolkata')::DATE) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4 AND LOWER(status) IN ('completed','paid','closed'))::BIGINT historical_appointment_days,
          COALESCE((SELECT SUM(GREATEST(0,EXTRACT(EPOCH FROM (end_at-start_at))/60)) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $5 AND $6 AND LOWER(status) NOT IN ('cancelled','canceled','void','no_show')),0)::BIGINT future_booked_minutes,
          COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4 AND status IN ('clocked_in','clocked_out','present')),0)::BIGINT worked_minutes,
          (SELECT COUNT(*) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4 AND status IN ('clocked_in','clocked_out','present'))::BIGINT attendance_staff_days"#,
    )
    .bind(tenant).bind(branch).bind(history_from).bind(history_to).bind(future_from).bind(future_to).fetch_one(db).await
}

pub async fn create_manpower_forecast(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
    history_from: NaiveDate,
    history_to: NaiveDate,
    projected: i64,
    capacity: Option<i64>,
    required: Option<i32>,
    shortage: Option<i32>,
    confidence: &str,
    evidence: &Value,
    actor: &str,
) -> Result<ManpowerForecastRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_manpower_forecasts(tenant_id,branch_id,period_start,period_end,history_start,history_end,projected_demand_minutes,available_capacity_minutes,required_staff_count,shortage_staff_count,confidence,evidence_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,period_start,period_end,history_start,history_end,projected_demand_minutes,available_capacity_minutes,required_staff_count,shortage_staff_count,confidence,evidence_json,created_at")
        .bind(tenant).bind(branch).bind(from).bind(to).bind(history_from).bind(history_to).bind(projected).bind(capacity).bind(required).bind(shortage).bind(confidence).bind(evidence).bind(actor).fetch_one(db).await
}

pub async fn replacement_context(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    appointment: &str,
) -> Result<Option<ReplacementContextRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id appointment_id,staff_id absent_staff_id,client_id,(start_at AT TIME ZONE 'Asia/Kolkata')::DATE business_date,(start_at AT TIME ZONE 'Asia/Kolkata')::TIME start_time,(end_at AT TIME ZONE 'Asia/Kolkata')::TIME end_time,service_ids_json FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND LOWER(status) NOT IN ('cancelled','canceled','void','completed','paid','closed')")
        .bind(tenant).bind(branch).bind(appointment).fetch_optional(db).await
}

pub async fn replacement_candidates(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    absent_staff: &str,
    appointment: &str,
    date: NaiveDate,
    start: NaiveTime,
    end: NaiveTime,
    service_ids: &[String],
    client_id: &str,
) -> Result<Vec<ReplacementCandidateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT s.id staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),s.id) staff_name,
          (NOT EXISTS(SELECT 1 FROM staff_schedules sc WHERE sc.tenant_id=$1 AND sc.branch_id=$2 AND sc.staff_id=s.id AND sc.schedule_date=$5)
            OR EXISTS(SELECT 1 FROM staff_schedules sc WHERE sc.tenant_id=$1 AND sc.branch_id=$2 AND sc.staff_id=s.id AND sc.schedule_date=$5 AND sc.status='working' AND ((sc.shift1_start<=$6 AND sc.shift1_end>=$7) OR (sc.shift2_start<=$6 AND sc.shift2_end>=$7)))) schedule_match,
          NOT EXISTS(SELECT 1 FROM staff_leave_requests lr WHERE lr.tenant_id=$1 AND lr.branch_id=$2 AND lr.staff_id=s.id AND lr.status='approved' AND $5 BETWEEN lr.start_date AND lr.end_date) leave_free,
          NOT EXISTS(SELECT 1 FROM appointments ap WHERE ap.tenant_id=$1 AND ap.branch_id=$2 AND ap.staff_id=s.id AND ap.id<>$4 AND LOWER(ap.status) NOT IN ('cancelled','canceled','void','no_show') AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$5 AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::TIME<$7 AND (ap.end_at AT TIME ZONE 'Asia/Kolkata')::TIME>$6) slot_free,
          NOT EXISTS(SELECT requested.service_id FROM UNNEST($8::TEXT[]) requested(service_id) WHERE NOT EXISTS(SELECT 1 FROM staff_catalog_assignments ca WHERE ca.tenant_id=$1 AND ca.branch_id=$2 AND ca.staff_id=s.id AND ca.item_type='service' AND ca.item_id=requested.service_id) AND NOT EXISTS(SELECT 1 FROM staff_service_assignments sa WHERE sa.tenant_id=$1 AND sa.branch_id=$2 AND sa.staff_id=s.id AND sa.service_id=requested.service_id)) service_match,
          COALESCE((SELECT TRIM(profile.department) FROM staff_profiles profile WHERE profile.tenant_id=$1 AND profile.branch_id=$2 AND profile.staff_id=s.id),'') department,
          NOT EXISTS(SELECT 1 FROM services requested WHERE requested.tenant_id=$1 AND requested.branch_id=$2 AND requested.id=ANY($8::TEXT[]) AND TRIM(requested.category)<>'' AND LOWER(TRIM(requested.category))<>LOWER(COALESCE((SELECT TRIM(profile.department) FROM staff_profiles profile WHERE profile.tenant_id=$1 AND profile.branch_id=$2 AND profile.staff_id=s.id),''))) department_match,
          EXISTS(SELECT 1 FROM clients client WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$9 AND client.preferred_staff_id=s.id) preferred_client,
          NOT EXISTS(SELECT 1 FROM appointment_blackouts blackout WHERE blackout.tenant_id=$1 AND blackout.branch_id=$2 AND (blackout.staff_id='' OR blackout.staff_id=s.id) AND (((blackout.blocked_from AT TIME ZONE 'Asia/Kolkata')::DATE=$5 AND (blackout.blocked_from AT TIME ZONE 'Asia/Kolkata')::TIME<$7 AND (blackout.blocked_until AT TIME ZONE 'Asia/Kolkata')::TIME>$6) OR (blackout.blocked_from IS NULL AND blackout.blocked_until IS NULL AND blackout.blackout_date=$5::TEXT))) blackout_free,
          (SELECT COUNT(*) FROM appointments ap WHERE ap.tenant_id=$1 AND ap.branch_id=$2 AND ap.staff_id=s.id AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$5 AND LOWER(ap.status) NOT IN ('cancelled','canceled','void','no_show'))::BIGINT workload_count,
          COALESCE((SELECT SUM(GREATEST(0,EXTRACT(EPOCH FROM (ap.end_at-ap.start_at))/60)) FROM appointments ap WHERE ap.tenant_id=$1 AND ap.branch_id=$2 AND ap.staff_id=s.id AND (ap.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$5 AND LOWER(ap.status) NOT IN ('cancelled','canceled','void','no_show')),0)::BIGINT workload_minutes
        FROM staff s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE AND s.id<>$3
        ORDER BY workload_count,staff_name,s.id"#,
    )
    .bind(tenant).bind(branch).bind(absent_staff).bind(appointment).bind(date).bind(start).bind(end).bind(service_ids).bind(client_id).fetch_all(db).await
}

pub async fn create_replacement_recommendation(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    absent_staff: &str,
    appointment: &str,
    recommended_staff: &str,
    ranked: &Value,
    confidence: &str,
    actor: &str,
) -> Result<ReplacementRecommendationRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_replacement_recommendations(tenant_id,branch_id,absent_staff_id,appointment_id,recommended_staff_id,ranked_options_json,confidence,requested_by) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8) RETURNING id,absent_staff_id,appointment_id,recommended_staff_id,ranked_options_json,confidence,status,requested_by,decided_by,decided_at,decision_reason,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(absent_staff).bind(appointment).bind(recommended_staff).bind(ranked).bind(confidence).bind(actor).fetch_one(db).await
}

pub async fn replacement_history(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ReplacementRecommendationRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,absent_staff_id,appointment_id,recommended_staff_id,ranked_options_json,confidence,status,requested_by,decided_by,decided_at,decision_reason,version,created_at,updated_at FROM staff_replacement_recommendations WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn decide_replacement(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    decision: &str,
    actor: &str,
    reason: &str,
) -> Result<Option<ReplacementRecommendationRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current: Option<ReplacementRecommendationRecord> = sqlx::query_as("SELECT id,absent_staff_id,appointment_id,recommended_staff_id,ranked_options_json,confidence,status,requested_by,decided_by,decided_at,decision_reason,version,created_at,updated_at FROM staff_replacement_recommendations WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='pending' FOR UPDATE")
        .bind(tenant).bind(branch).bind(id).bind(version).fetch_optional(&mut *tx).await?;
    let Some(current) = current else {
        tx.rollback().await?;
        return Ok(None);
    };
    if decision == "approved" {
        let updated = sqlx::query("UPDATE appointments target SET staff_id=$4,version=version+1,updated_at=NOW() WHERE target.tenant_id=$1 AND target.branch_id=$2 AND target.id=$3 AND ($5::TEXT IS NULL OR target.staff_id=$5) AND EXISTS(SELECT 1 FROM staff_schedules sc WHERE sc.tenant_id=$1 AND sc.branch_id=$2 AND sc.staff_id=$4 AND sc.schedule_date=(target.start_at AT TIME ZONE 'Asia/Kolkata')::DATE AND sc.status='working' AND ((sc.shift1_start<=(target.start_at AT TIME ZONE 'Asia/Kolkata')::TIME AND sc.shift1_end>=(target.end_at AT TIME ZONE 'Asia/Kolkata')::TIME) OR (sc.shift2_start<=(target.start_at AT TIME ZONE 'Asia/Kolkata')::TIME AND sc.shift2_end>=(target.end_at AT TIME ZONE 'Asia/Kolkata')::TIME))) AND NOT EXISTS(SELECT 1 FROM staff_leave_requests lr WHERE lr.tenant_id=$1 AND lr.branch_id=$2 AND lr.staff_id=$4 AND lr.status='approved' AND (target.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN lr.start_date AND lr.end_date) AND NOT EXISTS(SELECT 1 FROM appointments conflict WHERE conflict.tenant_id=$1 AND conflict.branch_id=$2 AND conflict.staff_id=$4 AND conflict.id<>target.id AND LOWER(conflict.status) NOT IN ('cancelled','canceled','void','no_show') AND conflict.start_at<target.end_at AND conflict.end_at>target.start_at) AND NOT EXISTS(SELECT requested.service_id FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NULLIF(target.service_ids_json,''),'[]')::JSONB) requested(service_id) WHERE NOT EXISTS(SELECT 1 FROM staff_catalog_assignments ca WHERE ca.tenant_id=$1 AND ca.branch_id=$2 AND ca.staff_id=$4 AND ca.item_type='service' AND ca.item_id=requested.service_id))")
            .bind(tenant).bind(branch).bind(current.appointment_id.as_deref().unwrap_or("")).bind(&current.recommended_staff_id).bind(current.absent_staff_id.as_deref()).execute(&mut *tx).await?;
        if updated.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
    }
    let row = sqlx::query_as("UPDATE staff_replacement_recommendations SET status=$5,decided_by=$6,decided_at=NOW(),decision_reason=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 RETURNING id,absent_staff_id,appointment_id,recommended_staff_id,ranked_options_json,confidence,status,requested_by,decided_by,decided_at,decision_reason,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(decision).bind(actor).bind(reason).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn staff_sales_summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Vec<StaffSalesSummaryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH line_base AS (
          SELECT sale.id sale_id,sale.invoice_number,sale.client_id,line.id sale_line_id,
                 line.line_type,line.taxable_paise,line.discount_paise,line.staff_id,line.staff_splits
            FROM pos_sales sale JOIN pos_sale_lines line ON line.sale_id=sale.id
           WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date BETWEEN $3 AND $4
             AND sale.status NOT IN ('draft','cancelled','voided')
        ), attributed AS (
          SELECT base.*,COALESCE(split.value->>'staffId',split.value->>'staff_id','') attributed_staff_id,
                 ROUND(COALESCE((split.value->>'percent')::NUMERIC,0)*100)::INTEGER split_bps
            FROM line_base base JOIN LATERAL jsonb_array_elements(COALESCE(base.staff_splits,'[]'::JSONB)) split(value)
              ON jsonb_array_length(COALESCE(base.staff_splits,'[]'::JSONB))>0
          UNION ALL
          SELECT base.*,base.staff_id,10000 FROM line_base base
           WHERE jsonb_array_length(COALESCE(base.staff_splits,'[]'::JSONB))=0 AND base.staff_id<>''
        ), valued AS (
          SELECT *,((taxable_paise*split_bps+5000)/10000)::BIGINT revenue_paise,
                   ((discount_paise*split_bps+5000)/10000)::BIGINT attributed_discount_paise
            FROM attributed WHERE attributed_staff_id<>'' AND split_bps>0
        ), commissions AS (
          SELECT staff_id,SUM(commission_paise)::BIGINT commission_paise
            FROM pos_staff_commission_snapshots
           WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4 GROUP BY staff_id
        )
        SELECT v.attributed_staff_id staff_id,
               COALESCE(NULLIF(s.appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),v.attributed_staff_id) staff_name,
               COUNT(DISTINCT v.sale_id)::BIGINT invoice_count,COUNT(DISTINCT v.client_id)::BIGINT client_count,
               COUNT(*)::BIGINT line_count,
               COALESCE(SUM(v.revenue_paise) FILTER(WHERE v.line_type='service'),0)::BIGINT service_revenue_paise,
               COALESCE(SUM(v.revenue_paise) FILTER(WHERE v.line_type='product'),0)::BIGINT product_revenue_paise,
               COALESCE(SUM(v.revenue_paise) FILTER(WHERE v.line_type='membership'),0)::BIGINT membership_revenue_paise,
               COALESCE(SUM(v.revenue_paise) FILTER(WHERE v.line_type='package'),0)::BIGINT package_revenue_paise,
               COALESCE(SUM(v.revenue_paise) FILTER(WHERE v.line_type NOT IN ('service','product','membership','package')),0)::BIGINT other_revenue_paise,
               COALESCE(SUM(v.revenue_paise),0)::BIGINT total_revenue_paise,
               COALESCE(SUM(v.attributed_discount_paise),0)::BIGINT discount_paise,
               COALESCE(MAX(c.commission_paise),0)::BIGINT commission_paise
          FROM valued v LEFT JOIN staff s ON s.tenant_id=$1 AND s.branch_id=$2 AND s.id=v.attributed_staff_id
          LEFT JOIN commissions c ON c.staff_id=v.attributed_staff_id
         GROUP BY v.attributed_staff_id,s.appointment_display_name,s.first_name,s.last_name
         ORDER BY total_revenue_paise DESC,staff_name"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(start)
    .bind(end)
    .fetch_all(db)
    .await
}

pub async fn staff_sales_lines(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    start: NaiveDate,
    end: NaiveDate,
    offset: i64,
    limit: i64,
) -> Result<Vec<StaffSalesLineRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH line_base AS (
          SELECT sale.id sale_id,sale.invoice_number,sale.business_date,sale.client_id,line.id sale_line_id,
                 line.line_type,line.item_id,line.item_name,line.taxable_paise,line.discount_paise,line.staff_id,line.staff_splits
            FROM pos_sales sale JOIN pos_sale_lines line ON line.sale_id=sale.id
           WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date BETWEEN $3 AND $4
             AND sale.status NOT IN ('draft','cancelled','voided')
        ), attributed AS (
          SELECT base.*,COALESCE(split.value->>'staffId',split.value->>'staff_id','') attributed_staff_id,
                 ROUND(COALESCE((split.value->>'percent')::NUMERIC,0)*100)::INTEGER split_bps
            FROM line_base base JOIN LATERAL jsonb_array_elements(COALESCE(base.staff_splits,'[]'::JSONB)) split(value)
              ON jsonb_array_length(COALESCE(base.staff_splits,'[]'::JSONB))>0
          UNION ALL
          SELECT base.*,base.staff_id,10000 FROM line_base base
           WHERE jsonb_array_length(COALESCE(base.staff_splits,'[]'::JSONB))=0 AND base.staff_id<>''
        )
        SELECT a.sale_id,a.invoice_number,a.business_date,a.attributed_staff_id staff_id,
               COALESCE(NULLIF(s.appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),a.attributed_staff_id) staff_name,
               a.client_id,a.line_type,a.item_id,a.item_name,a.split_bps,
               ((a.taxable_paise*a.split_bps+5000)/10000)::BIGINT revenue_paise,
               ((a.discount_paise*a.split_bps+5000)/10000)::BIGINT discount_paise,
               COALESCE(c.commission_paise,0)::BIGINT commission_paise
          FROM attributed a LEFT JOIN staff s ON s.tenant_id=$1 AND s.branch_id=$2 AND s.id=a.attributed_staff_id
          LEFT JOIN pos_staff_commission_snapshots c ON c.tenant_id=$1 AND c.branch_id=$2 AND c.sale_line_id=a.sale_line_id AND c.staff_id=a.attributed_staff_id
         WHERE a.attributed_staff_id<>'' AND a.split_bps>0
         ORDER BY a.business_date DESC,a.invoice_number DESC,a.sale_line_id,a.attributed_staff_id OFFSET $5 LIMIT $6"#,
    )
    .bind(tenant).bind(branch).bind(start).bind(end).bind(offset).bind(limit).fetch_all(db).await
}

pub async fn staff_sales_line_count(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COUNT(*)::BIGINT FROM pos_sales sale JOIN pos_sale_lines line ON line.sale_id=sale.id
           LEFT JOIN LATERAL jsonb_array_elements(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
             ON jsonb_array_length(COALESCE(line.staff_splits,'[]'::JSONB))>0
          WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date BETWEEN $3 AND $4
            AND sale.status NOT IN ('draft','cancelled','voided')
            AND (split.value IS NOT NULL OR line.staff_id<>'')"#,
    )
    .bind(tenant).bind(branch).bind(start).bind(end).fetch_one(db).await
}

pub async fn staff_operational_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    start: NaiveDate,
    end: NaiveDate,
    report_type: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    let sql = match report_type {
        "attendance" => {
            r#"SELECT row FROM (SELECT jsonb_build_object('staffId',a.staff_id,'staffName',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))),'days',COUNT(*),'presentDays',COUNT(*) FILTER(WHERE COALESCE(a.manual_status,a.status) IN ('present','clocked_in','clocked_out')),'workedMinutes',SUM(a.worked_minutes),'breakMinutes',SUM(a.break_minutes),'lateMinutes',SUM(a.late_minutes),'overtimeMinutes',SUM(a.overtime_minutes)) AS row FROM staff_attendance_records a JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.business_date BETWEEN $3 AND $4 GROUP BY a.staff_id,s.appointment_display_name,s.first_name,s.last_name) report ORDER BY row->>'staffName'"#
        }
        "payroll" => {
            r#"SELECT jsonb_build_object('staffId',i.staff_id,'staffName',i.staff_name,'runs',COUNT(*),'grossPaise',SUM(i.gross_paise),'deductionsPaise',SUM(i.deductions_paise),'netPaise',SUM(i.net_paise),'commissionPaise',SUM(i.commission_paise)) FROM staff_payroll_items i JOIN staff_payroll_runs r ON r.id=i.payroll_run_id AND r.tenant_id=i.tenant_id AND r.branch_id=i.branch_id WHERE i.tenant_id=$1 AND i.branch_id=$2 AND r.period_start<=$4 AND r.period_end>=$3 GROUP BY i.staff_id,i.staff_name ORDER BY i.staff_name"#
        }
        "commission" => {
            r#"SELECT row FROM (SELECT jsonb_build_object('staffId',c.staff_id,'staffName',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))),'saleCount',COUNT(DISTINCT c.sale_id),'lineCount',COUNT(*),'basePaise',SUM(c.base_paise),'commissionPaise',SUM(c.commission_paise)) AS row FROM pos_staff_commission_snapshots c LEFT JOIN staff s ON s.id=c.staff_id AND s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.business_date BETWEEN $3 AND $4 GROUP BY c.staff_id,s.appointment_display_name,s.first_name,s.last_name) report ORDER BY row->>'staffName'"#
        }
        "training" => {
            r#"SELECT row FROM (SELECT jsonb_build_object('staffId',t.staff_id,'staffName',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))),'assigned',COUNT(*),'completed',COUNT(*) FILTER(WHERE t.status='completed'),'overdue',COUNT(*) FILTER(WHERE t.status NOT IN ('completed','cancelled') AND t.due_at<NOW())) AS row FROM staff_tasks t LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.task_type='training' AND t.created_at::DATE BETWEEN $3 AND $4 GROUP BY t.staff_id,s.appointment_display_name,s.first_name,s.last_name) report ORDER BY row->>'staffName'"#
        }
        _ => return Ok(Vec::new()),
    };
    sqlx::query_scalar(sql)
        .bind(tenant)
        .bind(branch)
        .bind(start)
        .bind(end)
        .fetch_all(db)
        .await
}

pub async fn notification_context(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
) -> Result<Option<StaffNotificationContext>, sqlx::Error> {
    sqlx::query_as("SELECT s.id staff_id,s.first_name,COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name))) display_name,s.mobile_phone,p.whatsapp_opt_in,p.allow_payroll_amounts,COALESCE(NULLIF(p.language_code,''),'en-IN') language_code,p.quiet_hours_start,p.quiet_hours_end FROM staff s LEFT JOIN staff_notification_preferences p ON p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id AND p.staff_id=s.id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE")
        .bind(tenant).bind(branch).bind(staff_id).fetch_optional(db).await
}

pub async fn notification_preference(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
) -> Result<Option<StaffNotificationPreferenceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,whatsapp_opt_in,allow_payroll_amounts,language_code,quiet_hours_start,quiet_hours_end,version,created_at,updated_at FROM staff_notification_preferences WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3")
        .bind(tenant).bind(branch).bind(staff_id).fetch_optional(db).await
}

pub async fn save_notification_preference(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
    whatsapp: bool,
    payroll: bool,
    language: &str,
    quiet_start: Option<NaiveTime>,
    quiet_end: Option<NaiveTime>,
    version: i32,
) -> Result<Option<StaffNotificationPreferenceRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_notification_preferences(tenant_id,branch_id,staff_id,whatsapp_opt_in,allow_payroll_amounts,language_code,quiet_hours_start,quiet_hours_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id,staff_id) DO UPDATE SET whatsapp_opt_in=EXCLUDED.whatsapp_opt_in,allow_payroll_amounts=EXCLUDED.allow_payroll_amounts,language_code=EXCLUDED.language_code,quiet_hours_start=EXCLUDED.quiet_hours_start,quiet_hours_end=EXCLUDED.quiet_hours_end,version=staff_notification_preferences.version+1,updated_at=NOW() WHERE staff_notification_preferences.version=$9 RETURNING id,staff_id,whatsapp_opt_in,allow_payroll_amounts,language_code,quiet_hours_start,quiet_hours_end,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(staff_id).bind(whatsapp).bind(payroll).bind(language).bind(quiet_start).bind(quiet_end).bind(version).fetch_optional(db).await
}

pub async fn list_notification_templates(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<StaffNotificationTemplateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,notification_type,language_code,title,body_template,sensitive,active,version,created_at,updated_at FROM staff_notification_templates WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,notification_type,language_code")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_notification_template(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    notification_type: &str,
    language: &str,
    title: &str,
    body: &str,
    sensitive: bool,
) -> Result<StaffNotificationTemplateRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_notification_templates(tenant_id,branch_id,created_by,notification_type,language_code,title,body_template,sensitive) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,notification_type,language_code,title,body_template,sensitive,active,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(actor).bind(notification_type).bind(language).bind(title).bind(body).bind(sensitive).fetch_one(db).await
}

pub async fn notification_template(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<StaffNotificationTemplateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,notification_type,language_code,title,body_template,sensitive,active,version,created_at,updated_at FROM staff_notification_templates WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

/// Looks up the active template configured for a notification type (e.g. by domain code that
/// needs to queue a notification but only knows the event type, not a template id — payroll
/// events use this instead of requiring every call-site to know a template UUID).
pub async fn active_notification_template_by_type(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    notification_type: &str,
    language_code: &str,
) -> Result<Option<StaffNotificationTemplateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,notification_type,language_code,title,body_template,sensitive,active,version,created_at,updated_at FROM staff_notification_templates WHERE tenant_id=$1 AND branch_id=$2 AND notification_type=$3 AND language_code IN ($4,'en-IN') AND active=TRUE ORDER BY CASE WHEN language_code=$4 THEN 0 ELSE 1 END LIMIT 1")
        .bind(tenant).bind(branch).bind(notification_type).bind(language_code).fetch_optional(db).await
}

/// Idempotency check for the payroll notification call-sites: has a notification with this
/// exact idempotency key already been queued for this staff/notification_type? Mirrors the
/// `metadata->>'idempotencyKey'` pattern already used by `staff_operations_repository`'s
/// `queue_staff_operation_notification`, since `staff_notification_queue` has no DB-level unique
/// constraint for this. The database unique index remains authoritative; this pre-check avoids a
/// predictable conflict on ordinary retries before calling the shared queue service.
pub async fn notification_already_queued(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
    notification_type: &str,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_notification_queue WHERE tenant_id=$1 AND branch_id=$2 \
         AND staff_id=$3 AND notification_type=$4 AND metadata_json->>'idempotencyKey'=$5)",
    )
    .bind(tenant)
    .bind(branch)
    .bind(staff_id)
    .bind(notification_type)
    .bind(idempotency_key)
    .fetch_one(db)
    .await
}

pub async fn create_notification_queue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    staff_id: &str,
    template_id: Option<&str>,
    channel: &str,
    notification_type: &str,
    recipient: &str,
    title: &str,
    body: &str,
    sensitive: bool,
    requires_approval: bool,
    status: &str,
    scheduled_at: DateTime<Utc>,
    metadata: &Value,
) -> Result<StaffNotificationQueueRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_notification_queue(tenant_id,branch_id,requested_by,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,requested_by,approved_by,approved_at,provider,provider_message_id,last_error,delivery_attempts,max_delivery_attempts,next_attempt_at,metadata_json,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(actor).bind(staff_id).bind(template_id).bind(channel).bind(notification_type).bind(recipient).bind(title).bind(body).bind(sensitive).bind(requires_approval).bind(status).bind(scheduled_at).bind(metadata).fetch_one(db).await
}

pub async fn list_notification_queue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: Option<&str>,
) -> Result<Vec<StaffNotificationQueueRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,requested_by,approved_by,approved_at,provider,provider_message_id,last_error,delivery_attempts,max_delivery_attempts,next_attempt_at,metadata_json,version,created_at,updated_at FROM staff_notification_queue WHERE tenant_id=$1 AND branch_id=$2 AND ($3::TEXT IS NULL OR status=$3) ORDER BY created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(status).fetch_all(db).await
}

pub async fn approve_notification(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    actor: &str,
) -> Result<Option<StaffNotificationQueueRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE staff_notification_queue SET status='approved',approved_by=$5,approved_at=NOW(),next_attempt_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='approval_required' RETURNING id,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,requested_by,approved_by,approved_at,provider,provider_message_id,last_error,delivery_attempts,max_delivery_attempts,next_attempt_at,metadata_json,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(actor).fetch_optional(db).await
}

pub async fn record_notification_delivery(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
    provider: &str,
    provider_message_id: &str,
    status: &str,
    error: &str,
    payload: &Value,
) -> Result<Option<StaffNotificationQueueRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<StaffNotificationQueueRecord> = sqlx::query_as("UPDATE staff_notification_queue SET status=$5,provider=$6,provider_message_id=$7,last_error=$8,delivery_attempts=CASE WHEN $5='failed' THEN delivery_attempts+1 ELSE delivery_attempts END,next_attempt_at=CASE WHEN $5='failed' THEN NOW() + (INTERVAL '5 minutes' * LEAST(delivery_attempts+1,max_delivery_attempts)) ELSE next_attempt_at END,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status IN ('queued','approved') RETURNING id,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,requested_by,approved_by,approved_at,provider,provider_message_id,last_error,delivery_attempts,max_delivery_attempts,next_attempt_at,metadata_json,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).bind(status).bind(provider).bind(provider_message_id).bind(error).fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query("INSERT INTO staff_notification_delivery_logs(tenant_id,branch_id,queue_id,provider,provider_message_id,delivery_status,error_message,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant).bind(branch).bind(id).bind(provider).bind(provider_message_id).bind(status).bind(error).bind(payload).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(row))
}

pub async fn retry_notification(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
) -> Result<Option<StaffNotificationQueueRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE staff_notification_queue SET status=CASE WHEN requires_approval THEN 'approved' ELSE 'queued' END,last_error='',next_attempt_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='failed' AND delivery_attempts < max_delivery_attempts RETURNING id,staff_id,template_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,requested_by,approved_by,approved_at,provider,provider_message_id,last_error,delivery_attempts,max_delivery_attempts,next_attempt_at,metadata_json,version,created_at,updated_at")
        .bind(tenant).bind(branch).bind(id).bind(version).fetch_optional(db).await
}

pub async fn notification_delivery_logs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    queue_id: Option<&str>,
) -> Result<Vec<StaffNotificationDeliveryLogRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,queue_id,provider,provider_message_id,delivery_status,error_message,payload_json,created_at FROM staff_notification_delivery_logs WHERE tenant_id=$1 AND branch_id=$2 AND ($3::TEXT IS NULL OR queue_id=$3) ORDER BY created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(queue_id).fetch_all(db).await
}

pub async fn staff_skill_matrix(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<StaffSkillMatrixRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT s.id staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),s.id) staff_name,
          s.job_title,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('roleId',r.id,'roleName',r.name) ORDER BY r.name)
            FROM staff_role_assignments a JOIN roles r ON r.id=a.role_id AND r.tenant_id=a.tenant_id
           WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=s.id),'[]'::JSONB) roles,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('serviceId',svc.id,'serviceName',svc.name,'category',svc.category,'commissionPercent',a.commission_percent) ORDER BY svc.name)
            FROM staff_catalog_assignments a JOIN services svc ON svc.id=a.item_id AND svc.tenant_id=a.tenant_id AND svc.branch_id=a.branch_id
           WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=s.id AND a.item_type='service'),'[]'::JSONB) services
        FROM staff s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE
        ORDER BY staff_name,s.id"#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await
}

pub async fn staff_floor_control(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Vec<StaffFloorControlRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT s.id staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),s.id) staff_name,
          schedule.id schedule_id,
          schedule.status schedule_status,schedule.shift1_start,schedule.shift1_end,schedule.shift2_start,schedule.shift2_end,
          COALESCE(attendance.manual_status,attendance.status) attendance_status,
          attendance.clock_in_at,attendance.clock_out_at,
          COALESCE(attendance.late_minutes,0)::INTEGER late_minutes,
          COALESCE(attendance.overtime_minutes,0)::INTEGER overtime_minutes,
          COALESCE(appointments.appointment_count,0)::BIGINT appointment_count,
          COALESCE(appointments.appointment_minutes,0)::BIGINT appointment_minutes
        FROM staff s
        LEFT JOIN staff_schedules schedule ON schedule.tenant_id=$1 AND schedule.branch_id=$2 AND schedule.staff_id=s.id AND schedule.schedule_date=$3
        LEFT JOIN staff_attendance_records attendance ON attendance.tenant_id=$1 AND attendance.branch_id=$2 AND attendance.staff_id=s.id AND attendance.business_date=$3
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::BIGINT appointment_count,
                 COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (a.end_at-a.start_at))::BIGINT/60)),0)::BIGINT appointment_minutes
            FROM appointments a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=s.id
             AND (a.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3
             AND LOWER(a.status) NOT IN ('cancelled','canceled','void','no_show')
        ) appointments ON TRUE
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE
        ORDER BY staff_name,s.id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_all(db)
    .await
}

pub async fn list_coaching_goals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<CoachingGoalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT g.id,g.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),g.staff_id) staff_name,
          g.goal_type,g.metric_unit,g.target_value,g.current_value,g.due_date,g.status,g.created_by,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'dueAt',t.due_at,'completedAt',t.completed_at,'version',t.version) ORDER BY t.created_at)
            FROM staff_tasks t WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.coaching_goal_id=g.id),'[]'::JSONB) actions,
          g.version,g.created_at,g.updated_at
        FROM staff_coaching_goals g JOIN staff s ON s.id=g.staff_id AND s.tenant_id=g.tenant_id AND s.branch_id=g.branch_id
        WHERE g.tenant_id=$1 AND g.branch_id=$2 AND ($3='' OR g.staff_id=$3) AND ($4='' OR g.status=$4)
        ORDER BY CASE WHEN g.status='active' THEN 0 ELSE 1 END,g.due_date,g.created_at DESC"#,
    )
    .bind(tenant).bind(branch).bind(staff_id).bind(status).fetch_all(db).await
}

pub async fn create_coaching_goal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    staff_id: &str,
    goal_type: &str,
    metric_unit: &str,
    target_value: i64,
    current_value: Option<i64>,
    due_date: NaiveDate,
    action_title: &str,
    action_description: &str,
    priority: &str,
) -> Result<Option<CoachingGoalRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let goal_id: Option<String> = sqlx::query_scalar("INSERT INTO staff_coaching_goals(tenant_id,branch_id,staff_id,goal_type,metric_unit,target_value,current_value,due_date,created_by) SELECT $1,$2,s.id,$4,$5,$6,$7,$8,$9 FROM staff s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE RETURNING id")
        .bind(tenant).bind(branch).bind(staff_id).bind(goal_type).bind(metric_unit).bind(target_value).bind(current_value).bind(due_date).bind(actor).fetch_optional(&mut *tx).await?;
    let Some(goal_id) = goal_id else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query("INSERT INTO staff_tasks(tenant_id,branch_id,staff_id,title,description,task_type,priority,due_at,status,assigned_by,coaching_goal_id) VALUES($1,$2,$3,$4,$5,'performance',$6,($7::DATE + TIME '18:00') AT TIME ZONE 'Asia/Kolkata','open',$8,$9)")
        .bind(tenant).bind(branch).bind(staff_id).bind(action_title).bind(action_description).bind(priority).bind(due_date).bind(actor).bind(&goal_id).execute(&mut *tx).await?;
    let row = coaching_goal_in(&mut tx, tenant, branch, &goal_id).await?;
    tx.commit().await?;
    Ok(row)
}

async fn coaching_goal_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<CoachingGoalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT g.id,g.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),g.staff_id) staff_name,
          g.goal_type,g.metric_unit,g.target_value,g.current_value,g.due_date,g.status,g.created_by,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'dueAt',t.due_at,'completedAt',t.completed_at,'version',t.version) ORDER BY t.created_at)
            FROM staff_tasks t WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.coaching_goal_id=g.id),'[]'::JSONB) actions,
          g.version,g.created_at,g.updated_at
        FROM staff_coaching_goals g JOIN staff s ON s.id=g.staff_id AND s.tenant_id=g.tenant_id AND s.branch_id=g.branch_id
        WHERE g.tenant_id=$1 AND g.branch_id=$2 AND g.id=$3"#,
    )
    .bind(tenant).bind(branch).bind(id).fetch_optional(&mut **tx).await
}

pub async fn complete_coaching_action(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    version: i32,
) -> Result<Option<CoachingActionRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row: Option<CoachingActionRecord> = sqlx::query_as("UPDATE staff_tasks SET status='completed',completed_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND coaching_goal_id IS NOT NULL AND status NOT IN ('completed','cancelled') RETURNING id,coaching_goal_id,staff_id,title,status,version,completed_at")
        .bind(tenant).bind(branch).bind(id).bind(version).fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query("UPDATE staff_coaching_goals g SET status='completed',version=version+1,updated_at=NOW() WHERE g.tenant_id=$1 AND g.branch_id=$2 AND g.id=$3 AND g.status='active' AND NOT EXISTS(SELECT 1 FROM staff_tasks t WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.coaching_goal_id=g.id AND t.status NOT IN ('completed','cancelled'))")
        .bind(tenant).bind(branch).bind(&row.coaching_goal_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(row))
}

pub async fn management_recommendations(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, sqlx::Error> {
    let (products, brands, resources, unassigned) = tokio::try_join!(
        sqlx::query_as::<_, (String, String, String, i32, i32)>(
            "SELECT id,name,brand,stock_quantity,reorder_point FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND stock_quantity<=reorder_point ORDER BY (reorder_point-stock_quantity) DESC,name LIMIT 8",
        ).bind(tenant).bind(branch).fetch_all(db),
        sqlx::query_as::<_, (String, i64, i64, i64)>(
            "SELECT item.brand,SUM(line.quantity)::BIGINT,SUM(line.line_total_paise)::BIGINT,COUNT(DISTINCT item.id)::BIGINT FROM inventory_items item JOIN pos_sale_lines line ON line.tenant_id=item.tenant_id AND line.branch_id=item.branch_id AND line.item_id=item.id AND line.line_type='product' JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.brand<>'' AND sale.business_date BETWEEN $3 AND $4 AND sale.status NOT IN ('draft','open','voided','cancelled','refunded') GROUP BY item.brand ORDER BY SUM(line.line_total_paise) DESC LIMIT 5",
        ).bind(tenant).bind(branch).bind(from).bind(to).fetch_all(db),
        sqlx::query_as::<_, (String, String, i64, i64)>(
            "SELECT resource.name,resource.kind,COUNT(appointment.id)::BIGINT,COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))/60),0)::BIGINT FROM appointment_resources resource LEFT JOIN appointments appointment ON appointment.tenant_id=resource.tenant_id AND appointment.branch_id=resource.branch_id AND appointment.chair_room_id=resource.id AND appointment.start_at >= $3::DATE AND appointment.start_at < ($4::DATE + 1) AND appointment.status NOT IN ('cancelled','canceled','void','voided','no_show','no-show') WHERE resource.tenant_id=$1 AND resource.branch_id=$2 AND resource.active=TRUE GROUP BY resource.id,resource.name,resource.kind HAVING COUNT(appointment.id)>0 ORDER BY COUNT(appointment.id) DESC LIMIT 5",
        ).bind(tenant).bind(branch).bind(from).bind(to).fetch_all(db),
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::BIGINT FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND chair_room_id IS NULL AND start_at >= $3::DATE AND start_at < ($4::DATE + 1) AND status NOT IN ('cancelled','canceled','void','voided','no_show','no-show')",
        ).bind(tenant).bind(branch).bind(from).bind(to).fetch_one(db),
    )?;
    let mut rows = Vec::new();
    rows.extend(products.into_iter().map(|(id, name, brand, stock, reorder)| json!({"type":"product","title":format!("Reorder {name}"),"reason":if stock == 0 { "Out of stock" } else { "Stock reached reorder point" },"priority":if stock == 0 { "critical" } else { "high" },"evidence":{"inventoryItemId":id,"brand":brand,"stock":stock,"reorderPoint":reorder},"route":"/inventory"})));
    rows.extend(brands.into_iter().map(|(brand, quantity, revenue, products)| json!({"type":"brand","title":format!("Prioritize {brand}"),"reason":"Highest product demand in the selected period","priority":"medium","evidence":{"quantitySold":quantity,"revenuePaise":revenue,"products":products},"route":"/inventory"})));
    if unassigned > 0 {
        rows.push(json!({"type":"equipment","title":"Assign chairs or rooms","reason":"Appointments are not linked to a resource","priority":"high","evidence":{"unassignedAppointments":unassigned},"route":"/appointments"}));
    }
    rows.extend(resources.into_iter().map(|(name, kind, appointments, minutes)| json!({"type":"equipment","title":format!("Review {name} capacity"),"reason":"Most-used active resource in the selected period","priority":"medium","evidence":{"kind":kind,"appointments":appointments,"bookedMinutes":minutes},"route":"/appointments"})));
    Ok(Value::Array(rows))
}
