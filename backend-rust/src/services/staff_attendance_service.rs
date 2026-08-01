use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        staff_attendance_repository::{
            self, AttendanceAdjustmentInput, AttendanceCorrectionInput,
            AttendanceSummaryBaseRecord, OvertimeApprovalRecord,
        },
        staff_payroll_repository, staff_repository,
    },
};

fn today_ist() -> NaiveDate {
    Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset is valid"))
        .date_naive()
}

fn validate_business_timestamp(
    business_date: NaiveDate,
    timestamp: DateTime<Utc>,
    allow_next_day: bool,
) -> Result<(), AppError> {
    if business_date > today_ist() || timestamp > Utc::now() + Duration::minutes(5) {
        return Err(AppError::validation("future attendance is not allowed"));
    }
    let timestamp_date = timestamp
        .with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset is valid"))
        .date_naive();
    if timestamp_date != business_date
        && !(allow_next_day && timestamp_date == business_date.succ_opt().unwrap_or(business_date))
    {
        return Err(AppError::validation(
            "attendance timestamp does not match the IST business date",
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceSummaryRow {
    pub staff_id: String,
    pub name: String,
    pub employee_code: Option<String>,
    pub salary_paise: Option<i64>,
    pub working_days: i64,
    pub leave_balance: f64,
    pub special_leave_balance: f64,
    pub leave_availed: i64,
    pub special_leave_availed: i64,
    pub penalty_paise: i64,
    pub leaves_accrued: f64,
    pub weekly_off_adjustment: f64,
    pub special_leave_adjustment: f64,
    pub operation_meeting_present: i64,
    pub operation_meeting_absent: i64,
    pub operation_task_completed: i64,
    pub operation_task_missed: i64,
    pub revised_leave_balance: f64,
    pub revised_special_leave_balance: f64,
    pub comments: String,
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    month: u32,
    staff_id: &str,
) -> Result<Vec<AttendanceSummaryRow>, AppError> {
    let (from, to) = month_range(year, month)?;
    let rows = staff_attendance_repository::summary_rows(
        db,
        tenant_id,
        branch_id,
        from,
        to,
        year,
        month as i32,
        staff_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load attendance summary"))?;
    Ok(rows.into_iter().map(calculate_row).collect())
}

pub async fn save_adjustments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    month: u32,
    entries: Vec<AttendanceAdjustmentInput>,
) -> Result<Vec<AttendanceSummaryRow>, AppError> {
    month_range(year, month)?;
    if entries.len() > 500
        || entries.iter().any(|entry| {
            entry.staff_id.trim().is_empty()
                || !entry.weekly_off_adjustment.is_finite()
                || !entry.special_leave_adjustment.is_finite()
                || entry.weekly_off_adjustment.abs() > 31.0
                || entry.special_leave_adjustment.abs() > 31.0
                || entry.comments.len() > 500
        })
    {
        return Err(AppError::validation(
            "invalid attendance summary adjustment",
        ));
    }
    let ids = entries
        .iter()
        .map(|entry| entry.staff_id.clone())
        .collect::<Vec<_>>();
    if !staff_ids_belong_to_scope(db, tenant_id, branch_id, &ids).await? {
        return Err(AppError::validation("invalid attendance staff selection"));
    }
    staff_attendance_repository::save_adjustments(
        db,
        tenant_id,
        branch_id,
        year,
        month as i32,
        entries,
    )
    .await
    .map_err(|_| AppError::internal("failed to save attendance summary"))?;
    summary(db, tenant_id, branch_id, year, month, "").await
}

pub async fn details(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    year: i32,
    month: u32,
) -> Result<Vec<staff_attendance_repository::AttendanceDetailRecord>, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    let (from, to) = month_range(year, month)?;
    staff_attendance_repository::detail_rows(db, tenant_id, branch_id, staff_id, from, to)
        .await
        .map_err(|_| AppError::internal("failed to load attendance details"))
}

pub async fn clock_in(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    clock_in_at: Option<DateTime<Utc>>,
    source: &str,
    comments: &str,
) -> Result<staff_attendance_repository::AttendanceRecord, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    if comments.len() > 500 || source.len() > 50 {
        return Err(AppError::validation("invalid attendance entry"));
    }
    let clock_in_at = clock_in_at.unwrap_or_else(Utc::now);
    validate_business_timestamp(business_date, clock_in_at, false)?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    if staff_attendance_repository::get_for_day(db, tenant_id, branch_id, staff_id, business_date)
        .await
        .map_err(|_| AppError::internal("failed to validate attendance"))?
        .is_some()
    {
        return Err(AppError::validation(
            "attendance already exists for this date",
        ));
    }
    staff_attendance_repository::clock_in(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        clock_in_at,
        source,
        comments,
    )
    .await
    .map_err(|_| AppError::internal("failed to clock in staff"))
}

pub async fn clock_out(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    clock_out_at: Option<DateTime<Utc>>,
    penalty_paise: i64,
    comments: &str,
) -> Result<staff_attendance_repository::AttendanceRecord, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    if penalty_paise < 0 || comments.len() > 500 {
        return Err(AppError::validation("invalid attendance clock out"));
    }
    let clock_out_at = clock_out_at.unwrap_or_else(Utc::now);
    validate_business_timestamp(business_date, clock_out_at, true)?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    staff_attendance_repository::clock_out(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        clock_out_at,
        penalty_paise,
        comments,
    )
    .await
    .map_err(|_| AppError::internal("failed to clock out staff"))?
    .ok_or_else(|| AppError::validation("active attendance record was not found"))
}

pub async fn start_break(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    actor_user_id: &str,
) -> Result<staff_attendance_repository::AttendanceBreakRecord, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    validate_business_timestamp(business_date, Utc::now(), true)?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    staff_attendance_repository::start_break(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        Utc::now(),
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to start attendance break"))?
    .ok_or_else(|| AppError::validation("active attendance or break state was not found"))
}

pub async fn end_break(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<staff_attendance_repository::AttendanceRecord, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    validate_business_timestamp(business_date, Utc::now(), true)?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    staff_attendance_repository::end_break(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        Utc::now(),
    )
    .await
    .map_err(|_| AppError::internal("failed to end attendance break"))?
    .ok_or_else(|| AppError::validation("active attendance break was not found"))
}

pub async fn correct_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    input: AttendanceCorrectionInput,
) -> Result<staff_attendance_repository::AttendanceRecord, AppError> {
    ensure_staff(db, tenant_id, branch_id, staff_id).await?;
    validate_correction(business_date, &input)?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    staff_attendance_repository::save_correction(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        input,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|db_error| db_error.is_unique_violation())
        {
            AppError::validation("attendance breaks overlap")
        } else {
            AppError::internal("failed to correct attendance")
        }
    })
}

