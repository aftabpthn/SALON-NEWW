use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::staff_operations_repository::{
        self as repository, BranchTransferRecord, PerformanceReviewRecord, ShiftSwapRecord,
        SkillLicenseRecord,
    },
};

const DECISIONS: &[&str] = &["approved", "rejected"];
const TRANSFER_TYPES: &[&str] = &["permanent", "deputation"];
const LICENSE_STATUSES: &[&str] = &["pending", "verified", "rejected", "expired"];
const REVIEW_STATUSES: &[&str] = &["draft", "shared", "acknowledged", "closed"];

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
) -> Result<Vec<ShiftSwapRecord>, AppError> {
    let status = optional_enum(
        status,
        &["pending", "approved", "rejected", "cancelled"],
        "swap status",
    )?;
    repository::list_shift_swaps(db, tenant_id, branch_id, &status)
        .await
        .map_err(internal("load shift swaps"))
}

pub async fn create_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
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
    )
    .await
    .map_err(write_error(
        "a pending swap already exists",
        "create shift swap",
    ))?
    .ok_or_else(|| AppError::validation("schedule or target employee is invalid"))
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
    use super::{required_enum, TRANSFER_TYPES};

    #[test]
    fn transfer_type_is_strict() {
        assert_eq!(
            required_enum("Deputation", TRANSFER_TYPES, "type").unwrap(),
            "deputation"
        );
        assert!(required_enum("temporary", TRANSFER_TYPES, "type").is_err());
    }
}
