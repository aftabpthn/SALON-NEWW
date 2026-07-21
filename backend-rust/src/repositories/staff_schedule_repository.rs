use chrono::{NaiveDate, NaiveTime};
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
        SELECT id,staff_id,schedule_date,shift1_start,shift1_end,shift2_start,shift2_end,status,notes,version
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
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4 AND staff_id=ANY($5)")
        .bind(tenant_id).bind(branch_id).bind(date_from).bind(date_to).bind(staff_ids).execute(&mut *tx).await?;
    for entry in entries {
        insert_entry(&mut tx, tenant_id, branch_id, entry).await?;
    }
    tx.commit().await
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
          shift2_start,shift2_end,status,notes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
          shift2_start,shift2_end,status,notes
        )
        SELECT tenant_id,branch_id,staff_id,$5 + (schedule_date - $3),shift1_start,shift1_end,
               shift2_start,shift2_end,status,notes
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
