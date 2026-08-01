use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, FromRow)]
pub struct StaffSourceRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub pay_rate_type: Option<String>,
    pub pay_rate_paise: Option<i64>,
    pub joining_date: Option<NaiveDate>,
    pub mandatory_break_minutes: i32,
    pub max_work_hours: i32,
}

#[derive(Debug, FromRow)]
pub struct CommissionRuleSource {
    pub staff_id: String,
    pub applies_to: String,
    pub rate_percent: i32,
}

#[derive(Debug, FromRow)]
pub struct CatalogCommissionSource {
    pub staff_id: String,
    pub item_type: String,
    pub item_id: String,
    pub commission_percent: Option<i32>,
}

#[derive(Debug, FromRow)]
pub struct LeavePolicySource {
    pub staff_id: String,
    pub leave_type: String,
}

#[derive(Debug, FromRow)]
pub struct AttendanceSourceRecord {
    pub staff_id: String,
    pub business_date: NaiveDate,
    pub status: String,
    pub worked_minutes: i32,
    pub overtime_minutes: i32,
    pub late_minutes: i32,
    pub early_leave_minutes: i32,
    pub break_minutes: i32,
    pub penalty_paise: i64,
    pub ot_approval_status: String,
    pub approved_overtime_minutes: i32,
}

#[derive(Debug, FromRow)]
pub struct ScheduleSourceRecord {
    pub staff_id: String,
    pub schedule_date: NaiveDate,
    pub status: String,
    pub scheduled_minutes: i64,
}

#[derive(Debug, FromRow)]
pub struct SaleLineSourceRecord {
    pub line_type: String,
    pub item_id: String,
    pub staff_id: String,
    pub staff_splits: Value,
    pub taxable_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct CommissionSnapshotSourceRecord {
    pub staff_id: String,
    pub commission_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct TipSourceRecord {
    pub staff_id: String,
    pub tip_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct PayrollAdjustmentRuleSource {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub amount_paise: i64,
    pub trigger_type: String,
    pub trigger_count: i32,
    pub application_mode: String,
}

#[derive(Debug, Clone)]
pub struct PayrollItemDraft {
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
    pub validation_errors: Value,
    pub validation_warnings: Value,
    pub calculation_json: Value,
    pub notes: String,
    pub attendance_source_hash: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRunRecord {
    pub id: String,
    pub cycle: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub status: String,
    pub gross_paise: i64,
    pub deductions_paise: i64,
    pub net_paise: i64,
    pub staff_count: i32,
    pub invalid_count: i32,
    pub created_by: String,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollHistoryRunRecord {
    pub id: String,
    pub cycle: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub status: String,
    pub gross_paise: i64,
    pub deductions_paise: i64,
    pub net_paise: i64,
    pub staff_count: i32,
    pub invalid_count: i32,
    pub created_by: String,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub branch_id: String,
    pub branch_name: String,
    pub payment_method: String,
    pub payment_reference: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollItemRecord {
    pub id: String,
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
    pub validation_errors: Value,
    pub validation_warnings: Value,
    pub calculation_json: Value,
    pub notes: String,
    pub status: String,
    pub attendance_source_hash: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollEventRecord {
    pub id: String,
    pub event_type: String,
    pub actor_user_id: String,
    pub payload_json: Value,
    pub created_at: DateTime<Utc>,
}

pub struct AdjustmentInput {
    pub staff_id: String,
    pub adjustment_paise: i64,
    pub notes: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct StatutoryProfileSource {
    pub staff_id: String,
    pub uan: String,
    pub esic_number: String,
    pub pan_number: String,
    pub pt_state_code: String,
    pub pf_opt_in: bool,
    pub esic_opt_in: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StatutoryProfileRecord {
    pub id: String,
    pub staff_id: String,
    pub uan: String,
    pub esic_number: String,
    pub pan_number: String,
    pub pt_state_code: String,
    pub pf_opt_in: bool,
    pub esic_opt_in: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct LegacyStatutoryPiiRecord {
    pub id: String,
    pub uan: String,
    pub esic_number: String,
    pub pan_number: String,
}

/// Per-staff PF/ESIC/PT/TDS contribution computed for one payroll item, threaded from the
/// service layer into the repository so it can be persisted into
/// `staff_payroll_statutory_calculations` in the same transaction as the payroll item.
#[derive(Debug, Clone)]
pub struct StatutoryContribution {
    pub staff_id: String,
    pub employee_paise: i64,
    pub employer_paise: i64,
    pub accrual_paise: i64,
    pub breakdown: Value,
}

/// A staff member's active salary advance as seen from the payroll engine — just enough to
/// schedule this period's recovery against the run-time capacity cap.
#[derive(Debug, Clone, FromRow)]
pub struct ActiveAdvanceSource {
    pub id: String,
    pub staff_id: String,
    pub outstanding_paise: i64,
    pub installment_amount_paise: i64,
    pub pending_carry_forward_paise: i64,
}

/// Per-staff advance recovery computed for one payroll item, threaded from the service layer
/// into the repository so it can be persisted into `staff_advance_recoveries` in the same
/// transaction as the payroll item. The ledger balance itself is only decremented later, when
/// the run is finalized (see `transition_run`) — recalculating a draft never mutates it.
#[derive(Debug, Clone, FromRow)]
pub struct AdvanceRecoveryContribution {
    pub staff_id: String,
    pub advance_id: String,
    pub scheduled_paise: i64,
    pub recovered_paise: i64,
    pub carried_forward_paise: i64,
    pub outstanding_after_paise: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffHolidayRecord {
    pub id: String,
    pub holiday_date: NaiveDate,
    pub name: String,
    pub is_paid: bool,
    pub active: bool,
}

pub async fn staff_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    period_end: NaiveDate,
) -> Result<Vec<StaffSourceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT s.id AS staff_id,
               TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS staff_name,
               s.employee_code,
               pay.rate_type AS pay_rate_type,
               pay.amount_paise AS pay_rate_paise,
               profile.joining_date,
               COALESCE(profile.mandatory_break_minutes,0) mandatory_break_minutes,
               COALESCE(profile.max_work_hours,0) max_work_hours
        FROM staff s
        LEFT JOIN staff_profiles profile ON profile.tenant_id=s.tenant_id AND profile.branch_id=s.branch_id AND profile.staff_id=s.id
        LEFT JOIN LATERAL (
          SELECT rate_type,amount_paise
          FROM staff_pay_rates pr
          WHERE pr.tenant_id=s.tenant_id AND pr.branch_id=s.branch_id AND pr.staff_id=s.id
            AND pr.active=true AND (pr.effective_from IS NULL OR pr.effective_from <= $4)
          ORDER BY pr.effective_from DESC NULLS LAST,pr.created_at DESC LIMIT 1
        ) pay ON true
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=true
          AND ($3='' OR s.id=$3)
        ORDER BY s.first_name,s.last_name,s.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn statutory_profiles(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<Vec<StatutoryProfileSource>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as("SELECT staff_id,CASE WHEN uan_ciphertext='' THEN '' ELSE '********'||uan_last_four END uan,CASE WHEN esic_number_ciphertext='' THEN '' ELSE '********'||esic_number_last_four END esic_number,CASE WHEN pan_number_ciphertext='' THEN '' ELSE '******'||pan_number_last_four END pan_number,pt_state_code,pf_opt_in,esic_opt_in FROM staff_statutory_profiles WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3)")
        .bind(tenant_id).bind(branch_id).bind(staff_ids).fetch_all(db).await
}

pub async fn list_statutory_profiles(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StatutoryProfileRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,CASE WHEN uan_ciphertext='' THEN '' ELSE '********'||uan_last_four END uan,CASE WHEN esic_number_ciphertext='' THEN '' ELSE '********'||esic_number_last_four END esic_number,CASE WHEN pan_number_ciphertext='' THEN '' ELSE '******'||pan_number_last_four END pan_number,pt_state_code,pf_opt_in,esic_opt_in,version,created_at,updated_at FROM staff_statutory_profiles WHERE tenant_id=$1 AND branch_id=$2 ORDER BY staff_id")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn upsert_statutory_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    uan_ciphertext: &str,
    uan_last_four: &str,
    esic_number_ciphertext: &str,
    esic_number_last_four: &str,
    pan_number_ciphertext: &str,
    pan_number_last_four: &str,
    pt_state_code: &str,
    pf_opt_in: bool,
    esic_opt_in: bool,
) -> Result<StatutoryProfileRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_statutory_profiles(tenant_id,branch_id,staff_id,uan_ciphertext,uan_last_four,esic_number_ciphertext,esic_number_last_four,pan_number_ciphertext,pan_number_last_four,pt_state_code,pf_opt_in,esic_opt_in,created_by)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)
        ON CONFLICT(tenant_id,branch_id,staff_id) DO UPDATE SET
          uan='',esic_number='',pan_number='',
          uan_ciphertext=EXCLUDED.uan_ciphertext,uan_last_four=EXCLUDED.uan_last_four,
          esic_number_ciphertext=EXCLUDED.esic_number_ciphertext,esic_number_last_four=EXCLUDED.esic_number_last_four,
          pan_number_ciphertext=EXCLUDED.pan_number_ciphertext,pan_number_last_four=EXCLUDED.pan_number_last_four,
          pt_state_code=EXCLUDED.pt_state_code,pf_opt_in=EXCLUDED.pf_opt_in,esic_opt_in=EXCLUDED.esic_opt_in,
          version=staff_statutory_profiles.version+1,updated_at=NOW()
        RETURNING id,staff_id,CASE WHEN uan_ciphertext='' THEN '' ELSE '********'||uan_last_four END uan,CASE WHEN esic_number_ciphertext='' THEN '' ELSE '********'||esic_number_last_four END esic_number,CASE WHEN pan_number_ciphertext='' THEN '' ELSE '******'||pan_number_last_four END pan_number,pt_state_code,pf_opt_in,esic_opt_in,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(staff_id).bind(uan_ciphertext).bind(uan_last_four)
    .bind(esic_number_ciphertext).bind(esic_number_last_four).bind(pan_number_ciphertext)
    .bind(pan_number_last_four).bind(pt_state_code).bind(pf_opt_in).bind(esic_opt_in).bind(actor_user_id)
    .fetch_one(db).await
}

pub async fn legacy_statutory_pii(
    db: &PgPool,
) -> Result<Vec<LegacyStatutoryPiiRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,uan,esic_number,pan_number FROM staff_statutory_profiles WHERE uan<>'' OR esic_number<>'' OR pan_number<>'' ORDER BY id")
        .fetch_all(db).await
}

pub async fn protect_legacy_statutory_pii(
    db: &PgPool,
    id: &str,
    uan_ciphertext: &str,
    uan_last_four: &str,
    esic_number_ciphertext: &str,
    esic_number_last_four: &str,
    pan_number_ciphertext: &str,
    pan_number_last_four: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE staff_statutory_profiles SET uan='',esic_number='',pan_number='',uan_ciphertext=$2,uan_last_four=$3,esic_number_ciphertext=$4,esic_number_last_four=$5,pan_number_ciphertext=$6,pan_number_last_four=$7,updated_at=NOW() WHERE id=$1")
        .bind(id).bind(uan_ciphertext).bind(uan_last_four).bind(esic_number_ciphertext)
        .bind(esic_number_last_four).bind(pan_number_ciphertext).bind(pan_number_last_four)
        .execute(db).await?;
    Ok(())
}

pub async fn validate_statutory_plaintext_constraint(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("ALTER TABLE staff_statutory_profiles VALIDATE CONSTRAINT staff_statutory_profiles_plaintext_empty")
        .execute(db).await?;
    Ok(())
}

pub async fn active_advances(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    as_of: NaiveDate,
) -> Result<Vec<ActiveAdvanceSource>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT id,staff_id,outstanding_paise,installment_amount_paise,pending_carry_forward_paise
          FROM staff_salary_advances
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3)
           AND status IN ('disbursed','recovering') AND outstanding_paise>0
           AND recovery_start_period<=$4
         ORDER BY created_at ASC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .bind(as_of)
    .fetch_all(db)
    .await
}

pub async fn commission_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    period_end: NaiveDate,
) -> Result<Vec<CommissionRuleSource>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as("SELECT staff_id,applies_to,rate_percent FROM staff_commission_rules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND active=true AND (effective_from IS NULL OR effective_from <= $4) ORDER BY effective_from DESC NULLS LAST,created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(staff_ids).bind(period_end).fetch_all(db).await
}

pub async fn catalog_commissions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<Vec<CatalogCommissionSource>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as("SELECT staff_id,item_type,item_id,commission_percent FROM staff_catalog_assignments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND commission_percent IS NOT NULL")
        .bind(tenant_id).bind(branch_id).bind(staff_ids).fetch_all(db).await
}

pub async fn leave_policies(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<Vec<LeavePolicySource>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as("SELECT staff_id,leave_type FROM staff_leave_policies WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND active=true AND leave_type <> 'unpaid'")
        .bind(tenant_id).bind(branch_id).bind(staff_ids).fetch_all(db).await
}

pub async fn attendance_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<AttendanceSourceRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as("SELECT staff_id,business_date,status,worked_minutes,overtime_minutes,late_minutes,early_leave_minutes,break_minutes,penalty_paise,ot_approval_status,approved_overtime_minutes FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND business_date BETWEEN $4 AND $5")
        .bind(tenant_id).bind(branch_id).bind(staff_ids).bind(period_start).bind(period_end).fetch_all(db).await
}

pub async fn schedule_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<ScheduleSourceRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT staff_id,schedule_date,status,
          (COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)
           + COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0))::BIGINT AS scheduled_minutes
        FROM staff_schedules
        WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND schedule_date BETWEEN $4 AND $5
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(staff_ids).bind(period_start).bind(period_end).fetch_all(db).await
}

