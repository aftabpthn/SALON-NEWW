use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransfer {
    pub id: String,
    pub source_branch_id: String,
    pub destination_branch_id: String,
    pub status: String,
    pub notes: String,
    pub dispatched_by_user_id: String,
    pub dispatched_at: DateTime<Utc>,
    pub received_by_user_id: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
    pub cancelled_by_user_id: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferLine {
    pub id: String,
    pub source_inventory_item_id: String,
    pub destination_inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedInventoryItem {
    pub stock_quantity: i32,
    pub unit_cost_paise: i64,
    pub batch_tracked: bool,
}

const TRANSFER_COLUMNS: &str = "id, source_branch_id, destination_branch_id, status, notes, dispatched_by_user_id, dispatched_at, received_by_user_id, received_at, cancelled_by_user_id, cancelled_at";

pub async fn active_branch_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM branches WHERE tenant_id::text=$1 AND id::text=$2 AND active=TRUE)")
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_one(&mut **tx)
        .await
}

pub async fn by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND source_branch_id=$2 AND idempotency_key=$3"))
        .bind(tenant_id)
        .bind(source_branch_id)
        .bind(idempotency_key)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    transfer_id: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND id=$3 AND (source_branch_id=$2 OR destination_branch_id=$2)"))
        .bind(tenant_id)
        .bind(branch_id)
        .bind(transfer_id)
        .fetch_optional(db)
        .await
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: Option<&str>,
) -> Result<Vec<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND (source_branch_id=$2 OR destination_branch_id=$2) AND ($3::text IS NULL OR status=$3) ORDER BY dispatched_at DESC LIMIT 100"))
        .bind(tenant_id)
        .bind(branch_id)
        .bind(status)
        .fetch_all(db)
        .await
}

pub async fn lines(
    db: &PgPool,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferLine>, sqlx::Error> {
    sqlx::query_as("SELECT id, source_inventory_item_id, destination_inventory_item_id, quantity, unit_cost_paise FROM inventory_transfer_lines WHERE tenant_id=$1 AND transfer_id=$2 ORDER BY created_at, id")
        .bind(tenant_id)
        .bind(transfer_id)
        .fetch_all(db)
        .await
}

pub async fn lines_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferLine>, sqlx::Error> {
    sqlx::query_as("SELECT id, source_inventory_item_id, destination_inventory_item_id, quantity, unit_cost_paise FROM inventory_transfer_lines WHERE tenant_id=$1 AND transfer_id=$2 ORDER BY created_at, id FOR UPDATE")
        .bind(tenant_id)
        .bind(transfer_id)
        .fetch_all(&mut **tx)
        .await
}

pub async fn get_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE"))
        .bind(tenant_id)
        .bind(transfer_id)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn lock_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<LockedInventoryItem>, sqlx::Error> {
    sqlx::query_as("SELECT stock_quantity, unit_cost_paise, batch_tracked FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(item_id)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn active_inventory_item_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(item_id)
        .fetch_one(&mut **tx)
        .await
}

pub async fn active_inventory_item_batch_tracked(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar("SELECT batch_tracked FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&mut **tx).await
}

pub async fn create_transfer(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    destination_branch_id: &str,
    idempotency_key: &str,
    notes: &str,
    actor_user_id: &str,
) -> Result<InventoryTransfer, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO inventory_transfers (tenant_id, source_branch_id, destination_branch_id, idempotency_key, notes, dispatched_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING {TRANSFER_COLUMNS}"))
        .bind(tenant_id)
        .bind(source_branch_id)
        .bind(destination_branch_id)
        .bind(idempotency_key)
        .bind(notes)
        .bind(actor_user_id)
        .fetch_one(&mut **tx)
        .await
}

pub async fn create_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    source_item_id: &str,
    destination_item_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
) -> Result<InventoryTransferLine, sqlx::Error> {
    sqlx::query_as("INSERT INTO inventory_transfer_lines (tenant_id, transfer_id, source_inventory_item_id, destination_inventory_item_id, quantity, unit_cost_paise) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, source_inventory_item_id, destination_inventory_item_id, quantity, unit_cost_paise")
        .bind(tenant_id)
        .bind(transfer_id)
        .bind(source_item_id)
        .bind(destination_item_id)
        .bind(quantity)
        .bind(unit_cost_paise)
        .fetch_one(&mut **tx)
        .await
}

pub async fn apply_stock(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    stock_quantity: i32,
    unit_cost_paise: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4, unit_cost_paise=$5, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(item_id)
        .bind(stock_quantity)
        .bind(unit_cost_paise)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn add_stock_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    transfer_id: &str,
    transfer_line_id: &str,
    movement_type: &str,
    quantity_delta: i32,
    unit_cost_paise: i64,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, inventory_transfer_id, inventory_transfer_line_id, movement_type, quantity_delta, unit_cost_paise) VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8) RETURNING id")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(inventory_item_id)
        .bind(transfer_id)
        .bind(transfer_line_id)
        .bind(movement_type)
        .bind(quantity_delta)
        .bind(unit_cost_paise)
        .fetch_one(&mut **tx)
        .await
}

pub async fn stock_ledger_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    transfer_line_id: &str,
    movement_type: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_transfer_line_id=$3 AND movement_type=$4")
        .bind(tenant_id).bind(branch_id).bind(transfer_line_id).bind(movement_type)
        .fetch_optional(&mut **tx).await
}

pub async fn mark_received(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfers SET status='received', received_by_user_id=$3, received_at=NOW() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id)
        .bind(transfer_id)
        .bind(actor_user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn mark_cancelled(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfers SET status='cancelled', cancelled_by_user_id=$3, cancelled_at=NOW() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id)
        .bind(transfer_id)
        .bind(actor_user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
