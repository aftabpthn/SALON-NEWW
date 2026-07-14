use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct AttendanceSummaryBaseRecord {
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
    pub annual_leave_days: f64,
    pub weekly_off_adjustment: f64,
    pub special_leave_adjustment: f64,
    pub comments: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceDetailRecord {
    pub id: Option<String>,
    pub business_date: NaiveDate,
    pub scheduled_status: Option<String>,
    pub attendance_status: Option<String>,
    pub manual_status: Option<String>,
    pub clock_in_at: Option<DateTime<Utc>>,
    pub clock_out_at: Option<DateTime<Utc>>,
    pub worked_minutes: i32,
    pub late_minutes: i32,
    pub early_leave_minutes: i32,
    pub overtime_minutes: i32,
    pub break_minutes: i32,
    pub penalty_paise: i64,
    pub source: String,
    pub comments: String,
    pub correction_reason: String,
    pub corrected_at: Option<DateTime<Utc>>,
    pub breaks: Value,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceRecord {
    pub id: String,
    pub staff_id: String,
    pub business_date: NaiveDate,
    pub clock_in_at: Option<DateTime<Utc>>,
    pub clock_out_at: Option<DateTime<Utc>>,
    pub status: String,
    pub manual_status: Option<String>,
    pub source: String,
    pub worked_minutes: i32,
    pub late_minutes: i32,
    pub early_leave_minutes: i32,
    pub overtime_minutes: i32,
    pub break_minutes: i32,
    pub penalty_paise: i64,
    pub comments: String,
    pub correction_reason: String,
    pub corrected_at: Option<DateTime<Utc>>,
}

pub struct AttendanceBreakInput {
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub comments: String,
}

pub struct AttendanceCorrectionInput {
    pub clock_in_at: Option<DateTime<Utc>>,
    pub clock_out_at: Option<DateTime<Utc>>,
    pub manual_status: Option<String>,
    pub penalty_paise: i64,
    pub comments: String,
    pub correction_reason: String,
    pub corrected_by: String,
    pub breaks: Vec<AttendanceBreakInput>,
}

pub struct AttendanceAdjustmentInput {
    pub staff_id: String,
    pub weekly_off_adjustment: f64,
    pub special_leave_adjustment: f64,
    pub comments: String,
}

pub async fn summary_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    year: i32,
    month: i32,
    staff_id: &str,
) -> Result<Vec<AttendanceSummaryBaseRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH attendance AS (
          SELECT staff_id,
                 COUNT(DISTINCT business_date) FILTER (WHERE status IN ('clocked_in','clocked_out','present','half_day')) AS working_days,
                 COALESCE(SUM(penalty_paise),0)::BIGINT AS penalty_paise
          FROM staff_attendance_records
          WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4
          GROUP BY staff_id
        ), schedule_usage AS (
          SELECT staff_id,
                 COUNT(*) FILTER (WHERE status IN ('annual_leave','leave','sick_leave')) AS leave_availed,
                 COUNT(*) FILTER (WHERE status='special_leave') AS special_leave_availed
          FROM staff_schedules
          WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4
          GROUP BY staff_id
        ), policies AS (
          SELECT staff_id,
                 COALESCE(SUM(annual_days) FILTER (WHERE leave_type <> 'special' AND active),0)::DOUBLE PRECISION AS annual_leave_days
          FROM staff_leave_policies
          WHERE tenant_id=$1 AND branch_id=$2
          GROUP BY staff_id
        )
        SELECT s.id AS staff_id,
               TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS name,
               s.employee_code,
               pay.amount_paise AS salary_paise,
               COALESCE(a.working_days,0)::BIGINT AS working_days,
               COALESCE(p.vacation_days,0)::DOUBLE PRECISION AS leave_balance,
               COALESCE(p.special_leave_days,0)::DOUBLE PRECISION AS special_leave_balance,
               COALESCE(su.leave_availed,0)::BIGINT AS leave_availed,
               COALESCE(su.special_leave_availed,0)::BIGINT AS special_leave_availed,
               COALESCE(a.penalty_paise,0)::BIGINT AS penalty_paise,
               COALESCE(pol.annual_leave_days,0)::DOUBLE PRECISION AS annual_leave_days,
               COALESCE(adj.weekly_off_adjustment,0)::DOUBLE PRECISION AS weekly_off_adjustment,
               COALESCE(adj.special_leave_adjustment,0)::DOUBLE PRECISION AS special_leave_adjustment,
               COALESCE(adj.comments,'') AS comments
        FROM staff s
        LEFT JOIN attendance a ON a.staff_id=s.id
        LEFT JOIN schedule_usage su ON su.staff_id=s.id
        LEFT JOIN staff_profiles p ON p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id AND p.staff_id=s.id
        LEFT JOIN policies pol ON pol.staff_id=s.id
        LEFT JOIN staff_attendance_summary_adjustments adj
          ON adj.tenant_id=s.tenant_id AND adj.branch_id=s.branch_id AND adj.staff_id=s.id
         AND adj.summary_year=$5 AND adj.summary_month=$6
        LEFT JOIN LATERAL (
          SELECT amount_paise FROM staff_pay_rates pr
          WHERE pr.tenant_id=s.tenant_id AND pr.branch_id=s.branch_id AND pr.staff_id=s.id
            AND pr.rate_type='monthly' AND pr.active=true
            AND (pr.effective_from IS NULL OR pr.effective_from <= $4)
          ORDER BY pr.effective_from DESC NULLS LAST,pr.created_at DESC LIMIT 1
        ) pay ON true
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=true
          AND ($7='' OR s.id=$7)
          AND (a.staff_id IS NOT NULL OR su.staff_id IS NOT NULL OR adj.staff_id IS NOT NULL)
        ORDER BY s.first_name,s.last_name,s.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(date_from)
    .bind(date_to)
    .bind(year)
    .bind(month)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn save_adjustments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year: i32,
    month: i32,
    entries: Vec<AttendanceAdjustmentInput>,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    for entry in entries {
        sqlx::query(
            r#"
            INSERT INTO staff_attendance_summary_adjustments(
              tenant_id,branch_id,staff_id,summary_year,summary_month,
              weekly_off_adjustment,special_leave_adjustment,comments
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (tenant_id,branch_id,staff_id,summary_year,summary_month)
            DO UPDATE SET weekly_off_adjustment=EXCLUDED.weekly_off_adjustment,
                          special_leave_adjustment=EXCLUDED.special_leave_adjustment,
                          comments=EXCLUDED.comments,updated_at=NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(entry.staff_id)
        .bind(year)
        .bind(month)
        .bind(entry.weekly_off_adjustment)
        .bind(entry.special_leave_adjustment)
        .bind(entry.comments)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

pub async fn detail_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
) -> Result<Vec<AttendanceDetailRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT a.id,COALESCE(a.business_date,s.schedule_date) AS business_date,
               s.status AS scheduled_status,
               a.status AS attendance_status,a.manual_status,
               a.clock_in_at,a.clock_out_at,COALESCE(a.worked_minutes,0) AS worked_minutes,
               COALESCE(a.late_minutes,0) AS late_minutes,
               COALESCE(a.early_leave_minutes,0) AS early_leave_minutes,
               COALESCE(a.overtime_minutes,0) AS overtime_minutes,
               COALESCE(a.break_minutes,0) AS break_minutes,COALESCE(a.penalty_paise,0)::BIGINT AS penalty_paise,
               COALESCE(a.source,'') AS source,COALESCE(a.comments,s.notes,'') AS comments,
               COALESCE(a.correction_reason,'') AS correction_reason,a.corrected_at,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',b.id,'startedAt',b.started_at,'endedAt',b.ended_at,'comments',b.comments
                 ) ORDER BY b.started_at)
                 FROM staff_attendance_breaks b
                 WHERE b.tenant_id=a.tenant_id AND b.branch_id=a.branch_id AND b.attendance_id=a.id
               ),'[]'::jsonb) AS breaks
        FROM staff_attendance_records a
        FULL OUTER JOIN staff_schedules s
          ON s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id AND s.staff_id=a.staff_id
         AND s.schedule_date=a.business_date
        WHERE COALESCE(a.tenant_id,s.tenant_id)=$1
          AND COALESCE(a.branch_id,s.branch_id)=$2
          AND COALESCE(a.staff_id,s.staff_id)=$3
          AND COALESCE(a.business_date,s.schedule_date) BETWEEN $4 AND $5
        ORDER BY business_date
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(date_from)
    .bind(date_to)
    .fetch_all(db)
    .await
}

