use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct InventoryRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sku: String,
    pub name: String,
    pub category: String,
    pub unit: String,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub sku: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub unit: &'a str,
    pub stock_quantity: i32,
    pub reorder_point: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: &'a str,
    pub gst_percent: i32,
    pub active: bool,
}

pub struct UpdateInventory<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub sku: Option<&'a str>,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub stock_quantity: Option<i32>,
    pub reorder_point: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub hsn_code: Option<&'a str>,
    pub gst_percent: Option<i32>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR sku ILIKE '%' || $3 || '%'
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
) -> Result<Option<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(&select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND id = $3
        LIMIT 1
        "#,
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn create(
    db: &PgPool,
    input: CreateInventory<'_>,
) -> Result<InventoryRecord, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(
        r#"
        INSERT INTO inventory_items (
          tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.unit)
    .bind(input.stock_quantity)
    .bind(input.reorder_point)
    .bind(input.unit_cost_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.active)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdateInventory<'_>,
) -> Result<Option<InventoryRecord>, sqlx::Error> {
    sqlx::query_as::<_, InventoryRecord>(
        r#"
        UPDATE inventory_items
        SET
          sku = COALESCE($4, sku),
          name = COALESCE($5, name),
          category = COALESCE($6, category),
          unit = COALESCE($7, unit),
          stock_quantity = COALESCE($8, stock_quantity),
          reorder_point = COALESCE($9, reorder_point),
          unit_cost_paise = COALESCE($10, unit_cost_paise),
          hsn_code = COALESCE($11, hsn_code),
          gst_percent = COALESCE($12, gst_percent),
          active = COALESCE($13, active),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.sku)
    .bind(input.name)
    .bind(input.category)
    .bind(input.unit)
    .bind(input.stock_quantity)
    .bind(input.reorder_point)
    .bind(input.unit_cost_paise)
    .bind(input.hsn_code)
    .bind(input.gst_percent)
    .bind(input.active)
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
        DELETE FROM inventory_items
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
          id, tenant_id, branch_id, sku, name, category, unit,
          stock_quantity, reorder_point, unit_cost_paise, hsn_code, gst_percent, active, created_at, updated_at
        FROM inventory_items
        {where_clause}
        "#,
    )
}
