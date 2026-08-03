use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
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
    pub operation_meeting_present: i64,
    pub operation_meeting_absent: i64,
    pub operation_task_completed: i64,
    pub operation_task_missed: i64,
    pub comments: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceDetailRecord {
    pub id: Option<String>,
    pub business_date: NaiveDate,
    pub scheduled_status: Option<String>,
    pub scheduled_shift1_start: Option<NaiveTime>,
    pub scheduled_shift1_end: Option<NaiveTime>,
    pub scheduled_shift2_start: Option<NaiveTime>,
    pub scheduled_shift2_end: Option<NaiveTime>,
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
    pub cash_tip_paise: i64,
    pub session_count: i32,
    pub source: String,
    pub comments: String,
    pub correction_reason: String,
    pub corrected_at: Option<DateTime<Utc>>,
    pub breaks: Value,
    pub sessions: Value,
    pub operations: Value,
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
    pub cash_tip_paise: i64,
    pub session_count: i32,
    pub comments: String,
    pub correction_reason: String,
    pub corrected_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceBreakRecord {
    pub id: String,
    pub attendance_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub comments: String,
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
    pub work_task_rate_id: Option<String>,
    pub breaks: Vec<AttendanceBreakInput>,
}

pub async fn break_inputs_for_day(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<Vec<AttendanceBreakInput>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (DateTime<Utc>, DateTime<Utc>, String)>(
        "SELECT breaks.started_at,breaks.ended_at,breaks.comments FROM staff_attendance_breaks breaks JOIN staff_attendance_records attendance ON attendance.id=breaks.attendance_id WHERE breaks.tenant_id=$1 AND breaks.branch_id=$2 AND breaks.staff_id=$3 AND attendance.business_date=$4 AND breaks.ended_at IS NOT NULL ORDER BY breaks.started_at"
    ).bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).fetch_all(db).await?;
    Ok(rows
        .into_iter()
        .map(|(started_at, ended_at, comments)| AttendanceBreakInput {
            started_at,
            ended_at,
            comments,
        })
        .collect())
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
                 COUNT(DISTINCT business_date) FILTER (WHERE status IN ('clocked_in','clocked_out','present','late','half_day')) AS working_days,
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
        ), operation_attendance AS (
          SELECT attendance.staff_id,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('staff_meeting','performance_review','training_session') AND attendance.status='present')::BIGINT AS operation_meeting_present,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('staff_meeting','performance_review','training_session') AND attendance.status IN ('absent','late'))::BIGINT AS operation_meeting_absent
          FROM staff_operation_attendance attendance
          JOIN staff_operation_schedules schedule ON schedule.tenant_id=attendance.tenant_id AND schedule.branch_id=attendance.branch_id AND schedule.id=attendance.operation_id
          WHERE attendance.tenant_id=$1 AND attendance.branch_id=$2 AND schedule.scheduled_date BETWEEN $3 AND $4
          GROUP BY attendance.staff_id
        ), operation_tasks AS (
          SELECT task.staff_id,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('deep_cleaning','hygiene_audit','cleaning_task') AND task.status IN ('completed','approved'))::BIGINT AS operation_task_completed,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('deep_cleaning','hygiene_audit','cleaning_task') AND task.status='missed')::BIGINT AS operation_task_missed
          FROM staff_operation_tasks task
          JOIN staff_operation_schedules schedule ON schedule.tenant_id=task.tenant_id AND schedule.branch_id=task.branch_id AND schedule.id=task.operation_id
          WHERE task.tenant_id=$1 AND task.branch_id=$2 AND schedule.scheduled_date BETWEEN $3 AND $4
          GROUP BY task.staff_id
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
               COALESCE(oa.operation_meeting_present,0)::BIGINT AS operation_meeting_present,
               COALESCE(oa.operation_meeting_absent,0)::BIGINT AS operation_meeting_absent,
               COALESCE(ot.operation_task_completed,0)::BIGINT AS operation_task_completed,
               COALESCE(ot.operation_task_missed,0)::BIGINT AS operation_task_missed,
               COALESCE(adj.comments,'') AS comments
        FROM staff s
        LEFT JOIN attendance a ON a.staff_id=s.id
        LEFT JOIN schedule_usage su ON su.staff_id=s.id
        LEFT JOIN staff_profiles p ON p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id AND p.staff_id=s.id
        LEFT JOIN policies pol ON pol.staff_id=s.id
        LEFT JOIN operation_attendance oa ON oa.staff_id=s.id
        LEFT JOIN operation_tasks ot ON ot.staff_id=s.id
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
               s.shift1_start AS scheduled_shift1_start,s.shift1_end AS scheduled_shift1_end,
               s.shift2_start AS scheduled_shift2_start,s.shift2_end AS scheduled_shift2_end,
               a.status AS attendance_status,a.manual_status,
               a.clock_in_at,a.clock_out_at,COALESCE(a.worked_minutes,0) AS worked_minutes,
               COALESCE(a.late_minutes,0) AS late_minutes,
               COALESCE(a.early_leave_minutes,0) AS early_leave_minutes,
               COALESCE(a.overtime_minutes,0) AS overtime_minutes,
               COALESCE(a.break_minutes,0) AS break_minutes,COALESCE(a.penalty_paise,0)::BIGINT AS penalty_paise,
               COALESCE(a.cash_tip_paise,0)::BIGINT AS cash_tip_paise,COALESCE(a.session_count,0) AS session_count,
               COALESCE(a.source,'') AS source,COALESCE(a.comments,s.notes,'') AS comments,
               COALESCE(a.correction_reason,'') AS correction_reason,a.corrected_at,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',b.id,'startedAt',b.started_at,'endedAt',b.ended_at,'comments',b.comments
                 ) ORDER BY b.started_at)
                 FROM staff_attendance_breaks b
                 WHERE b.tenant_id=a.tenant_id AND b.branch_id=a.branch_id AND b.attendance_id=a.id
               ),'[]'::jsonb) AS breaks,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',session.id,'clockInAt',session.clock_in_at,'clockOutAt',session.clock_out_at,
                   'workTaskRateId',session.work_task_rate_id,'workTaskName',session.work_task_name,
                   'payRatePaise',session.pay_rate_paise,'cashTipPaise',session.cash_tip_paise,'source',session.source
                 ) ORDER BY session.clock_in_at)
                 FROM staff_attendance_sessions session
                 WHERE session.tenant_id=a.tenant_id AND session.branch_id=a.branch_id AND session.attendance_id=a.id
                   AND session.superseded_at IS NULL
               ),'[]'::jsonb) AS sessions,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id',op.id,'title',op.title,'operationType',op.operation_type,'status',op.status,
                   'attendanceStatus',oa.status,'taskStatus',task.status
                 ) ORDER BY op.scheduled_time NULLS LAST,op.title)
                 FROM staff_operation_schedules op
                 LEFT JOIN staff_operation_attendance oa ON oa.tenant_id=op.tenant_id AND oa.branch_id=op.branch_id AND oa.operation_id=op.id AND oa.staff_id=$3
                 LEFT JOIN staff_operation_tasks task ON task.tenant_id=op.tenant_id AND task.branch_id=op.branch_id AND task.operation_id=op.id AND task.staff_id=$3
                 WHERE op.tenant_id=$1 AND op.branch_id=$2 AND op.scheduled_date=COALESCE(a.business_date,s.schedule_date)
                   AND op.status <> 'cancelled'
                   AND (jsonb_array_length(op.assigned_staff_ids)=0 OR op.assigned_staff_ids ? $3 OR oa.id IS NOT NULL OR task.id IS NOT NULL)
               ),'[]'::jsonb) AS operations
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
    sqlx::query_as("SELECT id,staff_id,business_date,clock_in_at,clock_out_at,status,manual_status,source,worked_minutes,late_minutes,early_leave_minutes,overtime_minutes,break_minutes,penalty_paise,cash_tip_paise,session_count,comments,correction_reason,corrected_at FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4")
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
             session.first_clock_in,session.last_clock_out,session.has_open_session,session.gross_minutes,session.session_count,session.cash_tip_paise,
             CASE WHEN session.first_clock_in IS NULL OR settings.start_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (((session.first_clock_in AT TIME ZONE 'Asia/Kolkata')::TIME)-settings.start_time))/60)::INTEGER-settings.grace_minutes) END AS late,
             CASE WHEN session.has_open_session OR session.last_clock_out IS NULL OR settings.end_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (settings.end_time-((session.last_clock_out AT TIME ZONE 'Asia/Kolkata')::TIME)))/60)::INTEGER-settings.early_leave_grace_minutes) END AS early_leave,
             CASE WHEN session.has_open_session OR session.last_clock_out IS NULL OR settings.end_time IS NULL THEN 0 ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (((session.last_clock_out AT TIME ZONE 'Asia/Kolkata')::TIME)-settings.end_time))/60)::INTEGER-settings.overtime_after_minutes) END AS raw_overtime,
             COALESCE((SELECT SUM(FLOOR(EXTRACT(EPOCH FROM (b.ended_at-b.started_at))/60)::INTEGER) FROM staff_attendance_breaks b WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.attendance_id=a.id),0)::INTEGER AS break_minutes,
             settings.*
      FROM staff_attendance_records a CROSS JOIN settings
      CROSS JOIN LATERAL (
        SELECT MIN(s.clock_in_at) AS first_clock_in,MAX(s.clock_out_at) AS last_clock_out,
               BOOL_OR(s.clock_out_at IS NULL) AS has_open_session,
               COALESCE(SUM(CASE WHEN s.clock_out_at IS NULL THEN 0 ELSE FLOOR(EXTRACT(EPOCH FROM (s.clock_out_at-s.clock_in_at))/60)::INTEGER END),0)::INTEGER AS gross_minutes,
               COUNT(*)::INTEGER AS session_count,COALESCE(SUM(s.cash_tip_paise),0)::BIGINT AS cash_tip_paise
        FROM staff_attendance_sessions s WHERE s.attendance_id=a.id AND s.superseded_at IS NULL
      ) session
      WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=$3 AND a.business_date=$4
    )
    UPDATE staff_attendance_records a SET
      clock_in_at=metrics.first_clock_in,clock_out_at=CASE WHEN metrics.has_open_session THEN NULL ELSE metrics.last_clock_out END,
      late_minutes=metrics.late,early_leave_minutes=metrics.early_leave,break_minutes=metrics.break_minutes,
      cash_tip_paise=metrics.cash_tip_paise,session_count=metrics.session_count,
      worked_minutes=GREATEST(0,metrics.gross_minutes-CASE WHEN metrics.deduct_breaks THEN metrics.break_minutes ELSE 0 END),
      overtime_minutes=CASE WHEN metrics.raw_overtime<metrics.minimum_overtime_minutes THEN 0 ELSE LEAST(
        CASE WHEN metrics.maximum_overtime_minutes>0 THEN metrics.maximum_overtime_minutes ELSE metrics.raw_overtime END,
        CASE WHEN metrics.overtime_rounding_minutes>0 THEN (metrics.raw_overtime/metrics.overtime_rounding_minutes)*metrics.overtime_rounding_minutes ELSE metrics.raw_overtime END
      ) END,
      status=COALESCE(a.manual_status,CASE
        WHEN metrics.has_open_session THEN 'clocked_in'
        WHEN metrics.last_clock_out IS NULL THEN a.status
        WHEN metrics.absent_after_minutes>0 AND metrics.late>=metrics.absent_after_minutes THEN 'absent'
        WHEN metrics.half_day_after_minutes>0 AND metrics.late>=metrics.half_day_after_minutes THEN 'half_day'
        WHEN metrics.late>0 THEN 'late'
        ELSE 'present' END),updated_at=NOW()
    FROM metrics WHERE a.id=metrics.id
    RETURNING a.id,a.staff_id,a.business_date,a.clock_in_at,a.clock_out_at,a.status,a.manual_status,a.source,
              a.worked_minutes,a.late_minutes,a.early_leave_minutes,a.overtime_minutes,a.break_minutes,
              a.penalty_paise,a.cash_tip_paise,a.session_count,a.comments,a.correction_reason,a.corrected_at
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
    work_task_rate_id: Option<&str>,
) -> Result<AttendanceRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let task = if let Some(id) = work_task_rate_id {
        sqlx::query_as::<_, (String, String, i64)>("SELECT id,task_name,pay_rate_paise FROM staff_work_task_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND active=TRUE")
            .bind(tenant_id).bind(branch_id).bind(staff_id).bind(id).fetch_optional(&mut *tx).await?
    } else {
        None
    };
    let attendance_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO staff_attendance_records(tenant_id,branch_id,staff_id,business_date,clock_in_at,status,source,comments) VALUES($1,$2,$3,$4,$5,'clocked_in',$6,$7) ON CONFLICT(tenant_id,branch_id,staff_id,business_date) DO UPDATE SET clock_out_at=NULL,status='clocked_in',source=EXCLUDED.source,comments=EXCLUDED.comments,updated_at=NOW() RETURNING id"
    ).bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).bind(clock_in_at).bind(source).bind(comments).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_attendance_sessions(tenant_id,branch_id,staff_id,attendance_id,business_date,clock_in_at,work_task_rate_id,work_task_name,pay_rate_paise,source,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(&attendance_id).bind(business_date).bind(clock_in_at)
        .bind(task.as_ref().map(|row| row.0.as_str())).bind(task.as_ref().map(|row| row.1.as_str()).unwrap_or(""))
        .bind(task.as_ref().map(|row| row.2).unwrap_or(0)).bind(source).bind(comments).execute(&mut *tx).await?;
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

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceWorkTaskRateRecord {
    pub id: String,
    pub task_name: String,
    pub pay_rate_paise: i64,
    pub version: i32,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceClockPolicyRecord {
    pub has_schedule: bool,
    pub schedule_start: Option<NaiveTime>,
    pub scheduled_clock_in_mode: String,
    pub unscheduled_clock_in_mode: String,
    pub early_clock_in_minutes: i32,
    pub mandatory_break_after_minutes: i32,
    pub mandatory_break_minutes: i32,
    pub automatic_break_enabled: bool,
    pub forgot_clock_out_minutes: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceCorrectionRequestRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub business_date: NaiveDate,
    pub requested_clock_in_at: Option<DateTime<Utc>>,
    pub requested_clock_out_at: Option<DateTime<Utc>>,
    pub requested_work_task_rate_id: Option<String>,
    pub work_task_name: String,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_note: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

const CORRECTION_REQUEST_COLUMNS: &str = r#"request.id,request.staff_id,
  COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),request.staff_id) AS staff_name,
  request.business_date,request.requested_clock_in_at,request.requested_clock_out_at,request.requested_work_task_rate_id,
  COALESCE(task.task_name,'') AS work_task_name,request.reason,request.status,request.requested_by,
  request.reviewed_by,request.reviewed_at,request.review_note,request.version,request.created_at,request.updated_at"#;

pub async fn list_correction_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<AttendanceCorrectionRequestRecord>, sqlx::Error> {
    let sql = format!(
        r#"SELECT {CORRECTION_REQUEST_COLUMNS}
      FROM staff_attendance_correction_requests request
      JOIN staff ON staff.tenant_id=request.tenant_id AND staff.branch_id=request.branch_id AND staff.id=request.staff_id
      LEFT JOIN staff_work_task_pay_rates task ON task.id=request.requested_work_task_rate_id
      WHERE request.tenant_id=$1 AND request.branch_id=$2 AND ($3='' OR request.staff_id=$3) AND ($4='' OR request.status=$4)
      ORDER BY request.created_at DESC,request.id DESC LIMIT 500"#
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(status)
        .fetch_all(db)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_correction_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    requested_clock_in_at: Option<DateTime<Utc>>,
    requested_clock_out_at: Option<DateTime<Utc>>,
    requested_work_task_rate_id: Option<&str>,
    reason: &str,
    requested_by: &str,
) -> Result<AttendanceCorrectionRequestRecord, sqlx::Error> {
    let sql = format!(
        r#"WITH inserted AS (
      INSERT INTO staff_attendance_correction_requests(tenant_id,branch_id,staff_id,business_date,requested_clock_in_at,requested_clock_out_at,requested_work_task_rate_id,reason,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    ) SELECT {CORRECTION_REQUEST_COLUMNS} FROM inserted request
      JOIN staff ON staff.tenant_id=request.tenant_id AND staff.branch_id=request.branch_id AND staff.id=request.staff_id
      LEFT JOIN staff_work_task_pay_rates task ON task.id=request.requested_work_task_rate_id"#
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .bind(requested_clock_in_at)
        .bind(requested_clock_out_at)
        .bind(requested_work_task_rate_id)
        .bind(reason)
        .bind(requested_by)
        .fetch_one(db)
        .await
}

pub async fn get_correction_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<AttendanceCorrectionRequestRecord>, sqlx::Error> {
    let sql = format!(
        r#"SELECT {CORRECTION_REQUEST_COLUMNS} FROM staff_attendance_correction_requests request
      JOIN staff ON staff.tenant_id=request.tenant_id AND staff.branch_id=request.branch_id AND staff.id=request.staff_id
      LEFT JOIN staff_work_task_pay_rates task ON task.id=request.requested_work_task_rate_id
      WHERE request.tenant_id=$1 AND request.branch_id=$2 AND request.id=$3"#
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn claim_correction_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    reviewer_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE staff_attendance_correction_requests SET status='processing',reviewed_by=$5,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' AND version=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(version).bind(reviewer_id).execute(db).await?.rows_affected()==1)
}

pub async fn finish_correction_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    from_status: &str,
    status: &str,
    reviewer_id: &str,
    review_note: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE staff_attendance_correction_requests SET status=$5,reviewed_by=$6,reviewed_at=CASE WHEN $5='pending' THEN NULL ELSE NOW() END,review_note=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(from_status).bind(status).bind(reviewer_id).bind(review_note).execute(db).await?.rows_affected()==1)
}

pub async fn work_task_rates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<AttendanceWorkTaskRateRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,task_name,pay_rate_paise,version FROM staff_work_task_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND active=TRUE ORDER BY task_name,id")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_all(db).await
}

pub async fn clock_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<AttendanceClockPolicyRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT schedule.id IS NOT NULL AND schedule.status='working' AS has_schedule,
                  schedule.shift1_start AS schedule_start,
                  COALESCE(rule.scheduled_clock_in_mode,'allow') AS scheduled_clock_in_mode,
                  COALESCE(rule.unscheduled_clock_in_mode,'warn') AS unscheduled_clock_in_mode,
                  COALESCE(rule.early_clock_in_minutes,0) AS early_clock_in_minutes,
                  COALESCE(rule.mandatory_break_after_minutes,profile.mandatory_break_minutes,0) AS mandatory_break_after_minutes,
                  COALESCE(rule.mandatory_break_minutes,profile.mandatory_break_minutes,0) AS mandatory_break_minutes,
                  COALESCE(rule.automatic_break_enabled,FALSE) AS automatic_break_enabled,
                  COALESCE(rule.forgot_clock_out_minutes,0) AS forgot_clock_out_minutes
             FROM staff employee
             LEFT JOIN staff_profiles profile ON profile.tenant_id=employee.tenant_id AND profile.branch_id=employee.branch_id AND profile.staff_id=employee.id
             LEFT JOIN staff_schedules schedule ON schedule.tenant_id=employee.tenant_id AND schedule.branch_id=employee.branch_id AND schedule.staff_id=employee.id AND schedule.schedule_date=$4
             LEFT JOIN staff_attendance_rules rule ON rule.tenant_id=employee.tenant_id AND rule.branch_id=employee.branch_id AND rule.active=TRUE
            WHERE employee.tenant_id=$1 AND employee.branch_id=$2 AND employee.id=$3"#,
    )
    .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).fetch_one(db).await
}

