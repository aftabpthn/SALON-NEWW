use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::staff_payroll_repository::{
        self as repository, AdjustmentInput, PayrollItemDraft,
    },
    services::accounting_service,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPreviewItem {
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub pay_rate_type: Option<String>,
    pub pay_rate_paise: Option<i64>,
    pub attendance_days_x2: i32,
    pub paid_leave_days_x2: i32,
    pub weekly_off_days_x2: i32,
    pub worked_minutes: i32,
    pub overtime_minutes: i32,
    pub earned_salary_paise: i64,
    pub overtime_paise: i64,
    pub commission_paise: i64,
    pub adjustment_paise: i64,
    pub penalty_paise: i64,
    pub gross_paise: i64,
    pub deductions_paise: i64,
    pub net_paise: i64,
    pub validation_errors: Vec<String>,
    pub validation_warnings: Vec<String>,
    pub calculation_json: Value,
    pub notes: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPreview {
    pub cycle: &'static str,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub staff_count: usize,
    pub invalid_count: usize,
    pub gross_paise: i64,
    pub deductions_paise: i64,
    pub net_paise: i64,
    pub items: Vec<PayrollPreviewItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunDetail {
    pub run: repository::PayrollRunRecord,
    pub items: Vec<repository::PayrollItemRecord>,
    pub events: Vec<repository::PayrollEventRecord>,
}

#[derive(Debug)]
pub struct PayrollAdjustment {
    pub staff_id: String,
    pub adjustment_paise: i64,
    pub notes: String,
}

pub struct PayrollPayoutInput {
    pub payment_method: String,
    pub reference: String,
    pub idempotency_key: String,
}

pub async fn preview(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    month: u32,
    staff_id: &str,
) -> Result<PayrollPreview, AppError> {
    let (period_start, period_end) = period(year, month)?;
    let staff = repository::staff_sources(db, tenant_id, branch_id, staff_id, period_end)
        .await
        .map_err(|error| AppError::internal(format!("failed to load payroll staff: {error}")))?;
    let staff_ids = staff
        .iter()
        .map(|row| row.staff_id.clone())
        .collect::<Vec<_>>();

    let (rules, catalog, policies, attendance, schedules, commission_snapshots, sale_lines) =
        tokio::try_join!(
            repository::commission_rules(db, tenant_id, branch_id, &staff_ids, period_end),
            repository::catalog_commissions(db, tenant_id, branch_id, &staff_ids),
            repository::leave_policies(db, tenant_id, branch_id, &staff_ids),
            repository::attendance_sources(
                db,
                tenant_id,
                branch_id,
                &staff_ids,
                period_start,
                period_end
            ),
            repository::schedule_sources(
                db,
                tenant_id,
                branch_id,
                &staff_ids,
                period_start,
                period_end
            ),
            repository::commission_snapshots(
                db,
                tenant_id,
                branch_id,
                &staff_ids,
                period_start,
                period_end
            ),
            repository::sale_lines(db, tenant_id, branch_id, period_start, period_end),
        )
        .map_err(|error| AppError::internal(format!("failed to load payroll sources: {error}")))?;

    let mut rules_by_staff: HashMap<String, Vec<(String, i32)>> = HashMap::new();
    for rule in rules {
        rules_by_staff
            .entry(rule.staff_id)
            .or_default()
            .push((rule.applies_to, rule.rate_percent));
    }
    let catalog_map = catalog
        .iter()
        .filter_map(|row| {
            row.commission_percent.map(|rate| {
                (
                    (
                        row.staff_id.clone(),
                        row.item_type.clone(),
                        row.item_id.clone(),
                    ),
                    rate,
                )
            })
        })
        .collect::<HashMap<_, _>>();
    let catalog_staff = catalog
        .iter()
        .map(|row| row.staff_id.clone())
        .collect::<HashSet<_>>();
    let policy_set = policies
        .into_iter()
        .map(|row| (row.staff_id, row.leave_type))
        .collect::<HashSet<_>>();

    let mut attendance_by_staff = HashMap::<String, Vec<_>>::new();
    for row in attendance {
        attendance_by_staff
            .entry(row.staff_id.clone())
            .or_default()
            .push(row);
    }
    let mut schedules_by_staff = HashMap::<String, Vec<_>>::new();
    for row in schedules {
        schedules_by_staff
            .entry(row.staff_id.clone())
            .or_default()
            .push(row);
    }

    let target_staff = staff_ids.iter().cloned().collect::<HashSet<_>>();
    let mut commission_by_staff = HashMap::<String, i64>::new();
    for row in commission_snapshots {
        *commission_by_staff.entry(row.staff_id).or_default() += row.commission_paise;
    }
    for line in sale_lines {
        for (line_staff_id, split_bps) in line_attributions(&line.staff_id, &line.staff_splits) {
            if !target_staff.contains(&line_staff_id) {
                continue;
            }
            let rate = catalog_map
                .get(&(
                    line_staff_id.clone(),
                    line.line_type.clone(),
                    line.item_id.clone(),
                ))
                .copied()
                .or_else(|| {
                    rules_by_staff.get(&line_staff_id).and_then(|rows| {
                        rows.iter()
                            .find(|(applies_to, _)| applies_to == &line.line_type)
                            .or_else(|| rows.iter().find(|(applies_to, _)| applies_to == "all"))
                            .map(|(_, rate)| *rate)
                    })
                })
                .unwrap_or(0);
            let attributed = multiply_divide(line.taxable_paise, split_bps, 10_000);
            *commission_by_staff.entry(line_staff_id).or_default() +=
                multiply_divide(attributed, i64::from(rate), 100);
        }
    }

    let days_in_month = i64::from(period_end.day());
    let items = staff
        .into_iter()
        .map(|staff_row| {
            let attendance_rows = attendance_by_staff
                .get(&staff_row.staff_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let schedule_rows = schedules_by_staff
                .get(&staff_row.staff_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);

            let attendance_days_x2 = attendance_rows
                .iter()
                .map(|row| match row.status.as_str() {
                    "clocked_out" | "present" => 2,
                    "half_day" => 1,
                    _ => 0,
                })
                .sum::<i32>();
            let worked_minutes = attendance_rows
                .iter()
                .map(|row| row.worked_minutes)
                .sum::<i32>();
            let overtime_minutes = attendance_rows
                .iter()
                .map(|row| row.overtime_minutes)
                .sum::<i32>();
            let penalty_paise = attendance_rows
                .iter()
                .map(|row| row.penalty_paise)
                .sum::<i64>();
            let open_clock_ins = attendance_rows
                .iter()
                .filter(|row| row.status == "clocked_in")
                .count();

            let mut paid_leave_days_x2 = 0;
            let mut weekly_off_days_x2 = 0;
            let mut scheduled_minutes = 0_i64;
            for schedule in schedule_rows {
                scheduled_minutes += schedule.scheduled_minutes.max(0);
                if schedule.status == "weekly_off" {
                    weekly_off_days_x2 += 2;
                } else if let Some(leave_type) = schedule_leave_type(&schedule.status) {
                    if policy_set.contains(&(staff_row.staff_id.clone(), leave_type.to_string())) {
                        paid_leave_days_x2 += 2;
                    }
                }
            }

            let mut validation_errors = Vec::new();
            let mut validation_warnings = Vec::new();
            if staff_row
                .pay_rate_paise
                .filter(|amount| *amount > 0)
                .is_none()
            {
                validation_errors.push("Pay rate is missing".to_string());
            }
            if attendance_rows.is_empty() {
                validation_errors.push("Attendance records are missing".to_string());
            }
            if open_clock_ins > 0 {
                validation_errors.push("Attendance has open clock-ins".to_string());
            }
            if schedule_rows.is_empty() {
                validation_warnings.push("Schedule is not configured".to_string());
            }
            if !rules_by_staff.contains_key(&staff_row.staff_id)
                && !catalog_staff.contains(&staff_row.staff_id)
            {
                validation_warnings.push("Commission rule is not configured".to_string());
            }

            let rate = staff_row.pay_rate_paise.unwrap_or(0);
            let paid_weekly_off_x2 = if staff_row.pay_rate_type.as_deref() == Some("monthly") {
                weekly_off_days_x2
            } else {
                0
            };
            let payable_days_x2 = i64::from(
                (attendance_days_x2 + paid_leave_days_x2 + paid_weekly_off_x2)
                    .min((days_in_month * 2) as i32),
            );
            let earned_salary_paise = match staff_row.pay_rate_type.as_deref() {
                Some("monthly") => multiply_divide(rate, payable_days_x2, days_in_month * 2),
                Some("daily") => multiply_divide(rate, payable_days_x2, 2),
                Some("hourly") => multiply_divide(rate, i64::from(worked_minutes), 60),
                _ => 0,
            };
            let overtime_paise = match staff_row.pay_rate_type.as_deref() {
                Some("monthly") => multiply_divide(
                    rate,
                    i64::from(overtime_minutes),
                    scheduled_minutes.max(days_in_month * 480),
                ),
                Some("daily") => multiply_divide(rate, i64::from(overtime_minutes), 480),
                Some("hourly") => multiply_divide(rate, i64::from(overtime_minutes), 60),
                _ => 0,
            };
            let commission_paise = commission_by_staff
                .get(&staff_row.staff_id)
                .copied()
                .unwrap_or(0);
            let gross_paise = earned_salary_paise + overtime_paise + commission_paise;
            let deductions_paise = penalty_paise;
            let net_paise = (gross_paise - deductions_paise).max(0);

            PayrollPreviewItem {
                calculation_json: json!({
                    "attendanceRecordCount": attendance_rows.len(),
                    "scheduleRecordCount": schedule_rows.len(),
                    "scheduledMinutes": scheduled_minutes,
                    "payableDaysX2": payable_days_x2,
                }),
                staff_id: staff_row.staff_id,
                staff_name: staff_row.staff_name,
                employee_code: staff_row.employee_code,
                pay_rate_type: staff_row.pay_rate_type,
                pay_rate_paise: staff_row.pay_rate_paise,
                attendance_days_x2,
                paid_leave_days_x2,
                weekly_off_days_x2,
                worked_minutes,
                overtime_minutes,
                earned_salary_paise,
                overtime_paise,
                commission_paise,
                adjustment_paise: 0,
                penalty_paise,
                gross_paise,
                deductions_paise,
                net_paise,
                validation_errors,
                validation_warnings,
                notes: String::new(),
                status: "preview".to_string(),
            }
        })
        .collect::<Vec<_>>();

    Ok(PayrollPreview {
        cycle: "monthly",
        period_start,
        period_end,
        staff_count: items.len(),
        invalid_count: items
            .iter()
            .filter(|item| !item.validation_errors.is_empty())
            .count(),
        gross_paise: items.iter().map(|item| item.gross_paise).sum(),
        deductions_paise: items.iter().map(|item| item.deductions_paise).sum(),
        net_paise: items.iter().map(|item| item.net_paise).sum(),
        items,
    })
}

pub async fn run_payroll(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    year: i32,
    month: u32,
    staff_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    let result = preview(db, tenant_id, branch_id, year, month, staff_id).await?;
    if result.items.is_empty() {
        return Err(AppError::validation(
            "no active employees found for this payroll period",
        ));
    }
    if let Some(existing) = repository::run_for_period(
        db,
        tenant_id,
        branch_id,
        result.period_start,
        result.period_end,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to check payroll run: {error}")))?
    {
        if matches!(existing.status.as_str(), "finalized" | "paid") {
            return Err(AppError::conflict(
                "finalized or paid payroll cannot be recalculated",
            ));
        }
    }
    let drafts = result
        .items
        .into_iter()
        .map(preview_item_to_draft)
        .collect::<Vec<_>>();
    let run = repository::replace_calculated_run(
        db,
        tenant_id,
        branch_id,
        result.period_start,
        result.period_end,
        actor_user_id,
        &drafts,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to save payroll run: {error}")))?;
    detail(db, tenant_id, branch_id, &run.id).await
}

pub async fn list_runs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<repository::PayrollRunRecord>, AppError> {
    repository::list_runs(db, tenant_id, branch_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load payroll history: {error}")))
}

pub async fn detail(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    let run = repository::get_run(db, tenant_id, branch_id, run_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load payroll run: {error}")))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    let (items, events) = tokio::try_join!(
        repository::get_items(db, tenant_id, branch_id, run_id),
        repository::get_events(db, tenant_id, branch_id, run_id),
    )
    .map_err(|error| AppError::internal(format!("failed to load payroll details: {error}")))?;
    Ok(PayrollRunDetail { run, items, events })
}

pub async fn save_adjustments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    entries: Vec<PayrollAdjustment>,
) -> Result<PayrollRunDetail, AppError> {
    let run = repository::get_run(db, tenant_id, branch_id, run_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load payroll run: {error}")))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    if run.status != "calculated" {
        return Err(AppError::conflict(
            "only a calculated payroll draft can be edited",
        ));
    }
    let mut seen = HashSet::new();
    let inputs = entries
        .into_iter()
        .map(|entry| {
            let staff_id = entry.staff_id.trim().to_string();
            if staff_id.is_empty() || !seen.insert(staff_id.clone()) {
                return Err(AppError::validation("staff adjustments must be unique"));
            }
            if entry.notes.chars().count() > 500 {
                return Err(AppError::validation(
                    "adjustment notes cannot exceed 500 characters",
                ));
            }
            if entry.adjustment_paise.unsigned_abs() > 1_000_000_000 {
                return Err(AppError::validation(
                    "adjustment amount is outside the allowed range",
                ));
            }
            Ok(AdjustmentInput {
                staff_id,
                adjustment_paise: entry.adjustment_paise,
                notes: entry.notes.trim().to_string(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    repository::update_adjustments(db, tenant_id, branch_id, run_id, actor_user_id, &inputs)
        .await
        .map_err(|error| AppError::internal(format!("failed to save payroll draft: {error}")))?;
    detail(db, tenant_id, branch_id, run_id).await
}

pub async fn review(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    transition(
        db,
        tenant_id,
        branch_id,
        run_id,
        actor_user_id,
        "calculated",
        "reviewed",
    )
    .await
}

pub async fn finalize(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    transition(
        db,
        tenant_id,
        branch_id,
        run_id,
        actor_user_id,
        "reviewed",
        "finalized",
    )
    .await
}

pub async fn mark_paid(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    transition(
        db,
        tenant_id,
        branch_id,
        run_id,
        actor_user_id,
        "finalized",
        "paid",
    )
    .await
}

pub async fn record_payout(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    input: PayrollPayoutInput,
) -> Result<PayrollRunDetail, AppError> {
    let (method, reference, key) = validate_payout(input)?;
    let reference = reference.as_str();
    let key = key.as_str();

    let mut tx = db
        .begin()
        .await
        .map_err(|error| AppError::internal(format!("failed to start payroll payout: {error}")))?;
    let run = repository::lock_run_for_payout(&mut tx, tenant_id, branch_id, run_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to lock payroll payout: {error}")))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    if run.status == "paid" {
        let replay = repository::payout_replay_exists(&mut tx, tenant_id, branch_id, run_id, key)
            .await
            .map_err(|error| {
                AppError::internal(format!("failed to check payroll payout retry: {error}"))
            })?;
        tx.rollback().await.map_err(|error| {
            AppError::internal(format!("failed to finish payroll payout retry: {error}"))
        })?;
        if replay {
            return detail(db, tenant_id, branch_id, run_id).await;
        }
        return Err(AppError::conflict("payroll is already paid"));
    }
    if run.status != "finalized" {
        return Err(AppError::conflict(
            "payroll must be finalized before payout",
        ));
    }
    let rows = repository::create_payouts(
        &mut tx,
        tenant_id,
        branch_id,
        run_id,
        &method,
        reference,
        key,
        actor_user_id,
    )
    .await
    .map_err(|error| AppError::conflict(format!("failed to record payroll payout: {error}")))?;
    if rows != run.staff_count as u64 {
        return Err(AppError::conflict(
            "payroll payout items do not match the finalized run",
        ));
    }
    accounting_service::post_payroll_payout(
        &mut tx,
        tenant_id,
        branch_id,
        run_id,
        &method,
        run.gross_paise,
        run.net_paise,
    )
    .await?;
    if !repository::complete_payout(
        &mut tx,
        tenant_id,
        branch_id,
        run_id,
        actor_user_id,
        &method,
        reference,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to complete payroll payout: {error}")))?
    {
        return Err(AppError::conflict(
            "payroll status changed; reload and try again",
        ));
    }
    tx.commit()
        .await
        .map_err(|error| AppError::internal(format!("failed to commit payroll payout: {error}")))?;
    detail(db, tenant_id, branch_id, run_id).await
}

fn validate_payout(input: PayrollPayoutInput) -> Result<(String, String, String), AppError> {
    let method = input.payment_method.trim().to_ascii_lowercase();
    let reference = input.reference.trim().to_string();
    let key = input.idempotency_key.trim().to_string();
    if !matches!(method.as_str(), "cash" | "bank" | "upi" | "other") {
        return Err(AppError::validation("paymentMethod is invalid"));
    }
    if method != "cash" && reference.is_empty() {
        return Err(AppError::validation(
            "reference is required for non-cash payout",
        ));
    }
    if reference.chars().count() > 160 || key.is_empty() || key.chars().count() > 160 {
        return Err(AppError::validation(
            "payout reference or idempotency key is invalid",
        ));
    }
    Ok((method, reference, key))
}

async fn transition(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    expected: &str,
    next: &str,
) -> Result<PayrollRunDetail, AppError> {
    let run = repository::get_run(db, tenant_id, branch_id, run_id)
        .await
        .map_err(|error| AppError::internal(format!("failed to load payroll run: {error}")))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    if run.status != expected {
        return Err(AppError::conflict(format!(
            "payroll must be {expected} before it can be {next}"
        )));
    }
    if next != "paid" && run.invalid_count > 0 {
        return Err(AppError::validation(
            "resolve payroll validation errors before continuing",
        ));
    }
    repository::transition_run(db, tenant_id, branch_id, run_id, actor_user_id, next)
        .await
        .map_err(|error| AppError::internal(format!("failed to update payroll status: {error}")))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    detail(db, tenant_id, branch_id, run_id).await
}

fn preview_item_to_draft(item: PayrollPreviewItem) -> PayrollItemDraft {
    PayrollItemDraft {
        staff_id: item.staff_id,
        staff_name: item.staff_name,
        employee_code: item.employee_code,
        pay_rate_type: item.pay_rate_type,
        pay_rate_paise: item.pay_rate_paise,
        attendance_days_x2: item.attendance_days_x2,
        paid_leave_days_x2: item.paid_leave_days_x2,
        weekly_off_days_x2: item.weekly_off_days_x2,
        worked_minutes: item.worked_minutes,
        overtime_minutes: item.overtime_minutes,
        earned_salary_paise: item.earned_salary_paise,
        overtime_paise: item.overtime_paise,
        commission_paise: item.commission_paise,
        adjustment_paise: item.adjustment_paise,
        penalty_paise: item.penalty_paise,
        gross_paise: item.gross_paise,
        deductions_paise: item.deductions_paise,
        net_paise: item.net_paise,
        validation_errors: json!(item.validation_errors),
        validation_warnings: json!(item.validation_warnings),
        calculation_json: item.calculation_json,
        notes: item.notes,
    }
}

fn period(year: i32, month: u32) -> Result<(NaiveDate, NaiveDate), AppError> {
    if !(2000..=2100).contains(&year) || !(1..=12).contains(&month) {
        return Err(AppError::validation("payroll year or month is invalid"));
    }
    let start = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::validation("payroll period is invalid"))?;
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(|| AppError::validation("payroll period is invalid"))?;
    Ok((start, next - Duration::days(1)))
}

fn schedule_leave_type(status: &str) -> Option<&'static str> {
    match status {
        "annual_leave" => Some("annual"),
        "sick_leave" => Some("sick"),
        "special_leave" | "jury_duty" => Some("special"),
        "leave" => Some("casual"),
        _ => None,
    }
}

fn line_attributions(default_staff_id: &str, splits: &Value) -> Vec<(String, i64)> {
    let mut remaining_bps = 10_000_i64;
    let rows = splits
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let staff_id = row.get("staffId")?.as_str()?.trim();
            let percent = row.get("percent")?.as_f64()?;
            if staff_id.is_empty() || !percent.is_finite() || percent <= 0.0 || remaining_bps == 0 {
                return None;
            }
            let bps = ((percent * 100.0).round().clamp(0.0, 10_000.0) as i64).min(remaining_bps);
            remaining_bps -= bps;
            Some((staff_id.to_string(), bps))
        })
        .collect::<Vec<_>>();
    if rows.is_empty() && !default_staff_id.trim().is_empty() {
        vec![(default_staff_id.trim().to_string(), 10_000)]
    } else {
        rows
    }
}

fn multiply_divide(amount: i64, numerator: i64, denominator: i64) -> i64 {
    if amount <= 0 || numerator <= 0 || denominator <= 0 {
        return 0;
    }
    let value = (i128::from(amount) * i128::from(numerator) + i128::from(denominator / 2))
        / i128::from(denominator);
    value.min(i128::from(i64::MAX)) as i64
}

#[cfg(test)]
mod tests {
    use super::{line_attributions, multiply_divide, period, validate_payout, PayrollPayoutInput};
    use chrono::Datelike;
    use serde_json::json;

    #[test]
    fn commission_split_uses_integer_paise_rounding() {
        let splits = line_attributions("fallback", &json!([{"staffId":"staff-1","percent":25}]));
        assert_eq!(splits, vec![("staff-1".to_string(), 2_500)]);
        assert_eq!(
            multiply_divide(multiply_divide(10_001, 2_500, 10_000), 10, 100),
            250
        );
        assert_eq!(period(2024, 2).unwrap().1.day(), 29);
        assert!(validate_payout(PayrollPayoutInput {
            payment_method: "bank".into(),
            reference: "UTR-1".into(),
            idempotency_key: "retry-1".into()
        })
        .is_ok());
        assert!(validate_payout(PayrollPayoutInput {
            payment_method: "bank".into(),
            reference: String::new(),
            idempotency_key: "retry-2".into()
        })
        .is_err());
    }
}
