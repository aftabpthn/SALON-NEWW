use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::staff_operations_repository::{
        self as repository, BranchTransferRecord, OperationCleaningScoreRow,
        OperationHygieneComplianceRow, OperationMeetingAttendanceRow, OperationReportOperationRow,
        PerformanceReviewRecord, ShiftSwapRecord, SkillLicenseRecord,
        StaffOperationAttendanceRecord, StaffOperationScheduleRecord, StaffOperationTaskRecord,
        StaffOperationTemplateRecord,
    },
};

const DECISIONS: &[&str] = &["approved", "rejected"];
const TRANSFER_TYPES: &[&str] = &["permanent", "deputation"];
const LICENSE_STATUSES: &[&str] = &["pending", "verified", "rejected", "expired"];
const REVIEW_STATUSES: &[&str] = &["draft", "shared", "acknowledged", "closed"];
const OPERATION_TYPES: &[&str] = &[
    "opening_checklist",
    "closing_checklist",
    "tool_sanitization",
    "stock_linen_check",
    "cleaning_task",
    "staff_meeting",
    "performance_review",
    "training_session",
    "deep_cleaning",
    "hygiene_audit",
    "custom",
];
const OPERATION_SCHEDULE_STATUSES: &[&str] =
    &["planned", "in_progress", "completed", "missed", "cancelled"];