pub async fn sale_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<SaleLineSourceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT l.line_type,l.item_id,l.staff_id,l.staff_splits,l.taxable_paise
        FROM pos_sale_lines l
        JOIN pos_sales s ON s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id AND s.id=l.sale_id
        WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.business_date BETWEEN $3 AND $4
          AND LOWER(s.status) NOT IN ('void','voided','refunded','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM pos_staff_commission_snapshots snap
             WHERE snap.tenant_id=l.tenant_id AND snap.branch_id=l.branch_id AND snap.sale_line_id=l.id
          )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn commission_snapshots(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<CommissionSnapshotSourceRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT staff_id,COALESCE(SUM(commission_paise),0)::BIGINT AS commission_paise
          FROM pos_staff_commission_snapshots
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3)
           AND business_date BETWEEN $4 AND $5
         GROUP BY staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn tip_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<TipSourceRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT s.staff_id,COALESCE(SUM(s.tip_paise),0)::BIGINT AS tip_paise
          FROM pos_sales s
         WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.staff_id=ANY($3)
           AND s.business_date BETWEEN $4 AND $5
           AND s.tip_paise > 0
           AND LOWER(s.status) NOT IN ('draft','void','voided','refunded','cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM staff_tip_payout_items item
              WHERE item.tenant_id=s.tenant_id AND item.branch_id=s.branch_id AND item.sale_id=s.id
           )
         GROUP BY s.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn payroll_adjustment_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PayrollAdjustmentRuleSource>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,kind,name,amount_paise,trigger_type,trigger_count,application_mode
          FROM staff_payroll_adjustment_rules
         WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND auto_apply=TRUE
         ORDER BY kind,name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn run_for_period(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Option<PayrollRunRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 AND cycle='monthly' AND period_start=$3 AND period_end=$4")
        .bind(tenant_id).bind(branch_id).bind(period_start).bind(period_end).fetch_optional(db).await
}

