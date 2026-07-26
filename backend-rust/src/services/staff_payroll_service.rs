use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::{
        staff_enterprise_repository::{self as enterprise_repository, StatutoryRuleRecord},
        staff_payroll_repository::{
            self as repository, ActiveAdvanceSource, AdjustmentInput, AdvanceRecoveryContribution,
            PayrollItemDraft, StatutoryContribution, StatutoryProfileSource,
        },
    },
    services::{accounting_service, staff_enterprise_service},
};

/// The statutory rule types wired into automatic payroll calculation. `gratuity` and `bonus`
/// rows in `staff_payroll_statutory_rules` are intentionally excluded here — they stay
/// available only through the manual `/staff/payroll-compliance/calculate` endpoint.
const AUTO_STATUTORY_TYPES: [(&str, &str); 4] = [
    ("provident_fund", "providentFund"),
    ("esic", "esic"),
    ("professional_tax", "professionalTax"),
    ("tds", "tds"),
];

#[derive(Debug, Default)]
struct StatutoryAllocation {
    employee_paise: i64,
    employer_paise: i64,
    accrual_paise: i64,
    breakdown: serde_json::Map<String, Value>,
    errors: Vec<String>,
}

fn best_statutory_rules(
    rules: &[StatutoryRuleRecord],
) -> HashMap<(String, String), &StatutoryRuleRecord> {
    let mut map: HashMap<(String, String), &StatutoryRuleRecord> = HashMap::new();
    for rule in rules {
        let key = (rule.rule_type.clone(), rule.state_code.clone());
        map.entry(key)
            .and_modify(|existing| {
                if rule.effective_from > existing.effective_from {
                    *existing = rule;
                }
            })
            .or_insert(rule);
    }
    map
}

fn resolve_statutory_rule<'a>(
    rule_map: &'a HashMap<(String, String), &'a StatutoryRuleRecord>,
    rule_type: &str,
    state_code: &str,
) -> Option<&'a StatutoryRuleRecord> {
    if !state_code.is_empty() {
        if let Some(rule) = rule_map.get(&(rule_type.to_string(), state_code.to_string())) {
            return Some(*rule);
        }
    }
    rule_map
        .get(&(rule_type.to_string(), String::new()))
        .copied()
}

/// Computes automatic PF/ESIC/PT/TDS for one staff member as of the payroll period, using only
/// the effective-dated rules already configured in `staff_payroll_statutory_rules` (no hardcoded
/// rates). Requires a `staff_statutory_profiles` row whenever any of the four rule types is
/// active for the period; missing profile or missing required identifiers (UAN/ESIC
/// number/PAN/PT state) surface as validation errors instead of silently defaulting.
fn compute_statutory(
    gross_paise: i64,
    rule_map: &HashMap<(String, String), &StatutoryRuleRecord>,
    has_any_active_rule: bool,
    profile: Option<&StatutoryProfileSource>,
) -> StatutoryAllocation {
    let mut result = StatutoryAllocation::default();
    if !has_any_active_rule {
        return result;
    }
    let Some(profile) = profile else {
        result.errors.push(
            "Statutory profile is missing; PF/ESIC/PT/TDS cannot be calculated".to_string(),
        );
        return result;
    };
    let has_pt_rule = rule_map.keys().any(|(t, _)| t == "professional_tax");
    for (rule_type, key) in AUTO_STATUTORY_TYPES {
        let Some(rule) = resolve_statutory_rule(rule_map, rule_type, &profile.pt_state_code)
        else {
            if rule_type == "professional_tax" && has_pt_rule {
                result.errors.push(
                    "Professional tax state is required to select the applicable rule"
                        .to_string(),
                );
            }
            continue;
        };
        if rule_type == "provident_fund" && !profile.pf_opt_in {
            continue;
        }
        if rule_type == "esic" && !profile.esic_opt_in {
            continue;
        }
        let (employee, employer, accrual) =
            match staff_enterprise_service::calculate_rule(gross_paise, &rule.rule_json) {
                Ok(v) => v,
                Err(_) => {
                    result
                        .errors
                        .push(format!("Statutory rule for {rule_type} is invalid"));
                    continue;
                }
            };
        if employee == 0 && employer == 0 && accrual == 0 {
            continue;
        }
        match rule_type {
            "provident_fund" if profile.uan.trim().is_empty() => result
                .errors
                .push("UAN is required for provident fund deduction".to_string()),
            "esic" if profile.esic_number.trim().is_empty() => result
                .errors
                .push("ESIC number is required for ESIC deduction".to_string()),
            "tds" if profile.pan_number.trim().is_empty() => result
                .errors
                .push("PAN is required for TDS deduction".to_string()),
            _ => {}
        }
        result.employee_paise += employee;
        result.employer_paise += employer;
        result.accrual_paise += accrual;
        result.breakdown.insert(
            key.to_string(),
            json!({
                "ruleId": rule.id,
                "stateCode": rule.state_code,
                "employeePaise": employee,
                "employerPaise": employer,
                "accrualPaise": accrual,
            }),
        );
    }
    result
}