/// Blocks attendance edits once the payroll period covering `business_date` is locked, or once
/// its configured correction deadline has passed — whichever applies. Both checks are advisory
/// unless explicitly configured (no period row / no deadline set = no restriction), so this
/// never breaks attendance editing for branches that haven't set up period locking yet.
async fn ensure_attendance_editable(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<(), AppError> {
    let period_month = business_date
        .with_day(1)
        .ok_or_else(|| AppError::internal("invalid business date"))?;
    let period =
        staff_payroll_repository::payroll_period_for_month(db, tenant_id, branch_id, period_month)
            .await
            .map_err(|_| AppError::internal("failed to load payroll period status"))?;
    if let Some(period) = period {
        if period.status == "locked" {
            return Err(AppError::conflict(
                "this payroll period is locked; an authorized reopen is required before attendance can be corrected",
            ));
        }
        if let Some(deadline) = period.correction_deadline {
            if today_ist() > deadline {
                return Err(AppError::conflict(
                    "the attendance correction deadline for this period has passed",
                ));
            }
        }
    }
    Ok(())
}

fn validate_correction(
    business_date: NaiveDate,
    input: &AttendanceCorrectionInput,
) -> Result<(), AppError> {
    if input.correction_reason.trim().is_empty()
        || input.correction_reason.chars().count() > 300
        || input.comments.chars().count() > 500
        || input.penalty_paise < 0
        || input.breaks.len() > 20
        || input.manual_status.as_deref().is_some_and(|status| {
            !matches!(
                status,
                "present"
                    | "absent"
                    | "late"
                    | "half_day"
                    | "leave"
                    | "special_leave"
                    | "weekly_off"
                    | "holiday"
            )
        })
        || input.clock_out_at.is_some() && input.clock_in_at.is_none()
        || input
            .clock_in_at
            .zip(input.clock_out_at)
            .is_some_and(|(start, end)| end < start)
    {
        return Err(AppError::validation("invalid attendance correction"));
    }
    if let Some(clock_in) = input.clock_in_at {
        validate_business_timestamp(business_date, clock_in, false)?;
    }
    if let Some(clock_out) = input.clock_out_at {
        validate_business_timestamp(business_date, clock_out, true)?;
    }
    let mut windows = input
        .breaks
        .iter()
        .map(|item| {
            (
                item.started_at,
                item.ended_at,
                item.comments.chars().count(),
            )
        })
        .collect::<Vec<_>>();
    windows.sort_by_key(|window| window.0);
    for (index, (start, end, comment_length)) in windows.iter().enumerate() {
        validate_business_timestamp(business_date, *start, true)?;
        validate_business_timestamp(business_date, *end, true)?;
        if end < start
            || *comment_length > 200
            || input.clock_in_at.is_some_and(|clock_in| *start < clock_in)
            || input.clock_out_at.is_some_and(|clock_out| *end > clock_out)
            || index > 0 && windows[index - 1].1 > *start
        {
            return Err(AppError::validation("invalid attendance break"));
        }
    }
    Ok(())
}

fn calculate_row(row: AttendanceSummaryBaseRecord) -> AttendanceSummaryRow {
    let leaves_accrued = round_days(row.annual_leave_days / 12.0);
    AttendanceSummaryRow {
        revised_leave_balance: round_days(
            row.leave_balance - row.leave_availed as f64
                + leaves_accrued
                + row.weekly_off_adjustment,
        ),
        revised_special_leave_balance: round_days(
            row.special_leave_balance - row.special_leave_availed as f64
                + row.special_leave_adjustment,
        ),
        staff_id: row.staff_id,
        name: row.name,
        employee_code: row.employee_code,
        salary_paise: row.salary_paise,
        working_days: row.working_days,
        leave_balance: row.leave_balance,
        special_leave_balance: row.special_leave_balance,
        leave_availed: row.leave_availed,
        special_leave_availed: row.special_leave_availed,
        penalty_paise: row.penalty_paise,
        leaves_accrued,
        weekly_off_adjustment: row.weekly_off_adjustment,
        special_leave_adjustment: row.special_leave_adjustment,
        operation_meeting_present: row.operation_meeting_present,
        operation_meeting_absent: row.operation_meeting_absent,
        operation_task_completed: row.operation_task_completed,
        operation_task_missed: row.operation_task_missed,
        comments: row.comments,
    }
}

fn round_days(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn month_range(year: i32, month: u32) -> Result<(NaiveDate, NaiveDate), AppError> {
    let from = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::validation("invalid attendance month"))?;
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(|| AppError::validation("invalid attendance month"))?;
    Ok((
        from,
        next.pred_opt().expect("month start has a previous day"),
    ))
}

async fn ensure_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<(), AppError> {
    staff_repository::get(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to validate attendance staff"))?
        .map(|_| ())
        .ok_or_else(|| AppError::not_found("staff was not found"))
}

async fn staff_ids_belong_to_scope(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<bool, AppError> {
    if staff_ids.is_empty() {
        return Ok(true);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to validate attendance staff"))?;
    Ok(count == staff_ids.len() as i64)
}

pub async fn list_overtime(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<OvertimeApprovalRecord>, AppError> {
    if !status.is_empty() && !matches!(status, "pending" | "approved" | "rejected") {
        return Err(AppError::validation("overtime status is invalid"));
    }
    if to < from {
        return Err(AppError::validation("date range is invalid"));
    }
    staff_attendance_repository::list_overtime(db, tenant_id, branch_id, staff_id, status, from, to)
        .await
        .map_err(|_| AppError::internal("failed to load overtime approvals"))
}

pub async fn decide_overtime(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    attendance_id: &str,
    decision: &str,
    approved_overtime_minutes: Option<i32>,
) -> Result<OvertimeApprovalRecord, AppError> {
    let decision = decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved or rejected",
        ));
    }
    let approved_minutes = if decision == "approved" {
        let minutes = approved_overtime_minutes.unwrap_or(i32::MAX);
        if minutes <= 0 {
            return Err(AppError::validation("approved overtime minutes is invalid"));
        }
        minutes
    } else {
        0
    };
    let business_date = staff_attendance_repository::overtime_business_date(
        db,
        tenant_id,
        branch_id,
        attendance_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load overtime attendance"))?
    .ok_or_else(|| AppError::not_found("attendance record with overtime not found"))?;
    ensure_attendance_editable(db, tenant_id, branch_id, business_date).await?;
    // `approved_minutes` may exceed the actual overtime_minutes when the caller didn't specify a
    // partial amount (defaults to "approve in full") — the repository's LEAST(...) clamp ensures
    // approval can never authorize more than what was actually worked.
    staff_attendance_repository::decide_overtime(
        db,
        tenant_id,
        branch_id,
        attendance_id,
        actor_user_id,
        &decision,
        approved_minutes,
    )
    .await
    .map_err(|_| AppError::internal("failed to decide overtime approval"))?
    .ok_or_else(|| AppError::not_found("attendance record with overtime not found"))
}

#[cfg(test)]
mod tests {
    use super::{calculate_row, month_range, validate_correction};
    use crate::repositories::staff_attendance_repository::{
        AttendanceBreakInput, AttendanceCorrectionInput, AttendanceSummaryBaseRecord,
    };
    use chrono::{DateTime, NaiveDate, Utc};

    #[test]
    fn monthly_summary_uses_saved_balances_and_adjustments() {
        let row = calculate_row(AttendanceSummaryBaseRecord {
            staff_id: "staff".into(),
            name: "Staff".into(),
            employee_code: None,
            salary_paise: None,
            working_days: 20,
            leave_balance: 10.0,
            special_leave_balance: 3.0,
            leave_availed: 2,
            special_leave_availed: 1,
            penalty_paise: 0,
            annual_leave_days: 12.0,
            weekly_off_adjustment: 1.0,
            special_leave_adjustment: 0.5,
            operation_meeting_present: 0,
            operation_meeting_absent: 0,
            operation_task_completed: 0,
            operation_task_missed: 0,
            comments: String::new(),
        });
        assert_eq!(row.leaves_accrued, 1.0);
        assert_eq!(row.revised_leave_balance, 10.0);
        assert_eq!(row.revised_special_leave_balance, 2.5);
        assert!(month_range(2026, 2).is_ok());
        assert!(month_range(2026, 13).is_err());
    }

    #[test]
    fn correction_rejects_overlapping_breaks() {
        let at = |value: &str| {
            DateTime::parse_from_rfc3339(value)
                .unwrap()
                .with_timezone(&Utc)
        };
        let input = AttendanceCorrectionInput {
            clock_in_at: Some(at("2026-07-13T09:00:00Z")),
            clock_out_at: Some(at("2026-07-13T18:00:00Z")),
            manual_status: None,
            penalty_paise: 0,
            comments: String::new(),
            correction_reason: "Manager correction".into(),
            corrected_by: "user".into(),
            breaks: vec![
                AttendanceBreakInput {
                    started_at: at("2026-07-13T12:00:00Z"),
                    ended_at: at("2026-07-13T13:00:00Z"),
                    comments: String::new(),
                },
                AttendanceBreakInput {
                    started_at: at("2026-07-13T12:30:00Z"),
                    ended_at: at("2026-07-13T13:30:00Z"),
                    comments: String::new(),
                },
            ],
        };
        assert!(
            validate_correction(NaiveDate::from_ymd_opt(2026, 7, 13).unwrap(), &input).is_err()
        );
    }

    #[test]
    fn correction_accepts_complete_statuses_and_rejects_cross_date_clock_in() {
        let at = |value: &str| {
            DateTime::parse_from_rfc3339(value)
                .unwrap()
                .with_timezone(&Utc)
        };
        let date = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        for status in [
            "present",
            "absent",
            "late",
            "half_day",
            "leave",
            "weekly_off",
            "holiday",
        ] {
            let input = AttendanceCorrectionInput {
                clock_in_at: None,
                clock_out_at: None,
                manual_status: Some(status.into()),
                penalty_paise: 0,
                comments: String::new(),
                correction_reason: "Manager correction".into(),
                corrected_by: "user".into(),
                breaks: vec![],
            };
            assert!(validate_correction(date, &input).is_ok(), "{status}");
        }
        let invalid = AttendanceCorrectionInput {
            clock_in_at: Some(at("2026-07-14T09:00:00+05:30")),
            clock_out_at: None,
            manual_status: None,
            penalty_paise: 0,
            comments: String::new(),
            correction_reason: "Manager correction".into(),
            corrected_by: "user".into(),
            breaks: vec![],
        };
        assert!(validate_correction(date, &invalid).is_err());
    }
}
