use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{models::common::AppError, repositories::staff_hrms_repository as repository};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobOpeningRequest {
    pub title: String,
    pub department: Option<String>,
    pub employment_type: String,
    pub openings_count: Option<i32>,
    pub description: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusRequest {
    pub status: String,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationRequest {
    pub job_opening_id: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub source: Option<String>,
    pub resume_url: Option<String>,
    pub notes: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationStageRequest {
    pub stage: String,
    pub linked_staff_id: Option<String>,
    pub probation_end_date: Option<NaiveDate>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleCaseRequest {
    pub staff_id: Option<String>,
    pub application_id: Option<String>,
    pub case_type: String,
    pub effective_date: NaiveDate,
    pub checklist: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleTaskRequest {
    pub completed: bool,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementRequest {
    pub reference: String,
    pub payroll_run_id: Option<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmploymentStatusRequest {
    pub status: String,
    pub effective_date: NaiveDate,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppraisalCycleRequest {
    pub name: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalKeyResultRequest {
    pub title: String,
    pub metric_unit: String,
    pub target_value: i64,
    pub weight_basis_points: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalTemplateRequest {
    pub name: String,
    pub description: Option<String>,
    pub key_results: Vec<GoalKeyResultRequest>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppraisalPopulationRequest {
    pub template_id: String,
    pub staff_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyResultProgressRequest {
    pub id: String,
    pub current_value: i64,
    pub evidence: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfReviewRequest {
    pub key_results: Vec<KeyResultProgressRequest>,
    pub comments: Option<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagerReviewRequest {
    pub score: i32,
    pub strengths: Option<String>,
    pub improvement_areas: Option<String>,
    pub goals: Option<String>,
    pub comments: Option<String>,
    pub coaching_goal_id: Option<String>,
    pub incentive_amount_paise: Option<i64>,
    pub incentive_evidence: Vec<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalibrationRequest {
    pub score: i32,
    pub comments: Option<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppraisalDecisionRequest {
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuccessionPlanRequest {
    pub role_title: String,
    pub target_role_id: Option<String>,
    pub critical_role: Option<bool>,
    pub incumbent_staff_id: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub notes: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuccessionCandidateRequest {
    pub staff_id: String,
    pub readiness: Option<String>,
    pub readiness_score: Option<i32>,
    pub evidence: Vec<String>,
    pub development_actions: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuccessionCandidateUpdateRequest {
    pub status: String,
    pub readiness: Option<String>,
    pub readiness_score: Option<i32>,
    pub evidence: Vec<String>,
    pub development_actions: Vec<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuccessionPlanCloseRequest {
    pub status: String,
    pub closure_note: Option<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuccessionDecisionRequest {
    pub decision: String,
    pub note: Option<String>,
    pub version: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationsIntelligenceQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

pub async fn dashboard(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    repository::dashboard(db, tenant, branch)
        .await
        .map_err(internal("load HRMS workspace"))
}

pub async fn operations_intelligence(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    p: OperationsIntelligenceQuery,
) -> Result<Value, AppError> {
    validate_report_period(p.from, p.to)?;
    repository::operations_intelligence(db, tenant, branch, p.from, p.to)
        .await
        .map_err(internal("load HR operations intelligence"))
}

pub async fn run_operations_intelligence_automations(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: OperationsIntelligenceQuery,
) -> Result<Value, AppError> {
    validate_report_period(p.from, p.to)?;
    let report = repository::operations_intelligence(db, tenant, branch, p.from, p.to)
        .await
        .map_err(internal("load HR operations intelligence"))?;
    let summary = &report["summary"];
    let attention = summary["expiryAlertCount"].as_i64().unwrap_or(0)
        + summary["onboardingOverdueCount"].as_i64().unwrap_or(0)
        + summary["missedTaskCount"].as_i64().unwrap_or(0)
        + summary["attendanceExceptionCount"].as_i64().unwrap_or(0)
        + summary["payrollExceptionCount"].as_i64().unwrap_or(0);
    let escalation_key = format!("hrms-escalation:{}:{}", p.from, p.to);
    let escalation_queued = attention > 0
        && repository::queue_operations_intelligence_notification(
            db,
            tenant,
            branch,
            actor,
            "hrms_operations_escalation",
            "HR operations items require attention",
            &format!("{attention} HR operations items require review for {} to {}", p.from, p.to),
            &json!({"idempotencyKey":escalation_key,"dateFrom":p.from,"dateTo":p.to,"summary":summary}),
            &escalation_key,
        )
        .await
        .map_err(internal("queue HR operations escalation"))?;
    let monthly_key = format!("hrms-monthly:{}:{}", p.from, p.to);
    let health_text = summary["hrHealthScore"]
        .as_f64()
        .map(|score| format!("{score:.2}%"))
        .unwrap_or_else(|| {
            format!(
                "insufficient evidence ({}% coverage)",
                summary["evidenceCoveragePercent"].as_f64().unwrap_or(0.0)
            )
        });
    let monthly_queued = repository::queue_operations_intelligence_notification(
        db,
        tenant,
        branch,
        actor,
        "hrms_monthly_owner_summary",
        "Monthly HR operations summary",
        &format!("HR health: {health_text} | Items requiring attention: {attention}"),
        &json!({"idempotencyKey":monthly_key,"dateFrom":p.from,"dateTo":p.to,"summary":summary}),
        &monthly_key,
    )
    .await
    .map_err(internal("queue monthly HR owner summary"))?;
    Ok(json!({
        "escalationsQueued": i32::from(escalation_queued),
        "monthlySummariesQueued": i32::from(monthly_queued),
        "requiresAttention": attention,
        "transactionalStaffChanges": false,
        "payrollChanges": false
    }))
}

pub async fn run_scheduled_operations_intelligence(db: &PgPool) -> Result<Value, AppError> {
    let today = Utc::now().date_naive();
    let current_month = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .ok_or_else(|| AppError::internal("failed to resolve HRMS reporting month"))?;
    let to = current_month
        .pred_opt()
        .ok_or_else(|| AppError::internal("failed to resolve HRMS reporting period"))?;
    let from = NaiveDate::from_ymd_opt(to.year(), to.month(), 1)
        .ok_or_else(|| AppError::internal("failed to resolve HRMS reporting period"))?;
    let scopes = repository::active_hrms_scopes(db)
        .await
        .map_err(internal("load active HRMS scopes"))?;
    let mut completed = 0;
    let mut failed = 0;
    for (tenant, branch) in &scopes {
        match run_operations_intelligence_automations(
            db,
            tenant,
            branch,
            "system:hrms-monthly-summary",
            OperationsIntelligenceQuery { from, to },
        )
        .await
        {
            Ok(_) => completed += 1,
            Err(error) => {
                failed += 1;
                tracing::warn!(tenant_id = tenant, branch_id = branch, error = ?error, "scheduled HRMS operations intelligence failed");
            }
        }
    }
    Ok(
        json!({"periodStart":from,"periodEnd":to,"scopeCount":scopes.len(),"completed":completed,"failed":failed}),
    )
}

pub async fn create_job_opening(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: JobOpeningRequest,
) -> Result<Value, AppError> {
    let title = required(&p.title, 160, "job title")?;
    let department = optional(p.department.as_deref(), 120, "department")?;
    let employment = one_of(
        &p.employment_type,
        &["full_time", "part_time", "contract", "intern"],
        "employment type",
    )?;
    let count = p.openings_count.unwrap_or(1);
    if !(1..=100).contains(&count) {
        return Err(AppError::validation(
            "openingsCount must be between 1 and 100",
        ));
    }
    let description = optional(p.description.as_deref(), 4000, "description")?;
    repository::create_job_opening(
        db,
        tenant,
        branch,
        actor,
        &title,
        &department,
        &employment,
        count,
        &description,
    )
    .await
    .map_err(internal("create job opening"))
}
pub async fn update_job_opening_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    p: StatusRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let status = one_of(&p.status, &["open", "paused", "closed"], "job status")?;
    repository::update_job_opening_status(db, tenant, branch, id.trim(), &status, p.version)
        .await
        .map_err(internal("update job opening"))?
        .ok_or_else(stale)
}
pub async fn create_application(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: ApplicationRequest,
) -> Result<Value, AppError> {
    let opening = required(&p.job_opening_id, 160, "job opening")?;
    let first = required(&p.first_name, 120, "first name")?;
    let last = optional(p.last_name.as_deref(), 120, "last name")?;
    let email = optional(p.email.as_deref(), 254, "email")?.to_ascii_lowercase();
    let phone = optional(p.phone.as_deref(), 40, "phone")?;
    if email.is_empty() && phone.is_empty() {
        return Err(AppError::validation("email or phone is required"));
    }
    if !email.is_empty() && (!email.contains('@') || email.chars().any(char::is_whitespace)) {
        return Err(AppError::validation("email is invalid"));
    }
    let source = optional(p.source.as_deref(), 120, "source")?;
    let resume = optional(p.resume_url.as_deref(), 2048, "resume URL")?;
    let notes = optional(p.notes.as_deref(), 4000, "notes")?;
    repository::create_application(
        db, tenant, branch, actor, &opening, &first, &last, &email, &phone, &source, &resume,
        &notes,
    )
    .await
    .map_err(write_error(
        "active application already exists",
        "create application",
    ))?
    .ok_or_else(|| AppError::validation("job opening is not open"))
}
pub async fn update_application_stage(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    p: ApplicationStageRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let stage = one_of(
        &p.stage,
        &[
            "screening",
            "interview",
            "offer",
            "hired",
            "rejected",
            "withdrawn",
        ],
        "application stage",
    )?;
    let staff = p
        .linked_staff_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if stage == "hired" && staff.is_none() {
        return Err(AppError::validation(
            "linkedStaffId is required when hiring",
        ));
    }
    if stage != "hired" && p.probation_end_date.is_some() {
        return Err(AppError::validation(
            "probationEndDate is only valid when hiring",
        ));
    }
    repository::update_application_stage(
        db,
        tenant,
        branch,
        id.trim(),
        &stage,
        staff,
        p.probation_end_date,
        p.version,
    )
    .await
    .map_err(internal("update application stage"))?
    .ok_or_else(stale)
}
pub async fn complete_settlement(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    p: SettlementRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let reference = required(&p.reference, 240, "final settlement reference")?;
    let payroll_run_id = optional(p.payroll_run_id.as_deref(), 160, "payroll run")?;
    repository::complete_settlement(
        db,
        tenant,
        branch,
        id.trim(),
        &reference,
        &payroll_run_id,
        p.version,
    )
    .await
    .map_err(internal("complete final settlement handoff"))?
    .ok_or_else(stale)
}
pub async fn update_employment_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    p: EmploymentStatusRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let status = one_of(
        &p.status,
        &["confirmed", "notice_period"],
        "employment status",
    )?;
    repository::update_employment_status(
        db,
        tenant,
        branch,
        id.trim(),
        &status,
        p.effective_date,
        p.version,
    )
    .await
    .map_err(internal("update employment status"))?
    .ok_or_else(stale)
}
pub async fn create_lifecycle_case(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: LifecycleCaseRequest,
) -> Result<Value, AppError> {
    let case_type = one_of(&p.case_type, &["onboarding", "offboarding"], "case type")?;
    let staff = p
        .staff_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let application = p
        .application_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if staff.is_none() && application.is_none() {
        return Err(AppError::validation("staffId or applicationId is required"));
    }
    if case_type == "offboarding" && staff.is_none() {
        return Err(AppError::validation("staffId is required for offboarding"));
    }
    if p.checklist.is_empty() || p.checklist.len() > 50 {
        return Err(AppError::validation("checklist must contain 1 to 50 tasks"));
    }
    let mut tasks = Vec::with_capacity(p.checklist.len());
    for title in p.checklist {
        let title = required(&title, 240, "checklist task")?;
        tasks.push(json!({"id":Uuid::new_v4().to_string(),"title":title,"completed":false,"completedAt":Value::Null}));
    }
    repository::create_lifecycle_case(
        db,
        tenant,
        branch,
        actor,
        staff,
        application,
        &case_type,
        p.effective_date,
        &Value::Array(tasks),
    )
    .await
    .map_err(write_error(
        "an active lifecycle case already exists",
        "create lifecycle case",
    ))?
    .ok_or_else(|| AppError::validation("staff or application is invalid"))
}
pub async fn update_lifecycle_task(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    task: &str,
    p: LifecycleTaskRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    repository::update_lifecycle_task(
        db,
        tenant,
        branch,
        id.trim(),
        task.trim(),
        p.completed,
        p.version,
    )
    .await
    .map_err(internal("update lifecycle task"))?
    .ok_or_else(stale)
}
pub async fn create_appraisal_cycle(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: AppraisalCycleRequest,
) -> Result<Value, AppError> {
    let name = required(&p.name, 160, "cycle name")?;
    if p.period_end < p.period_start {
        return Err(AppError::validation(
            "periodEnd must be on or after periodStart",
        ));
    }
    repository::create_appraisal_cycle(
        db,
        tenant,
        branch,
        actor,
        &name,
        p.period_start,
        p.period_end,
    )
    .await
    .map_err(write_error(
        "appraisal cycle already exists",
        "create appraisal cycle",
    ))
}
pub async fn update_appraisal_cycle_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    p: StatusRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let status = one_of(
        &p.status,
        &["active", "review", "calibration", "closed"],
        "cycle status",
    )?;
    repository::update_appraisal_cycle_status(db, tenant, branch, id.trim(), &status, p.version)
        .await
        .map_err(internal("update appraisal cycle"))?
        .ok_or_else(stale)
}
pub async fn create_goal_template(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: GoalTemplateRequest,
) -> Result<Value, AppError> {
    let name = required(&p.name, 160, "template name")?;
    let description = optional(p.description.as_deref(), 2000, "description")?;
    let key_results = goal_key_results(p.key_results)?;
    repository::create_goal_template(db, tenant, branch, actor, &name, &description, &key_results)
        .await
        .map_err(write_error(
            "goal template already exists",
            "create goal template",
        ))
}

pub async fn populate_appraisal_cycle(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: AppraisalPopulationRequest,
) -> Result<Value, AppError> {
    let template = required(&p.template_id, 160, "goal template")?;
    if p.staff_ids.is_empty() || p.staff_ids.len() > 500 {
        return Err(AppError::validation(
            "staffIds must contain 1 to 500 employees",
        ));
    }
    let mut staff_ids = Vec::with_capacity(p.staff_ids.len());
    for staff in p.staff_ids {
        let staff = required(&staff, 160, "employee")?;
        if !staff_ids.contains(&staff) {
            staff_ids.push(staff);
        }
    }
    let row = repository::populate_appraisal_cycle(
        db,
        tenant,
        branch,
        id.trim(),
        &template,
        &staff_ids,
        actor,
    )
    .await
    .map_err(internal("populate appraisal cycle"))?;
    if row
        .get("insertedCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        == 0
    {
        return Err(AppError::validation(
            "cycle, template, or employees are invalid or already assigned",
        ));
    }
    Ok(row)
}

pub async fn self_appraisals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
) -> Result<Vec<Value>, AppError> {
    repository::self_appraisals(db, tenant, branch, user)
        .await
        .map_err(internal("load self appraisals"))
}

pub async fn submit_self_review(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
    id: &str,
    p: SelfReviewRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let comments = optional(p.comments.as_deref(), 4000, "self comments")?;
    let template = repository::self_review_key_results(db, tenant, branch, id.trim(), user)
        .await
        .map_err(internal("load appraisal key results"))?
        .ok_or_else(stale)?;
    let (results, score) = measured_key_results(&template, p.key_results)?;
    repository::submit_self_review(
        db,
        tenant,
        branch,
        id.trim(),
        user,
        &results,
        score,
        &comments,
        p.version,
    )
    .await
    .map_err(internal("submit self review"))?
    .ok_or_else(stale)
}

pub async fn submit_manager_review(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: ManagerReviewRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    rating_score(p.score, "manager score")?;
    let strengths = optional(p.strengths.as_deref(), 4000, "strengths")?;
    let improvement = optional(p.improvement_areas.as_deref(), 4000, "improvement areas")?;
    let goals = optional(p.goals.as_deref(), 4000, "goals")?;
    let comments = optional(p.comments.as_deref(), 4000, "manager comments")?;
    let coaching_goal = optional(p.coaching_goal_id.as_deref(), 160, "coaching goal")?;
    let incentive = p.incentive_amount_paise.unwrap_or(0);
    if incentive < 0 {
        return Err(AppError::validation(
            "incentiveAmountPaise cannot be negative",
        ));
    }
    let evidence = strings(p.incentive_evidence, 20, 500, "incentive evidence")?;
    let (profit_rows, contribution, dirty_days) =
        repository::contribution_profit(db, tenant, branch, id.trim())
            .await
            .map_err(internal("load appraisal profitability evidence"))?
            .ok_or_else(stale)?;
    validate_incentive(incentive, &evidence, profit_rows, contribution, dirty_days)?;
    repository::submit_manager_review(
        db,
        tenant,
        branch,
        id.trim(),
        actor,
        p.score,
        &strengths,
        &improvement,
        &goals,
        &comments,
        &coaching_goal,
        incentive,
        &evidence,
        contribution,
        p.version,
    )
    .await
    .map_err(internal("submit manager appraisal"))?
    .ok_or_else(stale)
}

pub async fn calibrate_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: CalibrationRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    rating_score(p.score, "calibrated score")?;
    let comments = required(
        p.comments.as_deref().unwrap_or(""),
        4000,
        "calibration comments",
    )?;
    repository::calibrate_appraisal(
        db,
        tenant,
        branch,
        id.trim(),
        actor,
        p.score,
        &comments,
        p.version,
    )
    .await
    .map_err(internal("calibrate appraisal"))?
    .ok_or_else(stale)
}

pub async fn approve_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: AppraisalDecisionRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let score = repository::appraisal_calibrated_score(db, tenant, branch, id.trim())
        .await
        .map_err(internal("load calibrated appraisal"))?
        .ok_or_else(stale)?;
    let rating = rating_label(score);
    repository::approve_appraisal(db, tenant, branch, id.trim(), actor, rating, p.version)
        .await
        .map_err(internal("approve appraisal"))?
        .ok_or_else(stale)
}

pub async fn acknowledge_appraisal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user: &str,
    id: &str,
    p: AppraisalDecisionRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    repository::acknowledge_appraisal(db, tenant, branch, id.trim(), user, p.version)
        .await
        .map_err(internal("acknowledge appraisal"))?
        .ok_or_else(stale)
}
pub async fn create_succession_plan(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    p: SuccessionPlanRequest,
) -> Result<Value, AppError> {
    let role = required(&p.role_title, 160, "role title")?;
    let target_role = p
        .target_role_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let incumbent = p
        .incumbent_staff_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let notes = optional(p.notes.as_deref(), 4000, "notes")?;
    repository::create_succession_plan(
        db,
        tenant,
        branch,
        actor,
        &role,
        target_role,
        p.critical_role.unwrap_or(true),
        incumbent,
        p.target_date,
        &notes,
    )
    .await
    .map_err(internal("create succession plan"))?
    .ok_or_else(|| AppError::validation("incumbent employee is invalid"))
}
pub async fn close_succession_plan(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: SuccessionPlanCloseRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    if p.status.trim() != "closed" {
        return Err(AppError::validation(
            "succession plan status must be closed",
        ));
    }
    let closure_note = optional(p.closure_note.as_deref(), 2000, "closure note")?;
    repository::close_succession_plan(
        db,
        tenant,
        branch,
        actor,
        id.trim(),
        p.version,
        &closure_note,
    )
    .await
    .map_err(internal("close succession plan"))?
    .ok_or_else(|| {
        AppError::conflict(
            "resolve all nominations and approve at least one successor before closing",
        )
    })
}
pub async fn create_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    plan: &str,
    p: SuccessionCandidateRequest,
) -> Result<Value, AppError> {
    let staff = required(&p.staff_id, 160, "employee")?;
    let evidence = strings(p.evidence, 20, 500, "evidence")?;
    let actions = strings(p.development_actions, 20, 500, "development action")?;
    repository::create_succession_candidate(
        db,
        tenant,
        branch,
        actor,
        plan.trim(),
        &staff,
        &evidence,
        &actions,
    )
    .await
    .map_err(write_error(
        "employee is already in this succession plan",
        "add succession candidate",
    ))?
    .ok_or_else(|| AppError::validation("plan or employee is invalid"))
}
pub async fn update_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: SuccessionCandidateUpdateRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let status = one_of(&p.status, &["proposed", "removed"], "candidate status")?;
    let evidence = strings(p.evidence, 20, 500, "evidence")?;
    let actions = strings(p.development_actions, 20, 500, "development action")?;
    repository::update_succession_candidate(
        db,
        tenant,
        branch,
        actor,
        id.trim(),
        &status,
        &evidence,
        &actions,
        p.version,
    )
    .await
    .map_err(internal("update succession candidate"))?
    .ok_or_else(stale)
}

pub async fn decide_succession_candidate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    p: SuccessionDecisionRequest,
) -> Result<Value, AppError> {
    version(p.version)?;
    let decision = one_of(&p.decision, &["approved", "rejected"], "decision")?;
    let note = optional(p.note.as_deref(), 2000, "decision note")?;
    repository::decide_succession_candidate(
        db,
        tenant,
        branch,
        actor,
        id.trim(),
        &decision,
        &note,
        p.version,
    )
    .await
    .map_err(internal("decide succession candidate"))?
    .ok_or_else(|| {
        AppError::conflict(
            "a different human approver and at least 50% evidence coverage are required",
        )
    })
}

pub async fn promotion_readiness_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, AppError> {
    repository::promotion_readiness_report(db, tenant, branch)
        .await
        .map_err(internal("load promotion readiness report"))
}

fn goal_key_results(values: Vec<GoalKeyResultRequest>) -> Result<Value, AppError> {
    if values.is_empty() || values.len() > 20 {
        return Err(AppError::validation(
            "keyResults must contain 1 to 20 entries",
        ));
    }
    let mut out = Vec::with_capacity(values.len());
    let mut titles = Vec::with_capacity(values.len());
    let mut total_weight = 0_i32;
    for value in values {
        let title = required(&value.title, 240, "key result title")?;
        if titles.iter().any(|existing| existing == &title) {
            return Err(AppError::validation("key result titles must be unique"));
        }
        let unit = one_of(
            &value.metric_unit,
            &["count", "percent", "minutes", "paise"],
            "key result metric unit",
        )?;
        if value.target_value <= 0 || !(1..=10_000).contains(&value.weight_basis_points) {
            return Err(AppError::validation(
                "key result target or weight is invalid",
            ));
        }
        total_weight += value.weight_basis_points;
        titles.push(title.clone());
        out.push(json!({"id":Uuid::new_v4().to_string(),"title":title,"metricUnit":unit,"targetValue":value.target_value,"weightBasisPoints":value.weight_basis_points,"currentValue":Value::Null,"evidence":""}));
    }
    if total_weight != 10_000 {
        return Err(AppError::validation(
            "key result weights must total 10000 basis points",
        ));
    }
    Ok(Value::Array(out))
}

fn measured_key_results(
    template: &Value,
    progress: Vec<KeyResultProgressRequest>,
) -> Result<(Value, i32), AppError> {
    let definitions = template
        .as_array()
        .ok_or_else(|| AppError::validation("appraisal key results are invalid"))?;
    if definitions.len() != progress.len() {
        return Err(AppError::validation("every key result must be measured"));
    }
    let mut weighted = 0_i128;
    let mut results = Vec::with_capacity(definitions.len());
    for definition in definitions {
        let id = definition.get("id").and_then(Value::as_str).unwrap_or("");
        let target = definition
            .get("targetValue")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let weight = definition
            .get("weightBasisPoints")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let matches = progress
            .iter()
            .filter(|item| item.id.trim() == id)
            .collect::<Vec<_>>();
        if id.is_empty() || target <= 0 || weight <= 0 || matches.len() != 1 {
            return Err(AppError::validation(
                "key result progress does not match the assigned template",
            ));
        }
        let item = matches[0];
        if item.current_value < 0 {
            return Err(AppError::validation(
                "key result currentValue cannot be negative",
            ));
        }
        let evidence = optional(item.evidence.as_deref(), 1000, "key result evidence")?;
        let mut result = definition
            .as_object()
            .cloned()
            .ok_or_else(|| AppError::validation("appraisal key result is invalid"))?;
        result.insert("currentValue".to_string(), json!(item.current_value));
        result.insert("evidence".to_string(), json!(evidence));
        results.push(Value::Object(result));
        weighted += i128::from(item.current_value.min(target)) * 100 * i128::from(weight)
            / i128::from(target);
    }
    Ok((Value::Array(results), (weighted / 10_000) as i32))
}

fn validate_incentive(
    amount: i64,
    evidence: &Value,
    profit_rows: i64,
    contribution: i64,
    dirty_days: i64,
) -> Result<(), AppError> {
    if amount == 0 {
        return Ok(());
    }
    if evidence.as_array().is_none_or(Vec::is_empty) {
        return Err(AppError::validation("incentive evidence is required"));
    }
    if dirty_days > 0 {
        return Err(AppError::validation(
            "CRM profit evidence is pending refresh for this appraisal period",
        ));
    }
    if profit_rows == 0 || contribution <= 0 {
        return Err(AppError::validation(
            "CRM profit evidence is unavailable for this appraisal period",
        ));
    }
    if amount > contribution {
        return Err(AppError::validation(
            "incentive exceeds CRM contribution profit for this period",
        ));
    }
    Ok(())
}

fn rating_score(value: i32, field: &str) -> Result<(), AppError> {
    if (0..=100).contains(&value) {
        Ok(())
    } else {
        Err(AppError::validation(format!(
            "{field} must be between 0 and 100"
        )))
    }
}

fn rating_label(score: i32) -> &'static str {
    match score {
        90..=100 => "outstanding",
        75..=89 => "exceeds_expectations",
        60..=74 => "meets_expectations",
        40..=59 => "needs_improvement",
        _ => "unsatisfactory",
    }
}

fn required(value: &str, max: usize, field: &str) -> Result<String, AppError> {
    let v = value.trim();
    if v.is_empty() || v.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} is required and must be at most {max} characters"
        )));
    }
    Ok(v.to_string())
}

#[cfg(test)]
mod tests {
    use super::{measured_key_results, validate_incentive, KeyResultProgressRequest};
    use serde_json::json;

    #[test]
    fn appraisal_score_and_profit_guard_use_measured_server_evidence() {
        let template = json!([
            {"id":"revenue","targetValue":100,"weightBasisPoints":6000},
            {"id":"retention","targetValue":50,"weightBasisPoints":4000}
        ]);
        let progress = vec![
            KeyResultProgressRequest {
                id: "revenue".into(),
                current_value: 80,
                evidence: None,
            },
            KeyResultProgressRequest {
                id: "retention".into(),
                current_value: 50,
                evidence: Some("CRM retention report".into()),
            },
        ];
        let (_, score) = measured_key_results(&template, progress).unwrap();
        assert_eq!(score, 88);
        assert!(validate_incentive(5_000, &json!(["approved rule"]), 1, 10_000, 0).is_ok());
        assert!(validate_incentive(15_000, &json!(["approved rule"]), 1, 10_000, 0).is_err());
        assert!(validate_incentive(5_000, &json!(["approved rule"]), 1, 10_000, 1).is_err());
    }
}
fn optional(value: Option<&str>, max: usize, field: &str) -> Result<String, AppError> {
    let v = value.unwrap_or("").trim();
    if v.chars().count() > max {
        return Err(AppError::validation(format!("{field} is too long")));
    }
    Ok(v.to_string())
}
fn validate_report_period(from: NaiveDate, to: NaiveDate) -> Result<(), AppError> {
    if to < from || (to - from).num_days() > 366 {
        Err(AppError::validation(
            "report period must be valid and no longer than 366 days",
        ))
    } else {
        Ok(())
    }
}
fn one_of(value: &str, allowed: &[&str], field: &str) -> Result<String, AppError> {
    let v = value.trim().to_ascii_lowercase();
    if allowed.contains(&v.as_str()) {
        Ok(v)
    } else {
        Err(AppError::validation(format!("{field} is invalid")))
    }
}
fn version(value: i32) -> Result<(), AppError> {
    if value < 1 {
        Err(AppError::validation("version is required"))
    } else {
        Ok(())
    }
}
fn score(value: i32) -> Result<(), AppError> {
    if !(0..=100).contains(&value) {
        Err(AppError::validation(
            "readinessScore must be between 0 and 100",
        ))
    } else {
        Ok(())
    }
}
fn strings(
    values: Vec<String>,
    max_items: usize,
    max_len: usize,
    field: &str,
) -> Result<Value, AppError> {
    if values.len() > max_items {
        return Err(AppError::validation(format!("too many {field} entries")));
    }
    let mut out = Vec::new();
    for value in values {
        out.push(Value::String(required(&value, max_len, field)?));
    }
    Ok(Value::Array(out))
}
fn stale() -> AppError {
    AppError::conflict("record changed or transition is not allowed; reload and try again")
}
fn internal(action: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |_| AppError::internal(format!("failed to {action}"))
}
fn write_error(
    conflict: &'static str,
    action: &'static str,
) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| {
        if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23505") {
            AppError::conflict(conflict)
        } else {
            AppError::internal(format!("failed to {action}"))
        }
    }
}