/// Content hash of one staff member's attendance rows for the period, used to detect whether
/// the underlying attendance source changed since payroll was last calculated for them (see
/// `run_payroll`'s regeneration source-change warning). Order-independent: rows are sorted by
/// business date before hashing so fetch order never affects the digest.
fn attendance_source_hash(rows: &[repository::AttendanceSourceRecord]) -> String {
    let mut sorted: Vec<&repository::AttendanceSourceRecord> = rows.iter().collect();
    sorted.sort_by_key(|row| row.business_date);
    let mut hasher = Sha256::new();
    for row in sorted {
        hasher.update(row.business_date.to_string());
        hasher.update([0]);
        hasher.update(&row.status);
        hasher.update([0]);
        hasher.update(row.worked_minutes.to_le_bytes());
        hasher.update(row.overtime_minutes.to_le_bytes());
        hasher.update(row.late_minutes.to_le_bytes());
        hasher.update(row.early_leave_minutes.to_le_bytes());
        hasher.update(row.break_minutes.to_le_bytes());
        hasher.update(row.penalty_paise.to_le_bytes());
        hasher.update(&row.ot_approval_status);
        hasher.update([0]);
        hasher.update(row.approved_overtime_minutes.to_le_bytes());
        hasher.update([b';']);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Debug, Default)]
struct AdvanceRecoveryAllocation {
    total_recovered_paise: i64,
    items: Vec<AdvanceRecoveryContribution>,
}

/// Schedules this period's salary-advance recovery across a staff member's active advances
/// (oldest first), capping the total at `available_capacity_paise` — net pay after every other
/// deduction already applied — so recovery can never push net pay below zero. Any shortfall
/// against what was scheduled carries forward onto the advance's `pending_carry_forward_paise`
/// for the next period; nothing here mutates the ledger balance itself, that only happens once
/// the run is finalized (see `transition_run`).
fn compute_advance_recovery(
    available_capacity_paise: i64,
    advances: &[ActiveAdvanceSource],
) -> AdvanceRecoveryAllocation {
    let mut result = AdvanceRecoveryAllocation::default();
    let mut remaining_capacity = available_capacity_paise.max(0);
    for advance in advances {
        let scheduled = (advance.installment_amount_paise + advance.pending_carry_forward_paise)
            .min(advance.outstanding_paise)
            .max(0);
        if scheduled == 0 {
            continue;
        }
        let recovered = scheduled.min(remaining_capacity);
        let carried_forward = scheduled - recovered;
        remaining_capacity -= recovered;
        result.total_recovered_paise += recovered;
        result.items.push(AdvanceRecoveryContribution {
            staff_id: String::new(),
            advance_id: advance.id.clone(),
            scheduled_paise: scheduled,
            recovered_paise: recovered,
            carried_forward_paise: carried_forward,
            outstanding_after_paise: advance.outstanding_paise - recovered,
        });
    }
    result
}

