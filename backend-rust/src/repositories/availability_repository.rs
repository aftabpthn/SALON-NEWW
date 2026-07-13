use chrono::{DateTime, NaiveTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct AvailabilityRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub weekday: i32,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub is_available: bool,
    pub reason: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreateAvailability<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub staff_id: &'a str,
    pub weekday: u8,
    pub start_time: &'a NaiveTime,
    pub end_time: &'a NaiveTime,
    pub is_available: bool,
    pub reason: &'a str,
}

pub struct UpdateAvailability<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub staff_id: Option<&'a str>,
    pub weekday: Option<u8>,
    pub start_time: Option<&'a NaiveTime>,
    pub end_time: Option<&'a NaiveTime>,
    pub is_available: Option<bool>,
    pub reason: Option<&'a str>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: Option<&str>,
    weekday: Option<u8>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AvailabilityRecord>, sqlx::Error> {
    sqlx::query_as::<_, AvailabilityRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND ($3 = '' OR staff_id = $3)
          AND ($4::smallint < 0 OR weekday = $4)
        ORDER BY staff_id, weekday, start_time
        LIMIT $5 OFFSET $6
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id.unwrap_or(""))
    .bind(weekday.map(i16::from).unwrap_or(-1))
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn create(
    db: &PgPool,
    input: CreateAvailability<'_>,
) -> Result<AvailabilityRecord, sqlx::Error> {
    sqlx::query_as::<_, AvailabilityRecord>(
        r#"
        INSERT INTO staff_availability (
          tenant_id, branch_id, staff_id, weekday, start_time, end_time, is_available, reason
        )
        VALUES ($1, $2, $3, $4, $5::time, $6::time, $7, $8)
        RETURNING
          id, tenant_id, branch_id, staff_id, weekday, start_time, end_time, is_available, reason, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .bind(i16::from(input.weekday))
    .bind(input.start_time)
    .bind(input.end_time)
    .bind(input.is_available)
    .bind(input.reason)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdateAvailability<'_>,
) -> Result<Option<AvailabilityRecord>, sqlx::Error> {
    sqlx::query_as::<_, AvailabilityRecord>(
        r#"
        UPDATE staff_availability
        SET
          staff_id = COALESCE($4, staff_id),
          weekday = COALESCE($5, weekday),
          start_time = COALESCE($6::time, start_time),
          end_time = COALESCE($7::time, end_time),
          is_available = COALESCE($8, is_available),
          reason = COALESCE($9, reason),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, staff_id, weekday, start_time, end_time, is_available, reason, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.staff_id)
    .bind(input.weekday.map(i16::from))
    .bind(input.start_time)
    .bind(input.end_time)
    .bind(input.is_available)
    .bind(input.reason)
    .fetch_optional(db)
    .await
}

pub async fn delete(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM staff_availability
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id, tenant_id, branch_id, staff_id, weekday,
          start_time, end_time, is_available, reason,
          created_at, updated_at
        FROM staff_availability
        {where_clause}
        "#,
    )
}