const OPERATION_TASK_STATUSES: &[&str] = &[
    "planned",
    "in_progress",
    "completed",
    "missed",
    "cancelled",
    "approved",
    "rejected",
];
const OPERATION_ATTENDANCE_STATUSES: &[&str] = &["pending", "present", "absent", "late", "excused"];
const OPERATION_FREQUENCIES: &[&str] = &["daily", "weekly", "fortnightly", "monthly", "custom"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationTaskRequest {
    pub staff_id: String,
    pub task_title: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationTaskPatchRequest {
    pub status: Option<String>,
    pub proof_url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationAttendanceRequest {
    pub staff_id: String,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationTemplateRequest {
    pub name: String,
    pub operation_type: String,
    pub frequency: String,
    pub checklist_json: Option<Value>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationScheduleRequest {
    pub template_id: Option<String>,
    pub title: String,
    pub operation_type: String,
    pub frequency: String,
    pub scheduled_date: NaiveDate,
    pub scheduled_time: Option<NaiveTime>,
    pub assigned_staff_ids: Option<Vec<String>>,
    pub owner_user_id: Option<String>,
    pub checklist_json: Option<Value>,
    pub notes: Option<String>,
    pub until: Option<NaiveDate>,
    pub occurrences: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSchedulePatchRequest {
    pub title: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time: Option<NaiveTime>,
    pub assigned_staff_ids: Option<Vec<String>>,
    pub status: Option<String>,
    pub checklist_json: Option<Value>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationAutomationRequest {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationReportSummary {
    pub completed_count: i64,
    pub missed_count: i64,
    pub pending_approval_count: i64,
    pub meeting_present_count: i64,
    pub meeting_absent_count: i64,
    pub average_cleaning_score: f64,
    pub hygiene_compliance_percent: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationReportResponse {
    pub date_from: NaiveDate,
    pub date_to: NaiveDate,
    pub summary: OperationReportSummary,
    pub completed_operations: Vec<OperationReportOperationRow>,
    pub missed_operations: Vec<OperationReportOperationRow>,
    pub pending_approvals: Vec<OperationReportOperationRow>,
    pub meeting_attendance: Vec<OperationMeetingAttendanceRow>,
    pub cleaning_scores: Vec<OperationCleaningScoreRow>,
    pub hygiene_compliance: Vec<OperationHygieneComplianceRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationAutomationRunResponse {
    pub escalations_queued: i64,
    pub meeting_reminders_queued: i64,
    pub cleaning_reminders_queued: i64,
    pub monthly_summaries_queued: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSwapRequest {
    pub schedule_id: String,
    pub to_staff_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRequest {
    pub decision: String,
    pub note: Option<String>,
    pub version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTransferRequest {
    pub target_branch_id: String,
    pub staff_id: String,
    pub role_id: String,
    pub transfer_type: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLicenseRequest {
    pub id: Option<String>,
    pub staff_id: String,
    pub skill_name: String,
    pub skill_level: Option<i16>,
    pub issuer: Option<String>,
    pub license_number: Option<String>,
    pub issued_on: Option<NaiveDate>,
    pub expires_on: Option<NaiveDate>,
    pub verification_status: Option<String>,
    pub document_url: Option<String>,
    pub notes: Option<String>,
    pub version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceReviewRequest {
    pub id: Option<String>,
    pub staff_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub score: Option<i32>,
    pub strengths: Option<String>,
    pub improvement_areas: Option<String>,
    pub goals: Option<String>,
    pub employee_comments: Option<String>,
    pub status: Option<String>,
    pub version: Option<i32>,
}

pub async fn list_shift_swaps(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    staff_id: &str,
) -> Result<Vec<ShiftSwapRecord>, AppError> {
    let status = optional_enum(
        status,
        &["pending", "approved", "rejected", "cancelled"],
        "swap status",
    )?;
    repository::list_shift_swaps(db, tenant_id, branch_id, &status, staff_id.trim())
        .await
        .map_err(internal("load shift swaps"))
}

pub async fn create_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    source_staff_id: &str,
    request: ShiftSwapRequest,
) -> Result<ShiftSwapRecord, AppError> {
    let schedule_id = required(&request.schedule_id, 160, "schedule")?;
    let to_staff_id = required(&request.to_staff_id, 160, "target employee")?;
    let reason = optional(request.reason.as_deref(), 1000, "reason")?;
    repository::create_shift_swap(
        db,
        tenant_id,
        branch_id,
        &schedule_id,
        &to_staff_id,
        &reason,
        actor_user_id,
        source_staff_id,
    )
    .await
    .map_err(write_error(
        "a pending swap already exists",
        "create shift swap",
    ))?
    .ok_or_else(|| AppError::validation("schedule or target employee is invalid"))
}

pub async fn decide_shift_swap_target(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    target_staff_id: &str,
    actor_user_id: &str,
    request: DecisionRequest,
) -> Result<ShiftSwapRecord, AppError> {
    let decision = required_enum(&request.decision, &["accepted", "rejected"], "decision")?;
    let note = optional(request.note.as_deref(), 1000, "decision note")?;
    if decision == "rejected" && note.is_empty() {
        return Err(AppError::validation("rejection note is required"));
    }
    repository::decide_shift_swap_target(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        target_staff_id,
        &decision,
        &note,
        actor_user_id,
        positive_version(request.version)?,
    )
    .await
    .map_err(internal("decide target shift swap"))?
    .ok_or_else(stale)
}

pub async fn decide_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    request: DecisionRequest,
) -> Result<ShiftSwapRecord, AppError> {
    let decision = required_enum(&request.decision, DECISIONS, "decision")?;
    let note = optional(request.note.as_deref(), 1000, "decision note")?;
    repository::decide_shift_swap(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        &decision,
        &note,
        actor_user_id,
        positive_version(request.version)?,
    )
    .await
    .map_err(|error| {
        if error.to_string().contains("already has a schedule") {
            AppError::conflict("target employee already has a schedule for this date")
        } else {
            AppError::internal("failed to decide shift swap")
        }
    })?
    .ok_or_else(stale)
}

pub async fn list_branch_transfers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<BranchTransferRecord>, AppError> {
    let status = optional_enum(
        status,
        &["pending", "approved", "rejected", "cancelled"],
        "transfer status",
    )?;
    repository::list_branch_transfers(db, tenant_id, branch_id, &status)
        .await
        .map_err(internal("load branch transfers"))
}

pub async fn create_branch_transfer(
    db: &PgPool,
    tenant_id: &str,
    source_branch_id: &str,
    actor_user_id: &str,
    request: BranchTransferRequest,
) -> Result<BranchTransferRecord, AppError> {
    let target_branch_id = required(&request.target_branch_id, 160, "target branch")?;
    let staff_id = required(&request.staff_id, 160, "employee")?;
    let role_id = required(&request.role_id, 160, "role")?;
    let transfer_type = required_enum(&request.transfer_type, TRANSFER_TYPES, "transfer type")?;
    if transfer_type == "deputation" {
        let (Some(from), Some(until)) = (request.valid_from, request.valid_until) else {
            return Err(AppError::validation(
                "deputation requires validFrom and validUntil",
            ));
        };
        if until < from {
            return Err(AppError::validation(
                "validUntil must be on or after validFrom",
            ));
        }
    } else if request.valid_from.is_some() || request.valid_until.is_some() {
        return Err(AppError::validation(
            "permanent transfer cannot have deputation dates",
        ));
    }
    let reason = optional(request.reason.as_deref(), 1000, "reason")?;
    repository::create_branch_transfer(
        db,
        tenant_id,
        source_branch_id,
        &target_branch_id,
        &staff_id,
        &role_id,
        &transfer_type,
        request.valid_from,
        request.valid_until,
        &reason,
        actor_user_id,
    )
    .await
    .map_err(write_error(
        "a pending transfer already exists",
        "create branch transfer",
    ))?
    .ok_or_else(|| AppError::validation("employee, target branch or role is invalid"))
}

pub async fn decide_branch_transfer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    request: DecisionRequest,
) -> Result<BranchTransferRecord, AppError> {
    let decision = required_enum(&request.decision, DECISIONS, "decision")?;
    let note = optional(request.note.as_deref(), 1000, "decision note")?;
    repository::decide_branch_transfer(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        &decision,
        &note,
        actor_user_id,
        positive_version(request.version)?,
    )
    .await
    .map_err(write_error(
        "target branch has conflicting staff configuration",
        "decide branch transfer",
    ))?
    .ok_or_else(stale)
}

pub async fn list_skill_licenses(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<SkillLicenseRecord>, AppError> {
    repository::list_skill_licenses(db, tenant_id, branch_id, staff_id.trim())
        .await
        .map_err(internal("load skill licenses"))
}

pub async fn save_skill_license(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: SkillLicenseRequest,
) -> Result<SkillLicenseRecord, AppError> {
    if let (Some(issued), Some(expires)) = (request.issued_on, request.expires_on) {
        if expires < issued {
            return Err(AppError::validation(
                "expiresOn must be on or after issuedOn",
            ));
        }
    }
    if request
        .id
        .as_deref()
        .is_some_and(|id| !id.trim().is_empty())
        && request.version.unwrap_or_default() < 1
    {
        return Err(AppError::validation(
            "version is required when updating a license",
        ));
    }
    let staff_id = required(&request.staff_id, 160, "employee")?;
    let skill_name = required(&request.skill_name, 200, "skill name")?;
    let skill_level = request.skill_level.unwrap_or(1);
    if !(1..=5).contains(&skill_level) {
        return Err(AppError::validation("skill level must be between 1 and 5"));
    }
    let issuer = optional(request.issuer.as_deref(), 200, "issuer")?;
    let license_number = optional(request.license_number.as_deref(), 200, "license number")?;
    let status = required_enum(
        request.verification_status.as_deref().unwrap_or("pending"),
        LICENSE_STATUSES,
        "verification status",
    )?;
    let document_url = optional(request.document_url.as_deref(), 2000, "document URL")?;
    let notes = optional(request.notes.as_deref(), 2000, "notes")?;
    repository::save_skill_license(
        db,
        tenant_id,
        branch_id,
        request.id.as_deref().map(str::trim),
        &staff_id,
        &skill_name,
        skill_level,
        &issuer,
        &license_number,
        request.issued_on,
        request.expires_on,
        &status,
        &document_url,
        &notes,
        actor_user_id,
        request.version,
    )
    .await
    .map_err(write_error(
        "license number already exists",
        "save skill license",
    ))?
    .ok_or_else(stale)
}

pub async fn list_reviews(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<PerformanceReviewRecord>, AppError> {
    repository::list_reviews(db, tenant_id, branch_id, staff_id.trim())
        .await
        .map_err(internal("load performance reviews"))
}

pub async fn save_review(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: PerformanceReviewRequest,
) -> Result<PerformanceReviewRecord, AppError> {
    if request.period_end < request.period_start {
        return Err(AppError::validation(
            "periodEnd must be on or after periodStart",
        ));
    }
    if request
        .score
        .is_some_and(|score| !(0..=100).contains(&score))
    {
        return Err(AppError::validation("score must be between 0 and 100"));
    }
    if request
        .id
        .as_deref()
        .is_some_and(|id| !id.trim().is_empty())
        && request.version.unwrap_or_default() < 1
    {
        return Err(AppError::validation(
            "version is required when updating a review",
        ));
    }
    let staff_id = required(&request.staff_id, 160, "employee")?;
    let status = required_enum(
        request.status.as_deref().unwrap_or("draft"),
        REVIEW_STATUSES,
        "review status",
    )?;
    let strengths = optional(request.strengths.as_deref(), 4000, "strengths")?;
    let improvement = optional(
        request.improvement_areas.as_deref(),
        4000,
        "improvement areas",
    )?;
    let goals = optional(request.goals.as_deref(), 4000, "goals")?;
    let comments = optional(
        request.employee_comments.as_deref(),
        4000,
        "employee comments",
    )?;
    repository::save_review(
        db,
        tenant_id,
        branch_id,
        request.id.as_deref().map(str::trim),
        &staff_id,
        actor_user_id,
        request.period_start,
        request.period_end,
        request.score,
        &strengths,
        &improvement,
        &goals,
        &comments,
        &status,
        request.version,
    )
    .await
    .map_err(internal("save performance review"))?
    .ok_or_else(stale)
}

pub async fn list_operation_templates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_type: &str,
    active_only: bool,
) -> Result<Vec<StaffOperationTemplateRecord>, AppError> {
    let operation_type = optional_enum(operation_type, OPERATION_TYPES, "operation type")?;
    repository::list_operation_templates(db, tenant_id, branch_id, &operation_type, active_only)
        .await
        .map_err(internal("load operation templates"))
}

pub async fn list_operation_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    status: &str,
    operation_type: &str,
) -> Result<Vec<StaffOperationScheduleRecord>, AppError> {
    validate_date_range(from, to)?;
    let status = optional_enum(status, OPERATION_SCHEDULE_STATUSES, "operation status")?;
    let operation_type = optional_enum(operation_type, OPERATION_TYPES, "operation type")?;
    repository::list_operation_schedules(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        &status,
        &operation_type,
    )
    .await
    .map_err(internal("load operation schedules"))
}

pub async fn list_operation_tasks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffOperationTaskRecord>, AppError> {
    let operation_id = optional(Some(operation_id), 160, "operation")?;
    let staff_id = optional(Some(staff_id), 160, "employee")?;
    let status = optional_enum(status, OPERATION_TASK_STATUSES, "task status")?;
    repository::list_operation_tasks(db, tenant_id, branch_id, &operation_id, &staff_id, &status)
        .await
        .map_err(internal("load operation tasks"))
}

pub async fn list_operation_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffOperationAttendanceRecord>, AppError> {
    let operation_id = optional(Some(operation_id), 160, "operation")?;
    let staff_id = optional(Some(staff_id), 160, "employee")?;
    let status = optional_enum(status, OPERATION_ATTENDANCE_STATUSES, "attendance status")?;
    repository::list_operation_attendance(
        db,
        tenant_id,
        branch_id,
        &operation_id,
        &staff_id,
        &status,
    )
    .await
    .map_err(internal("load operation attendance"))
}

pub async fn create_operation_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    request: OperationTaskRequest,
) -> Result<StaffOperationTaskRecord, AppError> {
    let operation_id = required(operation_id, 160, "operation")?;
    let staff_id = required(&request.staff_id, 160, "employee")?;
    let task_title = required(&request.task_title, 240, "task title")?;
    let notes = optional(request.notes.as_deref(), 2000, "notes")?;
    repository::create_operation_task(
        db,
        tenant_id,
        branch_id,
        &operation_id,
        &staff_id,
        &task_title,
        &notes,
    )
    .await
    .map_err(internal("create operation task"))?
    .ok_or_else(|| AppError::validation("operation or employee is invalid for this branch"))
}

pub async fn update_operation_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    manager_action: bool,
    request: OperationTaskPatchRequest,
) -> Result<StaffOperationTaskRecord, AppError> {
    let id = required(id, 160, "task")?;
    let status = match request.status.as_deref() {
        Some(value) => Some(required_enum(
            value,
            OPERATION_TASK_STATUSES,
            "task status",
        )?),
        None => None,
    };
    if status
        .as_deref()
        .is_some_and(|value| matches!(value, "approved" | "rejected"))
        && !manager_action
    {
        return Err(AppError::forbidden("manager approval is restricted"));
    }
    let proof_url = match request.proof_url.as_deref() {
        Some(value) => Some(optional(Some(value), 2000, "proof URL")?),
        None => None,
    };
    let notes = match request.notes.as_deref() {
        Some(value) => Some(optional(Some(value), 2000, "notes")?),
        None => None,
    };
    repository::update_operation_task(
        db,
        tenant_id,
        branch_id,
        &id,
        status.as_deref(),
        proof_url.as_deref(),
        notes.as_deref(),
        if status
            .as_deref()
            .is_some_and(|value| matches!(value, "approved" | "rejected"))
        {
            Some(actor_user_id)
        } else {
            None
        },
    )
    .await
    .map_err(internal("update operation task"))?
    .ok_or_else(|| AppError::not_found("operation task not found"))
}

pub async fn upsert_operation_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    actor_user_id: &str,
    request: OperationAttendanceRequest,
) -> Result<StaffOperationAttendanceRecord, AppError> {
    let operation_id = required(operation_id, 160, "operation")?;
    let staff_id = required(&request.staff_id, 160, "employee")?;
    let status = required_enum(
        &request.status,
        OPERATION_ATTENDANCE_STATUSES,
        "attendance status",
    )?;
    let notes = optional(request.notes.as_deref(), 2000, "notes")?;
    repository::upsert_operation_attendance(
        db,
        tenant_id,
        branch_id,
        &operation_id,
        &staff_id,
        &status,
        &notes,
        actor_user_id,
    )
    .await
    .map_err(internal("save operation attendance"))?
    .ok_or_else(|| AppError::validation("operation or employee is invalid for this branch"))
}

pub async fn create_operation_template(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: OperationTemplateRequest,
) -> Result<StaffOperationTemplateRecord, AppError> {
    let name = required(&request.name, 200, "template name")?;
    let operation_type = required_enum(&request.operation_type, OPERATION_TYPES, "operation type")?;
    let frequency = required_enum(&request.frequency, OPERATION_FREQUENCIES, "frequency")?;
    let checklist_json = checklist_array(request.checklist_json)?;
    repository::create_operation_template(
        db,
        tenant_id,
        branch_id,
        &name,
        &operation_type,
        &frequency,
        &checklist_json,
        request.active.unwrap_or(true),
        actor_user_id,
    )
    .await
    .map_err(write_error(
        "operation template name already exists",
        "create operation template",
    ))
}

pub async fn create_operation_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: OperationScheduleRequest,
) -> Result<Vec<StaffOperationScheduleRecord>, AppError> {
    let title = required(&request.title, 240, "schedule title")?;
    let operation_type = required_enum(&request.operation_type, OPERATION_TYPES, "operation type")?;
    let frequency = required_enum(&request.frequency, OPERATION_FREQUENCIES, "frequency")?;
    let notes = optional(request.notes.as_deref(), 2000, "notes")?;
    let checklist_json = checklist_array(request.checklist_json)?;
    let assigned_staff_ids = clean_staff_ids(request.assigned_staff_ids.unwrap_or_default())?;
    ensure_active_staff(db, tenant_id, branch_id, &assigned_staff_ids).await?;
    let template_id = clean_optional_id(request.template_id.as_deref(), "template")?;
    if let Some(template_id) = template_id.as_deref() {
        let exists = repository::operation_template_exists(db, tenant_id, branch_id, template_id)
            .await
            .map_err(internal("validate operation template"))?;
        if !exists {
            return Err(AppError::validation("template is invalid for this branch"));
        }
    }
    let dates = expand_schedule_dates(
        request.scheduled_date,
        &frequency,
        request.until,
        request.occurrences,
    )?;
    repository::create_operation_schedules(
        db,
        tenant_id,
        branch_id,
        template_id.as_deref(),
        &title,
        &operation_type,
        &frequency,
        &dates,
        request.scheduled_time,
        &json!(assigned_staff_ids),
        request
            .owner_user_id
            .as_deref()
            .unwrap_or(actor_user_id)
            .trim(),
        &checklist_json,
        &notes,
        actor_user_id,
    )
    .await
    .map_err(internal("create operation schedules"))
}

pub async fn update_operation_schedule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    request: OperationSchedulePatchRequest,
) -> Result<StaffOperationScheduleRecord, AppError> {
    let title = match request.title.as_deref() {
        Some(value) => Some(required(value, 240, "schedule title")?),
        None => None,
    };
    let notes = match request.notes.as_deref() {
        Some(value) => Some(optional(Some(value), 2000, "notes")?),
        None => None,
    };
    let status = match request.status.as_deref() {
        Some(value) => Some(required_enum(
            value,
            OPERATION_SCHEDULE_STATUSES,
            "operation status",
        )?),
        None => None,
    };
    let assigned_staff_ids = match request.assigned_staff_ids {
        Some(ids) => {
            let ids = clean_staff_ids(ids)?;
            ensure_active_staff(db, tenant_id, branch_id, &ids).await?;
            Some(json!(ids))
        }
        None => None,
    };
    let checklist_json = match request.checklist_json {
        Some(value) => Some(checklist_array(Some(value))?),
        None => None,
    };
    repository::update_operation_schedule(
        db,
        tenant_id,
        branch_id,
        id.trim(),
        title.as_deref(),
        request.scheduled_date,
        request.scheduled_time,
        assigned_staff_ids.as_ref(),
        status.as_deref(),
        checklist_json.as_ref(),
        notes.as_deref(),
    )
    .await
    .map_err(internal("update operation schedule"))?
    .ok_or_else(|| AppError::not_found("operation schedule not found"))
}

pub async fn operation_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
    operation_type: &str,
) -> Result<OperationReportResponse, AppError> {
    validate_date_range(from, to)?;
    let staff_id = optional(Some(staff_id), 160, "employee")?;
    let operation_type = optional_enum(operation_type, OPERATION_TYPES, "operation type")?;

    let completed_operations = repository::operation_report_operation_rows(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        &staff_id,
        &operation_type,
        "completed",
    )
    .await
    .map_err(internal("load completed operation report"))?;
    let missed_operations = repository::operation_report_operation_rows(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        &staff_id,
        &operation_type,
        "missed",
    )
    .await
    .map_err(internal("load missed operation report"))?;
    let pending_approvals = repository::operation_report_operation_rows(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        &staff_id,
        &operation_type,
        "pending_approval",
    )
    .await
    .map_err(internal("load pending operation approvals"))?;
    let meeting_attendance = repository::operation_meeting_attendance_rows(
        db, tenant_id, branch_id, from, to, &staff_id,
    )
    .await
    .map_err(internal("load meeting attendance report"))?;
    let cleaning_scores =
        repository::operation_cleaning_score_rows(db, tenant_id, branch_id, from, to, &staff_id)
            .await
            .map_err(internal("load cleaning score report"))?;
    let hygiene_compliance = repository::operation_hygiene_compliance_rows(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        &operation_type,
    )
    .await
    .map_err(internal("load hygiene compliance report"))?;

    let meeting_present_count = meeting_attendance.iter().map(|row| row.present_count).sum();
    let meeting_absent_count = meeting_attendance.iter().map(|row| row.absent_count).sum();
    let average_cleaning_score = average_score(cleaning_scores.iter().map(|row| row.score));
    let hygiene_compliance_percent =
        average_score(hygiene_compliance.iter().map(|row| row.compliance_percent));

    Ok(OperationReportResponse {
        date_from: from,
        date_to: to,
        summary: OperationReportSummary {
            completed_count: completed_operations.len() as i64,
            missed_count: missed_operations.len() as i64,
            pending_approval_count: pending_approvals.len() as i64,
            meeting_present_count,
            meeting_absent_count,
            average_cleaning_score,
            hygiene_compliance_percent,
        },
        completed_operations,
        missed_operations,
        pending_approvals,
        meeting_attendance,
        cleaning_scores,
        hygiene_compliance,
    })
}

pub async fn run_operation_automations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request: OperationAutomationRequest,
) -> Result<OperationAutomationRunResponse, AppError> {
    validate_date_range(request.from, request.to)?;
    let now = Utc::now();
    let today = now.date_naive();
    let reminder_from = if request.from > today {
        request.from
    } else {
        today
    };
    let reminder_to = if request.to < reminder_from {
        reminder_from
    } else {
        request.to
    };

    let mut escalations_queued = 0_i64;
    for target in
        repository::missed_operation_targets(db, tenant_id, branch_id, request.from, request.to)
            .await
            .map_err(internal("load missed operation automation targets"))?
    {
        let task_key = target.task_id.as_deref().unwrap_or("operation");
        let idempotency_key = format!("missed:{}:{}", target.operation_id, task_key);
        let metadata = json!({
            "idempotencyKey": idempotency_key,
            "operationId": target.operation_id,
            "taskId": target.task_id,
            "operationType": target.operation_type,
            "scheduledDate": target.scheduled_date,
            "automation": "missed_task_escalation"
        });
        let queued = repository::queue_staff_operation_notification(
            db,
            tenant_id,
            branch_id,
            actor_user_id,
            &target.staff_id,
            "operation_missed_task_escalation",
            &target.mobile_phone,
            "Missed operation task",
            &format!("{} missed on {}", target.title, target.scheduled_date),
            now,
            &metadata,
            &idempotency_key,
        )
        .await
        .map_err(internal("queue missed task escalation"))?;
        if queued {
            escalations_queued += 1;
        }
    }

    let meeting_types = vec![
        "staff_meeting".to_string(),
        "performance_review".to_string(),
        "training_session".to_string(),
    ];
    let mut meeting_reminders_queued = 0_i64;
    for target in repository::upcoming_operation_targets(
        db,
        tenant_id,
        branch_id,
        reminder_from,
        reminder_to,
        &meeting_types,
    )
    .await
    .map_err(internal("load meeting reminder targets"))?
    {
        let idempotency_key = format!("meeting:{}:{}", target.operation_id, target.staff_id);
        let metadata = json!({
            "idempotencyKey": idempotency_key,
            "operationId": target.operation_id,
            "operationType": target.operation_type,
            "scheduledDate": target.scheduled_date,
            "automation": "upcoming_meeting_reminder"
        });
        let queued = repository::queue_staff_operation_notification(
            db,
            tenant_id,
            branch_id,
            actor_user_id,
            &target.staff_id,
            "operation_meeting_reminder",
            &target.mobile_phone,
            "Upcoming staff operation",
            &format!("{} is scheduled on {}", target.title, target.scheduled_date),
            now,
            &metadata,
            &idempotency_key,
        )
        .await
        .map_err(internal("queue meeting reminder"))?;
        if queued {
            meeting_reminders_queued += 1;
        }
    }

    let cleaning_types = vec![
        "cleaning_task".to_string(),
        "deep_cleaning".to_string(),
        "hygiene_audit".to_string(),
    ];
    let mut cleaning_reminders_queued = 0_i64;
    for target in repository::upcoming_operation_targets(
        db,
        tenant_id,
        branch_id,
        reminder_from,
        reminder_to,
        &cleaning_types,
    )
    .await
    .map_err(internal("load deep cleaning reminder targets"))?
    {
        let idempotency_key = format!("cleaning:{}:{}", target.operation_id, target.staff_id);
        let metadata = json!({
            "idempotencyKey": idempotency_key,
            "operationId": target.operation_id,
            "operationType": target.operation_type,
            "scheduledDate": target.scheduled_date,
            "automation": "deep_cleaning_reminder"
        });
        let queued = repository::queue_staff_operation_notification(
            db,
            tenant_id,
            branch_id,
            actor_user_id,
            &target.staff_id,
            "operation_deep_cleaning_reminder",
            &target.mobile_phone,
            "Deep cleaning reminder",
            &format!("{} is scheduled on {}", target.title, target.scheduled_date),
            now,
            &metadata,
            &idempotency_key,
        )
        .await
        .map_err(internal("queue deep cleaning reminder"))?;
        if queued {
            cleaning_reminders_queued += 1;
        }
    }

    let report =
        operation_report(db, tenant_id, branch_id, request.from, request.to, "", "").await?;
    let idempotency_key = format!("monthly:{}:{}", request.from, request.to);
    let body = format!(
        "Completed: {} | Missed: {} | Pending approvals: {} | Hygiene: {:.2}%",
        report.summary.completed_count,
        report.summary.missed_count,
        report.summary.pending_approval_count,
        report.summary.hygiene_compliance_percent
    );
    let metadata = json!({
        "idempotencyKey": idempotency_key,
        "from": request.from,
        "to": request.to,
        "summary": &report.summary,
        "automation": "monthly_summary"
    });
    let monthly_summaries_queued = if repository::queue_owner_operation_summary(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        "Staff operations monthly summary",
        &body,
        &metadata,
        &idempotency_key,
    )
    .await
    .map_err(internal("queue monthly operation summary"))?
    {
        1
    } else {
        0
    };

    Ok(OperationAutomationRunResponse {
        escalations_queued,
        meeting_reminders_queued,
        cleaning_reminders_queued,
        monthly_summaries_queued,
    })
}

fn average_score(values: impl Iterator<Item = f64>) -> f64 {
    let mut total = 0.0;
    let mut count = 0.0;
    for value in values {
        total += value;
        count += 1.0;
    }
    if count == 0.0 {
        0.0
    } else {
        ((total / count) * 100.0).round() / 100.0
    }
}

fn required(value: &str, max: usize, field: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} is required and must not exceed {max} characters"
        )));
    }
    Ok(value.to_string())
}