/// Detects manual `staff_payroll_adjustment_rules` entries whose name reads as a PF/ESIC/PT/TDS
/// line item (e.g. an admin's earlier manual workaround) so they can be excluded from
/// `auto_deduction_paise` — otherwise the same statutory amount would be withheld twice, once
/// manually and once automatically.
fn is_statutory_named(name: &str) -> bool {
    let tokens: std::collections::HashSet<String> = name
        .to_ascii_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    const KEYWORDS: [&str; 8] = [
        "pf", "provident", "esic", "esi", "tds", "professional", "pt", "vpf",
    ];
    KEYWORDS.iter().any(|k| tokens.contains(*k))
}

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
    #[serde(skip)]
    pub statutory_employer_paise: i64,
    #[serde(skip)]
    pub statutory_accrual_paise: i64,
    #[serde(skip)]
    pub statutory_breakdown: Value,
    #[serde(skip)]
    pub advance_recovery_items: Vec<repository::AdvanceRecoveryContribution>,
    pub attendance_source_hash: String,
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
    skipped_statutory_names: Vec<String>,
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
        statutory_rules,
        statutory_profiles,
        active_advances,
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
        enterprise_repository::effective_rules_all(db, tenant_id, branch_id, period_end),
        repository::statutory_profiles(db, tenant_id, branch_id, &staff_ids),
        repository::active_advances(db, tenant_id, branch_id, &staff_ids, period_end),
    )
    .map_err(|_| AppError::internal("failed to load payroll sources"))?;

    let statutory_rule_map = best_statutory_rules(&statutory_rules);
    let has_active_statutory_rule = statutory_rule_map
        .keys()
        .any(|(rule_type, _)| AUTO_STATUTORY_TYPES.iter().any(|(t, _)| t == rule_type));
    let statutory_profile_by_staff = statutory_profiles
        .into_iter()
        .map(|profile| (profile.staff_id.clone(), profile))
        .collect::<HashMap<_, _>>();
    let mut advances_by_staff: HashMap<String, Vec<ActiveAdvanceSource>> = HashMap::new();
    for advance in active_advances {
        advances_by_staff
            .entry(advance.staff_id.clone())
            .or_default()
            .push(advance);
    }

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
            // Only OT explicitly approved counts toward pay — pending/rejected overtime is
            // tracked for visibility but never enters the salary calculation.
            let approved_overtime_minutes = attendance_rows
                .iter()
                .filter(|row| row.ot_approval_status == "approved")
                .map(|row| row.approved_overtime_minutes)
                .sum::<i32>();
            let pending_overtime_minutes = attendance_rows
                .iter()
                .filter(|row| row.ot_approval_status == "pending" && row.overtime_minutes > 0)
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
            if pending_overtime_minutes > 0 {
                validation_warnings.push(format!(
                    "{pending_overtime_minutes} overtime minute(s) are pending approval and excluded from pay"
                ));
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
                    i64::from(approved_overtime_minutes),
                    scheduled_minutes.max(days_in_month * 480),
                ),
                Some("daily") => multiply_divide(rate, i64::from(approved_overtime_minutes), 480),
                Some("hourly") => multiply_divide(rate, i64::from(approved_overtime_minutes), 60),
                _ => 0,
            };
            let commission_paise = commission_by_staff.get(&staff_id).copied().unwrap_or(0);
            let commission_breakdown = commission_breakdown_by_staff
                .get(&staff_id)
                .cloned()
                .unwrap_or_default();
            let tip_paise = tips_by_staff.get(&staff_id).copied().unwrap_or(0);
            let weekend_sandwich =
                compute_weekend_sandwich(schedule_rows, attendance_rows, &paid_holidays);
            let rule_adjustments = auto_adjustments(
                &adjustment_rules,
                late_count,
                i64::from(absent_days_x2 / 2),
                half_day_count,
                short_hours,
                open_clock_ins as i64,
                i64::from(unpaid_leave_days_x2 / 2),
                &weekend_sandwich,
            );
            let auto_deduction_paise = rule_adjustments.deduction_paise + rule_adjustments.fine_paise;
            let generated_positive_paise = tip_paise + rule_adjustments.allowance_paise;
            let gross_paise =
                earned_salary_paise + overtime_paise + commission_paise + generated_positive_paise;
            let statutory = compute_statutory(
                gross_paise,
                &statutory_rule_map,
                has_active_statutory_rule,
                statutory_profile_by_staff.get(&staff_id),
            );
            for name in &rule_adjustments.skipped_statutory_names {
                validation_warnings.push(format!(
                    "Manual rule '{name}' skipped: overlaps with automatic statutory deduction"
                ));
            }
            validation_errors.extend(statutory.errors.iter().cloned());
            // Available capacity for advance recovery is whatever net pay would be left after
            // every other deduction already applied — recovery is capped here so it can never
            // push net pay below zero.
            let available_before_advance_paise =
                (gross_paise - penalty_paise - auto_deduction_paise - statutory.employee_paise)
                    .max(0);
            let mut advance_recovery = compute_advance_recovery(
                available_before_advance_paise,
                advances_by_staff.get(&staff_id).map(Vec::as_slice).unwrap_or(&[]),
            );
            for item in &mut advance_recovery.items {
                item.staff_id = staff_id.clone();
            }
            let advance_recovery_paise = advance_recovery.total_recovered_paise;
            let deductions_paise =
                penalty_paise + auto_deduction_paise + statutory.employee_paise + advance_recovery_paise;
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
                "approvedOvertimeMinutes": approved_overtime_minutes,
                "pendingOvertimeMinutes": pending_overtime_minutes,
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
                "advanceSource": if advance_recovery.items.is_empty() { "none" } else { "salary_advance_ledger" },
                "grossPaise": gross_paise,
                "deductionsPaise": deductions_paise,
                "netPaise": net_paise,
                "autoAdjustmentRules": rule_adjustments.rows,
                "weekendPenaltyOccurrences": weekend_sandwich.weekend_penalty_count,
                "sandwichPenaltyOccurrences": weekend_sandwich.sandwich_penalty_count,
                "weeklyOffWorkedOccurrences": weekend_sandwich.weekly_off_worked_count,
                "weekendSandwichBreakdown": weekend_sandwich.breakdown.clone(),
                "statutoryEmployeePaise": statutory.employee_paise,
                "statutoryEmployerPaise": statutory.employer_paise,
                "statutoryAccrualPaise": statutory.accrual_paise,
                "sourceCounts": {
                    "attendance": attendance_rows.len(),
                    "schedule": schedule_rows.len()
                }
            });
            let statutory_breakdown = Value::Object(statutory.breakdown);
            let advance_recovery_json: Vec<Value> = advance_recovery
                .items
                .iter()
                .map(|item| {
                    json!({
                        "advanceId": item.advance_id,
                        "scheduledPaise": item.scheduled_paise,
                        "recoveredPaise": item.recovered_paise,
                        "carriedForwardPaise": item.carried_forward_paise,
                        "outstandingAfterPaise": item.outstanding_after_paise,
                    })
                })
                .collect();

            PayrollPreviewItem {
                calculation_json: json!({
                    "attendanceRecordCount": attendance_rows.len(),
                    "scheduleRecordCount": schedule_rows.len(),
                    "scheduledMinutes": scheduled_minutes,
                    "payableDaysX2": payable_days_x2,
                    "holidayDaysX2": holiday_days_x2,
                    "generatedPositiveAdjustmentPaise": generated_positive_paise,
                    "generatedAutoDeductionPaise": auto_deduction_paise,
                    "generatedStatutoryDeductionPaise": statutory.employee_paise,
                    "generatedAdvanceRecoveryPaise": advance_recovery_paise,
                    "salaryRow": salary_row,
                    "statutory": {
                        "employeePaise": statutory.employee_paise,
                        "employerPaise": statutory.employer_paise,
                        "accrualPaise": statutory.accrual_paise,
                        "breakdown": statutory_breakdown,
                    },
                    "advanceRecovery": {
                        "totalRecoveredPaise": advance_recovery_paise,
                        "items": advance_recovery_json,
                    },
                }),
                statutory_employer_paise: statutory.employer_paise,
                statutory_accrual_paise: statutory.accrual_paise,
                statutory_breakdown,
                advance_recovery_items: advance_recovery.items,
                attendance_source_hash: attendance_source_hash(attendance_rows),
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
    let mut result = preview(db, tenant_id, branch_id, year, month, staff_id).await?;
    if result.items.is_empty() {
        return Err(AppError::validation(
            "no active employees found for this payroll period",
        ));
    }
    let existing_run = repository::run_for_period(
        db,
        tenant_id,
        branch_id,
        result.period_start,
        result.period_end,
    )
    .await
    .map_err(|_| AppError::internal("failed to check payroll run"))?;
    if let Some(existing) = &existing_run {
        if matches!(existing.status.as_str(), "finalized" | "paid") {
            return Err(AppError::conflict(
                "finalized or paid payroll cannot be recalculated",
            ));
        }
    }
    if let Some(existing) = &existing_run {
        // Warn (non-blocking) when attendance changed since this staff's last calculation —
        // the regenerated numbers are still correct (always freshly computed), this just flags
        // that they differ from what was calculated before, for reviewer awareness.
        let staff_ids = result
            .items
            .iter()
            .map(|item| item.staff_id.clone())
            .collect::<Vec<_>>();
        let previous_hashes = repository::existing_attendance_hashes(
            db,
            tenant_id,
            branch_id,
            &existing.id,
            &staff_ids,
        )
        .await
        .map_err(|_| AppError::internal("failed to check attendance source changes"))?;
        for item in &mut result.items {
            if let Some(previous_hash) = previous_hashes.get(&item.staff_id) {
                if !previous_hash.is_empty() && previous_hash != &item.attendance_source_hash {
                    item.validation_warnings.push(
                        "Attendance source changed since this staff was last calculated"
                            .to_string(),
                    );
                }
            }
        }
    }
    let statutory = result
        .items
        .iter()
        .filter(|item| {
            item.statutory_breakdown
                .as_object()
                .is_some_and(|breakdown| !breakdown.is_empty())
        })
        .map(|item| StatutoryContribution {
            staff_id: item.staff_id.clone(),
            employee_paise: item
                .calculation_json
                .get("statutory")
                .and_then(|s| s.get("employeePaise"))
                .and_then(Value::as_i64)
                .unwrap_or(0),
            employer_paise: item.statutory_employer_paise,
            accrual_paise: item.statutory_accrual_paise,
            breakdown: item.statutory_breakdown.clone(),
        })
        .collect::<Vec<_>>();
    let advance_recoveries = result
        .items
        .iter()
        .flat_map(|item| item.advance_recovery_items.iter().cloned())
        .collect::<Vec<_>>();
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
            &statutory,
            &advance_recoveries,
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
            &statutory,
            &advance_recoveries,
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
    let mut lines = vec![
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
    ];
    lines.extend(statutory_payslip_lines(&item.calculation_json));
    lines.extend(advance_recovery_payslip_lines(&item.calculation_json));
    lines.push(format!("Net pay: INR {}", paise_text(item.net_paise)));
    Ok(crate::services::invoice_pdf::render_text_report(
        "STAFF PAYSLIP",
        &lines,
    ))
}

