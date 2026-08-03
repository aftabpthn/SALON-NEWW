use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgConnection, PgPool};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRequestRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub leave_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub days: i32,
    pub requested_days: f64,
    pub day_parts: Value,
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

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LeaveBalanceRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub employee_code: Option<String>,
    pub leave_type: String,
    pub annual_days: f64,
    pub used_days: f64,
    pub pending_days: f64,
    pub remaining_days: f64,
    pub allow_negative: bool,
    pub negative_limit_days: f64,
    pub balance_cap_days: Option<f64>,
    pub carry_forward_days: f64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LeaveAccrualEventRecord {
    pub id: String,
    pub leave_type: String,
    pub effective_date: NaiveDate,
    pub days: f64,
    pub event_type: String,
    pub notes: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct LeaveDayInput {
    pub leave_date: NaiveDate,
    pub start_time: Option<NaiveTime>,
    pub end_time: Option<NaiveTime>,
    pub day_fraction: f64,
}

#[derive(Debug)]
pub struct NewLeaveRequest {
    pub staff_id: String,
    pub leave_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub days: i32,
    pub requested_days: f64,
    pub day_parts: Vec<LeaveDayInput>,
    pub reason: String,
    pub requested_by: String,
}

pub enum CreateOutcome {
    Created(String),
    StaffNotFound,
    PolicyMissing,
    Overlap,
}

pub enum DecisionOutcome {
    Updated,
    NotFound,
    Conflict,
    PolicyMissing,
    InsufficientBalance,
}

#[derive(Debug, FromRow)]
struct LeaveRequestState {
    staff_id: String,
    leave_type: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    days: i32,
    requested_days: f64,
    status: String,
    version: i32,
    requested_by: String,
}

pub async fn list_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_id: &str,
    status: &str,
) -> Result<Vec<LeaveRequestRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT r.id,r.staff_id,
               TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS staff_name,
               s.employee_code,r.leave_type,r.start_date,r.end_date,r.days,r.requested_days::DOUBLE PRECISION AS requested_days,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('date',part.leave_date,'startTime',part.start_time,'endTime',part.end_time,'dayFraction',part.day_fraction) ORDER BY part.leave_date) FROM staff_leave_request_days part WHERE part.request_id=r.id),'[]'::jsonb) AS day_parts,
               r.reason,r.status,
               r.requested_by,r.reviewed_by,r.reviewed_at,r.review_note,r.version,r.created_at,r.updated_at
        FROM staff_leave_requests r
        JOIN staff s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.id=r.staff_id
        WHERE r.tenant_id=$1 AND r.branch_id=$2
          AND r.end_date >= $3 AND r.start_date <= $4
          AND ($5='' OR r.staff_id=$5)
          AND ($6='' OR r.status=$6)
        ORDER BY r.created_at DESC,r.id DESC
        LIMIT 500
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(date_from)
    .bind(date_to)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn get_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
) -> Result<Option<LeaveRequestRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT r.id,r.staff_id,
               TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS staff_name,
               s.employee_code,r.leave_type,r.start_date,r.end_date,r.days,r.requested_days::DOUBLE PRECISION AS requested_days,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('date',part.leave_date,'startTime',part.start_time,'endTime',part.end_time,'dayFraction',part.day_fraction) ORDER BY part.leave_date) FROM staff_leave_request_days part WHERE part.request_id=r.id),'[]'::jsonb) AS day_parts,
               r.reason,r.status,
               r.requested_by,r.reviewed_by,r.reviewed_at,r.review_note,r.version,r.created_at,r.updated_at
        FROM staff_leave_requests r
        JOIN staff s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.id=r.staff_id
        WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .fetch_optional(db)
    .await
}