fn optional(value: Option<&str>, max: usize, field: &str) -> Result<String, AppError> {
    let value = value.unwrap_or("").trim();
    if value.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} must not exceed {max} characters"
        )));
    }
    Ok(value.to_string())
}

fn required_enum(value: &str, allowed: &[&str], field: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_lowercase();
    if !allowed.contains(&value.as_str()) {
        return Err(AppError::validation(format!("invalid {field}")));
    }
    Ok(value)
}

fn optional_enum(value: &str, allowed: &[&str], field: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        Ok(String::new())
    } else {
        required_enum(value, allowed, field)
    }
}

fn positive_version(version: i32) -> Result<i32, AppError> {
    if version < 1 {
        Err(AppError::validation("version must be positive"))
    } else {
        Ok(version)
    }
}

fn validate_date_range(from: NaiveDate, to: NaiveDate) -> Result<(), AppError> {
    if to < from {
        return Err(AppError::validation(
            "to date must be on or after from date",
        ));
    }
    if to.signed_duration_since(from).num_days() > 370 {
        return Err(AppError::validation("date range cannot exceed 370 days"));
    }
    Ok(())
}

fn checklist_array(value: Option<Value>) -> Result<Value, AppError> {
    let value = value.unwrap_or_else(|| json!([]));
    if value.as_array().is_none() {
        return Err(AppError::validation("checklistJson must be an array"));
    }
    Ok(value)
}