pub async fn get_for_day(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<Option<AttendanceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,business_date,clock_in_at,clock_out_at,status,manual_status,source,worked_minutes,late_minutes,early_leave_minutes,overtime_minutes,break_minutes,penalty_paise,comments,correction_reason,corrected_at FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).fetch_optional(db).await
}

const RECALCULATE_ATTENDANCE_SQL: &str = r#"
    WITH settings AS (
      SELECT COALESCE(CASE WHEN schedule.status='working' THEN schedule.shift1_start END,template.shift1_start) AS start_time,
             COALESCE(CASE WHEN schedule.status='working' THEN COALESCE(schedule.shift2_end,schedule.shift1_end) END,COALESCE(template.shift2_end,template.shift1_end)) AS end_time,
             COALESCE(rule.grace_minutes,0) AS grace_minutes,
             COALESCE(rule.early_leave_grace_minutes,0) AS early_leave_grace_minutes,
             COALESCE(rule.overtime_after_minutes,0) AS overtime_after_minutes,
             COALESCE(rule.half_day_after_minutes,0) AS half_day_after_minutes,
             COALESCE(rule.absent_after_minutes,0) AS absent_after_minutes,
             COALESCE(rule.deduct_breaks,TRUE) AS deduct_breaks,
             COALESCE(rule.minimum_overtime_minutes,0) AS minimum_overtime_minutes,
             COALESCE(rule.overtime_rounding_minutes,0) AS overtime_rounding_minutes,
             COALESCE(rule.maximum_overtime_minutes,0) AS maximum_overtime_minutes
      FROM staff employee
      LEFT JOIN staff_profiles profile ON profile.tenant_id=employee.tenant_id AND profile.branch_id=employee.branch_id AND profile.staff_id=employee.id
      LEFT JOIN staff_shift_templates template ON template.tenant_id=employee.tenant_id AND template.branch_id=employee.branch_id AND template.id=profile.shift_template_id AND template.active=TRUE
      LEFT JOIN staff_schedules schedule ON schedule.tenant_id=employee.tenant_id AND schedule.branch_id=employee.branch_id AND schedule.staff_id=employee.id AND schedule.schedule_date=$4
      LEFT JOIN staff_attendance_rules rule ON rule.tenant_id=employee.tenant_id AND rule.branch_id=employee.branch_id AND rule.active=TRUE
      WHERE employee.tenant_id=$1 AND employee.branch_id=$2 AND employee.id=$3
    ), metrics AS (
      SELECT a.id,
             CASE WHEN a.clock_in_at IS NULL OR settings.start_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (((a.clock_in_at AT TIME ZONE 'Asia/Kolkata')::TIME)-settings.start_time))/60)::INTEGER-settings.grace_minutes) END AS late,
             CASE WHEN a.clock_out_at IS NULL OR settings.end_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (settings.end_time-((a.clock_out_at AT TIME ZONE 'Asia/Kolkata')::TIME)))/60)::INTEGER-settings.early_leave_grace_minutes) END AS early_leave,
             CASE WHEN a.clock_out_at IS NULL OR settings.end_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (((a.clock_out_at AT TIME ZONE 'Asia/Kolkata')::TIME)-settings.end_time))/60)::INTEGER-settings.overtime_after_minutes) END AS raw_overtime,
             CASE WHEN a.clock_in_at IS NULL OR a.clock_out_at IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (a.clock_out_at-a.clock_in_at))/60)::INTEGER) END AS gross_minutes,
             COALESCE((SELECT SUM(FLOOR(EXTRACT(EPOCH FROM (b.ended_at-b.started_at))/60)::INTEGER) FROM staff_attendance_breaks b WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.attendance_id=a.id),0)::INTEGER AS break_minutes,
             settings.*
      FROM staff_attendance_records a CROSS JOIN settings
      WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=$3 AND a.business_date=$4
    )
    UPDATE staff_attendance_records a SET
      late_minutes=metrics.late,early_leave_minutes=metrics.early_leave,break_minutes=metrics.break_minutes,
      worked_minutes=GREATEST(0,metrics.gross_minutes-CASE WHEN metrics.deduct_breaks THEN metrics.break_minutes ELSE 0 END),
      overtime_minutes=CASE WHEN metrics.raw_overtime<metrics.minimum_overtime_minutes THEN 0 ELSE LEAST(
        CASE WHEN metrics.maximum_overtime_minutes>0 THEN metrics.maximum_overtime_minutes ELSE metrics.raw_overtime END,
        CASE WHEN metrics.overtime_rounding_minutes>0 THEN (metrics.raw_overtime/metrics.overtime_rounding_minutes)*metrics.overtime_rounding_minutes ELSE metrics.raw_overtime END
      ) END,
      status=COALESCE(a.manual_status,CASE
        WHEN a.clock_out_at IS NULL THEN CASE WHEN a.clock_in_at IS NULL THEN a.status ELSE 'clocked_in' END
        WHEN metrics.absent_after_minutes>0 AND metrics.late>=metrics.absent_after_minutes THEN 'absent'
        WHEN metrics.half_day_after_minutes>0 AND metrics.late>=metrics.half_day_after_minutes THEN 'half_day'
        ELSE 'clocked_out' END),updated_at=NOW()
    FROM metrics WHERE a.id=metrics.id
    RETURNING a.id,a.staff_id,a.business_date,a.clock_in_at,a.clock_out_at,a.status,a.manual_status,a.source,
              a.worked_minutes,a.late_minutes,a.early_leave_minutes,a.overtime_minutes,a.break_minutes,
              a.penalty_paise,a.comments,a.correction_reason,a.corrected_at
