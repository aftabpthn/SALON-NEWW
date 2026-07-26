use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    config::Settings,
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
    pub holiday_days_x2: i32,
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
    pub salary_rows: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunDetail {
    pub run: repository::PayrollRunRecord,
    pub items: Vec<repository::PayrollItemRecord>,
    pub events: Vec<repository::PayrollEventRecord>,
    pub salary_rows: Vec<Value>,
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct StaffHolidayInput {
    pub holiday_date: NaiveDate,
    pub name: String,
    pub is_paid: Option<bool>,
}

#[derive(Debug, Default, Clone)]
struct CommissionBreakdown {
    invoice_sales_paise: i64,
    service_sales_paise: i64,
    product_sales_paise: i64,
    membership_sales_paise: i64,
    package_sales_paise: i64,
    service_commission_paise: i64,
    product_commission_paise: i64,
    membership_commission_paise: i64,
    package_commission_paise: i64,
    snapshot_commission_paise: i64,
    total_commission_paise: i64,
}

#[derive(Debug, Default)]
struct AdjustmentBreakdown {
    allowance_paise: i64,
    deduction_paise: i64,
    fine_paise: i64,
    rows: Vec<Value>,
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
        .map_err(|_| AppError::internal("failed to load payroll staff"))?;
    let staff_ids = staff
        .iter()
        .map(|row| row.staff_id.clone())
        .collect::<Vec<_>>();

    let (
        rules,
        catalog,
        policies,
        attendance,
        schedules,
        commission_snapshots,
        sale_lines,
        tips,
        adjustment_rules,
        holidays,
    ) = tokio::try_join!(
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
        repository::tip_sources(
            db,
            tenant_id,
            branch_id,
            &staff_ids,
            period_start,
            period_end
        ),
        repository::payroll_adjustment_rules(db, tenant_id, branch_id),
        repository::list_holidays(db, tenant_id, branch_id, period_start, period_end),
    )
    .map_err(|_| AppError::internal("failed to load payroll sources"))?;

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
    let mut commission_breakdown_by_staff = HashMap::<String, CommissionBreakdown>::new();
    for row in commission_snapshots {
        *commission_by_staff.entry(row.staff_id.clone()).or_default() += row.commission_paise;
        let breakdown = commission_breakdown_by_staff
            .entry(row.staff_id)
            .or_default();
        breakdown.snapshot_commission_paise += row.commission_paise;
        breakdown.total_commission_paise += row.commission_paise;
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
            let commission_paise = multiply_divide(attributed, i64::from(rate), 100);
            *commission_by_staff
                .entry(line_staff_id.clone())
                .or_default() += commission_paise;
            let breakdown = commission_breakdown_by_staff
                .entry(line_staff_id)
                .or_default();
            breakdown.invoice_sales_paise += attributed;
            breakdown.total_commission_paise += commission_paise;
            match line.line_type.as_str() {
                "service" => {
                    breakdown.service_sales_paise += attributed;
                    breakdown.service_commission_paise += commission_paise;
                }
                "product" => {
                    breakdown.product_sales_paise += attributed;
                    breakdown.product_commission_paise += commission_paise;
                }
                "membership" => {
                    breakdown.membership_sales_paise += attributed;
                    breakdown.membership_commission_paise += commission_paise;
                }
                "package" => {
                    breakdown.package_sales_paise += attributed;
                    breakdown.package_commission_paise += commission_paise;
                }
                _ => {}
            }
        }
    }
    let tips_by_staff = tips
        .into_iter()
        .map(|row| (row.staff_id, row.tip_paise))
        .collect::<HashMap<_, _>>();

    let days_in_month = i64::from(period_end.day());
    let paid_holidays = holidays
        .into_iter()
        .filter(|row| row.is_paid)
        .map(|row| row.holiday_date)
        .collect::<HashSet<_>>();
    let items = staff
        .into_iter()
        .map(|staff_row| {
            let staff_id = staff_row.staff_id.clone();
            let attendance_rows = attendance_by_staff
                .get(&staff_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let schedule_rows = schedules_by_staff
                .get(&staff_id)
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
            let absent_days_x2 = attendance_rows
                .iter()
                .filter(|row| row.status == "absent")
                .count() as i32
                * 2;
            let half_day_count = attendance_rows
                .iter()
                .filter(|row| row.status == "half_day")
                .count() as i64;
            let leave_attendance_days_x2 = attendance_rows
                .iter()
                .filter(|row| matches!(row.status.as_str(), "leave" | "special_leave"))
                .count() as i32
                * 2;
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
            let late_minutes = attendance_rows
                .iter()
                .map(|row| row.late_minutes)
                .sum::<i32>();
            let early_leave_minutes = attendance_rows
                .iter()
                .map(|row| row.early_leave_minutes)
                .sum::<i32>();
            let break_minutes = attendance_rows
                .iter()
                .map(|row| row.break_minutes)
                .sum::<i32>();
            let late_count = attendance_rows
                .iter()
                .filter(|row| row.late_minutes > 0)
                .count() as i64;
            let open_clock_ins = attendance_rows
                .iter()
                .filter(|row| row.status == "clocked_in")
                .count();

            let mut paid_leave_days_x2 = 0;
            let mut unpaid_leave_days_x2 = leave_attendance_days_x2;
            let mut weekly_off_days_x2 = 0;
            let mut scheduled_minutes = 0_i64;
            let mut compensated_schedule_dates = HashSet::new();
            for schedule in schedule_rows {
                scheduled_minutes += schedule.scheduled_minutes.max(0);
                if schedule.status == "weekly_off" {
                    weekly_off_days_x2 += 2;
                    compensated_schedule_dates.insert(schedule.schedule_date);
                } else if let Some(leave_type) = schedule_leave_type(&schedule.status) {
                    if policy_set.contains(&(staff_id.clone(), leave_type.to_string())) {
                        paid_leave_days_x2 += 2;
                        compensated_schedule_dates.insert(schedule.schedule_date);
                    } else {
                        unpaid_leave_days_x2 += 2;
                    }
                }
            }
            let attended_dates = attendance_rows
                .iter()
                .filter(|row| matches!(row.status.as_str(), "clocked_out" | "present" | "half_day"))
                .map(|row| row.business_date)
                .collect::<HashSet<_>>();
            let holiday_days_x2 = paid_holiday_days_x2(
                &paid_holidays,
                &attended_dates,
                &compensated_schedule_dates,
                staff_row.joining_date,
            );
            let short_minutes = (scheduled_minutes - i64::from(worked_minutes)).max(0);
            let short_hours = (short_minutes + 59) / 60;

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
            if !rules_by_staff.contains_key(&staff_id) && !catalog_staff.contains(&staff_id) {
                validation_warnings.push("Commission rule is not configured".to_string());
            }

            let rate = staff_row.pay_rate_paise.unwrap_or(0);
            let paid_weekly_off_x2 = if staff_row.pay_rate_type.as_deref() == Some("monthly") {
                weekly_off_days_x2
            } else {
                0
            };
            let payable_days_x2 = i64::from(
                (attendance_days_x2 + paid_leave_days_x2 + paid_weekly_off_x2 + holiday_days_x2)
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
            let commission_paise = commission_by_staff.get(&staff_id).copied().unwrap_or(0);
            let commission_breakdown = commission_breakdown_by_staff
                .get(&staff_id)
                .cloned()
                .unwrap_or_default();
            let tip_paise = tips_by_staff.get(&staff_id).copied().unwrap_or(0);
            let rule_adjustments = auto_adjustments(
                &adjustment_rules,
                late_count,
                i64::from(absent_days_x2 / 2),
                half_day_count,
                short_hours,
                open_clock_ins as i64,
                i64::from(unpaid_leave_days_x2 / 2),
            );
            let advance_recovery_paise = 0_i64;
            let auto_deduction_paise = rule_adjustments.deduction_paise
                + rule_adjustments.fine_paise
                + advance_recovery_paise;
            let generated_positive_paise = tip_paise + rule_adjustments.allowance_paise;
            let gross_paise =
                earned_salary_paise + overtime_paise + commission_paise + generated_positive_paise;
            let deductions_paise = penalty_paise + auto_deduction_paise;
            let net_paise = (gross_paise - deductions_paise).max(0);
            let salary_row = json!({
                "staffId": staff_id,
                "staffName": staff_row.staff_name,
                "employeeCode": staff_row.employee_code,
                "payRateType": staff_row.pay_rate_type,
                "payRatePaise": staff_row.pay_rate_paise,
                "attendanceDaysX2": attendance_days_x2,
                "presentDaysX2": attendance_days_x2,
                "absentDaysX2": absent_days_x2,
                "halfDayCount": half_day_count,
                "paidLeaveDaysX2": paid_leave_days_x2,
                "unpaidLeaveDaysX2": unpaid_leave_days_x2,
                "weeklyOffDaysX2": weekly_off_days_x2,
                "holidayDaysX2": holiday_days_x2,
                "payableDaysX2": payable_days_x2,
                "workedMinutes": worked_minutes,
                "scheduledMinutes": scheduled_minutes,
                "shortMinutes": short_minutes,
                "overtimeMinutes": overtime_minutes,
                "lateMinutes": late_minutes,
                "earlyLeaveMinutes": early_leave_minutes,
                "breakMinutes": break_minutes,
                "baseSalaryPaise": rate,
                "earnedSalaryPaise": earned_salary_paise,
                "overtimePaise": overtime_paise,
                "invoiceSalesPaise": commission_breakdown.invoice_sales_paise,
                "serviceSalesPaise": commission_breakdown.service_sales_paise,
                "productSalesPaise": commission_breakdown.product_sales_paise,
                "membershipSalesPaise": commission_breakdown.membership_sales_paise,
                "packageSalesPaise": commission_breakdown.package_sales_paise,
                "serviceCommissionPaise": commission_breakdown.service_commission_paise,
                "productCommissionPaise": commission_breakdown.product_commission_paise,
                "membershipCommissionPaise": commission_breakdown.membership_commission_paise,
                "packageCommissionPaise": commission_breakdown.package_commission_paise,
                "snapshotCommissionPaise": commission_breakdown.snapshot_commission_paise,
                "commissionPaise": commission_paise,
                "tipsPaise": tip_paise,
                "allowancePaise": rule_adjustments.allowance_paise,
                "attendancePenaltyPaise": penalty_paise,
                "ruleFinePaise": rule_adjustments.fine_paise,
                "ruleDeductionPaise": rule_adjustments.deduction_paise,
                "advanceRecoveryPaise": advance_recovery_paise,
                "advanceSource": "not_configured",
                "grossPaise": gross_paise,
                "deductionsPaise": deductions_paise,
                "netPaise": net_paise,
                "autoAdjustmentRules": rule_adjustments.rows,
                "sourceCounts": {
                    "attendance": attendance_rows.len(),
                    "schedule": schedule_rows.len()
                }
            });

            PayrollPreviewItem {
                calculation_json: json!({
                    "attendanceRecordCount": attendance_rows.len(),
                    "scheduleRecordCount": schedule_rows.len(),
                    "scheduledMinutes": scheduled_minutes,
                    "payableDaysX2": payable_days_x2,
                    "holidayDaysX2": holiday_days_x2,
                    "generatedPositiveAdjustmentPaise": generated_positive_paise,
                    "generatedAutoDeductionPaise": auto_deduction_paise,
                    "salaryRow": salary_row,
                }),
                staff_id,
                staff_name: staff_row.staff_name,
                employee_code: staff_row.employee_code,
                pay_rate_type: staff_row.pay_rate_type,
                pay_rate_paise: staff_row.pay_rate_paise,
                attendance_days_x2,
                paid_leave_days_x2,
                weekly_off_days_x2,
                holiday_days_x2,
                worked_minutes,
                overtime_minutes,
                earned_salary_paise,
                overtime_paise,
                commission_paise,
                adjustment_paise: generated_positive_paise,
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
    let salary_rows = items.iter().map(preview_salary_row).collect::<Vec<_>>();

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
        salary_rows,
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
    reason: &str,
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
    .map_err(|_| AppError::internal("failed to check payroll run"))?
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
    let run = if staff_id.trim().is_empty() {
        repository::replace_calculated_run(
            db,
            tenant_id,
            branch_id,
            result.period_start,
            result.period_end,
            actor_user_id,
            &drafts,
        )
        .await
        .map_err(|_| AppError::internal("failed to save payroll run"))?
    } else {
        repository::replace_selected_calculated_items(
            db,
            tenant_id,
            branch_id,
            result.period_start,
            result.period_end,
            actor_user_id,
            &drafts,
            reason,
        )
        .await
        .map_err(|_| AppError::internal("failed to regenerate payroll staff"))?
    };
    detail(db, tenant_id, branch_id, &run.id).await
}

pub async fn list_runs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<repository::PayrollRunRecord>, AppError> {
    repository::list_runs(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load payroll history"))
}

pub async fn detail(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<PayrollRunDetail, AppError> {
    let run = repository::get_run(db, tenant_id, branch_id, run_id)
        .await
        .map_err(|_| AppError::internal("failed to load payroll run"))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    let (items, events) = tokio::try_join!(
        repository::get_items(db, tenant_id, branch_id, run_id),
        repository::get_events(db, tenant_id, branch_id, run_id),
    )
    .map_err(|_| AppError::internal("failed to load payroll details"))?;
    let salary_rows = items.iter().map(item_salary_row).collect::<Vec<_>>();
    Ok(PayrollRunDetail {
        run,
        items,
        events,
        salary_rows,
    })
}

pub async fn payslip_pdf(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_id: &str,
) -> Result<Vec<u8>, AppError> {
    let detail = detail(db, tenant_id, branch_id, run_id).await?;
    if !matches!(detail.run.status.as_str(), "finalized" | "paid") {
        return Err(AppError::conflict(
            "payslips are available after payroll finalization",
        ));
    }
    let item = detail
        .items
        .iter()
        .find(|item| item.staff_id == staff_id)
        .ok_or_else(|| AppError::not_found("payroll employee not found"))?;
    Ok(crate::services::invoice_pdf::render_text_report(
        "STAFF PAYSLIP",
        &[
            format!("Employee: {}", item.staff_name),
            format!(
                "Employee code: {}",
                item.employee_code.as_deref().unwrap_or("-")
            ),
            format!(
                "Period: {} to {}",
                detail.run.period_start, detail.run.period_end
            ),
            format!("Status: {}", detail.run.status),
            format!(
                "Earned salary: INR {}",
                paise_text(item.earned_salary_paise)
            ),
            format!("Overtime: INR {}", paise_text(item.overtime_paise)),
            format!("Commission: INR {}", paise_text(item.commission_paise)),
            format!("Adjustment: INR {}", paise_text(item.adjustment_paise)),
            format!("Deductions: INR {}", paise_text(item.deductions_paise)),
            format!("Net pay: INR {}", paise_text(item.net_paise)),
        ],
    ))
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
        .map_err(|_| AppError::internal("failed to load payroll run"))?
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
        .map_err(|_| AppError::internal("failed to save payroll draft"))?;
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
    settings: &Settings,
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    input: PayrollPayoutInput,
) -> Result<PayrollRunDetail, AppError> {
    let (method, mut reference, key) = validate_payout(input)?;
    if method == "bank" {
        let current = detail(db, tenant_id, branch_id, run_id).await?;
        if current.run.status == "finalized" {
            reference =
                submit_bank_payout(settings, tenant_id, branch_id, run_id, &key, &current).await?;
        }
    }
    let reference = reference.as_str();
    let key = key.as_str();

    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payroll payout"))?;
    let run = repository::lock_run_for_payout(&mut tx, tenant_id, branch_id, run_id)
        .await
        .map_err(|_| AppError::internal("failed to lock payroll payout"))?
        .ok_or_else(|| AppError::not_found("payroll run not found"))?;
    if run.status == "paid" {
        let replay = repository::payout_replay_exists(&mut tx, tenant_id, branch_id, run_id, key)
            .await
            .map_err(|_| AppError::internal("failed to check payroll payout retry"))?;
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish payroll payout retry"))?;
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
    .map_err(|_| AppError::conflict("failed to record payroll payout"))?;
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
    .map_err(|_| AppError::internal("failed to complete payroll payout"))?
    {
        return Err(AppError::conflict(
            "payroll status changed; reload and try again",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payroll payout"))?;
    detail(db, tenant_id, branch_id, run_id).await
}

fn validate_payout(input: PayrollPayoutInput) -> Result<(String, String, String), AppError> {
    let method = input.payment_method.trim().to_ascii_lowercase();
    let reference = input.reference.trim().to_string();
    let key = input.idempotency_key.trim().to_string();
    if !matches!(method.as_str(), "cash" | "bank" | "upi" | "other") {
        return Err(AppError::validation("paymentMethod is invalid"));
    }
    if matches!(method.as_str(), "upi" | "other") && reference.is_empty() {
        return Err(AppError::validation(
            "reference is required for UPI or other payout",
        ));
    }
    if reference.chars().count() > 160 || key.is_empty() || key.chars().count() > 160 {
        return Err(AppError::validation(
            "payout reference or idempotency key is invalid",
        ));
    }
    Ok((method, reference, key))
}

async fn submit_bank_payout(
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    idempotency_key: &str,
    detail: &PayrollRunDetail,
) -> Result<String, AppError> {
    if !settings.payroll_payout_provider_enabled() {
        return Err(AppError::service_unavailable(
            "PAYROLL_PAYOUT_PROVIDER_NOT_CONFIGURED",
            "bank payout provider is not configured",
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AppError::internal("failed to initialize payroll payout provider"))?;
    let response = client
        .post(
            settings
                .payroll_payout_provider_url
                .as_deref()
                .unwrap_or(""),
        )
        .bearer_auth(
            settings
                .payroll_payout_provider_token
                .as_deref()
                .unwrap_or(""),
        )
        .header("idempotency-key", idempotency_key)
        .json(&json!({
            "event":"payroll.payout.requested",
            "tenantId":tenant_id,
            "branchId":branch_id,
            "payrollRunId":run_id,
            "periodStart":detail.run.period_start,
            "periodEnd":detail.run.period_end,
            "currency":"INR",
            "idempotencyKey":idempotency_key,
            "items":detail.items.iter().map(|item| json!({
                "staffId":item.staff_id,
                "employeeCode":item.employee_code,
                "staffName":item.staff_name,
                "amountPaise":item.net_paise,
            })).collect::<Vec<_>>()
        }))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "PAYROLL_PAYOUT_PROVIDER_UNAVAILABLE",
                "bank payout provider is unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "PAYROLL_PAYOUT_PROVIDER_REJECTED",
            "bank payout provider rejected the payroll",
        ));
    }
    let body = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYROLL_PAYOUT_PROVIDER_INVALID_RESPONSE",
            "bank payout provider returned an invalid response",
        )
    })?;
    settled_provider_reference(&body).ok_or_else(|| {
        AppError::service_unavailable(
            "PAYROLL_PAYOUT_NOT_SETTLED",
            "bank payout provider did not confirm settlement",
        )
    })
}

fn settled_provider_reference(body: &Value) -> Option<String> {
    let status = body.get("status")?.as_str()?.trim().to_ascii_lowercase();
    if !matches!(
        status.as_str(),
        "paid" | "processed" | "settled" | "success" | "completed"
    ) {
        return None;
    }
    body.get("providerReference")
        .or_else(|| body.get("reference"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 160)
        .map(str::to_string)
}

fn paid_holiday_days_x2(
    holidays: &HashSet<NaiveDate>,
    attended_dates: &HashSet<NaiveDate>,
    compensated_schedule_dates: &HashSet<NaiveDate>,
    joining_date: Option<NaiveDate>,
) -> i32 {
    (holidays
        .iter()
        .filter(|date| joining_date.is_none_or(|joined| **date >= joined))
        .filter(|date| !attended_dates.contains(date) && !compensated_schedule_dates.contains(date))
        .count() as i32)
        * 2
}

pub async fn list_holidays(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<repository::StaffHolidayRecord>, AppError> {
    if from > to || (to - from).num_days() > 400 {
        return Err(AppError::validation("holiday date range is invalid"));
    }
    repository::list_holidays(db, tenant_id, branch_id, from, to)
        .await
        .map_err(|_| AppError::internal("failed to load staff holidays"))
}

pub async fn save_holiday(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: StaffHolidayInput,
) -> Result<repository::StaffHolidayRecord, AppError> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(AppError::validation("holiday name is invalid"));
    }
    repository::upsert_holiday(
        db,
        tenant_id,
        branch_id,
        input.holiday_date,
        name,
        input.is_paid.unwrap_or(true),
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save staff holiday"))
}

pub async fn delete_holiday(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<(), AppError> {
    repository::deactivate_holiday(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to delete staff holiday"))?
        .then_some(())
        .ok_or_else(|| AppError::not_found("staff holiday not found"))
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
        .map_err(|_| AppError::internal("failed to load payroll run"))?
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
        .map_err(|_| AppError::internal("failed to update payroll status"))?
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
        holiday_days_x2: item.holiday_days_x2,
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

fn preview_salary_row(item: &PayrollPreviewItem) -> Value {
    salary_row_from_json(&item.calculation_json).unwrap_or_else(|| {
        json!({
            "staffId": item.staff_id,
            "staffName": item.staff_name,
            "employeeCode": item.employee_code,
            "attendanceDaysX2": item.attendance_days_x2,
            "paidLeaveDaysX2": item.paid_leave_days_x2,
            "weeklyOffDaysX2": item.weekly_off_days_x2,
            "holidayDaysX2": item.holiday_days_x2,
            "workedMinutes": item.worked_minutes,
            "overtimeMinutes": item.overtime_minutes,
            "earnedSalaryPaise": item.earned_salary_paise,
            "overtimePaise": item.overtime_paise,
            "commissionPaise": item.commission_paise,
            "grossPaise": item.gross_paise,
            "deductionsPaise": item.deductions_paise,
            "netPaise": item.net_paise
        })
    })
}

fn item_salary_row(item: &repository::PayrollItemRecord) -> Value {
    salary_row_from_json(&item.calculation_json).unwrap_or_else(|| {
        json!({
            "staffId": item.staff_id,
            "staffName": item.staff_name,
            "employeeCode": item.employee_code,
            "attendanceDaysX2": item.attendance_days_x2,
            "paidLeaveDaysX2": item.paid_leave_days_x2,
            "weeklyOffDaysX2": item.weekly_off_days_x2,
            "holidayDaysX2": item.holiday_days_x2,
            "workedMinutes": item.worked_minutes,
            "overtimeMinutes": item.overtime_minutes,
            "earnedSalaryPaise": item.earned_salary_paise,
            "overtimePaise": item.overtime_paise,
            "commissionPaise": item.commission_paise,
            "grossPaise": item.gross_paise,
            "deductionsPaise": item.deductions_paise,
            "netPaise": item.net_paise
        })
    })
}

fn salary_row_from_json(calculation_json: &Value) -> Option<Value> {
    calculation_json.get("salaryRow").cloned()
}

#[allow(clippy::too_many_arguments)]
fn auto_adjustments(
    rules: &[repository::PayrollAdjustmentRuleSource],
    late_count: i64,
    absent_days: i64,
    half_day_count: i64,
    short_hours: i64,
    no_clock_out_count: i64,
    unpaid_week_off_days: i64,
) -> AdjustmentBreakdown {
    let mut result = AdjustmentBreakdown::default();
    for rule in rules {
        let metric = match rule.trigger_type.as_str() {
            "late_count" => late_count,
            "absent_day" => absent_days,
            "half_day" => half_day_count,
            "short_hours" => short_hours,
            "no_clock_out" => no_clock_out_count,
            "unpaid_week_off" => unpaid_week_off_days,
            "fixed" => 1,
            _ => 0,
        };
        let occurrences = rule_occurrences(metric, rule.trigger_count, &rule.application_mode);
        if occurrences == 0 || rule.amount_paise <= 0 {
            continue;
        }
        let amount_paise = rule.amount_paise.saturating_mul(occurrences);
        match rule.kind.as_str() {
            "allowance" => result.allowance_paise += amount_paise,
            "fine" => result.fine_paise += amount_paise,
            "deduction" => result.deduction_paise += amount_paise,
            _ => continue,
        }
        result.rows.push(json!({
            "ruleId": rule.id,
            "kind": rule.kind,
            "name": rule.name,
            "triggerType": rule.trigger_type,
            "triggerCount": rule.trigger_count,
            "applicationMode": rule.application_mode,
            "metric": metric,
            "occurrences": occurrences,
            "amountPaise": amount_paise
        }));
    }
    result
}

fn rule_occurrences(metric: i64, trigger_count: i32, application_mode: &str) -> i64 {
    if metric <= 0 {
        return 0;
    }
    let trigger_count = i64::from(trigger_count.max(1));
    if metric < trigger_count {
        return 0;
    }
    if application_mode == "fixed" {
        1
    } else {
        metric / trigger_count
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

pub(crate) fn paise_text(value: i64) -> String {
    format!("{}.{:02}", value / 100, value.unsigned_abs() % 100)
}

#[cfg(test)]
mod tests {
    use super::{
        line_attributions, multiply_divide, paid_holiday_days_x2, period,
        settled_provider_reference, validate_payout, PayrollPayoutInput,
    };
    use chrono::Datelike;
    use serde_json::json;
    use std::collections::HashSet;

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
        .is_ok());
        let holiday = chrono::NaiveDate::from_ymd_opt(2026, 8, 15).unwrap();
        assert_eq!(
            paid_holiday_days_x2(
                &HashSet::from([holiday]),
                &HashSet::new(),
                &HashSet::new(),
                None,
            ),
            2
        );
        assert_eq!(
            settled_provider_reference(&json!({"status":"settled","providerReference":"UTR-1"}))
                .as_deref(),
            Some("UTR-1")
        );
    }
}