fn clean_optional_id(value: Option<&str>, field: &str) -> Result<Option<String>, AppError> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.chars().count() <= 160 => Ok(Some(value.to_string())),
        Some(_) => Err(AppError::validation(format!("{field} is too long"))),
        None => Ok(None),
    }
}

fn clean_staff_ids(values: Vec<String>) -> Result<Vec<String>, AppError> {
    let mut ids = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > 160 {
            return Err(AppError::validation(
                "assigned staff contains an invalid employee",
            ));
        }
        if !ids.iter().any(|id| id == value) {
            ids.push(value.to_string());
        }
    }
    if ids.len() > 200 {
        return Err(AppError::validation(
            "assigned staff cannot exceed 200 employees",
        ));
    }
    Ok(ids)
}

async fn ensure_active_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<(), AppError> {
    if staff_ids.is_empty() {
        return Ok(());
    }
    let count = repository::active_staff_count(db, tenant_id, branch_id, staff_ids)
        .await
        .map_err(internal("validate assigned staff"))?;
    if count as usize == staff_ids.len() {
        Ok(())
    } else {
        Err(AppError::validation(
            "assigned staff must be active in this branch",
        ))
    }
}

fn expand_schedule_dates(
    start: NaiveDate,
    frequency: &str,
    until: Option<NaiveDate>,
    occurrences: Option<i32>,
) -> Result<Vec<NaiveDate>, AppError> {
    if frequency == "custom" && (until.is_some() || occurrences.unwrap_or(1) > 1) {
        return Err(AppError::validation(
            "custom frequency creates one schedule at a time",
        ));
    }
    let max = occurrences.unwrap_or(if until.is_some() { 120 } else { 1 });
    if !(1..=120).contains(&max) {
        return Err(AppError::validation(
            "occurrences must be between 1 and 120",
        ));
    }
    if let Some(until) = until {
        validate_date_range(start, until)?;
    }
    let mut dates = Vec::new();
    let original_day = start.day();
    let mut current = start;
    while dates.len() < max as usize {
        if until.is_some_and(|until| current > until) {
            break;
        }
        dates.push(current);
        current = match frequency {
            "daily" => current + Duration::days(1),
            "weekly" => current + Duration::days(7),
            "fortnightly" => current + Duration::days(15),
            "monthly" => add_month(current, original_day)?,
            "custom" => break,
            _ => return Err(AppError::validation("invalid frequency")),
        };
    }
    Ok(dates)
}