fn statutory_payslip_lines(calculation_json: &Value) -> Vec<String> {
    const LABELS: [(&str, &str); 4] = [
        ("providentFund", "Provident Fund (PF)"),
        ("esic", "ESIC"),
        ("professionalTax", "Professional Tax"),
        ("tds", "TDS"),
    ];
    let Some(statutory) = calculation_json.get("statutory") else {
        return vec![];
    };
    let breakdown = statutory.get("breakdown").and_then(Value::as_object);
    let has_any = breakdown.is_some_and(|b| !b.is_empty());
    if !has_any {
        return vec![];
    }
    let breakdown = breakdown.unwrap();
    let mut lines = vec!["Statutory deductions (PF/ESIC/PT/TDS):".to_string()];
    for (key, label) in LABELS {
        if let Some(entry) = breakdown.get(key) {
            let employee_paise = entry.get("employeePaise").and_then(Value::as_i64).unwrap_or(0);
            lines.push(format!("  {label}: INR {}", paise_text(employee_paise)));
        }
    }
    let employer_paise = statutory
        .get("employerPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let accrual_paise = statutory
        .get("accrualPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if employer_paise > 0 || accrual_paise > 0 {
        lines.push(format!(
            "  Employer contribution (informational, not deducted): INR {}",
            paise_text(employer_paise + accrual_paise)
        ));
    }
    lines
}

fn advance_recovery_payslip_lines(calculation_json: &Value) -> Vec<String> {
    let Some(advance_recovery) = calculation_json.get("advanceRecovery") else {
        return vec![];
    };
    let total_paise = advance_recovery
        .get("totalRecoveredPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if total_paise <= 0 {
        return vec![];
    }
    vec![format!(
        "Salary advance recovery: INR {}",
        paise_text(total_paise)
    )]
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
        attendance_source_hash: item.attendance_source_hash,
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

#[derive(Debug, Default, Clone)]
struct WeekendSandwichMetrics {
    weekend_penalty_count: i64,
    sandwich_penalty_count: i64,
    weekly_off_worked_count: i64,
    breakdown: Vec<Value>,
}

/// Computes weekend/sandwich penalty and weekly-off-worked occurrences for one staff member,
/// purely from attendance/schedule/holiday data already loaded for payroll — no client input,
/// no hardcoded amounts (the amounts themselves come from the admin-configured
/// `staff_payroll_adjustment_rules` via `auto_adjustments`, same as every other auto-adjustment).
///
/// - `weekend_penalty`: exactly one of the day before/after a weekly-off or paid holiday is an
///   unexcused absence.
/// - `sandwich_penalty`: both the day before AND after are unexcused absences (takes priority
///   over weekend_penalty for that off-day — it isn't double-counted as both).
/// - `weekly_off_worked`: staff actually attended a day scheduled as their weekly off.
///
/// An absence only counts if unexcused: a paid holiday or a day covered by an approved-leave
/// schedule entry is exempt entirely, regardless of what the raw attendance status says.
fn compute_weekend_sandwich(
    schedule_rows: &[repository::ScheduleSourceRecord],
    attendance_rows: &[repository::AttendanceSourceRecord],
    paid_holidays: &HashSet<NaiveDate>,
) -> WeekendSandwichMetrics {
    let attendance_status: HashMap<NaiveDate, &str> = attendance_rows
        .iter()
        .map(|row| (row.business_date, row.status.as_str()))
        .collect();
    let schedule_leave_dates: HashSet<NaiveDate> = schedule_rows
        .iter()
        .filter(|row| schedule_leave_type(&row.status).is_some())
        .map(|row| row.schedule_date)
        .collect();
    let is_unexcused_absence = |date: NaiveDate| -> bool {
        attendance_status.get(&date) == Some(&"absent")
            && !paid_holidays.contains(&date)
            && !schedule_leave_dates.contains(&date)
    };

    let mut off_days: Vec<NaiveDate> = schedule_rows
        .iter()
        .filter(|row| row.status == "weekly_off")
        .map(|row| row.schedule_date)
        .collect();
    off_days.extend(paid_holidays.iter().copied());
    off_days.sort();
    off_days.dedup();

    let mut result = WeekendSandwichMetrics::default();
    for off_date in off_days {
        let before = off_date - Duration::days(1);
        let after = off_date + Duration::days(1);
        let before_absent = is_unexcused_absence(before);
        let after_absent = is_unexcused_absence(after);
        if before_absent && after_absent {
            result.sandwich_penalty_count += 1;
            result.breakdown.push(json!({
                "date": off_date,
                "rule": "sandwich_penalty",
                "beforeDate": before,
                "afterDate": after,
            }));
        } else if before_absent || after_absent {
            result.weekend_penalty_count += 1;
            result.breakdown.push(json!({
                "date": off_date,
                "rule": "weekend_penalty",
                "triggeringDate": if before_absent { before } else { after },
            }));
        }
    }
    for row in schedule_rows.iter().filter(|row| row.status == "weekly_off") {
        if matches!(
            attendance_status.get(&row.schedule_date),
            Some(&"clocked_out") | Some(&"present") | Some(&"half_day")
        ) {
            result.weekly_off_worked_count += 1;
            result.breakdown.push(json!({
                "date": row.schedule_date,
                "rule": "weekly_off_worked",
            }));
        }
    }
    result
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
    weekend_sandwich: &WeekendSandwichMetrics,
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
            "weekend_penalty" => weekend_sandwich.weekend_penalty_count,
            "sandwich_penalty" => weekend_sandwich.sandwich_penalty_count,
            "weekly_off_worked" => weekend_sandwich.weekly_off_worked_count,
            "fixed" => 1,
            _ => 0,
        };
        let occurrences = rule_occurrences(metric, rule.trigger_count, &rule.application_mode);
        if occurrences == 0 || rule.amount_paise <= 0 {
            continue;
        }
        let amount_paise = rule.amount_paise.saturating_mul(occurrences);
        if matches!(rule.kind.as_str(), "fine" | "deduction") && is_statutory_named(&rule.name) {
            result.skipped_statutory_names.push(rule.name.clone());
            continue;
        }
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryProfileInput {
    pub uan: Option<String>,
    pub esic_number: Option<String>,
    pub pan_number: Option<String>,
    pub pt_state_code: Option<String>,
    pub pf_opt_in: Option<bool>,
    pub esic_opt_in: Option<bool>,
}

pub async fn list_statutory_profiles(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<repository::StatutoryProfileRecord>, AppError> {
    repository::list_statutory_profiles(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load statutory profiles"))
}

pub async fn save_statutory_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    input: StatutoryProfileInput,
) -> Result<repository::StatutoryProfileRecord, AppError> {
    let field = |v: Option<String>, label: &str| -> Result<String, AppError> {
        let v = v.unwrap_or_default().trim().to_string();
        if v.chars().count() > 32 {
            return Err(AppError::validation(format!("{label} is too long")));
        }
        Ok(v)
    };
    let uan = field(input.uan, "UAN")?;
    let esic_number = field(input.esic_number, "ESIC number")?;
    let pan_number = field(input.pan_number, "PAN")?;
    let pt_state_code = field(input.pt_state_code, "PT state code")?;
    repository::upsert_statutory_profile(
        db,
        tenant_id,
        branch_id,
        staff_id,
        actor_user_id,
        &uan,
        &esic_number,
        &pan_number,
        &pt_state_code,
        input.pf_opt_in.unwrap_or(true),
        input.esic_opt_in.unwrap_or(true),
    )
    .await
    .map_err(|_| AppError::internal("failed to save statutory profile"))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPeriodScheduleInput {
    pub period_month: NaiveDate,
    pub cutoff_date: Option<NaiveDate>,
    pub correction_deadline: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPeriodLockInput {
    pub period_month: NaiveDate,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPeriodReopenInput {
    pub reason: String,
}

fn validate_period_reason(value: &str) -> Result<String, AppError> {
    let reason = value.trim();
    if reason.is_empty() || reason.chars().count() > 500 {
        return Err(AppError::validation(
            "reason must contain 1 to 500 characters",
        ));
    }
    Ok(reason.to_string())
}

fn as_period_month(date: NaiveDate) -> Result<NaiveDate, AppError> {
    date.with_day(1)
        .ok_or_else(|| AppError::validation("period month is invalid"))
}

pub async fn list_payroll_periods(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<repository::PayrollPeriodRecord>, AppError> {
    repository::list_payroll_periods(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load payroll periods"))
}

pub async fn set_payroll_period_schedule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: PayrollPeriodScheduleInput,
) -> Result<repository::PayrollPeriodRecord, AppError> {
    let period_month = as_period_month(input.period_month)?;
    if let Some(cutoff) = input.cutoff_date {
        if cutoff < period_month {
            return Err(AppError::validation(
                "cutoff date cannot be before the payroll period",
            ));
        }
    }
    if let Some(deadline) = input.correction_deadline {
        if deadline < period_month {
            return Err(AppError::validation(
                "correction deadline cannot be before the payroll period",
            ));
        }
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payroll period update"))?;
    repository::lock_payroll_period_advisory(&mut tx, tenant_id, branch_id, period_month)
        .await
        .map_err(|_| AppError::internal("failed to lock payroll period"))?;
    let record = repository::set_payroll_period_schedule(
        &mut tx,
        tenant_id,
        branch_id,
        period_month,
        input.cutoff_date,
        input.correction_deadline,
    )
    .await
    .map_err(|_| AppError::internal("failed to save payroll period schedule"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payroll period schedule"))?;
    Ok(record)
}

pub async fn lock_payroll_period(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: PayrollPeriodLockInput,
) -> Result<repository::PayrollPeriodRecord, AppError> {
    let period_month = as_period_month(input.period_month)?;
    let reason = validate_period_reason(&input.reason)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payroll period lock"))?;
    repository::lock_payroll_period_advisory(&mut tx, tenant_id, branch_id, period_month)
        .await
        .map_err(|_| AppError::internal("failed to lock payroll period"))?;
    let record = repository::lock_payroll_period(
        &mut tx,
        tenant_id,
        branch_id,
        period_month,
        &reason,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock payroll period"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payroll period lock"))?;
    Ok(record)
}

pub async fn reopen_payroll_period(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    period_month: NaiveDate,
    input: PayrollPeriodReopenInput,
) -> Result<repository::PayrollPeriodRecord, AppError> {
    let period_month = as_period_month(period_month)?;
    let reason = validate_period_reason(&input.reason)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payroll period reopen"))?;
    repository::lock_payroll_period_advisory(&mut tx, tenant_id, branch_id, period_month)
        .await
        .map_err(|_| AppError::internal("failed to lock payroll period"))?;
    let record = repository::reopen_payroll_period(
        &mut tx,
        tenant_id,
        branch_id,
        period_month,
        &reason,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to reopen payroll period"))?
    .ok_or_else(|| AppError::conflict("payroll period is not locked"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payroll period reopen"))?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::{
        best_statutory_rules, compute_statutory, compute_weekend_sandwich, is_statutory_named,
        line_attributions, multiply_divide, paid_holiday_days_x2, period, resolve_statutory_rule,
        settled_provider_reference, validate_payout, PayrollPayoutInput, StatutoryProfileSource,
        StatutoryRuleRecord,
    };
    use crate::repositories::staff_payroll_repository::{
        AttendanceSourceRecord, ScheduleSourceRecord,
    };
    use chrono::Datelike;
    use serde_json::{json, Value};
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

    fn rule(rule_type: &str, state_code: &str, effective_from: &str, json: Value) -> StatutoryRuleRecord {
        StatutoryRuleRecord {
            id: format!("{rule_type}-{state_code}-{effective_from}"),
            rule_type: rule_type.to_string(),
            state_code: state_code.to_string(),
            rule_json: json,
            effective_from: chrono::NaiveDate::parse_from_str(effective_from, "%Y-%m-%d").unwrap(),
            effective_to: None,
            active: true,
            version: 1,
            created_at: chrono::Utc::now(),
            updated_at: None,
        }
    }

    fn profile(pt_state_code: &str, pf_opt_in: bool, esic_opt_in: bool) -> StatutoryProfileSource {
        StatutoryProfileSource {
            staff_id: "staff-1".to_string(),
            uan: String::new(),
            esic_number: String::new(),
            pan_number: String::new(),
            pt_state_code: pt_state_code.to_string(),
            pf_opt_in,
            esic_opt_in,
        }
    }

    #[test]
    fn statutory_named_rules_are_detected_case_and_punctuation_insensitively() {
        assert!(is_statutory_named("PF Deduction"));
        assert!(is_statutory_named("esic-contribution"));
        assert!(is_statutory_named("Professional Tax"));
        assert!(is_statutory_named("TDS"));
        assert!(!is_statutory_named("Late attendance fine"));
    }

    #[test]
    fn resolve_statutory_rule_prefers_staff_state_then_falls_back_to_blank() {
        let rules = vec![
            rule(
                "professional_tax",
                "",
                "2024-01-01",
                json!({"employeeFixedPaise": 20000}),
            ),
            rule(
                "professional_tax",
                "MH",
                "2024-01-01",
                json!({"employeeFixedPaise": 30000}),
            ),
        ];
        let map = best_statutory_rules(&rules);
        assert_eq!(
            resolve_statutory_rule(&map, "professional_tax", "MH")
                .unwrap()
                .state_code,
            "MH"
        );
        assert_eq!(
            resolve_statutory_rule(&map, "professional_tax", "KA")
                .unwrap()
                .state_code,
            ""
        );
    }

    #[test]
    fn compute_statutory_requires_profile_when_rules_are_active() {
        let rules = vec![rule(
            "provident_fund",
            "",
            "2024-01-01",
            json!({"employeeBasisPoints": 1200, "employerBasisPoints": 1200}),
        )];
        let map = best_statutory_rules(&rules);
        let result = compute_statutory(1_000_000, &map, true, None);
        assert_eq!(result.employee_paise, 0);
        assert!(result.errors.iter().any(|e| e.contains("profile is missing")));
    }

    #[test]
    fn compute_statutory_skips_opted_out_and_flags_missing_identifiers() {
        let rules = vec![
            rule(
                "provident_fund",
                "",
                "2024-01-01",
                json!({"employeeBasisPoints": 1200, "employerBasisPoints": 1200}),
            ),
            rule(
                "esic",
                "",
                "2024-01-01",
                json!({"employeeBasisPoints": 75, "employerBasisPoints": 325}),
            ),
        ];
        let map = best_statutory_rules(&rules);
        let opted_out_pf = profile("", false, true);
        let result = compute_statutory(1_000_000, &map, true, Some(&opted_out_pf));
        assert_eq!(result.employee_paise, 12_500); // only ESIC (0.75%) applied, PF skipped
        assert!(result.errors.iter().any(|e| e.contains("ESIC number")));
        assert!(!result.errors.iter().any(|e| e.contains("UAN")));
    }

    #[test]
    fn compute_statutory_is_a_no_op_without_active_rules() {
        let map = best_statutory_rules(&[]);
        let result = compute_statutory(1_000_000, &map, false, None);
        assert_eq!(result.employee_paise, 0);
        assert_eq!(result.employer_paise, 0);
        assert!(result.errors.is_empty());
    }

    fn attendance(date: &str, status: &str) -> AttendanceSourceRecord {
        AttendanceSourceRecord {
            staff_id: "staff-1".to_string(),
            business_date: chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            status: status.to_string(),
            worked_minutes: 0,
            overtime_minutes: 0,
            late_minutes: 0,
            early_leave_minutes: 0,
            break_minutes: 0,
            penalty_paise: 0,
            ot_approval_status: "pending".to_string(),
            approved_overtime_minutes: 0,
        }
    }

    fn schedule(date: &str, status: &str) -> ScheduleSourceRecord {
        ScheduleSourceRecord {
            staff_id: "staff-1".to_string(),
            schedule_date: chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            status: status.to_string(),
            scheduled_minutes: 0,
        }
    }

    #[test]
    fn weekend_penalty_triggers_on_one_sided_unexcused_absence() {
        // Sunday 2026-07-12 is weekly off; staff absent only the day before (Saturday).
        let schedules = vec![schedule("2026-07-12", "weekly_off")];
        let attendance_rows = vec![
            attendance("2026-07-11", "absent"),
            attendance("2026-07-13", "present"),
        ];
        let result = compute_weekend_sandwich(&schedules, &attendance_rows, &HashSet::new());
        assert_eq!(result.weekend_penalty_count, 1);
        assert_eq!(result.sandwich_penalty_count, 0);
    }

    #[test]
    fn sandwich_penalty_triggers_only_when_both_sides_are_unexcused_absences() {
        let schedules = vec![schedule("2026-07-12", "weekly_off")];
        let attendance_rows = vec![
            attendance("2026-07-11", "absent"),
            attendance("2026-07-13", "absent"),
        ];
        let result = compute_weekend_sandwich(&schedules, &attendance_rows, &HashSet::new());
        assert_eq!(result.sandwich_penalty_count, 1);
        assert_eq!(result.weekend_penalty_count, 0);
    }

    #[test]
    fn approved_leave_and_holiday_exempt_the_adjacent_absence() {
        // Same shape as the sandwich case, but the day after is an approved leave and the
        // weekly-off itself is also a paid holiday — neither should trigger any penalty.
        let schedules = vec![
            schedule("2026-07-12", "weekly_off"),
            schedule("2026-07-13", "annual_leave"),
        ];
        let attendance_rows = vec![
            attendance("2026-07-11", "absent"),
            attendance("2026-07-13", "absent"),
        ];
        let holidays = HashSet::from([chrono::NaiveDate::parse_from_str("2026-07-11", "%Y-%m-%d").unwrap()]);
        let result = compute_weekend_sandwich(&schedules, &attendance_rows, &holidays);
        assert_eq!(result.weekend_penalty_count, 0);
        assert_eq!(result.sandwich_penalty_count, 0);
    }

    #[test]
    fn weekly_off_worked_triggers_when_staff_attends_their_off_day() {
        let schedules = vec![schedule("2026-07-12", "weekly_off")];
        let attendance_rows = vec![attendance("2026-07-12", "present")];
        let result = compute_weekend_sandwich(&schedules, &attendance_rows, &HashSet::new());
        assert_eq!(result.weekly_off_worked_count, 1);
        assert_eq!(result.weekend_penalty_count, 0);
    }
}
