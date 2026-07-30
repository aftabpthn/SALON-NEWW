use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::Serialize;
use serde_json::json;
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
    pub annual_days: i32,
    pub used_days: i32,
    pub pending_days: i32,
    pub remaining_days: i32,
}

#[derive(Debug)]
pub struct NewLeaveRequest {
    pub staff_id: String,
    pub leave_type: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub days: i32,
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
               s.employee_code,r.leave_type,r.start_date,r.end_date,r.days,r.reason,r.status,
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
               s.employee_code,r.leave_type,r.start_date,r.end_date,r.days,r.reason,r.status,
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
          tenant_id,branch_id,staff_id,leave_type,start_date,end_date,days,reason,requested_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
    .bind(&input.reason)
    .bind(&input.requested_by)
    .fetch_one(&mut *tx)
    .await?;
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
        "SELECT staff_id,leave_type,start_date,end_date,days,status,version,requested_by FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
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
        let allowance = sqlx::query_scalar::<_, Option<i32>>(
            "SELECT MAX(annual_days) FROM staff_leave_policies WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND leave_type=$4 AND active=true",
        )
        .bind(tenant_id).bind(branch_id).bind(&request.staff_id).bind(&request.leave_type)
        .fetch_one(&mut *tx).await?;
        let Some(allowance) = allowance else {
            return Ok(DecisionOutcome::PolicyMissing);
        };
        let year_start = NaiveDate::from_ymd_opt(request.start_date.year(), 1, 1).unwrap();
        let year_end = NaiveDate::from_ymd_opt(request.start_date.year(), 12, 31).unwrap();
        let used = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(days),0) FROM staff_leave_requests WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND leave_type=$4 AND status='approved' AND start_date >= $5 AND end_date <= $6",
        )
        .bind(tenant_id).bind(branch_id).bind(&request.staff_id).bind(&request.leave_type)
        .bind(year_start).bind(year_end).fetch_one(&mut *tx).await?;
        if used + i64::from(request.days) > i64::from(allowance) {
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
        sqlx::query(
            r#"
            INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,status,notes)
            SELECT $1,$2,$3,day::DATE,$6,$7
            FROM GENERATE_SERIES($4::DATE,$5::DATE,INTERVAL '1 day') day
            ON CONFLICT (tenant_id,branch_id,staff_id,schedule_date)
            DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes,updated_at=NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&request.staff_id)
        .bind(request.start_date)
        .bind(request.end_date)
        .bind(schedule_status)
        .bind(schedule_note)
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
        WITH policy AS (
          SELECT s.id AS staff_id,
                 TRIM(CONCAT_WS(' ',s.first_name,NULLIF(s.last_name,''))) AS staff_name,
                 s.employee_code,p.leave_type,MAX(p.annual_days)::INTEGER AS annual_days
          FROM staff s
          JOIN staff_leave_policies p
            ON p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id AND p.staff_id=s.id AND p.active=true
          WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=true AND ($5='' OR s.id=$5)
          GROUP BY s.id,s.first_name,s.last_name,s.employee_code,p.leave_type
        ), usage AS (
          SELECT staff_id,leave_type,
                 COALESCE(SUM(days) FILTER (WHERE status='approved'),0)::INTEGER AS used_days,
                 COALESCE(SUM(days) FILTER (WHERE status='pending'),0)::INTEGER AS pending_days
          FROM staff_leave_requests
          WHERE tenant_id=$1 AND branch_id=$2 AND start_date >= $3 AND end_date <= $4
          GROUP BY staff_id,leave_type
        )
        SELECT p.staff_id,p.staff_name,p.employee_code,p.leave_type,p.annual_days,
               COALESCE(u.used_days,0)::INTEGER AS used_days,
               COALESCE(u.pending_days,0)::INTEGER AS pending_days,
               GREATEST(p.annual_days-COALESCE(u.used_days,0),0)::INTEGER AS remaining_days
        FROM policy p
        LEFT JOIN usage u ON u.staff_id=p.staff_id AND u.leave_type=p.leave_type
        ORDER BY p.staff_name,p.leave_type
        "#,
    )
    .bind(tenant_id).bind(branch_id).bind(year_start).bind(year_end).bind(staff_id)
    .fetch_all(db).await
}
