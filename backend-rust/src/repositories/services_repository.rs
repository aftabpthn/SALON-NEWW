use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct ServiceRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub category: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: String,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption_json: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreateService<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub duration_minutes: i32,
    pub price_paise: i64,
    pub gst_percent: i32,
    pub sac_code: &'a str,
    pub wait_time_minutes: i32,
    pub cleanup_time_minutes: i32,
    pub buffer_time_minutes: i32,
    pub product_consumption_json: &'a str,
}

pub struct UpdateService<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub duration_minutes: Option<i32>,
    pub price_paise: Option<i64>,
    pub gst_percent: Option<i32>,
    pub sac_code: Option<&'a str>,
    pub wait_time_minutes: Option<i32>,
    pub cleanup_time_minutes: Option<i32>,
    pub buffer_time_minutes: Option<i32>,
    pub product_consumption_json: Option<&'a str>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ServiceRecord>, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR name ILIKE '%' || $3 || '%'
            OR category ILIKE '%' || $3 || '%'
          )
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(q)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<ServiceRecord>, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        LIMIT 1
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn create(db: &PgPool, input: CreateService<'_>) -> Result<ServiceRecord, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(
        r#"
        INSERT INTO services (
          tenant_id, branch_id, name, category, duration_minutes, price_paise,
          gst_percent, sac_code, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes,
          product_consumption_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING
          id, tenant_id, branch_id, name, category, duration_minutes, price_paise::BIGINT AS price_paise,
          gst_percent, sac_code, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes,
          product_consumption_json::TEXT AS product_consumption_json,
          active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.name)
    .bind(input.category)
    .bind(input.duration_minutes)
    .bind(input.price_paise)
    .bind(input.gst_percent)
    .bind(input.sac_code)
    .bind(input.wait_time_minutes)
    .bind(input.cleanup_time_minutes)
    .bind(input.buffer_time_minutes)
    .bind(input.product_consumption_json)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdateService<'_>,
) -> Result<Option<ServiceRecord>, sqlx::Error> {
    sqlx::query_as::<_, ServiceRecord>(
        r#"
        UPDATE services
        SET
          name = COALESCE($4, name),
          category = COALESCE($5, category),
          duration_minutes = COALESCE($6, duration_minutes),
          price_paise = COALESCE($7, price_paise),
          gst_percent = COALESCE($8, gst_percent),
          sac_code = COALESCE($9, sac_code),
          wait_time_minutes = COALESCE($10, wait_time_minutes),
          cleanup_time_minutes = COALESCE($11, cleanup_time_minutes),
          buffer_time_minutes = COALESCE($12, buffer_time_minutes),
          product_consumption_json = COALESCE($13::jsonb, product_consumption_json),
          active = COALESCE($14, active),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, name, category, duration_minutes, price_paise::BIGINT AS price_paise,
          gst_percent, sac_code, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes,
          product_consumption_json::TEXT AS product_consumption_json,
          active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.name)
    .bind(input.category)
    .bind(input.duration_minutes)
    .bind(input.price_paise)
    .bind(input.gst_percent)
    .bind(input.sac_code)
    .bind(input.wait_time_minutes)
    .bind(input.cleanup_time_minutes)
    .bind(input.buffer_time_minutes)
    .bind(input.product_consumption_json)
    .bind(input.active)
    .fetch_optional(db)
    .await
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id, tenant_id, branch_id, name, category, duration_minutes, price_paise::BIGINT AS price_paise,
          gst_percent, sac_code, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes,
          product_consumption_json::TEXT AS product_consumption_json,
          active, created_at, updated_at
        FROM services
        {where_clause}
        "#
    )
}
