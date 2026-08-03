use std::collections::HashSet;

use chrono::{Datelike, Duration, FixedOffset, NaiveDate, Timelike, Utc};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::staff_leave_repository::{
        self as repository, CreateOutcome, DecisionOutcome, LeaveAccrualEventRecord,
        LeaveBalanceRecord, LeaveDayInput, LeaveRequestRecord, NewLeaveRequest,
    },
};

const LEAVE_TYPES: &[&str] = &["annual", "sick", "casual", "special", "unpaid"];
const STATUSES: &[&str] = &["pending", "approved", "rejected", "withdrawn", "cancelled"];

pub async fn list_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    month: u32,
    staff_id: &str,
    status: &str,
) -> Result<Vec<LeaveRequestRecord>, AppError> {
    let (date_from, date_to) = month_period(year, month)?;
    if !status.is_empty() && !STATUSES.contains(&status) {
        return Err(AppError::validation("leave status filter is invalid"));
    }
    repository::list_requests(
        db, tenant_id, branch_id, date_from, date_to, staff_id, status,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to load leave requests: {error}")))
}

pub async fn balances(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    staff_id: &str,
) -> Result<Vec<LeaveBalanceRecord>, AppError> {
    let (year_start, year_end) = year_period(year)?;
    repository::balances(db, tenant_id, branch_id, year_start, year_end, staff_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load leave balances: {error}")))
}

pub async fn accrual_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    staff_id: &str,
) -> Result<Vec<LeaveAccrualEventRecord>, AppError> {
    let (year_start, year_end) = year_period(year)?;
    repository::accrual_history(db, tenant_id, branch_id, staff_id, year_start, year_end)
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load leave accrual history: {error}"))
        })
}

#[allow(clippy::too_many_arguments)]
pub async fn create_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    staff_id: &str,
    leave_type: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
    reason: &str,
    day_parts: Vec<LeaveDayInput>,
) -> Result<LeaveRequestRecord, AppError> {
    let staff_id = staff_id.trim();
    let leave_type = leave_type.trim().to_lowercase();
    let reason = reason.trim();
    if staff_id.is_empty() {
        return Err(AppError::validation("employee is required"));
    }
    if !LEAVE_TYPES.contains(&leave_type.as_str()) {
        return Err(AppError::validation("leave type is invalid"));
    }
    let days = request_days(start_date, end_date)?;
    let day_parts = normalize_day_parts(start_date, end_date, day_parts)?;
    let requested_days =
        (day_parts.iter().map(|part| part.day_fraction).sum::<f64>() * 100.0).round() / 100.0;
    if reason.chars().count() > 500 {
        return Err(AppError::validation(
            "leave reason cannot exceed 500 characters",
        ));
    }
    let outcome = repository::create_request(
        db,
        tenant_id,
        branch_id,
        NewLeaveRequest {
            staff_id: staff_id.to_string(),
            leave_type,
            start_date,
            end_date,
            days,
            requested_days,
            day_parts,
            reason: reason.to_string(),
            requested_by: actor_user_id.to_string(),
        },
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to save leave request: {error}")))?;
    let request_id = match outcome {
        CreateOutcome::Created(id) => id,
        CreateOutcome::StaffNotFound => return Err(AppError::validation("employee is invalid")),
        CreateOutcome::PolicyMissing => {
            return Err(AppError::validation(
                "configure an active leave policy for this employee first",
            ))
        }
        CreateOutcome::Overlap => {
            return Err(AppError::conflict(
                "employee already has a pending or approved leave in this period",
            ))
        }
    };
    repository::get_request(db, tenant_id, branch_id, &request_id)
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load saved leave request: {error}"))
        })?
        .ok_or_else(|| AppError::internal("saved leave request could not be loaded"))
}