fn add_month(date: NaiveDate, desired_day: u32) -> Result<NaiveDate, AppError> {
    let mut year = date.year();
    let mut month = date.month() + 1;
    if month == 13 {
        month = 1;
        year += 1;
    }
    let day = desired_day.min(days_in_month(year, month));
    NaiveDate::from_ymd_opt(year, month, day)
        .ok_or_else(|| AppError::validation("invalid monthly schedule date"))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid month");
    (first_next - Duration::days(1)).day()
}

fn stale() -> AppError {
    AppError::conflict("record was changed or is no longer pending")
}

fn internal(context: &'static str) -> impl Fn(sqlx::Error) -> AppError {
    move |_| AppError::internal(format!("failed to {context}"))
}

fn write_error(
    conflict_message: &'static str,
    context: &'static str,
) -> impl Fn(sqlx::Error) -> AppError {
    move |error| {
        if error
            .as_database_error()
            .is_some_and(|db| db.is_unique_violation())
        {
            AppError::conflict(conflict_message)
        } else {
            AppError::internal(format!("failed to {context}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        expand_schedule_dates, required_enum, OPERATION_FREQUENCIES, OPERATION_TASK_STATUSES,
        TRANSFER_TYPES,
    };
    use chrono::NaiveDate;

    #[test]
    fn monthly_recurrence_clamps_to_month_end() {
        let dates = expand_schedule_dates(
            NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
            "monthly",
            None,
            Some(2),
        )
        .unwrap();
        assert_eq!(dates[1], NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
        assert!(required_enum("weekly", OPERATION_FREQUENCIES, "frequency").is_ok());
    }

    #[test]
    fn task_statuses_allow_completion_and_approval() {
        assert!(required_enum("completed", OPERATION_TASK_STATUSES, "task status").is_ok());
        assert!(required_enum("approved", OPERATION_TASK_STATUSES, "task status").is_ok());
        assert!(required_enum("done", OPERATION_TASK_STATUSES, "task status").is_err());
    }

    #[test]
    fn transfer_type_is_strict() {
        assert_eq!(
            required_enum("Deputation", TRANSFER_TYPES, "type").unwrap(),
            "deputation"
        );
        assert!(required_enum("temporary", TRANSFER_TYPES, "type").is_err());
    }
}
