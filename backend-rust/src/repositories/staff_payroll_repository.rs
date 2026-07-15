use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, FromRow)]
pub struct StaffSourceRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub pay_rate_type: Option<String>,
    pub pay_rate_paise: Option<i64>,
    pub joining_date: Option<NaiveDate>,
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
    pub penalty_paise: i64,
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

#[derive(Debug, FromRow)]
pub struct LockedPayrollRun {
    pub status: String,
    pub gross_paise: i64,
    pub net_paise: i64,
    pub staff_count: i32,
}

pub struct AdjustmentInput {
    pub staff_id: String,
    pub adjustment_paise: i64,
    pub notes: String,
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
               profile.joining_date
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
    sqlx::query_as("SELECT staff_id,business_date,status,worked_minutes,overtime_minutes,penalty_paise FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=ANY($3) AND business_date BETWEEN $4 AND $5")
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
    sqlx::query_as("SELECT id,staff_id,staff_name,employee_code,pay_rate_type,pay_rate_paise,attendance_days_x2,paid_leave_days_x2,weekly_off_days_x2,holiday_days_x2,worked_minutes,overtime_minutes,earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,penalty_paise,gross_paise,deductions_paise,net_paise,validation_errors,validation_warnings,calculation_json,notes,status FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 ORDER BY staff_name,staff_id")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_all(db).await
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
        sqlx::query(
            r#"
            INSERT INTO staff_payroll_items(
              tenant_id,branch_id,payroll_run_id,staff_id,staff_name,employee_code,pay_rate_type,pay_rate_paise,
              attendance_days_x2,paid_leave_days_x2,weekly_off_days_x2,holiday_days_x2,worked_minutes,overtime_minutes,
              earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,penalty_paise,gross_paise,
              deductions_paise,net_paise,validation_errors,validation_warnings,calculation_json,notes,status
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'calculated')
            "#,
        )
        .bind(tenant_id).bind(branch_id).bind(&run.id).bind(&item.staff_id).bind(&item.staff_name)
        .bind(&item.employee_code).bind(&item.pay_rate_type).bind(item.pay_rate_paise)
        .bind(item.attendance_days_x2).bind(item.paid_leave_days_x2).bind(item.weekly_off_days_x2).bind(item.holiday_days_x2)
        .bind(item.worked_minutes).bind(item.overtime_minutes).bind(item.earned_salary_paise)
        .bind(item.overtime_paise).bind(item.commission_paise).bind(item.adjustment_paise)
        .bind(item.penalty_paise).bind(item.gross_paise).bind(item.deductions_paise).bind(item.net_paise)
        .bind(&item.validation_errors).bind(&item.validation_warnings).bind(&item.calculation_json).bind(&item.notes)
        .execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.calculated',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(&run.id).bind(actor_user_id)
        .bind(serde_json::json!({"staffCount":items.len(),"invalidCount":invalid_count})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(run)
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
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for entry in entries {
        sqlx::query(
            r#"
            UPDATE staff_payroll_items SET adjustment_paise=$4,notes=$5,
              gross_paise=earned_salary_paise+overtime_paise+commission_paise+GREATEST($4,0),
              deductions_paise=penalty_paise+GREATEST(-$4,0),
              net_paise=GREATEST(earned_salary_paise+overtime_paise+commission_paise+$4-penalty_paise,0),
              updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$6
            "#,
        )
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(entry.adjustment_paise).bind(&entry.notes).bind(&entry.staff_id)
        .execute(&mut *tx).await?;
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
    tx.commit().await
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
        "reviewed" => "UPDATE staff_payroll_runs SET status='reviewed',reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
        "finalized" => "UPDATE staff_payroll_runs SET status='finalized',finalized_by=$4,finalized_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
        "paid" => "UPDATE staff_payroll_runs SET status='paid',paid_by=$4,paid_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,cycle,period_start,period_end,status,gross_paise,deductions_paise,net_paise,staff_count,invalid_count,created_by,reviewed_at,finalized_at,paid_at,created_at,updated_at",
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
        sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,$4,$5,'{}'::JSONB)")
            .bind(tenant_id).bind(branch_id).bind(run_id).bind(format!("payroll.{status}")).bind(actor_user_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(run)
}

pub async fn lock_run_for_payout(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Option<LockedPayrollRun>, sqlx::Error> {
    sqlx::query_as("SELECT status,gross_paise,net_paise,staff_count FROM staff_payroll_runs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(run_id).fetch_optional(&mut **tx).await
}

pub async fn payout_replay_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_payroll_payouts WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND idempotency_key=$4)")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(idempotency_key).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_payouts(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    payment_method: &str,
    reference: &str,
    idempotency_key: &str,
    actor_user_id: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO staff_payroll_payouts(tenant_id,branch_id,payroll_run_id,payroll_item_id,staff_id,base_pay_paise,commission_paise,adjustment_paise,deductions_paise,net_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,item.payroll_run_id,item.id,item.staff_id,item.earned_salary_paise+item.overtime_paise,item.commission_paise,item.adjustment_paise,item.deductions_paise,item.net_paise,$4,$5,$6,$7 FROM staff_payroll_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.payroll_run_id=$3")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(payment_method).bind(reference).bind(idempotency_key).bind(actor_user_id).execute(&mut **tx).await?.rows_affected())
}

pub async fn complete_payout(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    actor_user_id: &str,
    payment_method: &str,
    reference: &str,
) -> Result<bool, sqlx::Error> {
    let updated = sqlx::query("UPDATE staff_payroll_runs SET status='paid',paid_by=$4,paid_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='finalized'")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id).execute(&mut **tx).await?.rows_affected() == 1;
    if !updated {
        return Ok(false);
    }
    sqlx::query("UPDATE staff_payroll_items SET status='paid',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3")
        .bind(tenant_id).bind(branch_id).bind(run_id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO staff_payroll_events(tenant_id,branch_id,payroll_run_id,event_type,actor_user_id,payload_json) VALUES($1,$2,$3,'payroll.paid',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(run_id).bind(actor_user_id)
        .bind(serde_json::json!({"paymentMethod":payment_method,"reference":reference})).execute(&mut **tx).await?;
    Ok(true)
}