fn normalize_day_parts(
    start_date: NaiveDate,
    end_date: NaiveDate,
    mut parts: Vec<LeaveDayInput>,
) -> Result<Vec<LeaveDayInput>, AppError> {
    let expected = (end_date - start_date).num_days() as usize + 1;
    if parts.is_empty() {
        parts = (0..expected)
            .map(|offset| LeaveDayInput {
                leave_date: start_date + Duration::days(offset as i64),
                start_time: None,
                end_time: None,
                day_fraction: 1.0,
            })
            .collect();
    }
    let mut dates = HashSet::new();
    if parts.len() != expected
        || parts.iter().any(|part| {
            part.leave_date < start_date
                || part.leave_date > end_date
                || !dates.insert(part.leave_date)
                || part.start_time.is_some() != part.end_time.is_some()
        })
    {
        return Err(AppError::validation(
            "leave day times must cover each requested date exactly once",
        ));
    }
    for part in &mut parts {
        part.day_fraction = match (part.start_time, part.end_time) {
            (None, None) => 1.0,
            (Some(start), Some(end)) => {
                let minutes = (i64::from(end.num_seconds_from_midnight())
                    - i64::from(start.num_seconds_from_midnight()))
                    / 60;
                if minutes <= 0 || minutes > 24 * 60 {
                    return Err(AppError::validation("partial-day leave time is invalid"));
                }
                ((minutes as f64 / 480.0).min(1.0) * 100.0).round() / 100.0
            }
            _ => {
                return Err(AppError::validation(
                    "partial-day leave requires start and end time",
                ))
            }
        };
    }
    parts.sort_by_key(|part| part.leave_date);
    Ok(parts)
}

pub async fn approve(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    actor_user_id: &str,
    version: i32,
    review_note: &str,
) -> Result<LeaveRequestRecord, AppError> {
    decide(
        db,
        tenant_id,
        branch_id,
        request_id,
        actor_user_id,
        version,
        "approved",
        review_note,
    )
    .await
}

pub async fn reject(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    actor_user_id: &str,
    version: i32,
    review_note: &str,
) -> Result<LeaveRequestRecord, AppError> {
    decide(
        db,
        tenant_id,
        branch_id,
        request_id,
        actor_user_id,
        version,
        "rejected",
        review_note,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn withdraw(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    version: i32,
) -> Result<LeaveRequestRecord, AppError> {
    if request_id.trim().is_empty() || staff_id.trim().is_empty() || version < 1 {
        return Err(AppError::validation("leave request version is invalid"));
    }
    match repository::withdraw_request(
        db,
        tenant_id,
        branch_id,
        request_id.trim(),
        staff_id.trim(),
        actor_user_id,
        version,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to withdraw leave request: {error}")))?
    {
        DecisionOutcome::Updated => {}
        DecisionOutcome::NotFound => return Err(AppError::not_found("leave request not found")),
        DecisionOutcome::Conflict => {
            return Err(AppError::conflict(
                "only a pending leave request can be withdrawn; refresh and try again",
            ))
        }
        DecisionOutcome::PolicyMissing | DecisionOutcome::InsufficientBalance => {
            return Err(AppError::internal("invalid leave withdrawal outcome"))
        }
    }
    repository::get_request(db, tenant_id, branch_id, request_id.trim())
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load withdrawn leave request: {error}"))
        })?
        .ok_or_else(|| AppError::not_found("leave request not found"))
}

#[allow(clippy::too_many_arguments)]
pub async fn cancel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    version: i32,
    reason: &str,
) -> Result<LeaveRequestRecord, AppError> {
    let reason = reason.trim();
    if request_id.trim().is_empty()
        || staff_id.trim().is_empty()
        || version < 1
        || reason.is_empty()
        || reason.chars().count() > 500
    {
        return Err(AppError::validation(
            "leave cancellation reason and current version are required",
        ));
    }
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("valid IST offset"))
        .date_naive();
    match repository::cancel_request(
        db,
        tenant_id,
        branch_id,
        request_id.trim(),
        staff_id.trim(),
        actor_user_id,
        version,
        reason,
        today,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to cancel leave request: {error}")))?
    {
        DecisionOutcome::Updated => {}
        DecisionOutcome::NotFound => return Err(AppError::not_found("leave request not found")),
        DecisionOutcome::Conflict => {
            return Err(AppError::conflict(
                "only unchanged approved current or future leave can be cancelled",
            ))
        }
        DecisionOutcome::PolicyMissing | DecisionOutcome::InsufficientBalance => {
            return Err(AppError::internal("invalid leave cancellation outcome"))
        }
    }
    repository::get_request(db, tenant_id, branch_id, request_id.trim())
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load cancelled leave request: {error}"))
        })?
        .ok_or_else(|| AppError::not_found("leave request not found"))
}

