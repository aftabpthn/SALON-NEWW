use std::collections::HashSet;

use chrono::{Duration, NaiveDate};
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        staff_repository,
        staff_schedule_repository::{
            self, ScheduleEntryInput, ScheduleEntryRecord, ScheduleRoleRecord, ScheduleStaffRecord,
        },
    },
};

const SCHEDULE_STATUSES: &[&str] = &[
    "working",
    "annual_leave",
    "jury_duty",
    "leave",
    "sick_leave",
    "special_leave",
    "weekly_off",
    "working_other_center",
    "not_set",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleData {
    pub staff: Vec<ScheduleStaffRecord>,
    pub entries: Vec<ScheduleEntryRecord>,
    pub roles: Vec<ScheduleRoleRecord>,
    pub jobs: Vec<String>,
}

pub async fn load(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    role_id: &str,
    job: &str,
    staff_id: &str,
) -> Result<ScheduleData, AppError> {
    validate_range(date_from, date_to)?;
    let (staff, roles, jobs) = tokio::try_join!(
        staff_schedule_repository::list_staff(db, tenant_id, branch_id, role_id, job, staff_id),
        staff_schedule_repository::list_roles(db, tenant_id),
        staff_repository::list_job_titles(db, tenant_id, branch_id),
    )
    .map_err(|_| AppError::internal("failed to load employee schedule"))?;
    let staff_ids = staff.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let entries = staff_schedule_repository::list_entries(
        db, tenant_id, branch_id, date_from, date_to, &staff_ids,
    )
    .await
    .map_err(|_| AppError::internal("failed to load employee schedule"))?;
    Ok(ScheduleData {
        staff,
        entries,
        roles,
        jobs,
    })
}

pub async fn save(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: Vec<String>,
    entries: Vec<ScheduleEntryInput>,
) -> Result<(), AppError> {
    validate_range(date_from, date_to)?;
    validate_staff_ids(&staff_ids)?;
    if !staff_schedule_repository::staff_ids_belong_to_scope(db, tenant_id, branch_id, &staff_ids)
        .await
        .map_err(|_| AppError::internal("failed to validate schedule staff"))?
    {
        return Err(AppError::validation("one or more staff are invalid"));
    }
    validate_entries(date_from, date_to, &staff_ids, &entries)?;
    staff_schedule_repository::replace_range(
        db, tenant_id, branch_id, date_from, date_to, &staff_ids, entries,
    )
    .await
    .map_err(|_| AppError::internal("failed to save employee schedule"))
}

pub async fn copy_week(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_start: NaiveDate,
    target_start: NaiveDate,
    staff_ids: Vec<String>,
) -> Result<(), AppError> {
    validate_staff_ids(&staff_ids)?;
    if source_start == target_start
        || (target_start <= source_start + Duration::days(6)
            && target_start + Duration::days(6) >= source_start)
    {
        return Err(AppError::validation(
            "source and target weeks must not overlap",
        ));
    }
    if !staff_schedule_repository::staff_ids_belong_to_scope(db, tenant_id, branch_id, &staff_ids)
        .await
        .map_err(|_| AppError::internal("failed to validate schedule staff"))?
    {
        return Err(AppError::validation("one or more staff are invalid"));
    }
    staff_schedule_repository::copy_week(
        db,
        tenant_id,
        branch_id,
        source_start,
        target_start,
        &staff_ids,
    )
    .await
    .map_err(|_| AppError::internal("failed to copy employee schedule"))
}

fn validate_range(date_from: NaiveDate, date_to: NaiveDate) -> Result<(), AppError> {
    if date_to < date_from || (date_to - date_from).num_days() > 30 {
        return Err(AppError::validation(
            "schedule range must be between 1 and 31 days",
        ));
    }
    Ok(())
}

fn validate_staff_ids(staff_ids: &[String]) -> Result<(), AppError> {
    if staff_ids.len() > 200
        || staff_ids.iter().any(|id| id.trim().is_empty())
        || !all_unique(staff_ids.iter().map(String::as_str))
    {
        return Err(AppError::validation("invalid schedule staff selection"));
    }
    Ok(())
}

fn validate_entries(
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: &[String],
    entries: &[ScheduleEntryInput],
) -> Result<(), AppError> {
    let staff_ids = staff_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let unique = all_unique(
        entries
            .iter()
            .map(|entry| format!("{}:{}", entry.staff_id, entry.schedule_date)),
    );
    let valid = entries.iter().all(|entry| {
        staff_ids.contains(entry.staff_id.as_str())
            && entry.schedule_date >= date_from
            && entry.schedule_date <= date_to
            && SCHEDULE_STATUSES.contains(&entry.status.as_str())
            && entry.notes.chars().count() <= 1000
            && valid_shift(entry.shift1_start, entry.shift1_end)
            && valid_shift(entry.shift2_start, entry.shift2_end)
            && (entry.status != "working"
                || entry.shift1_start.is_some()
                || entry.shift2_start.is_some())
    });
    if !unique || !valid {
        return Err(AppError::validation("invalid employee schedule entry"));
    }
    Ok(())
}

fn valid_shift(start: Option<chrono::NaiveTime>, end: Option<chrono::NaiveTime>) -> bool {
    matches!((start, end), (None, None))
        || matches!((start, end), (Some(start), Some(end)) if start < end)
}

fn all_unique<T: Eq + std::hash::Hash>(values: impl Iterator<Item = T>) -> bool {
    let mut seen = HashSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveTime};

    use super::validate_entries;
    use crate::repositories::staff_schedule_repository::ScheduleEntryInput;

    #[test]
    fn schedule_rejects_inverted_shift() {
        let day = NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        let entries = vec![ScheduleEntryInput {
            staff_id: "staff-1".into(),
            schedule_date: day,
            shift1_start: NaiveTime::from_hms_opt(18, 0, 0),
            shift1_end: NaiveTime::from_hms_opt(9, 0, 0),
            shift2_start: None,
            shift2_end: None,
            status: "working".into(),
            notes: String::new(),
        }];
        assert!(validate_entries(day, day, &["staff-1".into()], &entries).is_err());
    }
}