"#;

pub async fn clock_in(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    clock_in_at: DateTime<Utc>,
    source: &str,
    comments: &str,
) -> Result<AttendanceRecord, sqlx::Error> {
    sqlx::query("INSERT INTO staff_attendance_records(tenant_id,branch_id,staff_id,business_date,clock_in_at,status,source,comments) VALUES($1,$2,$3,$4,$5,'clocked_in',$6,$7)")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date)
        .bind(clock_in_at).bind(source).bind(comments).execute(db).await?;
    recalculate(db, tenant_id, branch_id, staff_id, business_date).await
}

pub async fn clock_out(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    clock_out_at: DateTime<Utc>,
    penalty_paise: i64,
    comments: &str,
) -> Result<Option<AttendanceRecord>, sqlx::Error> {
    let updated = sqlx::query("UPDATE staff_attendance_records SET clock_out_at=$5,penalty_paise=$6,comments=$7,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4 AND status='clocked_in' AND clock_in_at IS NOT NULL AND $5>=clock_in_at")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date)
        .bind(clock_out_at).bind(penalty_paise).bind(comments).execute(db).await?;
    if updated.rows_affected() == 0 {
        return Ok(None);
    }
    recalculate(db, tenant_id, branch_id, staff_id, business_date)
        .await
        .map(Some)
}