pub async fn active_clock_state(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<(Option<DateTime<Utc>>, i64), sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
             (SELECT MAX(clock_in_at) FROM staff_attendance_sessions WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4 AND clock_out_at IS NULL AND superseded_at IS NULL),
             COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (breaks.ended_at-breaks.started_at))/60)::BIGINT
                         FROM staff_attendance_breaks breaks
                         JOIN staff_attendance_records attendance ON attendance.id=breaks.attendance_id
                        WHERE breaks.tenant_id=$1 AND breaks.branch_id=$2 AND breaks.staff_id=$3
                          AND attendance.business_date=$4 AND breaks.ended_at IS NOT NULL),0)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .fetch_one(db)
    .await
}

pub async fn clock_out(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    clock_out_at: DateTime<Utc>,
    penalty_paise: i64,
    cash_tip_paise: i64,
    comments: &str,
    automatic_break_after_minutes: i32,
    automatic_break_minutes: i32,
) -> Result<Option<AttendanceRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query_as::<_, (String, DateTime<Utc>)>("UPDATE staff_attendance_sessions SET clock_out_at=$5,cash_tip_paise=$6,comments=$7,updated_at=NOW() WHERE id=(SELECT id FROM staff_attendance_sessions WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4 AND clock_out_at IS NULL AND superseded_at IS NULL AND $5>=clock_in_at ORDER BY clock_in_at DESC LIMIT 1) RETURNING attendance_id,clock_in_at")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).bind(clock_out_at).bind(cash_tip_paise).bind(comments).fetch_optional(&mut *tx).await?;
    let Some((attendance_id, clock_in_at)) = updated else {
        tx.rollback().await?;
        return Ok(None);
    };
    if let Some((break_start, break_end)) = automatic_break_window(
        clock_in_at,
        clock_out_at,
        automatic_break_after_minutes,
        automatic_break_minutes,
    ) {
        sqlx::query("INSERT INTO staff_attendance_breaks(tenant_id,branch_id,staff_id,attendance_id,started_at,ended_at,comments,created_by) SELECT $1,$2,$3,$4,$5,$6,'Automatic policy break','system' WHERE NOT EXISTS(SELECT 1 FROM staff_attendance_breaks WHERE tenant_id=$1 AND branch_id=$2 AND attendance_id=$4)")
            .bind(tenant_id).bind(branch_id).bind(staff_id).bind(&attendance_id).bind(break_start).bind(break_end).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE staff_attendance_records SET penalty_paise=$5,comments=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).bind(penalty_paise).bind(comments).execute(&mut *tx).await?;
    let before: Option<i32> = sqlx::query_scalar("SELECT overtime_minutes FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(business_date).fetch_optional(&mut *tx).await?;
    let row: AttendanceRecord = sqlx::query_as(RECALCULATE_ATTENDANCE_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .fetch_one(&mut *tx)
        .await?;
    if before != Some(row.overtime_minutes) {
        sqlx::query("UPDATE staff_attendance_records SET ot_approval_status='pending',approved_overtime_minutes=0,ot_approved_by=NULL,ot_approved_at=NULL,updated_at=NOW() WHERE id=$1")
            .bind(&row.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Some(row))
}

fn automatic_break_window(
    clock_in_at: DateTime<Utc>,
    clock_out_at: DateTime<Utc>,
    after_minutes: i32,
    break_minutes: i32,
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    (after_minutes > 0
        && break_minutes > 0
        && clock_out_at - clock_in_at >= Duration::minutes(i64::from(after_minutes)))
    .then(|| {
        (
            (clock_out_at - Duration::minutes(i64::from(break_minutes))).max(clock_in_at),
            clock_out_at,
        )
    })
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

/// Recomputes attendance and, if the recomputation changed `overtime_minutes`, resets any
/// existing OT approval decision back to pending — an approval must always match the overtime
/// figure it was actually granted against, never a stale one from before a correction/clock edit.
async fn recalculate_with_ot_reset(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<AttendanceRecord, sqlx::Error> {
    let before_overtime: Option<i32> = sqlx::query_scalar(
        "SELECT overtime_minutes FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .fetch_optional(db)
    .await?;
    let updated = recalculate(db, tenant_id, branch_id, staff_id, business_date).await?;
    if before_overtime != Some(updated.overtime_minutes) {
        sqlx::query(
            "UPDATE staff_attendance_records SET ot_approval_status='pending',approved_overtime_minutes=0,ot_approved_by=NULL,ot_approved_at=NULL,updated_at=NOW() \
             WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .execute(db)
        .await?;
    }
    Ok(updated)
}

pub async fn start_break(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    started_at: DateTime<Utc>,
    created_by: &str,
) -> Result<Option<AttendanceBreakRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_attendance_breaks(
          tenant_id,branch_id,staff_id,attendance_id,started_at,ended_at,comments,created_by
        )
        SELECT $1,$2,$3,a.id,$5,NULL,'',$6
        FROM staff_attendance_records a
        WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.staff_id=$3 AND a.business_date=$4
          AND a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
        ON CONFLICT (attendance_id) WHERE ended_at IS NULL DO NOTHING
        RETURNING id,attendance_id,started_at,ended_at,comments
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .bind(started_at)
    .bind(created_by)
    .fetch_optional(db)
    .await
}

pub async fn end_break(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
    ended_at: DateTime<Utc>,
) -> Result<Option<AttendanceRecord>, sqlx::Error> {
    let updated = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE staff_attendance_breaks b SET ended_at=$5,updated_at=NOW()
        FROM staff_attendance_records a
        WHERE a.id=b.attendance_id AND b.tenant_id=$1 AND b.branch_id=$2 AND b.staff_id=$3
          AND a.business_date=$4 AND b.ended_at IS NULL AND $5>=b.started_at
        RETURNING b.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .bind(ended_at)
    .fetch_optional(db)
    .await?;
    if updated.is_none() {
        return Ok(None);
    }
    recalculate_with_ot_reset(db, tenant_id, branch_id, staff_id, business_date)
        .await
        .map(Some)
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
    sqlx::query("UPDATE staff_attendance_sessions SET superseded_at=NOW(),superseded_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND attendance_id=$3 AND superseded_at IS NULL")
        .bind(tenant_id).bind(branch_id).bind(&attendance_id).bind(&input.corrected_by).execute(&mut *tx).await?;
    if let Some(clock_in_at) = input.clock_in_at {
        let task = if let Some(id) = input.work_task_rate_id.as_deref() {
            sqlx::query_as::<_, (String, String, i64)>("SELECT id,task_name,pay_rate_paise FROM staff_work_task_pay_rates WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND active=TRUE")
                .bind(tenant_id).bind(branch_id).bind(staff_id).bind(id).fetch_optional(&mut *tx).await?
        } else {
            None
        };
        sqlx::query("INSERT INTO staff_attendance_sessions(tenant_id,branch_id,staff_id,attendance_id,business_date,clock_in_at,clock_out_at,work_task_rate_id,work_task_name,pay_rate_paise,source,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual_correction',$11)")
            .bind(tenant_id).bind(branch_id).bind(staff_id).bind(&attendance_id).bind(business_date)
            .bind(clock_in_at).bind(input.clock_out_at).bind(task.as_ref().map(|row| row.0.as_str()))
            .bind(task.as_ref().map(|row| row.1.as_str()).unwrap_or("")).bind(task.as_ref().map(|row| row.2).unwrap_or(0))
            .bind(&input.comments).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM staff_attendance_breaks WHERE tenant_id=$1 AND branch_id=$2 AND attendance_id=$3")
        .bind(tenant_id).bind(branch_id).bind(&attendance_id).execute(&mut *tx).await?;
    for item in input.breaks {
        sqlx::query("INSERT INTO staff_attendance_breaks(tenant_id,branch_id,staff_id,attendance_id,started_at,ended_at,comments,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(staff_id).bind(&attendance_id)
            .bind(item.started_at).bind(item.ended_at).bind(item.comments).bind(&input.corrected_by)
            .execute(&mut *tx).await?;
    }
    let before_overtime: Option<i32> =
        sqlx::query_scalar("SELECT overtime_minutes FROM staff_attendance_records WHERE id=$1")
            .bind(&attendance_id)
            .fetch_optional(&mut *tx)
            .await?;
    let row: AttendanceRecord = sqlx::query_as(RECALCULATE_ATTENDANCE_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .bind(business_date)
        .fetch_one(&mut *tx)
        .await?;
    if before_overtime != Some(row.overtime_minutes) {
        // The correction changed overtime — any prior OT approval no longer matches reality.
        sqlx::query(
            "UPDATE staff_attendance_records SET ot_approval_status='pending',approved_overtime_minutes=0,ot_approved_by=NULL,ot_approved_at=NULL,updated_at=NOW() WHERE id=$1",
        )
        .bind(&attendance_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(row)
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeApprovalRecord {
    pub id: String,
    pub staff_id: String,
    pub business_date: NaiveDate,
    pub overtime_minutes: i32,
    pub ot_approval_status: String,
    pub approved_overtime_minutes: i32,
    pub ot_approved_by: Option<String>,
    pub ot_approved_at: Option<DateTime<Utc>>,
}

const OVERTIME_APPROVAL_COLUMNS: &str =
    "id,staff_id,business_date,overtime_minutes,ot_approval_status,\
approved_overtime_minutes,ot_approved_by,ot_approved_at";

pub async fn list_overtime(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<OvertimeApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {OVERTIME_APPROVAL_COLUMNS} FROM staff_attendance_records
         WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR staff_id=$3) AND ($4='' OR ot_approval_status=$4)
           AND overtime_minutes>0 AND business_date BETWEEN $5 AND $6
         ORDER BY business_date DESC,staff_id
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(status)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn decide_overtime(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    attendance_id: &str,
    actor_user_id: &str,
    decision: &str,
    approved_overtime_minutes: i32,
) -> Result<Option<OvertimeApprovalRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_attendance_records SET
          ot_approval_status=$5,approved_overtime_minutes=LEAST($6,overtime_minutes),ot_approved_by=$4,ot_approved_at=NOW(),updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND overtime_minutes>0
        RETURNING {OVERTIME_APPROVAL_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(attendance_id)
    .bind(actor_user_id)
    .bind(decision)
    .bind(approved_overtime_minutes)
    .fetch_optional(db)
    .await
}

pub async fn overtime_business_date(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    attendance_id: &str,
) -> Result<Option<NaiveDate>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT business_date FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND overtime_minutes>0",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(attendance_id)
    .fetch_optional(db)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn automatic_break_requires_threshold_and_uses_policy_duration() {
        let clock_in = Utc.with_ymd_and_hms(2026, 8, 2, 3, 30, 0).unwrap();
        let clock_out = clock_in + Duration::hours(8);
        assert_eq!(
            automatic_break_window(clock_in, clock_out, 360, 30),
            Some((clock_out - Duration::minutes(30), clock_out))
        );
        assert_eq!(automatic_break_window(clock_in, clock_out, 600, 30), None);
    }
}
