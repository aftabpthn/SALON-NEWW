use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleStaffRecord {
    pub id: String,
    pub name: String,
    pub job_title: String,
    pub role_ids: Vec<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntryRecord {
    pub id: String,
    pub staff_id: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub status: String,
    pub notes: String,
    pub room_id: Option<String>,
    pub role_id: Option<String>,
    pub job_title: String,
    pub version: i32,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRoleRecord {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRoomRecord {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleBlockoutRecord {
    pub id: String,
    pub staff_id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub reason: String,
    pub version: i32,
}

#[derive(Debug, FromRow)]
pub struct CalendarFeedEventRecord {
    pub id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub summary: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleOperationBlockRecord {
    pub id: String,
    pub staff_id: String,
    pub scheduled_date: NaiveDate,
    pub scheduled_time: Option<NaiveTime>,
    pub title: String,
    pub operation_type: String,
    pub status: String,
}

pub struct ScheduleEntryInput {
    pub staff_id: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub status: String,
    pub notes: String,
    pub room_id: Option<String>,
    pub role_id: Option<String>,
    pub job_title: String,
    pub version: Option<i32>,
}

pub async fn list_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role_id: &str,
    job: &str,
    staff_id: &str,
) -> Result<Vec<ScheduleStaffRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT s.id,
               TRIM(CONCAT_WS(' ', s.first_name, NULLIF(s.last_name, ''))) AS name,
               s.job_title,
               COALESCE(ARRAY_AGG(DISTINCT a.role_id) FILTER (WHERE a.role_id IS NOT NULL), ARRAY[]::TEXT[]) AS role_ids
        FROM staff s
        LEFT JOIN staff_role_assignments a
          ON a.tenant_id=s.tenant_id AND a.branch_id=s.branch_id AND a.staff_id=s.id
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=true
          AND ($3='' OR EXISTS (
            SELECT 1 FROM staff_role_assignments ra
            WHERE ra.tenant_id=s.tenant_id AND ra.branch_id=s.branch_id AND ra.staff_id=s.id AND ra.role_id=$3
          ))
          AND ($4='' OR s.job_title=$4)
          AND ($5='' OR s.id=$5)
        GROUP BY s.id, s.first_name, s.last_name, s.job_title
        ORDER BY s.first_name, s.last_name, s.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(role_id)
    .bind(job)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn list_entries(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: &[String],
) -> Result<Vec<ScheduleEntryRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT id,staff_id,schedule_date,shift1_start,shift1_end,shift2_start,shift2_end,status,notes,room_id,role_id,job_title,version
        FROM staff_schedules
        WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4 AND staff_id=ANY($5)
        ORDER BY staff_id,schedule_date
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(date_from)
    .bind(date_to)
    .bind(staff_ids)
    .fetch_all(db)
    .await
}

pub async fn list_operation_blocks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: &[String],
) -> Result<Vec<ScheduleOperationBlockRecord>, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(vec![]);
    }
    sqlx::query_as(
        r#"
        SELECT operation.id,sid.staff_id,operation.scheduled_date,operation.scheduled_time,
               operation.title,operation.operation_type,operation.status
        FROM UNNEST($5::TEXT[]) AS sid(staff_id)
        JOIN staff_operation_schedules operation
          ON operation.tenant_id=$1 AND operation.branch_id=$2
         AND operation.scheduled_date BETWEEN $3 AND $4
         AND operation.status <> 'cancelled'
         AND operation.operation_type IN ('staff_meeting','performance_review','training_session','deep_cleaning','hygiene_audit')
         AND (jsonb_array_length(operation.assigned_staff_ids)=0 OR operation.assigned_staff_ids ? sid.staff_id)
        ORDER BY sid.staff_id,operation.scheduled_date,operation.scheduled_time NULLS LAST,operation.title
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(date_from)
    .bind(date_to)
    .bind(staff_ids)
    .fetch_all(db)
    .await
}

pub async fn list_roles(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<ScheduleRoleRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,name FROM roles WHERE tenant_id=$1 ORDER BY name")
        .bind(tenant_id)
        .fetch_all(db)
        .await
}

pub async fn list_rooms(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ScheduleRoomRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,kind FROM appointment_resources WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY kind,name,id")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn staff_ids_belong_to_scope(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<bool, sqlx::Error> {
    if staff_ids.is_empty() {
        return Ok(true);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .fetch_one(db)
    .await?;
    Ok(count == staff_ids.len() as i64)
}

pub async fn replace_range(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: &[String],
    entries: Vec<ScheduleEntryInput>,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current = sqlx::query_as::<_, (String, NaiveDate, i32)>("SELECT staff_id,schedule_date,version FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4 AND staff_id=ANY($5) FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(date_from).bind(date_to).bind(staff_ids).fetch_all(&mut *tx).await?;
    let expected = entries
        .iter()
        .map(|entry| {
            (
                (entry.staff_id.as_str(), entry.schedule_date),
                entry.version,
            )
        })
        .collect::<HashMap<_, _>>();
    if current.iter().any(|(staff_id, date, version)| {
        expected.get(&(staff_id.as_str(), *date)).copied().flatten() != Some(*version)
    }) || entries.iter().any(|entry| {
        entry.version.is_some()
            && !current.iter().any(|(staff_id, date, _)| {
                staff_id == &entry.staff_id && date == &entry.schedule_date
            })
    }) {
        tx.rollback().await?;
        return Ok(false);
    }
    for entry in entries {
        insert_entry(&mut tx, tenant_id, branch_id, entry).await?;
    }
    tx.commit().await?;
    Ok(true)
}

async fn insert_entry(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    entry: ScheduleEntryInput,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO staff_schedules(
          tenant_id,branch_id,staff_id,schedule_date,shift1_start,shift1_end,
          shift2_start,shift2_end,status,notes,room_id,role_id,job_title
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(tenant_id,branch_id,staff_id,schedule_date) DO UPDATE SET
          shift1_start=EXCLUDED.shift1_start,shift1_end=EXCLUDED.shift1_end,
          shift2_start=EXCLUDED.shift2_start,shift2_end=EXCLUDED.shift2_end,
          status=EXCLUDED.status,notes=EXCLUDED.notes,room_id=EXCLUDED.room_id,
          role_id=EXCLUDED.role_id,job_title=EXCLUDED.job_title,version=staff_schedules.version+1,updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(entry.staff_id)
    .bind(entry.schedule_date)
    .bind(entry.shift1_start)
    .bind(entry.shift1_end)
    .bind(entry.shift2_start)
    .bind(entry.shift2_end)
    .bind(entry.status)
    .bind(entry.notes)
    .bind(entry.room_id)
    .bind(entry.role_id)
    .bind(entry.job_title)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn copy_week(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_start: NaiveDate,
    target_start: NaiveDate,
    staff_ids: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $3 + 6 AND staff_id=ANY($4)")
        .bind(tenant_id).bind(branch_id).bind(target_start).bind(staff_ids).execute(&mut *tx).await?;
    sqlx::query(
        r#"
        INSERT INTO staff_schedules(
          tenant_id,branch_id,staff_id,schedule_date,shift1_start,shift1_end,
          shift2_start,shift2_end,status,notes,room_id,role_id,job_title
        )
        SELECT tenant_id,branch_id,staff_id,$5 + (schedule_date - $3),shift1_start,shift1_end,
               shift2_start,shift2_end,status,notes,room_id,role_id,job_title
        FROM staff_schedules
        WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $3 + 6 AND staff_id=ANY($4)
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(source_start)
    .bind(staff_ids)
    .bind(target_start)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub async fn list_blockouts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<ScheduleBlockoutRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,staff_id,starts_at,ends_at,reason,version FROM staff_schedule_blockouts WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR staff_id=$3) AND starts_at<$5 AND ends_at>$4 ORDER BY starts_at,id")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(from).bind(to).fetch_all(db).await
}

pub async fn create_blockout(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    reason: &str,
    actor_user_id: &str,
) -> Result<Option<ScheduleBlockoutRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO staff_schedule_blockouts(tenant_id,branch_id,staff_id,starts_at,ends_at,reason,created_by) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE) RETURNING id,staff_id,starts_at,ends_at,reason,version")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(starts_at).bind(ends_at).bind(reason).bind(actor_user_id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_blockout(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    id: &str,
    version: i32,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    reason: &str,
) -> Result<Option<ScheduleBlockoutRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE staff_schedule_blockouts SET starts_at=$6,ends_at=$7,reason=$8,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND version=$5 AND $7>$6 RETURNING id,staff_id,starts_at,ends_at,reason,version")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(id).bind(version)
        .bind(starts_at).bind(ends_at).bind(reason).fetch_optional(db).await
}

pub async fn delete_blockout(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    id: &str,
    version: i32,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM staff_schedule_blockouts WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND version=$5")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(id).bind(version).execute(db).await?.rows_affected()==1)
}

pub async fn replace_calendar_feed_token(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    token_hash: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE staff_calendar_feed_tokens SET active=FALSE,revoked_at=NOW() WHERE tenant_id=$1 AND staff_id=$2 AND active=TRUE")
        .bind(tenant_id).bind(staff_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO staff_calendar_feed_tokens(tenant_id,branch_id,staff_id,token_hash,created_by) VALUES($1,$2,$3,$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(token_hash).bind(actor_user_id).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn revoke_calendar_feed_token(
    db: &PgPool,
    tenant_id: &str,
    staff_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE staff_calendar_feed_tokens SET active=FALSE,revoked_at=NOW() WHERE tenant_id=$1 AND staff_id=$2 AND active=TRUE")
        .bind(tenant_id).bind(staff_id).execute(db).await?;
    Ok(())
}

pub async fn calendar_feed_scope(
    db: &PgPool,
    token_hash: &str,
) -> Result<Option<(String, String, String)>, sqlx::Error> {
    let scope = sqlx::query_as("UPDATE staff_calendar_feed_tokens SET last_used_at=NOW() WHERE token_hash=$1 AND active=TRUE RETURNING tenant_id,branch_id,staff_id")
        .bind(token_hash).fetch_optional(db).await?;
    Ok(scope)
}

pub async fn calendar_feed_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<CalendarFeedEventRecord>, sqlx::Error> {
    sqlx::query_as(r#"SELECT id,starts_at,ends_at,summary FROM (
      SELECT schedule.id||'-1' id,(schedule.schedule_date+schedule.shift1_start) AT TIME ZONE 'Asia/Kolkata' starts_at,
             (schedule.schedule_date+schedule.shift1_end) AT TIME ZONE 'Asia/Kolkata' ends_at,'Work shift'::TEXT summary
      FROM staff_schedules schedule WHERE schedule.tenant_id=$1 AND schedule.branch_id=$2 AND schedule.staff_id=$3 AND schedule.schedule_date BETWEEN $4 AND $5 AND schedule.status='working' AND schedule.shift1_start IS NOT NULL
      UNION ALL
      SELECT schedule.id||'-2',(schedule.schedule_date+schedule.shift2_start) AT TIME ZONE 'Asia/Kolkata',
             (schedule.schedule_date+schedule.shift2_end) AT TIME ZONE 'Asia/Kolkata','Work shift'::TEXT
      FROM staff_schedules schedule WHERE schedule.tenant_id=$1 AND schedule.branch_id=$2 AND schedule.staff_id=$3 AND schedule.schedule_date BETWEEN $4 AND $5 AND schedule.status='working' AND schedule.shift2_start IS NOT NULL
      UNION ALL
      SELECT blockout.id,blockout.starts_at,blockout.ends_at,CASE WHEN blockout.reason='' THEN 'Block out' ELSE blockout.reason END
      FROM staff_schedule_blockouts blockout WHERE blockout.tenant_id=$1 AND blockout.branch_id=$2 AND blockout.staff_id=$3 AND (blockout.starts_at AT TIME ZONE 'Asia/Kolkata')::DATE<=$5 AND (blockout.ends_at AT TIME ZONE 'Asia/Kolkata')::DATE>=$4
    ) event ORDER BY starts_at,id"#)
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(from).bind(to).fetch_all(db).await
}