pub async fn list_runs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PayrollRunRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY period_start DESC,created_at DESC LIMIT 120")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

/// Filters for the payroll history search/export endpoints. Every string field is treated as
/// "no filter" when empty, matching the `($n='' OR ...)` idiom already used elsewhere in this
/// repository (e.g. `staff_sources`).
pub struct PayrollHistoryFilters<'a> {
    pub tenant_id: &'a str,
    pub branch_ids: &'a [String],
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub status: &'a str,
    pub validation_state: &'a str,
    pub payment_method: &'a str,
    pub staff_id: &'a str,
    pub category: &'a str,
    pub search: &'a str,
}

const PAYROLL_HISTORY_WHERE: &str = r#"
    r.tenant_id=$1 AND r.branch_id=ANY($2)
    AND ($3::date IS NULL OR r.period_end>=$3)
    AND ($4::date IS NULL OR r.period_start<=$4)
    AND ($5='' OR r.status=$5)
    AND ($6='' OR ($6='valid' AND r.invalid_count=0) OR ($6='invalid' AND r.invalid_count>0))
    AND ($7='' OR EXISTS(
      SELECT 1 FROM staff_payroll_payouts p
      WHERE p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id AND p.payroll_run_id=r.id AND p.payment_method=$7
    ))
    AND ($8='' OR EXISTS(
      SELECT 1 FROM staff_payroll_items i
      WHERE i.tenant_id=r.tenant_id AND i.branch_id=r.branch_id AND i.payroll_run_id=r.id AND i.staff_id=$8
    ))
    AND ($9='' OR EXISTS(
      SELECT 1 FROM staff_payroll_items i JOIN staff s
        ON s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id AND s.id=i.staff_id
      WHERE i.tenant_id=r.tenant_id AND i.branch_id=r.branch_id AND i.payroll_run_id=r.id AND s.job_title=$9
    ))
    AND ($10='' OR EXISTS(
      SELECT 1 FROM staff_payroll_items i
      WHERE i.tenant_id=r.tenant_id AND i.branch_id=r.branch_id AND i.payroll_run_id=r.id
        AND (i.staff_name ILIKE '%'||$10||'%' OR i.employee_code ILIKE '%'||$10||'%')
    ))
"#;

pub async fn list_runs_filtered(
    db: &PgPool,
    filters: &PayrollHistoryFilters<'_>,
    page: i64,
    page_size: i64,
) -> Result<Vec<PayrollHistoryRunRecord>, sqlx::Error> {
    let sql = format!(
        "SELECT r.id,r.cycle,r.period_start,r.period_end,r.status,r.gross_paise,r.deductions_paise,r.net_paise,\
         r.staff_count,r.invalid_count,r.created_by,r.reviewed_at,r.finalized_at,r.paid_at,r.created_at,r.updated_at,\
         r.branch_id,COALESCE(b.name,'') AS branch_name,\
         COALESCE((SELECT p.payment_method FROM staff_payroll_payouts p WHERE p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id AND p.payroll_run_id=r.id ORDER BY p.paid_at DESC LIMIT 1),'') AS payment_method,\
         COALESCE((SELECT p.reference FROM staff_payroll_payouts p WHERE p.tenant_id=r.tenant_id AND p.branch_id=r.branch_id AND p.payroll_run_id=r.id ORDER BY p.paid_at DESC LIMIT 1),'') AS payment_reference \
         FROM staff_payroll_runs r LEFT JOIN branches b ON b.tenant_id=r.tenant_id AND b.id=r.branch_id WHERE {PAYROLL_HISTORY_WHERE} \
         ORDER BY r.period_start DESC,r.created_at DESC LIMIT $11 OFFSET $12"
    );
    sqlx::query_as(&sql)
        .bind(filters.tenant_id)
        .bind(filters.branch_ids)
        .bind(filters.from)
        .bind(filters.to)
        .bind(filters.status)
        .bind(filters.validation_state)
        .bind(filters.payment_method)
        .bind(filters.staff_id)
        .bind(filters.category)
        .bind(filters.search)
        .bind(page_size)
        .bind((page - 1) * page_size)
        .fetch_all(db)
        .await
}

pub async fn count_runs_filtered(
    db: &PgPool,
    filters: &PayrollHistoryFilters<'_>,
) -> Result<i64, sqlx::Error> {
    let sql = format!("SELECT COUNT(*) FROM staff_payroll_runs r WHERE {PAYROLL_HISTORY_WHERE}");
    sqlx::query_scalar(&sql)
        .bind(filters.tenant_id)
        .bind(filters.branch_ids)
        .bind(filters.from)
        .bind(filters.to)
        .bind(filters.status)
        .bind(filters.validation_state)
        .bind(filters.payment_method)
        .bind(filters.staff_id)
        .bind(filters.category)
        .bind(filters.search)
        .fetch_one(db)
        .await
}

pub async fn get_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Option<PayrollRunRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_optional(db).await
}

pub async fn get_items(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Vec<PayrollItemRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,staff_name,employee_code,pay_rate_type,pay_rate_paise,attendance_days_x2,paid_leave_days_x2,weekly_off_days_x2,holiday_days_x2,worked_minutes,overtime_minutes,earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,penalty_paise,gross_paise,deductions_paise,net_paise,validation_errors,validation_warnings,calculation_json,notes,status,attendance_source_hash FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 ORDER BY staff_name,staff_id")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_all(db).await
}