async fn recalculate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<AttendanceRecord, sqlx::Error> {
    sqlx::query_as(RECALCULATE_ATTENDANCE_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .fetch_one(db)
        .await
}

pub async fn save_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    input: AttendanceCorrectionInput,
) -> Result<AttendanceRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let attendance_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO staff_attendance_records(
              tenant_id,branch_id,staff_id,business_date,clock_in_at,clock_out_at,status,manual_status,
              source,penalty_paise,comments,correction_reason,corrected_by,corrected_at
           ) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,'present'),$7,'manual_correction',$8,$9,$10,$11,NOW())
           ON CONFLICT (tenant_id,branch_id,staff_id,business_date) DO UPDATE SET
              clock_in_at=EXCLUDED.clock_in_at,clock_out_at=EXCLUDED.clock_out_at,
              manual_status=EXCLUDED.manual_status,penalty_paise=EXCLUDED.penalty_paise,
              comments=EXCLUDED.comments,correction_reason=EXCLUDED.correction_reason,
              corrected_by=EXCLUDED.corrected_by,corrected_at=NOW(),updated_at=NOW()
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .bind(input.clock_in_at)
    .bind(input.clock_out_at)
    .bind(input.manual_status.as_deref())
    .bind(input.penalty_paise)
    .bind(&input.comments)
    .bind(&input.correction_reason)
    .bind(&input.corrected_by)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM staff_attendance_breaks WHERE tenant_id=$1 AND branch_id=$2 AND attendance_id=$3")
        .bind(tenant_id).bind(branch_id).bind(&attendance_id).execute(&mut *tx).await?;
    for item in input.breaks {
        sqlx::query("INSERT INTO staff_attendance_breaks(tenant_id,branch_id,staff_id,attendance_id,started_at,ended_at,comments,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(staff_id).bind(&attendance_id)
            .bind(item.started_at).bind(item.ended_at).bind(item.comments).bind(&input.corrected_by)
            .execute(&mut *tx).await?;
    }
    let row = sqlx::query_as(RECALCULATE_ATTENDANCE_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(row)
}