pub async fn restore(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    version: i32,
) -> Result<LeaveRequestRecord, AppError> {
    if request_id.trim().is_empty() || version < 1 {
        return Err(AppError::validation("leave request version is invalid"));
    }
    match repository::restore_request(db, tenant_id, branch_id, request_id.trim(), version)
        .await
        .map_err(|error| AppError::internal(format!("failed to restore leave request: {error}")))?
    {
        DecisionOutcome::Updated => {}
        DecisionOutcome::NotFound => return Err(AppError::not_found("leave request not found")),
        DecisionOutcome::Conflict => {
            return Err(AppError::conflict(
                "only an unchanged withdrawn leave request can be restored",
            ))
        }
        DecisionOutcome::PolicyMissing | DecisionOutcome::InsufficientBalance => {
            return Err(AppError::internal("invalid leave restoration outcome"))
        }
    }
    repository::get_request(db, tenant_id, branch_id, request_id.trim())
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load restored leave request: {error}"))
        })?
        .ok_or_else(|| AppError::not_found("leave request not found"))
}

#[allow(clippy::too_many_arguments)]
async fn decide(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    actor_user_id: &str,
    version: i32,
    decision: &str,
    review_note: &str,
) -> Result<LeaveRequestRecord, AppError> {
    let request_id = request_id.trim();
    let review_note = review_note.trim();
    if request_id.is_empty() || version < 1 {
        return Err(AppError::validation("leave request version is invalid"));
    }
    if review_note.chars().count() > 500 {
        return Err(AppError::validation(
            "review note cannot exceed 500 characters",
        ));
    }
    let current = repository::get_request(db, tenant_id, branch_id, request_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load leave request: {error}")))?
        .ok_or_else(|| AppError::not_found("leave request not found"))?;
    if current.requested_by == actor_user_id {
        return Err(AppError::forbidden(
            "you cannot decide your own leave request",
        ));
    }
    let outcome = repository::decide_request(
        db,
        tenant_id,
        branch_id,
        request_id,
        version,
        decision,
        actor_user_id,
        review_note,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to update leave request: {error}")))?;
    match outcome {
        DecisionOutcome::Updated => {}
        DecisionOutcome::NotFound => return Err(AppError::not_found("leave request not found")),
        DecisionOutcome::Conflict => {
            return Err(AppError::conflict(
                "leave request has already been updated; refresh and try again",
            ))
        }
        DecisionOutcome::PolicyMissing => {
            return Err(AppError::validation(
                "active leave policy is required before approval",
            ))
        }
        DecisionOutcome::InsufficientBalance => {
            return Err(AppError::validation(
                "employee does not have enough leave balance",
            ))
        }
    }
    repository::get_request(db, tenant_id, branch_id, request_id)
        .await
        .map_err(|error| {
            AppError::internal(format!("failed to load updated leave request: {error}"))
        })?
        .ok_or_else(|| AppError::not_found("leave request not found"))
}

fn request_days(start_date: NaiveDate, end_date: NaiveDate) -> Result<i32, AppError> {
    if end_date < start_date
        || start_date.year() != end_date.year()
        || (end_date - start_date).num_days() > 365
    {
        return Err(AppError::validation(
            "leave period must be within one calendar year",
        ));
    }
    Ok((end_date - start_date).num_days() as i32 + 1)
}

fn month_period(year: i32, month: u32) -> Result<(NaiveDate, NaiveDate), AppError> {
    if !(2000..=2100).contains(&year) || !(1..=12).contains(&month) {
        return Err(AppError::validation("leave month or year is invalid"));
    }
    let start = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .unwrap();
    Ok((start, next - Duration::days(1)))
}

fn year_period(year: i32) -> Result<(NaiveDate, NaiveDate), AppError> {
    if !(2000..=2100).contains(&year) {
        return Err(AppError::validation("leave year is invalid"));
    }
    Ok((
        NaiveDate::from_ymd_opt(year, 1, 1).unwrap(),
        NaiveDate::from_ymd_opt(year, 12, 31).unwrap(),
    ))
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::request_days;

    #[test]
    fn leave_days_are_inclusive_and_cannot_cross_years() {
        let start = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        assert_eq!(request_days(start, end).unwrap(), 3);
        assert!(request_days(start, NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()).is_err());
    }
}