/// Attendance-source hash recorded the last time each of these staff members' payroll items
/// was calculated for this run (empty string if the staff has no prior item, e.g. first
/// calculation) — used to detect and warn when attendance changed since then.
pub async fn existing_attendance_hashes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_ids: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT staff_id,attendance_source_hash FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=ANY($4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Advance recoveries actually applied for a finalized run — used to notify affected staff
/// once the recovery is real (matches the same `applied=TRUE` rows `transition_run` just set).
pub async fn applied_advance_recoveries_for_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Vec<AdvanceRecoveryContribution>, sqlx::Error> {
    sqlx::query_as(
        "SELECT staff_id,advance_id,scheduled_paise,recovered_paise,carried_forward_paise,outstanding_after_paise \
         FROM staff_advance_recoveries WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND applied=TRUE AND recovered_paise>0",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .fetch_all(db)
    .await
}

pub async fn get_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Vec<PayrollEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,actor_user_id,payload_json,created_at FROM staff_payroll_events WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 ORDER BY created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_all(db).await
}

pub async fn replace_calculated_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    actor_user_id: &str,
    items: &[PayrollItemDraft],
    statutory: &[StatutoryContribution],
    advance_recoveries: &[AdvanceRecoveryContribution],
) -> Result<PayrollRunRecord, sqlx::Error> {
    let gross_paise = items.iter().map(|item| item.gross_paise).sum::<i64>();
    let deductions_paise = items.iter().map(|item| item.deductions_paise).sum::<i64>();
    let net_paise = items.iter().map(|item| item.net_paise).sum::<i64>();
    let invalid_count = items
        .iter()
        .filter(|item| {
            item.validation_errors
                .as_array()
                .is_some_and(|errors| !errors.is_empty())
        })
        .count() as i32;
    let mut tx = db.begin().await?;
    let run: PayrollRunRecord = sqlx::query_as(
        r#"
        INSERT INTO staff_payroll_runs(tenant_id,branch_id,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by)
        VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9,$10)
        ON CONFLICT (tenant_id,branch_id,cycle,period_start,period_end)
        DO UPDATE SET status='calculated',gross_paise=EXCLUDED.gross_paise,deductions_paise=EXCLUDED.deductions_paise,
          net_paise=EXCLUDED.net_paise,staff_count=EXCLUDED.staff_count,invalid_count=EXCLUDED.invalid_count,
          reviewed_by=NULL,reviewed_at=NULL,updated_at=NOW()
        RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(period_start).bind(period_end)
    .bind(gross_paise).bind(deductions_paise).bind(net_paise).bind(items.len() as i32).bind(invalid_count).bind(actor_user_id)
    .fetch_one(&mut *tx).await?;
    sqlx::query(
        "DELETE FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&run.id)
    .execute(&mut *tx)
    .await?;
    for item in items {
        let item_id = insert_payroll_item(&mut tx, tenant_id, branch_id, &run.id, item).await?;
        if let Some(contribution) = statutory.iter().find(|c| c.staff_id == item.staff_id) {
            upsert_statutory_calculation(
                &mut tx,
                tenant_id,
                branch_id,
                &run.id,
                &item_id,
                period_start,
                period_end,
                item.gross_paise,
                actor_user_id,
                contribution,
            )
            .await?;
        }
        for contribution in advance_recoveries
            .iter()
            .filter(|c| c.staff_id == item.staff_id)
        {
            upsert_advance_recovery(
                &mut tx,
                tenant_id,
                branch_id,
                &run.id,
                &item_id,
                period_start,
                period_end,
                actor_user_id,
                contribution,
            )
            .await?;
        }
    }
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.calculated',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(&run.id).bind(actor_user_id)
        .bind(serde_json::json!({"staffCount":items.len(),"invalidCount":invalid_count})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(run)
}

#[derive(Debug, FromRow)]
struct SelectedItemSnapshot {
    staff_id: String,
    attendance_days_x2: i32,
    paid_leave_days_x2: i32,
    weekly_off_days_x2: i32,
    holiday_days_x2: i32,
    worked_minutes: i32,
    overtime_minutes: i32,
    earned_salary_paise: i64,
    overtime_paise: i64,
    commission_paise: i64,
    adjustment_paise: i64,
    gross_paise: i64,
    deductions_paise: i64,
    net_paise: i64,
    calculation_json: Value,
}

fn snapshot_tips_paise(calculation_json: &Value) -> i64 {
    calculation_json
        .get("tipsPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0)
}

fn snapshot_json(snapshot: &SelectedItemSnapshot) -> Value {
    serde_json::json!({
        "attendanceDaysX2": snapshot.attendance_days_x2,
        "paidLeaveDaysX2": snapshot.paid_leave_days_x2,
        "weeklyOffDaysX2": snapshot.weekly_off_days_x2,
        "holidayDaysX2": snapshot.holiday_days_x2,
        "workedMinutes": snapshot.worked_minutes,
        "overtimeMinutes": snapshot.overtime_minutes,
        "earnedSalaryPaise": snapshot.earned_salary_paise,
        "overtimePaise": snapshot.overtime_paise,
        "commissionPaise": snapshot.commission_paise,
        "tipsPaise": snapshot_tips_paise(&snapshot.calculation_json),
        "adjustmentPaise": snapshot.adjustment_paise,
        "grossPaise": snapshot.gross_paise,
        "deductionsPaise": snapshot.deductions_paise,
        "netPaise": snapshot.net_paise,
    })
}

fn draft_snapshot_json(item: &PayrollItemDraft) -> Value {
    serde_json::json!({
        "attendanceDaysX2": item.attendance_days_x2,
        "paidLeaveDaysX2": item.paid_leave_days_x2,
        "weeklyOffDaysX2": item.weekly_off_days_x2,
        "holidayDaysX2": item.holiday_days_x2,
        "workedMinutes": item.worked_minutes,
        "overtimeMinutes": item.overtime_minutes,
        "earnedSalaryPaise": item.earned_salary_paise,
        "overtimePaise": item.overtime_paise,
        "commissionPaise": item.commission_paise,
        "tipsPaise": snapshot_tips_paise(&item.calculation_json),
        "adjustmentPaise": item.adjustment_paise,
        "grossPaise": item.gross_paise,
        "deductionsPaise": item.deductions_paise,
        "netPaise": item.net_paise,
    })
}

pub async fn replace_selected_calculated_items(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    actor_user_id: &str,
    items: &[PayrollItemDraft],
    reason: &str,
    statutory: &[StatutoryContribution],
    advance_recoveries: &[AdvanceRecoveryContribution],
) -> Result<PayrollRunRecord, sqlx::Error> {
    let gross_paise = items.iter().map(|item| item.gross_paise).sum::<i64>();
    let deductions_paise = items.iter().map(|item| item.deductions_paise).sum::<i64>();
    let net_paise = items.iter().map(|item| item.net_paise).sum::<i64>();
    let invalid_count = items
        .iter()
        .filter(|item| {
            item.validation_errors
                .as_array()
                .is_some_and(|errors| !errors.is_empty())
        })
        .count() as i32;
    let staff_ids = items
        .iter()
        .map(|item| item.staff_id.clone())
        .collect::<Vec<_>>();
    let mut tx = db.begin().await?;
    let run: PayrollRunRecord = sqlx::query_as(
        r#"
        INSERT INTO staff_payroll_runs(tenant_id,branch_id,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by)
        VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9,$10)
        ON CONFLICT (tenant_id,branch_id,cycle,period_start,period_end)
        DO UPDATE SET status='calculated',reviewed_by=NULL,reviewed_at=NULL,updated_at=NOW()
        RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(period_start).bind(period_end)
    .bind(gross_paise).bind(deductions_paise).bind(net_paise).bind(items.len() as i32).bind(invalid_count).bind(actor_user_id)
    .fetch_one(&mut *tx).await?;
    let before_snapshots: Vec<SelectedItemSnapshot> = sqlx::query_as(
        "SELECT staff_id,attendance_days_x2,paid_leave_days_x2,weekly_off_days_x2,holiday_days_x2,worked_minutes,overtime_minutes,earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,gross_paise,deductions_paise,net_paise,calculation_json FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=ANY($4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&run.id)
    .bind(&staff_ids)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=ANY($4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&run.id)
    .bind(&staff_ids)
    .execute(&mut *tx)
    .await?;
    for item in items {
        let item_id = insert_payroll_item(&mut tx, tenant_id, branch_id, &run.id, item).await?;
        if let Some(contribution) = statutory.iter().find(|c| c.staff_id == item.staff_id) {
            upsert_statutory_calculation(
                &mut tx,
                tenant_id,
                branch_id,
                &run.id,
                &item_id,
                period_start,
                period_end,
                item.gross_paise,
                actor_user_id,
                contribution,
            )
            .await?;
        }
        for contribution in advance_recoveries
            .iter()
            .filter(|c| c.staff_id == item.staff_id)
        {
            upsert_advance_recovery(
                &mut tx,
                tenant_id,
                branch_id,
                &run.id,
                &item_id,
                period_start,
                period_end,
                actor_user_id,
                contribution,
            )
            .await?;
        }
    }
    let run: PayrollRunRecord = sqlx::query_as(
        r#"
        UPDATE staff_payroll_runs r SET
          gross_paise=x.gross_paise,
          deductions_paise=x.deductions_paise,
          net_paise=x.net_paise,
          staff_count=x.staff_count,
          invalid_count=x.invalid_count,
          updated_at=NOW()
        FROM (
          SELECT COALESCE(SUM(gross_paise),0)::BIGINT AS gross_paise,
                 COALESCE(SUM(deductions_paise),0)::BIGINT AS deductions_paise,
                 COALESCE(SUM(net_paise),0)::BIGINT AS net_paise,
                 COUNT(*)::INTEGER AS staff_count,
                 COUNT(*) FILTER (
                   WHERE jsonb_typeof(validation_errors)='array' AND jsonb_array_length(validation_errors) > 0
                 )::INTEGER AS invalid_count
            FROM staff_payroll_items
           WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3
        ) x
        WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3
        RETURNING r.id,r.cycle,r.period_start,r.period_end,r.status,r.gross_paise,r.deductions_paise,r.net_paise,r.staff_count,r.invalid_count,r.created_by,r.reviewed_at,r.finalized_at,r.paid_at,r.created_at,r.updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&run.id)
    .fetch_one(&mut *tx)
    .await?;
    let mut before_by_staff: HashMap<String, &SelectedItemSnapshot> = HashMap::new();
    for snapshot in &before_snapshots {
        before_by_staff.insert(snapshot.staff_id.clone(), snapshot);
    }
    let changes: Vec<Value> = items
        .iter()
        .map(|item| {
            let after = draft_snapshot_json(item);
            match before_by_staff.get(&item.staff_id) {
                Some(before) => serde_json::json!({
                    "staffId": item.staff_id,
                    "before": snapshot_json(before),
                    "after": after,
                }),
                None => serde_json::json!({
                    "staffId": item.staff_id,
                    "before": Value::Null,
                    "after": after,
                }),
            }
        })
        .collect();
    let event_type = if before_snapshots.is_empty() {
        "payroll.selected_staff_calculated"
    } else {
        "payroll.selected_staff_regenerated"
    };
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(&run.id).bind(event_type).bind(actor_user_id)
        .bind(serde_json::json!({"staffIds":staff_ids,"staffCount":items.len(),"invalidCount":invalid_count,"reason":reason,"changes":changes})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(run)
}

async fn insert_payroll_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    item: &PayrollItemDraft,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        INSERT INTO staff_payroll_items(
          tenant_id,branch_id,payroll_run_id,staff_id,staff_name,employee_code,pay_rate_type,pay_rate_paise,
          attendance_days_x2,paid_leave_days_x2,weekly_off_days_x2,holiday_days_x2,worked_minutes,overtime_minutes,
          earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,penalty_paise,gross_paise,
          deductions_paise,net_paise,validation_errors,validation_warnings,calculation_json,notes,status,
          attendance_source_hash
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'calculated',$27)
        RETURNING id
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(run_id).bind(&item.staff_id).bind(&item.staff_name)
    .bind(&item.employee_code).bind(&item.pay_rate_type).bind(item.pay_rate_paise)
    .bind(item.attendance_days_x2).bind(item.paid_leave_days_x2).bind(item.weekly_off_days_x2).bind(item.holiday_days_x2)
    .bind(item.worked_minutes).bind(item.overtime_minutes).bind(item.earned_salary_paise)
    .bind(item.overtime_paise).bind(item.commission_paise).bind(item.adjustment_paise)
    .bind(item.penalty_paise).bind(item.gross_paise).bind(item.deductions_paise).bind(item.net_paise)
    .bind(&item.validation_errors).bind(&item.validation_warnings).bind(&item.calculation_json).bind(&item.notes)
    .bind(&item.attendance_source_hash)
    .fetch_one(&mut **tx).await
}

async fn upsert_statutory_calculation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    item_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    gross_paise: i64,
    actor_user_id: &str,
    contribution: &StatutoryContribution,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO staff_payroll_statutory_calculations(
          tenant_id,branch_id,payroll_run_id,payroll_item_id,staff_id,period_start,period_end,gross_paise,
          employee_deduction_paise,employer_contribution_paise,accrual_paise,breakdown_json,calculated_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(tenant_id,branch_id,payroll_item_id) DO UPDATE SET
          employee_deduction_paise=EXCLUDED.employee_deduction_paise,
          employer_contribution_paise=EXCLUDED.employer_contribution_paise,
          accrual_paise=EXCLUDED.accrual_paise,breakdown_json=EXCLUDED.breakdown_json,
          calculated_by=EXCLUDED.calculated_by,calculated_at=NOW()
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(run_id).bind(item_id).bind(&contribution.staff_id)
    .bind(period_start).bind(period_end).bind(gross_paise)
    .bind(contribution.employee_paise).bind(contribution.employer_paise).bind(contribution.accrual_paise)
    .bind(&contribution.breakdown).bind(actor_user_id)
    .execute(&mut **tx).await?;
    Ok(())
}

async fn upsert_advance_recovery(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    item_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    actor_user_id: &str,
    contribution: &AdvanceRecoveryContribution,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO staff_advance_recoveries(
          tenant_id,branch_id,advance_id,payroll_run_id,payroll_item_id,staff_id,period_start,period_end,
          scheduled_paise,recovered_paise,carried_forward_paise,outstanding_after_paise,recorded_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(tenant_id,branch_id,payroll_item_id,advance_id) DO UPDATE SET
          scheduled_paise=EXCLUDED.scheduled_paise,recovered_paise=EXCLUDED.recovered_paise,
          carried_forward_paise=EXCLUDED.carried_forward_paise,outstanding_after_paise=EXCLUDED.outstanding_after_paise,
          recorded_by=EXCLUDED.recorded_by,recorded_at=NOW(),applied=FALSE
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(&contribution.advance_id).bind(run_id).bind(item_id)
    .bind(&contribution.staff_id).bind(period_start).bind(period_end)
    .bind(contribution.scheduled_paise).bind(contribution.recovered_paise)
    .bind(contribution.carried_forward_paise).bind(contribution.outstanding_after_paise)
    .bind(actor_user_id)
    .execute(&mut **tx).await?;
    Ok(())
}

pub async fn list_holidays(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<StaffHolidayRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,holiday_date,name,is_paid,active FROM staff_holidays WHERE tenant_id=$1 AND branch_id=$2 AND holiday_date BETWEEN $3 AND $4 AND active=TRUE ORDER BY holiday_date,name")
        .bind(tenant_id).bind(branch_id).bind(from).bind(to).fetch_all(db).await
}

pub async fn upsert_holiday(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    holiday_date: NaiveDate,
    name: &str,
    is_paid: bool,
    actor_user_id: &str,
) -> Result<StaffHolidayRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_holidays(tenant_id,branch_id,holiday_date,name,is_paid,active,created_by) VALUES($1,$2,$3,$4,$5,TRUE,$6) ON CONFLICT(tenant_id,branch_id,holiday_date) DO UPDATE SET name=EXCLUDED.name,is_paid=EXCLUDED.is_paid,active=TRUE,updated_at=NOW() RETURNING id,holiday_date,name,is_paid,active")
        .bind(tenant_id).bind(branch_id).bind(holiday_date).bind(name).bind(is_paid).bind(actor_user_id).fetch_one(db).await
}

pub async fn deactivate_holiday(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE staff_holidays SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).execute(db).await?.rows_affected() == 1)
}

pub async fn update_adjustments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    entries: &[AdjustmentInput],
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    for entry in entries {
        let updated = sqlx::query(
            r#"
            UPDATE staff_payroll_items SET adjustment_paise=COALESCE((calculation_json->>'generatedPositiveAdjustmentPaise')::BIGINT,0)+$4,notes=$5,
              gross_paise=earned_salary_paise+overtime_paise+commission_paise+COALESCE((calculation_json->>'generatedPositiveAdjustmentPaise')::BIGINT,0)+GREATEST($4,0),
              deductions_paise=penalty_paise+COALESCE((calculation_json->>'generatedAutoDeductionPaise')::BIGINT,0)+COALESCE((calculation_json->>'generatedStatutoryDeductionPaise')::BIGINT,0)+COALESCE((calculation_json->>'generatedAdvanceRecoveryPaise')::BIGINT,0)+GREATEST(-$4,0),
              net_paise=GREATEST(earned_salary_paise+overtime_paise+commission_paise+COALESCE((calculation_json->>'generatedPositiveAdjustmentPaise')::BIGINT,0)+$4-penalty_paise-COALESCE((calculation_json->>'generatedAutoDeductionPaise')::BIGINT,0)-COALESCE((calculation_json->>'generatedStatutoryDeductionPaise')::BIGINT,0)-COALESCE((calculation_json->>'generatedAdvanceRecoveryPaise')::BIGINT,0),0),
              updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$6
              AND COALESCE((calculation_json->>'generatedAdvanceRecoveryPaise')::BIGINT,0)
                  <= GREATEST(
                    earned_salary_paise+overtime_paise+commission_paise
                    +COALESCE((calculation_json->>'generatedPositiveAdjustmentPaise')::BIGINT,0)
                    +GREATEST($4,0)-penalty_paise
                    -COALESCE((calculation_json->>'generatedAutoDeductionPaise')::BIGINT,0)
                    -COALESCE((calculation_json->>'generatedStatutoryDeductionPaise')::BIGINT,0)
                    -GREATEST(-$4,0),
                    0
                  )
            "#,
        )
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(entry.adjustment_paise).bind(&entry.notes).bind(&entry.staff_id)
        .execute(&mut *tx).await?;
        if updated.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(false);
        }
    }
    sqlx::query(
        r#"
        UPDATE staff_payroll_runs r SET
          gross_paise=x.gross_paise,deductions_paise=x.deductions_paise,net_paise=x.net_paise,updated_at=NOW()
        FROM (SELECT COALESCE(SUM(gross_paise),0)::BIGINT gross_paise,COALESCE(SUM(deductions_paise),0)::BIGINT deductions_paise,COALESCE(SUM(net_paise),0)::BIGINT net_paise FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3) x
        WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3
        "#,
    ).bind(tenant_id).bind(branch_id).bind(run_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.adjusted',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id).bind(serde_json::json!({"entryCount":entries.len()})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn transition_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    status: &str,
) -> Result<Option<PayrollRunRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let query = match status {
        "reviewed" => "UPDATE staff_payroll_runs SET status='reviewed',reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='calculated' RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
        "finalized" => "UPDATE staff_payroll_runs SET status='finalized',finalized_by=$4,finalized_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='reviewed' RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
        "paid" => "UPDATE staff_payroll_runs SET status='paid',paid_by=$4,paid_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='finalized' RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
        _ => return Ok(None),
    };
    let run = sqlx::query_as(query)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(run_id)
        .bind(actor_user_id)
        .fetch_optional(&mut *tx)
        .await?;
    if run.is_some() {
        sqlx::query("UPDATE staff_payroll_items SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3")
            .bind(tenant_id).bind(branch_id).bind(run_id).bind(status).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(tenant_id).bind(branch_id).bind(run_id).bind(format!("payroll.{status}")).bind(actor_user_id)
            .bind(serde_json::json!({"status":status,"action":"status_transition"})).execute(&mut *tx).await?;
        if status == "finalized" {
            // Apply the recovery snapshots frozen at calculate-time to the advance ledger exactly
            // once, atomically with the finalize transition itself (finalize cannot run twice, so
            // this cannot double-apply). Recomputing the run before finalize never touches this —
            // only unapplied rows for this run are ever affected.
            let expected_recoveries = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)::BIGINT FROM staff_advance_recoveries WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND applied=FALSE",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await?;
            let applied_recoveries = sqlx::query(
                r#"
                UPDATE staff_salary_advances a SET
                  outstanding_paise = a.outstanding_paise - r.recovered_paise,
                  pending_carry_forward_paise = r.carried_forward_paise,
                  status = CASE WHEN a.outstanding_paise - r.recovered_paise <= 0 THEN 'closed' ELSE 'recovering' END,
                  closed_at = CASE WHEN a.outstanding_paise - r.recovered_paise <= 0 THEN NOW() ELSE a.closed_at END,
                  updated_at = NOW()
                FROM staff_advance_recoveries r
                WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.payroll_run_id=$3 AND r.applied=FALSE
                  AND a.tenant_id=r.tenant_id AND a.branch_id=r.branch_id AND a.id=r.advance_id
                  AND a.status IN ('disbursed','recovering')
                  AND a.outstanding_paise >= r.scheduled_paise
                "#,
            )
            .bind(tenant_id).bind(branch_id).bind(run_id).execute(&mut *tx).await?;
            if applied_recoveries.rows_affected() != expected_recoveries as u64 {
                return Err(sqlx::Error::Protocol(
                    "salary advance recovery snapshot is stale".to_string(),
                ));
            }
            sqlx::query(
                r#"
                UPDATE staff_advance_recoveries r SET outstanding_after_paise=a.outstanding_paise
                FROM staff_salary_advances a
                WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.payroll_run_id=$3 AND r.applied=FALSE
                  AND a.tenant_id=r.tenant_id AND a.branch_id=r.branch_id AND a.id=r.advance_id
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE staff_advance_recoveries SET applied=TRUE WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND applied=FALSE")
                .bind(tenant_id).bind(branch_id).bind(run_id).execute(&mut *tx).await?;
            // Finalizing a run locks its attendance period automatically — attendance can no
            // longer be corrected for this month without an explicit, reasoned reopen. This is
            // in addition to (not instead of) any earlier manual lock.
            let period_start = run.as_ref().map(|r: &PayrollRunRecord| r.period_start);
            if let Some(period_start) = period_start {
                lock_payroll_period_advisory(&mut tx, tenant_id, branch_id, period_start).await?;
                lock_payroll_period(
                    &mut tx,
                    tenant_id,
                    branch_id,
                    period_start,
                    "Payroll finalized",
                    actor_user_id,
                )
                .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(run)
}

#[derive(Debug, Clone, FromRow)]
pub struct PayoutReference {
    pub payment_method: String,
    pub reference: String,
    pub paid_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPayoutStateRecord {
    pub state_id: Option<String>,
    pub payroll_item_id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub gross_paise: i64,
    pub net_paise: i64,
    pub status: String,
    pub payment_method: String,
    pub reference: String,
    pub hold_reason: String,
    pub last_error: String,
    pub attempt_count: i32,
    pub paid_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct LockedPayoutState {
    pub staff_id: String,
    pub status: String,
}

pub async fn list_payout_states(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Vec<PayrollPayoutStateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT state.id AS state_id,item.id AS payroll_item_id,item.staff_id,item.staff_name,
          item.employee_code,item.gross_paise,item.net_paise,
          COALESCE(state.status,CASE WHEN payout.id IS NULL THEN 'pending' ELSE 'paid' END) AS status,
          COALESCE(payout.payment_method,state.payment_method,'') AS payment_method,
          COALESCE(payout.reference,state.reference,'') AS reference,
          COALESCE(state.hold_reason,'') AS hold_reason,COALESCE(state.last_error,'') AS last_error,
          COALESCE(state.attempt_count,CASE WHEN payout.id IS NULL THEN 0 ELSE 1 END) AS attempt_count,
          COALESCE(payout.paid_at,state.paid_at) AS paid_at
        FROM staff_payroll_items item
        LEFT JOIN staff_payroll_payout_states state
          ON state.tenant_id=item.tenant_id AND state.branch_id=item.branch_id
          AND state.payroll_run_id=item.payroll_run_id AND state.staff_id=item.staff_id
        LEFT JOIN staff_payroll_payouts payout
          ON payout.tenant_id=item.tenant_id AND payout.branch_id=item.branch_id
          AND payout.payroll_run_id=item.payroll_run_id AND payout.staff_id=item.staff_id
        WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3
        ORDER BY item.staff_name,item.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .fetch_all(db)
    .await
}

pub async fn hold_payouts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_ids: &[String],
    reason: &str,
    actor_user_id: &str,
) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query(
        r#"
        INSERT INTO staff_payroll_payout_states(
          tenant_id,branch_id,payroll_run_id,payroll_item_id,staff_id,status,hold_reason,held_by,held_at
        )
        SELECT $1,$2,item.payroll_run_id,item.id,item.staff_id,'held',$5,$6,NOW()
        FROM staff_payroll_items item
        WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3 AND item.staff_id=ANY($4)
        ON CONFLICT(payroll_run_id,staff_id) DO UPDATE SET
          status='held',hold_reason=EXCLUDED.hold_reason,held_by=EXCLUDED.held_by,held_at=NOW(),
          last_error='',updated_at=NOW()
        WHERE staff_payroll_payout_states.status IN ('pending','failed','held')
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_ids)
    .bind(reason)
    .bind(actor_user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if rows != staff_ids.len() as u64 {
        tx.rollback().await?;
        return Ok(0);
    }
    if rows > 0 {
        sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.payout_held',$4,$5)")
            .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id)
            .bind(json!({"staffIds":staff_ids,"reason":reason})).execute(&mut *tx).await?;
        reconcile_payout_run(&mut tx, tenant_id, branch_id, run_id, actor_user_id).await?;
    }
    tx.commit().await?;
    Ok(rows)
}

pub async fn release_payout_holds(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_ids: &[String],
    actor_user_id: &str,
) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query("UPDATE staff_payroll_payout_states SET status='pending',hold_reason='',held_by=NULL,held_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=ANY($4) AND status='held'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(staff_ids).execute(&mut *tx).await?.rows_affected();
    if rows != staff_ids.len() as u64 {
        tx.rollback().await?;
        return Ok(0);
    }
    if rows > 0 {
        sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.payout_hold_released',$4,$5)")
            .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id)
            .bind(json!({"staffIds":staff_ids})).execute(&mut *tx).await?;
        reconcile_payout_run(&mut tx, tenant_id, branch_id, run_id, actor_user_id).await?;
    }
    tx.commit().await?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub async fn reserve_payout_attempt(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_id: &str,
    method: &str,
    reference: &str,
    idempotency_key: &str,
    actor_user_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let state_id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO staff_payroll_payout_states(
          tenant_id,branch_id,payroll_run_id,payroll_item_id,staff_id,status,payment_method,reference,attempt_count
        )
        SELECT $1,$2,item.payroll_run_id,item.id,item.staff_id,'processing',$5,$6,1
        FROM staff_payroll_items item
        WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3 AND item.staff_id=$4
        ON CONFLICT(payroll_run_id,staff_id) DO UPDATE SET
          status='processing',payment_method=EXCLUDED.payment_method,reference=EXCLUDED.reference,
          last_error='',attempt_count=staff_payroll_payout_states.attempt_count+1,updated_at=NOW()
        WHERE staff_payroll_payout_states.status IN ('pending','failed')
          OR (staff_payroll_payout_states.status='processing' AND staff_payroll_payout_states.updated_at<NOW()-INTERVAL '2 minutes')
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_id)
    .bind(method)
    .bind(reference)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(state_id) = state_id else {
        tx.rollback().await?;
        return Ok(None);
    };
    let inserted = sqlx::query("INSERT INTO staff_payroll_payout_attempts(tenant_id,branch_id,payroll_run_id,payout_state_id,staff_id,idempotency_key,status,payment_method,reference,created_by) VALUES($1,$2,$3,$4,$5,$6,'processing',$7,$8,$9) ON CONFLICT DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(&state_id).bind(staff_id)
        .bind(idempotency_key).bind(method).bind(reference).bind(actor_user_id)
        .execute(&mut *tx).await?.rows_affected() == 1;
    if !inserted {
        tx.rollback().await?;
        return Ok(None);
    }
    tx.commit().await?;
    Ok(Some(state_id))
}

pub async fn lock_payout_state(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    state_id: &str,
) -> Result<Option<LockedPayoutState>, sqlx::Error> {
    sqlx::query_as("SELECT staff_id,status FROM staff_payroll_payout_states WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(state_id).fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_staff_payout(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_id: &str,
    method: &str,
    reference: &str,
    idempotency_key: &str,
    actor_user_id: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO staff_payroll_payouts(tenant_id,branch_id,payroll_run_id,payroll_item_id,staff_id,base_pay_paise,commission_paise,adjustment_paise,deductions_paise,net_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,item.payroll_run_id,item.id,item.staff_id,item.earned_salary_paise+item.overtime_paise,item.commission_paise,item.adjustment_paise,item.deductions_paise,item.net_paise,$5,$6,$7,$8 FROM staff_payroll_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3 AND item.staff_id=$4 RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(staff_id).bind(method)
        .bind(reference).bind(idempotency_key).bind(actor_user_id).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn complete_staff_payout(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    state_id: &str,
    staff_id: &str,
    idempotency_key: &str,
    reference: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE staff_payroll_payout_states SET status='paid',reference=$5,last_error='',paid_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND id=$4 AND status='processing'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(state_id).bind(reference).execute(&mut **tx).await?;
    sqlx::query("UPDATE staff_payroll_payout_attempts SET status='succeeded',reference=$6,completed_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND payout_state_id=$4 AND idempotency_key=$5 AND status='processing'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(state_id).bind(idempotency_key).bind(reference).execute(&mut **tx).await?;
    sqlx::query("UPDATE staff_payroll_items SET status='paid',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$4")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(staff_id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.staff_paid',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id)
        .bind(json!({"staffId":staff_id,"reference":reference})).execute(&mut **tx).await?;
    reconcile_payout_run(tx, tenant_id, branch_id, run_id, actor_user_id).await
}

#[allow(clippy::too_many_arguments)]
pub async fn fail_staff_payout(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    state_id: &str,
    staff_id: &str,
    idempotency_key: &str,
    error: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE staff_payroll_payout_states SET status='failed',last_error=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND id=$4 AND status='processing'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(state_id).bind(error).execute(&mut *tx).await?;
    sqlx::query("UPDATE staff_payroll_payout_attempts SET status='failed',error_message=$6,completed_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND payout_state_id=$4 AND idempotency_key=$5 AND status='processing'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(state_id).bind(idempotency_key).bind(error).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.staff_payout_failed',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id)
        .bind(json!({"staffId":staff_id,"error":error})).execute(&mut *tx).await?;
    reconcile_payout_run(&mut tx, tenant_id, branch_id, run_id, actor_user_id).await?;
    tx.commit().await
}

pub async fn reconcile_payout_run(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    let (total, paid, active) = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT COUNT(*)::BIGINT,COUNT(payout.id)::BIGINT,COUNT(state.id) FILTER (WHERE state.status<>'pending')::BIGINT FROM staff_payroll_items item LEFT JOIN staff_payroll_payouts payout ON payout.tenant_id=item.tenant_id AND payout.branch_id=item.branch_id AND payout.payroll_run_id=item.payroll_run_id AND payout.staff_id=item.staff_id LEFT JOIN staff_payroll_payout_states state ON state.tenant_id=item.tenant_id AND state.branch_id=item.branch_id AND state.payroll_run_id=item.payroll_run_id AND state.staff_id=item.staff_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(run_id).fetch_one(&mut **tx).await?;
    let status = if total > 0 && paid == total {
        "paid"
    } else if paid > 0 || active > 0 {
        "partially_paid"
    } else {
        "finalized"
    };
    let previous = sqlx::query_scalar::<_, String>("SELECT status FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_one(&mut **tx).await?;
    sqlx::query("UPDATE staff_payroll_runs SET status=$4,paid_by=CASE WHEN $4='paid' THEN $5 ELSE paid_by END,paid_at=CASE WHEN $4='paid' THEN NOW() ELSE paid_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('finalized','partially_paid','paid')")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(status).bind(actor_user_id).execute(&mut **tx).await?;
    if previous != status {
        sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(tenant_id).bind(branch_id).bind(run_id)
            .bind(if status == "paid" { "payroll.paid" } else { "payroll.partially_paid" })
            .bind(actor_user_id).bind(json!({"paidCount":paid,"staffCount":total,"status":status})).execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn payout_for_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_id: &str,
) -> Result<Option<PayoutReference>, sqlx::Error> {
    sqlx::query_as("SELECT payment_method,reference,paid_at FROM staff_payroll_payouts WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$4")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(staff_id).fetch_optional(db).await
}

pub async fn branch_name(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT name FROM branches WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(db)
        .await
}

const PAYROLL_PERIOD_COLUMNS: &str =
    "id,period_month,cutoff_date,correction_deadline,status,lock_reason,\
locked_by,locked_at,reopen_reason,reopened_by,reopened_at,updated_at";

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPeriodRecord {
    pub id: String,
    pub period_month: NaiveDate,
    pub cutoff_date: Option<NaiveDate>,
    pub correction_deadline: Option<NaiveDate>,
    pub status: String,
    pub lock_reason: String,
    pub locked_by: Option<String>,
    pub locked_at: Option<DateTime<Utc>>,
    pub reopen_reason: String,
    pub reopened_by: Option<String>,
    pub reopened_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_payroll_periods(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PayrollPeriodRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {PAYROLL_PERIOD_COLUMNS} FROM staff_payroll_periods WHERE tenant_id=$1 AND branch_id=$2 ORDER BY period_month DESC"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

/// Serializes concurrent lock/reopen/schedule changes for the same period, mirroring
/// `balance_sheet_repository::lock_accounting_period`.
pub async fn lock_payroll_period_advisory(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
) -> Result<(), sqlx::Error> {
    use chrono::Datelike;
    let period_key = period_month.year() * 100 + period_month.month() as i32;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2 || ':payroll'),$3)")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(period_key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn payroll_period_for_month(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
) -> Result<Option<PayrollPeriodRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {PAYROLL_PERIOD_COLUMNS} FROM staff_payroll_periods WHERE tenant_id=$1 AND branch_id=$2 AND period_month=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .fetch_optional(db)
    .await
}

pub async fn set_payroll_period_schedule(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
    cutoff_date: Option<NaiveDate>,
    correction_deadline: Option<NaiveDate>,
) -> Result<PayrollPeriodRecord, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        INSERT INTO staff_payroll_periods(tenant_id,branch_id,period_month,cutoff_date,correction_deadline)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,branch_id,period_month) DO UPDATE SET
          cutoff_date=EXCLUDED.cutoff_date,correction_deadline=EXCLUDED.correction_deadline,updated_at=NOW()
        RETURNING {PAYROLL_PERIOD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .bind(cutoff_date)
    .bind(correction_deadline)
    .fetch_one(&mut **tx)
    .await
}

pub async fn lock_payroll_period(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
    reason: &str,
    actor_user_id: &str,
) -> Result<PayrollPeriodRecord, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        INSERT INTO staff_payroll_periods(tenant_id,branch_id,period_month,status,lock_reason,locked_by,locked_at)
        VALUES($1,$2,$3,'locked',$4,$5,NOW())
        ON CONFLICT(tenant_id,branch_id,period_month) DO UPDATE SET
          status='locked',lock_reason=EXCLUDED.lock_reason,locked_by=EXCLUDED.locked_by,locked_at=NOW(),updated_at=NOW()
        RETURNING {PAYROLL_PERIOD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn reopen_payroll_period(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
    reason: &str,
    actor_user_id: &str,
) -> Result<Option<PayrollPeriodRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_payroll_periods SET
          status='open',reopen_reason=$4,reopened_by=$5,reopened_at=NOW(),updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND period_month=$3 AND status='locked'
        RETURNING {PAYROLL_PERIOD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_optional(&mut **tx)
    .await
}

const CORRECTION_COLUMNS: &str = "id,original_run_id,staff_id,correction_type,amount_paise,reason,status,\
requested_by,decided_by,decided_at,decision_note,payment_method,payment_reference,posted_by,posted_at,\
version,created_at,updated_at";

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollCorrectionRecord {
    pub id: String,
    pub original_run_id: String,
    pub staff_id: String,
    pub correction_type: String,
    pub amount_paise: i64,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: String,
    pub payment_method: Option<String>,
    pub payment_reference: String,
    pub posted_by: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollCorrectionEventRecord {
    pub id: String,
    pub event_type: String,
    pub actor_user_id: String,
    pub payload_json: Value,
    pub created_at: DateTime<Utc>,
}

/// A run is only correctable once it's fully paid — a finalized-but-unpaid run should still go
/// through the normal recalculate/finalize/pay flow, not the correction mechanism.
pub async fn run_is_paid(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='paid')",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .fetch_one(db)
    .await
}

pub async fn staff_has_item_in_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    staff_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_id)
    .fetch_one(db)
    .await
}

pub async fn create_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    original_run_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    correction_type: &str,
    amount_paise: i64,
    reason: &str,
) -> Result<PayrollCorrectionRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let record: PayrollCorrectionRecord = sqlx::query_as(&format!(
        r#"
        INSERT INTO staff_payroll_corrections(
          tenant_id,branch_id,original_run_id,staff_id,correction_type,amount_paise,reason,requested_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING {CORRECTION_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(original_run_id)
    .bind(staff_id)
    .bind(correction_type)
    .bind(amount_paise)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_one(&mut *tx)
    .await?;
    insert_correction_event(
        &mut tx,
        tenant_id,
        branch_id,
        &record.id,
        "correction.requested",
        actor_user_id,
        &json!({"correctionType": correction_type, "amountPaise": amount_paise, "reason": reason}),
    )
    .await?;
    tx.commit().await?;
    Ok(record)
}

pub async fn get_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PayrollCorrectionRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CORRECTION_COLUMNS} FROM staff_payroll_corrections WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list_corrections_for_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    original_run_id: &str,
) -> Result<Vec<PayrollCorrectionRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CORRECTION_COLUMNS} FROM staff_payroll_corrections WHERE tenant_id=$1 AND branch_id=$2 AND original_run_id=$3 ORDER BY created_at DESC"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(original_run_id)
    .fetch_all(db)
    .await
}

pub async fn decide_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    decision: &str,
    note: &str,
) -> Result<Option<PayrollCorrectionRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let record: Option<PayrollCorrectionRecord> = sqlx::query_as(&format!(
        r#"
        UPDATE staff_payroll_corrections SET
          status=$5,decided_by=$6,decided_at=NOW(),decision_note=$7,version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='pending'
          AND ($5<>'approved' OR requested_by<>$6)
        RETURNING {CORRECTION_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(decision)
    .bind(actor_user_id)
    .bind(note)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(record) = &record {
        insert_correction_event(
            &mut tx,
            tenant_id,
            branch_id,
            &record.id,
            &format!("correction.{decision}"),
            actor_user_id,
            &json!({"note": note}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(record)
}

pub async fn cancel_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
) -> Result<Option<PayrollCorrectionRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let record: Option<PayrollCorrectionRecord> = sqlx::query_as(&format!(
        r#"
        UPDATE staff_payroll_corrections SET status='cancelled',version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status IN ('pending','approved')
        RETURNING {CORRECTION_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(record) = &record {
        insert_correction_event(
            &mut tx,
            tenant_id,
            branch_id,
            &record.id,
            "correction.cancelled",
            actor_user_id,
            &json!({}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(record)
}

pub async fn lock_correction_for_posting(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PayrollCorrectionRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {CORRECTION_COLUMNS} FROM staff_payroll_corrections WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn correction_posting_replay_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_payroll_corrections WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 \
         AND posting_idempotency_key=$4 AND status='posted')",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await
}

pub async fn complete_correction_posting(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    payment_method: Option<&str>,
    payment_reference: &str,
    idempotency_key: &str,
) -> Result<Option<PayrollCorrectionRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_payroll_corrections SET
          status='posted',payment_method=$6,payment_reference=$7,posting_idempotency_key=$8,
          posted_by=$5,posted_at=NOW(),version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='approved'
        RETURNING {CORRECTION_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(actor_user_id)
    .bind(payment_method)
    .bind(payment_reference)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn insert_correction_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    correction_id: &str,
    event_type: &str,
    actor_user_id: &str,
    payload: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO staff_payroll_correction_events(tenant_id,branch_id,correction_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(correction_id).bind(event_type).bind(actor_user_id).bind(payload)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn correction_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    correction_id: &str,
) -> Result<Vec<PayrollCorrectionEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,actor_user_id,payload_json,created_at FROM staff_payroll_correction_events WHERE tenant_id=$1 AND branch_id=$2 AND correction_id=$3 ORDER BY created_at ASC")
        .bind(tenant_id).bind(branch_id).bind(correction_id).fetch_all(db).await
}
