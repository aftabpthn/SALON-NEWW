use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::staff_advance_repository::{
        self as repository, AdvanceRecoveryRecord, StaffAdvanceRecord,
    },
    services::accounting_service,
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceRequestInput {
    pub staff_id: String,
    pub requested_amount_paise: i64,
    pub installment_count: i32,
    pub recovery_start_period: NaiveDate,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceDecisionInput {
    pub decision: String,
    pub approved_amount_paise: Option<i64>,
    pub note: Option<String>,
    pub version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceCancelInput {
    pub version: i32,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceDisbursementInput {
    pub version: i32,
    pub payment_method: String,
    pub reference: Option<String>,
    pub idempotency_key: String,
    pub mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceWaiverInput {
    pub version: i32,
    pub reason: String,
    pub mfa_code: Option<String>,
}

fn clean(v: &str, max: usize, label: &str) -> Result<String, AppError> {
    let v = v.trim().to_string();
    if v.chars().count() > max {
        Err(AppError::validation(format!("{label} is too long")))
    } else {
        Ok(v)
    }
}

fn ceil_div(amount: i64, parts: i32) -> i64 {
    let parts = i64::from(parts.max(1));
    (amount + parts - 1) / parts
}

pub async fn request_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: AdvanceRequestInput,
) -> Result<StaffAdvanceRecord, AppError> {
    let staff_id = clean(&input.staff_id, 64, "staff")?;
    if staff_id.is_empty() {
        return Err(AppError::validation("staff is required"));
    }
    if input.requested_amount_paise <= 0 || input.requested_amount_paise > 100_000_000_00 {
        return Err(AppError::validation(
            "requested amount is outside the allowed range",
        ));
    }
    if !(1..=36).contains(&input.installment_count) {
        return Err(AppError::validation(
            "installment count must be between 1 and 36",
        ));
    }
    let reason = clean(&input.reason, 500, "reason")?;
    match repository::create_request(
        db,
        tenant_id,
        branch_id,
        &staff_id,
        actor_user_id,
        input.requested_amount_paise,
        input.installment_count,
        input.recovery_start_period,
        &reason,
    )
    .await
    {
        Ok(row) => Ok(row),
        Err(sqlx::Error::RowNotFound) => {
            Err(AppError::not_found("active staff not found in this branch"))
        }
        Err(_) => Err(AppError::internal(
            "failed to create salary advance request",
        )),
    }
}

pub async fn list_advances(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffAdvanceRecord>, AppError> {
    repository::list(db, tenant_id, branch_id, staff_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load salary advances"))
}

pub async fn get_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<StaffAdvanceRecord, AppError> {
    repository::get(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load salary advance"))?
        .ok_or_else(|| AppError::not_found("salary advance not found"))
}

pub async fn advance_recoveries(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    advance_id: &str,
) -> Result<Vec<AdvanceRecoveryRecord>, AppError> {
    repository::recoveries_for_advance(db, tenant_id, branch_id, advance_id)
        .await
        .map_err(|_| AppError::internal("failed to load salary advance recoveries"))
}

pub async fn decide_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    id: &str,
    input: AdvanceDecisionInput,
) -> Result<StaffAdvanceRecord, AppError> {
    let decision = input.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved or rejected",
        ));
    }
    let note = clean(input.note.as_deref().unwrap_or(""), 500, "decision note")?;
    let approved_amount_paise = if decision == "approved" {
        let existing = get_advance(db, tenant_id, branch_id, id).await?;
        let amount = input
            .approved_amount_paise
            .unwrap_or(existing.requested_amount_paise);
        if amount <= 0 || amount > existing.requested_amount_paise {
            return Err(AppError::validation(
                "approved amount must be positive and cannot exceed the requested amount",
            ));
        }
        Some(amount)
    } else {
        None
    };
    repository::decide(
        db,
        tenant_id,
        branch_id,
        id,
        input.version,
        actor_user_id,
        &decision,
        approved_amount_paise,
        &note,
    )
    .await
    .map_err(|_| AppError::internal("failed to decide salary advance"))?
    .ok_or_else(|| {
        AppError::conflict("salary advance is not pending or was updated by another request")
    })
}

pub async fn cancel_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    id: &str,
    input: AdvanceCancelInput,
) -> Result<StaffAdvanceRecord, AppError> {
    let reason = clean(
        input.reason.as_deref().unwrap_or(""),
        500,
        "cancellation reason",
    )?;
    repository::cancel(
        db,
        tenant_id,
        branch_id,
        id,
        input.version,
        actor_user_id,
        &reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to cancel salary advance"))?
    .ok_or_else(|| {
        AppError::conflict(
            "salary advance can only be cancelled while pending or approved, and not stale",
        )
    })
}

pub async fn disburse_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    id: &str,
    input: AdvanceDisbursementInput,
) -> Result<StaffAdvanceRecord, AppError> {
    let method = input.payment_method.trim().to_ascii_lowercase();
    if !matches!(method.as_str(), "cash" | "bank" | "upi" | "other") {
        return Err(AppError::validation("paymentMethod is invalid"));
    }
    let reference = clean(input.reference.as_deref().unwrap_or(""), 160, "reference")?;
    let idempotency_key = clean(&input.idempotency_key, 160, "idempotency key")?;
    if idempotency_key.is_empty() {
        return Err(AppError::validation("idempotency key is required"));
    }

    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start advance disbursement"))?;
    let advance = repository::lock_for_update(&mut tx, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to lock salary advance"))?
        .ok_or_else(|| AppError::not_found("salary advance not found"))?;

    if advance.status != "approved" {
        let replay = repository::disbursement_replay_exists(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            &idempotency_key,
        )
        .await
        .map_err(|_| AppError::internal("failed to check disbursement retry"))?;
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish disbursement retry"))?;
        if replay {
            return get_advance(db, tenant_id, branch_id, id).await;
        }
        return Err(AppError::conflict(
            "salary advance must be approved before disbursement",
        ));
    }
    let amount_paise = advance
        .approved_amount_paise
        .ok_or_else(|| AppError::conflict("salary advance has no approved amount"))?;
    let installment_amount_paise = ceil_div(amount_paise, advance.installment_count);

    accounting_service::post_staff_advance_disbursement(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        &method,
        amount_paise,
    )
    .await?;

    let updated = repository::complete_disbursement(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        input.version,
        actor_user_id,
        &method,
        &reference,
        &idempotency_key,
        amount_paise,
        installment_amount_paise,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.is_unique_violation())
        {
            AppError::conflict("idempotency key was already used for another disbursement")
        } else {
            AppError::internal("failed to complete advance disbursement")
        }
    })?
    .ok_or_else(|| AppError::conflict("salary advance status changed; reload and try again"))?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit advance disbursement"))?;
    Ok(updated)
}

pub async fn waive_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    id: &str,
    input: AdvanceWaiverInput,
) -> Result<StaffAdvanceRecord, AppError> {
    let reason = clean(&input.reason, 500, "waiver reason")?;
    if reason.is_empty() {
        return Err(AppError::validation("waiver reason is required"));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start advance waiver"))?;
    let advance = repository::lock_for_update(&mut tx, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to lock salary advance"))?
        .ok_or_else(|| AppError::not_found("salary advance not found"))?;
    if !matches!(advance.status.as_str(), "disbursed" | "recovering")
        || advance.outstanding_paise <= 0
    {
        return Err(AppError::conflict(
            "salary advance has no outstanding balance to waive",
        ));
    }
    accounting_service::post_staff_advance_waiver(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        advance.outstanding_paise,
    )
    .await?;
    let updated = repository::complete_waiver(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        input.version,
        actor_user_id,
        &reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to complete advance waiver"))?
    .ok_or_else(|| AppError::conflict("salary advance status changed; reload and try again"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit advance waiver"))?;
    Ok(updated)
}
