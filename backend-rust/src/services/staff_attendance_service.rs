use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        staff_attendance_repository::{
            self, AttendanceAdjustmentInput, AttendanceCorrectionInput, AttendanceSummaryBaseRecord,
        },
        staff_repository,
    },
};

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
        clock_in_at.unwrap_or_else(Utc::now),
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
    staff_attendance_repository::clock_out(
        db,
        tenant_id,
        branch_id,
        staff_id,
        business_date,
        clock_out_at.unwrap_or_else(Utc::now),
        penalty_paise,
        comments,
    )
    .await
    .map_err(|_| AppError::internal("failed to clock out staff"))?
    .ok_or_else(|| AppError::validation("active attendance record was not found"))
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
    validate_correction(&input)?;
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

fn validate_correction(input: &AttendanceCorrectionInput) -> Result<(), AppError> {
    if input.correction_reason.trim().is_empty()
        || input.correction_reason.chars().count() > 300
        || input.comments.chars().count() > 500
        || input.penalty_paise < 0
        || input.breaks.len() > 20
        || input.manual_status.as_deref().is_some_and(|status| {
            !matches!(
                status,
                "present" | "absent" | "half_day" | "leave" | "special_leave" | "weekly_off"
            )
        })
        || input
            .clock_in_at
            .zip(input.clock_out_at)
            .is_some_and(|(start, end)| end < start)
    {
        return Err(AppError::validation("invalid attendance correction"));
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

#[cfg(test)]
mod tests {
    use super::{calculate_row, month_range, validate_correction};
    use crate::repositories::staff_attendance_repository::{
        AttendanceBreakInput, AttendanceCorrectionInput, AttendanceSummaryBaseRecord,
    };
    use chrono::{DateTime, Utc};

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
        assert!(validate_correction(&input).is_err());
    }
}