pub async fn create_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewLeaveRequest,
) -> Result<CreateOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let staff_name = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(NULLIF(appointment_display_name,''),TRIM(CONCAT_WS(' ',first_name,last_name))) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.staff_id)
    .fetch_optional(&mut *tx)
    .await?
    ;
    let Some(staff_name) = staff_name else {
        return Ok(CreateOutcome::StaffNotFound);
    };

    if input.leave_type != "unpaid" {
        let policy = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM staff_leave_policies WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND leave_type=$4 AND active=true",
        )
        .bind(tenant_id).bind(branch_id).bind(&input.staff_id).bind(&input.leave_type)
        .fetch_one(&mut *tx).await?;
        if policy == 0 {
            return Ok(CreateOutcome::PolicyMissing);
        }
    }

    let overlap = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status IN ('pending','approved') AND end_date >= $4 AND start_date <= $5",
    )
    .bind(tenant_id).bind(branch_id).bind(&input.staff_id).bind(input.start_date).bind(input.end_date)
    .fetch_one(&mut *tx).await?;
    if overlap > 0 {
        return Ok(CreateOutcome::Overlap);
    }

    let id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO staff_leave_requests(
          tenant_id,branch_id,staff_id,leave_type,start_date,end_date,days,requested_days,reason,requested_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.staff_id)
    .bind(&input.leave_type)
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.days)
    .bind(input.requested_days)
    .bind(&input.reason)
    .bind(&input.requested_by)
    .fetch_one(&mut *tx)
    .await?;
    for part in &input.day_parts {
        sqlx::query("INSERT INTO staff_leave_request_days(tenant_id,branch_id,request_id,staff_id,leave_date,start_time,end_time,day_fraction) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(tenant_id).bind(branch_id).bind(&id).bind(&input.staff_id).bind(part.leave_date)
            .bind(part.start_time).bind(part.end_time).bind(part.day_fraction).execute(&mut *tx).await?;
    }
    notify_leave_managers(
        &mut tx,
        tenant_id,
        branch_id,
        &input.requested_by,
        &id,
        "Leave request",
        &format!(
            "{staff_name} requested {} leave from {} to {}.",
            input.leave_type,
            input.start_date.format("%d/%m/%Y"),
            input.end_date.format("%d/%m/%Y")
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(CreateOutcome::Created(id))
}

pub async fn decide_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    expected_version: i32,
    decision: &str,
    reviewer_id: &str,
    review_note: &str,
) -> Result<DecisionOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let request = sqlx::query_as::<_, LeaveRequestState>(
        "SELECT staff_id,leave_type,start_date,end_date,days,requested_days::DOUBLE PRECISION AS requested_days,status,version,requested_by FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant_id).bind(branch_id).bind(request_id).fetch_optional(&mut *tx).await?;
    let Some(request) = request else {
        return Ok(DecisionOutcome::NotFound);
    };
    if request.status != "pending" || request.version != expected_version {
        return Ok(DecisionOutcome::Conflict);
    }

    sqlx::query("SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&request.staff_id)
        .execute(&mut *tx)
        .await?;

    if decision == "approved" && request.leave_type != "unpaid" {
        let policy = sqlx::query_as::<_, (i64, f64, bool, f64, Option<f64>)>(r#"
          WITH identity AS (SELECT user_id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)
          SELECT COUNT(*)::BIGINT,
                 COALESCE(MAX(policy.annual_days+policy.carry_forward_days),0)::DOUBLE PRECISION,
                 COALESCE(BOOL_OR(policy.allow_negative),FALSE),
                 COALESCE(MAX(policy.negative_limit_days),0)::DOUBLE PRECISION,
                 MIN(policy.balance_cap_days)::DOUBLE PRECISION
          FROM staff_leave_policies policy
          JOIN staff employee ON employee.tenant_id=policy.tenant_id AND employee.branch_id=policy.branch_id AND employee.id=policy.staff_id
          CROSS JOIN identity
          WHERE policy.tenant_id=$1 AND policy.leave_type=$4 AND policy.active=TRUE
            AND (employee.id=$3 OR (identity.user_id IS NOT NULL AND employee.user_id=identity.user_id))"#)
        .bind(tenant_id).bind(branch_id).bind(&request.staff_id).bind(&request.leave_type).fetch_one(&mut *tx).await?;
        if policy.0 == 0 {
            return Ok(DecisionOutcome::PolicyMissing);
        }
        let year_start = NaiveDate::from_ymd_opt(request.start_date.year(), 1, 1).unwrap();
        let year_end = NaiveDate::from_ymd_opt(request.start_date.year(), 12, 31).unwrap();
        let used = sqlx::query_scalar::<_, f64>(r#"
            WITH identity AS (SELECT user_id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)
            SELECT COALESCE(SUM(requested_days),0)::DOUBLE PRECISION FROM staff_leave_requests request
            JOIN staff employee ON employee.tenant_id=request.tenant_id AND employee.branch_id=request.branch_id AND employee.id=request.staff_id
            CROSS JOIN identity WHERE request.tenant_id=$1 AND request.leave_type=$4 AND request.status='approved'
              AND request.start_date >= $5 AND request.end_date <= $6
              AND (employee.id=$3 OR (identity.user_id IS NOT NULL AND employee.user_id=identity.user_id))"#)
        .bind(tenant_id).bind(branch_id).bind(&request.staff_id).bind(&request.leave_type)
        .bind(year_start).bind(year_end).fetch_one(&mut *tx).await?;
        let entitlement = policy.4.map(|cap| cap.min(policy.1)).unwrap_or(policy.1);
        let allowed = entitlement + if policy.2 { policy.3 } else { 0.0 };
        if used + request.requested_days > allowed {
            return Ok(DecisionOutcome::InsufficientBalance);
        }
    }

    sqlx::query(
        "UPDATE staff_leave_requests SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(request_id).bind(decision).bind(reviewer_id).bind(review_note)
    .execute(&mut *tx).await?;

    sqlx::query("UPDATE notifications SET is_read=TRUE,metadata_json=jsonb_set(metadata_json,'{status}',to_jsonb($4::TEXT),TRUE),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND resource_type='staff_leave_request' AND resource_id=$3")
        .bind(tenant_id).bind(branch_id).bind(request_id).bind(decision).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json) VALUES($1,$2,$3,$4,'staff_leave_decision',$5,$6,'staff_leave_request',$7,$8)")
        .bind(tenant_id).bind(branch_id).bind(&request.requested_by).bind(reviewer_id)
        .bind(format!("Leave request {decision}"))
        .bind(format!("Your {} leave request from {} to {} was {decision}.", request.leave_type, request.start_date.format("%d/%m/%Y"), request.end_date.format("%d/%m/%Y")))
        .bind(request_id).bind(json!({"deepLink":"/staff/leaves","status":decision})).execute(&mut *tx).await?;

    if decision == "approved" {
        let schedule_status = match request.leave_type.as_str() {
            "annual" => "annual_leave",
            "sick" => "sick_leave",
            "special" => "special_leave",
            _ => "leave",
        };
        let schedule_note = format!("Approved {} leave", request.leave_type);
        sqlx::query(r#"INSERT INTO staff_leave_schedule_backups(request_id,tenant_id,branch_id,staff_id,schedule_date,existed,shift1_start,shift1_end,shift2_start,shift2_end,status,notes,room_id,role_id,job_title)
          SELECT $1,$2,$3,$4,part.leave_date,schedule.id IS NOT NULL,schedule.shift1_start,schedule.shift1_end,schedule.shift2_start,schedule.shift2_end,schedule.status,schedule.notes,schedule.room_id,schedule.role_id,schedule.job_title
          FROM staff_leave_request_days part LEFT JOIN staff_schedules schedule ON schedule.tenant_id=$2 AND schedule.branch_id=$3 AND schedule.staff_id=$4 AND schedule.schedule_date=part.leave_date
          WHERE part.request_id=$1 AND part.start_time IS NULL ON CONFLICT(request_id,schedule_date) DO NOTHING"#)
          .bind(request_id).bind(tenant_id).bind(branch_id).bind(&request.staff_id).execute(&mut *tx).await?;
        sqlx::query(
            r#"
            INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,status,notes,leave_request_id)
            SELECT $1,$2,$3,part.leave_date,$4,$5,$6
            FROM staff_leave_request_days part WHERE part.request_id=$6 AND part.start_time IS NULL
            ON CONFLICT (tenant_id,branch_id,staff_id,schedule_date)
            DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes,leave_request_id=EXCLUDED.leave_request_id,version=staff_schedules.version+1,updated_at=NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&request.staff_id)
        .bind(schedule_status)
        .bind(schedule_note)
        .bind(request_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(DecisionOutcome::Updated)
}

pub async fn withdraw_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    expected_version: i32,
) -> Result<DecisionOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query(
        "UPDATE staff_leave_requests SET status='withdrawn',reviewed_by=$5,reviewed_at=NOW(),review_note='Withdrawn by requester',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND staff_id=$4 AND status='pending' AND version=$6",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .bind(staff_id)
    .bind(actor_user_id)
    .bind(expected_version)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 1 {
        sqlx::query("UPDATE notifications SET is_read=TRUE,metadata_json=jsonb_set(metadata_json,'{status}','\"withdrawn\"'::jsonb,TRUE),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND resource_type='staff_leave_request' AND resource_id=$3")
            .bind(tenant_id).bind(branch_id).bind(request_id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(DecisionOutcome::Updated);
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND staff_id=$4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .bind(staff_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(if exists {
        DecisionOutcome::Conflict
    } else {
        DecisionOutcome::NotFound
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn cancel_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    expected_version: i32,
    reason: &str,
    today: NaiveDate,
) -> Result<DecisionOutcome, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query("UPDATE staff_leave_requests SET status='cancelled',cancelled_by=$5,cancelled_at=NOW(),cancellation_reason=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND staff_id=$4 AND status='approved' AND version=$6 AND end_date>=$8")
        .bind(tenant_id).bind(branch_id).bind(request_id).bind(staff_id).bind(actor_user_id).bind(expected_version).bind(reason).bind(today).execute(&mut *tx).await?;
    if updated.rows_affected() == 0 {
        let exists=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND staff_id=$4)")
            .bind(tenant_id).bind(branch_id).bind(request_id).bind(staff_id).fetch_one(&mut *tx).await?;
        tx.rollback().await?;
        return Ok(if exists {
            DecisionOutcome::Conflict
        } else {
            DecisionOutcome::NotFound
        });
    }
    sqlx::query(r#"UPDATE staff_schedules schedule SET shift1_start=backup.shift1_start,shift1_end=backup.shift1_end,shift2_start=backup.shift2_start,shift2_end=backup.shift2_end,status=backup.status,notes=backup.notes,room_id=backup.room_id,role_id=backup.role_id,job_title=backup.job_title,leave_request_id=NULL,version=schedule.version+1,updated_at=NOW()
      FROM staff_leave_schedule_backups backup WHERE backup.request_id=$1 AND backup.existed=TRUE AND backup.schedule_date>=$2
        AND schedule.tenant_id=backup.tenant_id AND schedule.branch_id=backup.branch_id AND schedule.staff_id=backup.staff_id
        AND schedule.schedule_date=backup.schedule_date AND schedule.leave_request_id=$1"#)
        .bind(request_id).bind(today).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM staff_schedules WHERE leave_request_id=$1 AND schedule_date>=$2 AND EXISTS(SELECT 1 FROM staff_leave_schedule_backups backup WHERE backup.request_id=$1 AND backup.schedule_date=staff_schedules.schedule_date AND backup.existed=FALSE)")
        .bind(request_id).bind(today).execute(&mut *tx).await?;
    sqlx::query("UPDATE notifications SET is_read=TRUE,metadata_json=jsonb_set(metadata_json,'{status}','\"cancelled\"'::jsonb,TRUE),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND resource_type='staff_leave_request' AND resource_id=$3")
        .bind(tenant_id).bind(branch_id).bind(request_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(DecisionOutcome::Updated)
}

async fn notify_leave_managers(
    tx: &mut PgConnection,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    request_id: &str,
    title: &str,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
           SELECT $1,$2,u.id,$3,'staff_leave_request',$5,$6,'staff_leave_request',$7,$8
             FROM users u
             LEFT JOIN user_branch_roles ubr ON ubr.tenant_id=u.tenant_id AND ubr.user_id=u.id AND ubr.branch_id=$2 AND ubr.active=TRUE
             LEFT JOIN roles r ON r.tenant_id=u.tenant_id AND r.id=COALESCE(ubr.role_id,u.role_id)
            WHERE u.tenant_id=$1 AND u.active=TRUE AND u.id<>$3
              AND COALESCE(ubr.branch_id,u.branch_id)=$2
              AND (REGEXP_REPLACE(LOWER(COALESCE(ubr.role_name,u.role_name)), '[-_ ]', '', 'g') IN ('owner','admin','manager','regionalhead')
                   OR ((COALESCE(r.permissions_json,'[]'::jsonb) ? $4 OR COALESCE(r.permissions_json,'[]'::jsonb) ? 'staff.app.leaves.manage')
                       AND NOT (COALESCE(r.denied_permissions_json,'[]'::jsonb) ? $4)
                       AND NOT (COALESCE(r.denied_permissions_json,'[]'::jsonb) ? 'staff.app.leaves.manage')))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(actor_user_id).bind("staff.leave.manage").bind(title).bind(body).bind(request_id)
    .bind(json!({"deepLink":"/staff/leave-management?status=pending","status":"pending"})).execute(&mut *tx).await?;
    Ok(())
}

pub async fn restore_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    expected_version: i32,
) -> Result<DecisionOutcome, sqlx::Error> {
    let updated = sqlx::query(
        "UPDATE staff_leave_requests SET status='pending',reviewed_by=NULL,reviewed_at=NULL,review_note='',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='withdrawn' AND version=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .bind(expected_version)
    .execute(db)
    .await?;
    if updated.rows_affected() == 1 {
        return Ok(DecisionOutcome::Updated);
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .fetch_one(db)
    .await?;
    Ok(if exists {
        DecisionOutcome::Conflict
    } else {
        DecisionOutcome::NotFound
    })
}

pub async fn balances(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    year_start: NaiveDate,
    year_end: NaiveDate,
    staff_id: &str,
) -> Result<Vec<LeaveBalanceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH local_staff AS (
          SELECT id,user_id,TRIM(CONCAT_WS(' ',first_name,NULLIF(last_name,''))) AS staff_name,employee_code
          FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND ($5='' OR id=$5)
        )
        SELECT employee.id AS staff_id,employee.staff_name,employee.employee_code,policy.leave_type,
               LEAST(policy.annual_days,COALESCE(policy.balance_cap_days,policy.annual_days))::DOUBLE PRECISION AS annual_days,
               COALESCE(usage.used_days,0)::DOUBLE PRECISION AS used_days,
               COALESCE(usage.pending_days,0)::DOUBLE PRECISION AS pending_days,
               GREATEST(LEAST(policy.annual_days,COALESCE(policy.balance_cap_days,policy.annual_days))-COALESCE(usage.used_days,0),
                 CASE WHEN policy.allow_negative THEN -policy.negative_limit_days ELSE 0 END)::DOUBLE PRECISION AS remaining_days,
               policy.allow_negative,policy.negative_limit_days::DOUBLE PRECISION,
               policy.balance_cap_days::DOUBLE PRECISION,policy.carry_forward_days::DOUBLE PRECISION
        FROM local_staff employee
        JOIN LATERAL (
          SELECT source.leave_type,
                 MAX(source.annual_days+source.carry_forward_days)::NUMERIC AS annual_days,
                 BOOL_OR(source.allow_negative) AS allow_negative,
                 MAX(source.negative_limit_days)::NUMERIC AS negative_limit_days,
                 MIN(source.balance_cap_days)::NUMERIC AS balance_cap_days,
                 MAX(source.carry_forward_days)::NUMERIC AS carry_forward_days
          FROM staff_leave_policies source
          JOIN staff owner ON owner.tenant_id=source.tenant_id AND owner.branch_id=source.branch_id AND owner.id=source.staff_id
          WHERE source.tenant_id=$1 AND source.active=TRUE
            AND (owner.id=employee.id OR (employee.user_id IS NOT NULL AND owner.user_id=employee.user_id))
          GROUP BY source.leave_type
        ) policy ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(request.requested_days) FILTER(WHERE request.status='approved'),0)::NUMERIC AS used_days,
                 COALESCE(SUM(request.requested_days) FILTER(WHERE request.status='pending'),0)::NUMERIC AS pending_days
          FROM staff_leave_requests request
          JOIN staff requester ON requester.tenant_id=request.tenant_id AND requester.branch_id=request.branch_id AND requester.id=request.staff_id
          WHERE request.tenant_id=$1 AND request.leave_type=policy.leave_type AND request.start_date >= $3 AND request.end_date <= $4
            AND (requester.id=employee.id OR (employee.user_id IS NOT NULL AND requester.user_id=employee.user_id))
        ) usage ON TRUE
        ORDER BY employee.staff_name,policy.leave_type
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(year_start).bind(year_end).bind(staff_id)
    .fetch_all(db).await
}

pub async fn accrual_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    year_start: NaiveDate,
    year_end: NaiveDate,
) -> Result<Vec<LeaveAccrualEventRecord>, sqlx::Error> {
    sqlx::query_as(r#"WITH identity AS (SELECT user_id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)
      SELECT event.id,event.leave_type,event.effective_date,event.days::DOUBLE PRECISION,event.event_type,event.notes,event.created_at
      FROM staff_leave_accrual_events event JOIN staff employee ON employee.tenant_id=event.tenant_id AND employee.branch_id=event.branch_id AND employee.id=event.staff_id
      CROSS JOIN identity WHERE event.tenant_id=$1 AND event.effective_date BETWEEN $4 AND $5
        AND (employee.id=$3 OR (identity.user_id IS NOT NULL AND employee.user_id=identity.user_id))
      ORDER BY event.effective_date DESC,event.created_at DESC,event.id DESC LIMIT 500"#)
      .bind(tenant_id).bind(branch_id).bind(staff_id).bind(year_start).bind(year_end).fetch_all(db).await
}
