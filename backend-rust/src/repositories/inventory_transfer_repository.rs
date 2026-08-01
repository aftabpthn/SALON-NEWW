use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransfer {
    pub id: String,
    pub transfer_number: String,
    pub source_branch_id: String,
    pub destination_branch_id: String,
    pub mode: String,
    pub parent_transfer_id: Option<String>,
    pub return_reason: String,
    pub status: String,
    pub notes: String,
    pub created_by_user_id: String,
    pub raised_by_user_id: Option<String>,
    pub raised_at: Option<DateTime<Utc>>,
    pub approved_by_user_id: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub dispatched_by_user_id: Option<String>,
    pub dispatched_at: Option<DateTime<Utc>>,
    pub received_by_user_id: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
    pub cancelled_by_user_id: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub rejected_by_user_id: Option<String>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub rejection_note: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferLine {
    pub id: String,
    pub source_inventory_item_id: String,
    pub destination_inventory_item_id: String,
    pub product_name: String,
    pub sku: String,
    pub quantity: i32,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub reserved_retail_quantity: i32,
    pub reserved_consumable_quantity: i32,
    pub dispatched_retail_quantity: i32,
    pub dispatched_consumable_quantity: i32,
    pub received_retail_quantity: i32,
    pub received_consumable_quantity: i32,
    pub damaged_quantity: i32,
    pub expired_quantity: i32,
    pub short_quantity: i32,
    pub unit_cost_paise: i64,
    pub transfer_unit_price_paise: i64,
    pub discount_bps: i32,
    pub gst_percent: i32,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferShipment {
    pub id: String,
    pub transfer_id: String,
    pub shipment_number: String,
    pub status: String,
    pub shipping_paise: i64,
    pub handling_paise: i64,
    pub other_charges_paise: i64,
    pub auto_checkout_applied: bool,
    pub dispatched_by_user_id: String,
    pub dispatched_at: DateTime<Utc>,
    pub shipped_by_user_id: Option<String>,
    pub shipped_at: Option<DateTime<Utc>>,
    pub received_by_user_id: Option<String>,
    pub received_at: Option<DateTime<Utc>>,
    pub receipt_note: String,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferShipmentLine {
    pub id: String,
    pub shipment_id: String,
    pub transfer_line_id: String,
    pub dispatched_retail_quantity: i32,
    pub dispatched_consumable_quantity: i32,
    pub received_retail_quantity: i32,
    pub received_consumable_quantity: i32,
    pub damaged_quantity: i32,
    pub expired_quantity: i32,
    pub short_quantity: i32,
    pub variance_reason: String,
    pub source_unit_cost_paise: i64,
    pub transfer_unit_price_paise: i64,
    pub discount_bps: i32,
    pub gst_percent: i32,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub landed_cost_paise: i64,
    pub landed_unit_cost_paise: i64,
    pub source_stock_ledger_id: Option<String>,
    pub destination_stock_ledger_id: Option<String>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryTransferEvent {
    pub id: String,
    pub event_type: String,
    pub from_status: String,
    pub to_status: String,
    pub actor_user_id: String,
    pub note: String,
    pub details: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCenterSettings {
    pub branch_id: String,
    pub center_role: String,
    pub default_retail_warehouse_branch_id: Option<String>,
    pub default_consumable_warehouse_branch_id: Option<String>,
    pub auto_checkout_transfers: bool,
    pub cannot_raise_transfer: bool,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferMismatch {
    pub transfer_id: String,
    pub transfer_number: String,
    pub shipment_id: String,
    pub shipment_number: String,
    pub source_branch_id: String,
    pub destination_branch_id: String,
    pub product_name: String,
    pub sku: String,
    pub dispatched_quantity: i32,
    pub received_quantity: i32,
    pub damaged_quantity: i32,
    pub expired_quantity: i32,
    pub short_quantity: i32,
    pub variance_reason: String,
    pub status: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedInventoryItem {
    pub id: String,
    pub name: String,
    pub sku: String,
    pub product_usage: String,
    pub unit: String,
    pub units_per_package: i32,
    pub stock_quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
    pub batch_tracked: bool,
}

const TRANSFER_COLUMNS: &str = "id,transfer_number,source_branch_id,destination_branch_id,mode,parent_transfer_id,return_reason,status,notes,created_by_user_id,raised_by_user_id,raised_at,approved_by_user_id,approved_at,dispatched_by_user_id,dispatched_at,received_by_user_id,received_at,cancelled_by_user_id,cancelled_at,rejected_by_user_id,rejected_at,rejection_note,created_at";
const LINE_COLUMNS: &str = "line.id,line.source_inventory_item_id,line.destination_inventory_item_id,item.name AS product_name,item.sku,line.quantity,line.retail_quantity,line.consumable_quantity,line.reserved_retail_quantity,line.reserved_consumable_quantity,line.dispatched_retail_quantity,line.dispatched_consumable_quantity,line.received_retail_quantity,line.received_consumable_quantity,line.damaged_quantity,line.expired_quantity,line.short_quantity,line.unit_cost_paise,line.transfer_unit_price_paise,line.discount_bps,line.gst_percent";
const SHIPMENT_COLUMNS: &str = "id,transfer_id,shipment_number,status,shipping_paise,handling_paise,other_charges_paise,auto_checkout_applied,dispatched_by_user_id,dispatched_at,shipped_by_user_id,shipped_at,received_by_user_id,received_at,receipt_note";
const SHIPMENT_LINE_COLUMNS: &str = "id,shipment_id,transfer_line_id,dispatched_retail_quantity,dispatched_consumable_quantity,received_retail_quantity,received_consumable_quantity,damaged_quantity,expired_quantity,short_quantity,variance_reason,source_unit_cost_paise,transfer_unit_price_paise,discount_bps,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,landed_cost_paise,landed_unit_cost_paise,source_stock_ledger_id,destination_stock_ledger_id";

pub async fn active_branch_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2 AND active=TRUE)")
        .bind(tenant_id).bind(branch_id).fetch_one(&mut **tx).await
}

pub async fn by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND source_branch_id=$2 AND idempotency_key=$3"))
        .bind(tenant_id).bind(source_branch_id).bind(idempotency_key).fetch_optional(&mut **tx).await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    transfer_id: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND id=$3 AND (source_branch_id=$2 OR destination_branch_id=$2)"))
        .bind(tenant_id).bind(branch_id).bind(transfer_id).fetch_optional(db).await
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: Option<&str>,
) -> Result<Vec<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND (source_branch_id=$2 OR destination_branch_id=$2) AND ($3::TEXT IS NULL OR status=$3) ORDER BY created_at DESC LIMIT 250"))
        .bind(tenant_id).bind(branch_id).bind(status).fetch_all(db).await
}

pub async fn lines(
    db: &PgPool,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferLine>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {LINE_COLUMNS} FROM inventory_transfer_lines line JOIN inventory_items item ON item.id=line.source_inventory_item_id AND item.tenant_id=line.tenant_id WHERE line.tenant_id=$1 AND line.transfer_id=$2 ORDER BY line.created_at,line.id"))
        .bind(tenant_id).bind(transfer_id).fetch_all(db).await
}

pub async fn lines_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferLine>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {LINE_COLUMNS} FROM inventory_transfer_lines line JOIN inventory_items item ON item.id=line.source_inventory_item_id AND item.tenant_id=line.tenant_id WHERE line.tenant_id=$1 AND line.transfer_id=$2 ORDER BY line.id FOR UPDATE OF line"))
        .bind(tenant_id).bind(transfer_id).fetch_all(&mut **tx).await
}

pub async fn shipments(
    db: &PgPool,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferShipment>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SHIPMENT_COLUMNS} FROM inventory_transfer_shipments WHERE tenant_id=$1 AND transfer_id=$2 ORDER BY created_at,id"))
        .bind(tenant_id).bind(transfer_id).fetch_all(db).await
}

pub async fn shipment_lines(
    db: &PgPool,
    tenant_id: &str,
    shipment_id: &str,
) -> Result<Vec<InventoryTransferShipmentLine>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SHIPMENT_LINE_COLUMNS} FROM inventory_transfer_shipment_lines WHERE tenant_id=$1 AND shipment_id=$2 ORDER BY created_at,id"))
        .bind(tenant_id).bind(shipment_id).fetch_all(db).await
}

pub async fn shipment_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    shipment_id: &str,
) -> Result<Option<InventoryTransferShipment>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SHIPMENT_COLUMNS} FROM inventory_transfer_shipments WHERE tenant_id=$1 AND transfer_id=$2 AND id=$3 FOR UPDATE"))
        .bind(tenant_id).bind(transfer_id).bind(shipment_id).fetch_optional(&mut **tx).await
}

pub async fn shipment_lines_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_id: &str,
) -> Result<Vec<InventoryTransferShipmentLine>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SHIPMENT_LINE_COLUMNS} FROM inventory_transfer_shipment_lines WHERE tenant_id=$1 AND shipment_id=$2 ORDER BY id FOR UPDATE"))
        .bind(tenant_id).bind(shipment_id).fetch_all(&mut **tx).await
}

pub async fn events(
    db: &PgPool,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Vec<InventoryTransferEvent>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,from_status,to_status,actor_user_id,note,details,created_at FROM inventory_transfer_events WHERE tenant_id=$1 AND transfer_id=$2 ORDER BY created_at,id")
        .bind(tenant_id).bind(transfer_id).fetch_all(db).await
}

pub async fn get_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<Option<InventoryTransfer>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TRANSFER_COLUMNS} FROM inventory_transfers WHERE tenant_id=$1 AND id=$2 FOR UPDATE"))
        .bind(tenant_id).bind(transfer_id).fetch_optional(&mut **tx).await
}

pub async fn lock_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<LockedInventoryItem>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,sku,product_usage,unit,units_per_package,stock_quantity,unit_cost_paise,gst_percent,batch_tracked FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND center_available=TRUE FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&mut **tx).await
}

pub async fn resolve_counterpart_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    item_id: &str,
    target_branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT target.id FROM inventory_items source JOIN inventory_items target ON target.tenant_id=source.tenant_id AND target.branch_id=$3 AND target.active=TRUE AND target.center_available=TRUE AND (target.sku=source.sku OR target.central_master_item_id=source.id OR source.central_master_item_id=target.id OR (source.central_master_item_id IS NOT NULL AND source.central_master_item_id=target.central_master_item_id)) WHERE source.tenant_id=$1 AND source.id=$2 AND source.active=TRUE ORDER BY CASE WHEN target.sku=source.sku THEN 0 ELSE 1 END LIMIT 1")
        .bind(tenant_id).bind(item_id).bind(target_branch_id).fetch_optional(&mut **tx).await
}

pub async fn reserved_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    excluding_transfer_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(line.reserved_retail_quantity+line.reserved_consumable_quantity),0)::BIGINT FROM inventory_transfer_lines line JOIN inventory_transfers transfer ON transfer.id=line.transfer_id AND transfer.tenant_id=line.tenant_id WHERE line.tenant_id=$1 AND transfer.source_branch_id=$2 AND line.source_inventory_item_id=$3 AND transfer.id<>$4 AND transfer.status IN ('raised','approved','dispatched','in_transit','partially_received')")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(excluding_transfer_id).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_transfer(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    destination_branch_id: &str,
    mode: &str,
    parent_transfer_id: Option<&str>,
    return_reason: &str,
    idempotency_key: &str,
    notes: &str,
    actor: &str,
) -> Result<InventoryTransfer, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO inventory_transfers(tenant_id,transfer_number,source_branch_id,destination_branch_id,mode,parent_transfer_id,return_reason,status,idempotency_key,notes,created_by_user_id,dispatched_by_user_id,dispatched_at) VALUES($1,'TO-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),$2,$3,$4,$5,$6,'draft',$7,$8,$9,NULL,NULL) RETURNING {TRANSFER_COLUMNS}"))
        .bind(tenant_id).bind(source_branch_id).bind(destination_branch_id).bind(mode).bind(parent_transfer_id).bind(return_reason).bind(idempotency_key).bind(notes).bind(actor).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    source_item_id: &str,
    destination_item_id: &str,
    retail_quantity: i32,
    consumable_quantity: i32,
    unit_cost_paise: i64,
    transfer_unit_price_paise: i64,
    discount_bps: i32,
    gst_percent: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_transfer_lines(tenant_id,transfer_id,source_inventory_item_id,destination_inventory_item_id,quantity,retail_quantity,consumable_quantity,unit_cost_paise,transfer_unit_price_paise,discount_bps,gst_percent) VALUES($1,$2,$3,$4,$5+$6,$5,$6,$7,$8,$9,$10) RETURNING id")
        .bind(tenant_id).bind(transfer_id).bind(source_item_id).bind(destination_item_id).bind(retail_quantity).bind(consumable_quantity).bind(unit_cost_paise).bind(transfer_unit_price_paise).bind(discount_bps).bind(gst_percent).fetch_one(&mut **tx).await
}

pub async fn reserve_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    line_id: &str,
    retail: i32,
    consumable: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_lines SET reserved_retail_quantity=$3,reserved_consumable_quantity=$4 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(line_id).bind(retail).bind(consumable).execute(&mut **tx).await?;
    Ok(())
}

pub async fn release_reservations(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_lines SET reserved_retail_quantity=0,reserved_consumable_quantity=0 WHERE tenant_id=$1 AND transfer_id=$2")
        .bind(tenant_id).bind(transfer_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn transition(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    from: &str,
    to: &str,
    actor: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let result=sqlx::query("UPDATE inventory_transfers SET status=$4,raised_by_user_id=CASE WHEN $4='raised' THEN $5 ELSE raised_by_user_id END,raised_at=CASE WHEN $4='raised' THEN NOW() ELSE raised_at END,approved_by_user_id=CASE WHEN $4='approved' THEN $5 ELSE approved_by_user_id END,approved_at=CASE WHEN $4='approved' THEN NOW() ELSE approved_at END,rejected_by_user_id=CASE WHEN $4='rejected' THEN $5 ELSE rejected_by_user_id END,rejected_at=CASE WHEN $4='rejected' THEN NOW() ELSE rejected_at END,rejection_note=CASE WHEN $4='rejected' THEN $6 ELSE rejection_note END,cancelled_by_user_id=CASE WHEN $4='cancelled' THEN $5 ELSE cancelled_by_user_id END,cancelled_at=CASE WHEN $4='cancelled' THEN NOW() ELSE cancelled_at END WHERE tenant_id=$1 AND id=$2 AND status=$3")
        .bind(tenant_id).bind(transfer_id).bind(from).bind(to).bind(actor).bind(note).execute(&mut **tx).await?;
    Ok(result.rows_affected() == 1)
}

pub async fn create_shipment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    shipping_paise: i64,
    handling_paise: i64,
    other_charges_paise: i64,
    auto_checkout_applied: bool,
    actor: &str,
) -> Result<InventoryTransferShipment, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO inventory_transfer_shipments(tenant_id,transfer_id,shipment_number,shipping_paise,handling_paise,other_charges_paise,auto_checkout_applied,dispatched_by_user_id) VALUES($1,$2,'TS-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),$3,$4,$5,$6,$7) RETURNING {SHIPMENT_COLUMNS}"))
        .bind(tenant_id).bind(transfer_id).bind(shipping_paise).bind(handling_paise).bind(other_charges_paise).bind(auto_checkout_applied).bind(actor).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_shipment_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_id: &str,
    transfer_line: &InventoryTransferLine,
    retail: i32,
    consumable: i32,
) -> Result<InventoryTransferShipmentLine, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO inventory_transfer_shipment_lines(tenant_id,shipment_id,transfer_line_id,dispatched_retail_quantity,dispatched_consumable_quantity,source_unit_cost_paise,transfer_unit_price_paise,discount_bps,gst_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING {SHIPMENT_LINE_COLUMNS}"))
        .bind(tenant_id).bind(shipment_id).bind(&transfer_line.id).bind(retail).bind(consumable).bind(transfer_line.unit_cost_paise).bind(transfer_line.transfer_unit_price_paise).bind(transfer_line.discount_bps).bind(transfer_line.gst_percent).fetch_one(&mut **tx).await
}

pub async fn apply_line_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    line_id: &str,
    retail: i32,
    consumable: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_lines SET reserved_retail_quantity=reserved_retail_quantity-$3,reserved_consumable_quantity=reserved_consumable_quantity-$4,dispatched_retail_quantity=dispatched_retail_quantity+$3,dispatched_consumable_quantity=dispatched_consumable_quantity+$4 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(line_id).bind(retail).bind(consumable).execute(&mut **tx).await?;
    Ok(())
}

pub async fn reverse_line_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    line_id: &str,
    retail: i32,
    consumable: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_lines SET dispatched_retail_quantity=dispatched_retail_quantity-$3,dispatched_consumable_quantity=dispatched_consumable_quantity-$4 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(line_id).bind(retail).bind(consumable).execute(&mut **tx).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn receive_shipment_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_line_id: &str,
    retail: i32,
    consumable: i32,
    damaged: i32,
    expired: i32,
    short: i32,
    reason: &str,
    taxable: i64,
    cgst: i64,
    sgst: i64,
    igst: i64,
    landed: i64,
    landed_unit: i64,
    destination_ledger_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_shipment_lines SET received_retail_quantity=$3,received_consumable_quantity=$4,damaged_quantity=$5,expired_quantity=$6,short_quantity=$7,variance_reason=$8,taxable_paise=$9,cgst_paise=$10,sgst_paise=$11,igst_paise=$12,landed_cost_paise=$13,landed_unit_cost_paise=$14,destination_stock_ledger_id=$15 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(shipment_line_id).bind(retail).bind(consumable).bind(damaged).bind(expired).bind(short).bind(reason).bind(taxable).bind(cgst).bind(sgst).bind(igst).bind(landed).bind(landed_unit).bind(destination_ledger_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn apply_line_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    line_id: &str,
    retail: i32,
    consumable: i32,
    damaged: i32,
    expired: i32,
    short: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_lines SET received_retail_quantity=received_retail_quantity+$3,received_consumable_quantity=received_consumable_quantity+$4,damaged_quantity=damaged_quantity+$5,expired_quantity=expired_quantity+$6,short_quantity=short_quantity+$7 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(line_id).bind(retail).bind(consumable).bind(damaged).bind(expired).bind(short).execute(&mut **tx).await?;
    Ok(())
}

pub async fn apply_stock(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    quantity: i32,
    cost: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,unit_cost_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(quantity).bind(cost).execute(&mut **tx).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn add_stock_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    transfer_id: &str,
    transfer_line_id: &str,
    shipment_id: &str,
    shipment_line_id: &str,
    movement_type: &str,
    quantity_delta: i32,
    unit_cost_paise: i64,
    stock_after: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,inventory_transfer_id,inventory_transfer_line_id,inventory_transfer_shipment_id,inventory_transfer_shipment_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(transfer_id).bind(transfer_line_id).bind(shipment_id).bind(shipment_line_id).bind(movement_type).bind(quantity_delta).bind(unit_cost_paise).bind(stock_after).fetch_one(&mut **tx).await
}

pub async fn set_source_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_line_id: &str,
    ledger_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_shipment_lines SET source_stock_ledger_id=$3 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(shipment_line_id).bind(ledger_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn mark_shipment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_id: &str,
    status: &str,
    actor: &str,
    note: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_shipments SET status=$3,shipped_by_user_id=CASE WHEN $3='in_transit' THEN $4 ELSE shipped_by_user_id END,shipped_at=CASE WHEN $3='in_transit' THEN NOW() ELSE shipped_at END,received_by_user_id=CASE WHEN $3='received' THEN $4 ELSE received_by_user_id END,received_at=CASE WHEN $3='received' THEN NOW() ELSE received_at END,receipt_note=CASE WHEN $3='received' THEN $5 ELSE receipt_note END WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(shipment_id).bind(status).bind(actor).bind(note).execute(&mut **tx).await?;
    Ok(())
}

pub async fn cancel_shipment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    shipment_id: &str,
    actor: &str,
    note: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfer_shipments SET status='cancelled',received_by_user_id=$3,received_at=NOW(),receipt_note=$4 WHERE tenant_id=$1 AND id=$2 AND status='dispatched'")
        .bind(tenant_id).bind(shipment_id).bind(actor).bind(note).execute(&mut **tx).await?;
    Ok(())
}

pub async fn set_transfer_dispatch_status(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    status: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfers SET status=$3,dispatched_by_user_id=COALESCE(dispatched_by_user_id,$4),dispatched_at=COALESCE(dispatched_at,NOW()) WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(transfer_id).bind(status).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn set_transfer_received_status(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    status: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_transfers SET status=$3,received_by_user_id=CASE WHEN $3='received' THEN $4 ELSE received_by_user_id END,received_at=CASE WHEN $3='received' THEN NOW() ELSE received_at END WHERE tenant_id=$1 AND id=$2")
        .bind(tenant_id).bind(transfer_id).bind(status).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn add_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    transfer_id: &str,
    event_type: &str,
    from: &str,
    to: &str,
    actor: &str,
    note: &str,
    details: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_transfer_events(tenant_id,transfer_id,event_type,from_status,to_status,actor_user_id,note,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant_id).bind(transfer_id).bind(event_type).bind(from).bind(to).bind(actor).bind(note).bind(details).execute(&mut **tx).await?;
    Ok(())
}

pub async fn setting(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<TransferCenterSettings>, sqlx::Error> {
    sqlx::query_as("SELECT branch_id,center_role,default_retail_warehouse_branch_id,default_consumable_warehouse_branch_id,auto_checkout_transfers,cannot_raise_transfer FROM inventory_transfer_center_settings WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant_id).bind(branch_id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_setting(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    retail: Option<&str>,
    consumable: Option<&str>,
    auto_checkout: bool,
    cannot_raise: bool,
    actor: &str,
) -> Result<TransferCenterSettings, sqlx::Error> {
    sqlx::query_as("INSERT INTO inventory_transfer_center_settings(tenant_id,branch_id,center_role,default_retail_warehouse_branch_id,default_consumable_warehouse_branch_id,auto_checkout_transfers,cannot_raise_transfer,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET center_role=EXCLUDED.center_role,default_retail_warehouse_branch_id=EXCLUDED.default_retail_warehouse_branch_id,default_consumable_warehouse_branch_id=EXCLUDED.default_consumable_warehouse_branch_id,auto_checkout_transfers=EXCLUDED.auto_checkout_transfers,cannot_raise_transfer=EXCLUDED.cannot_raise_transfer,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING branch_id,center_role,default_retail_warehouse_branch_id,default_consumable_warehouse_branch_id,auto_checkout_transfers,cannot_raise_transfer")
        .bind(tenant_id).bind(branch_id).bind(role).bind(retail).bind(consumable).bind(auto_checkout).bind(cannot_raise).bind(actor).fetch_one(&mut **tx).await
}

pub async fn center_role(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT center_role FROM inventory_transfer_center_settings WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant_id).bind(branch_id).fetch_optional(&mut **tx).await
}

pub async fn franchise_central_branch(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT central_branch_id FROM franchise_policies WHERE tenant_id=$1")
        .bind(tenant_id)
        .fetch_optional(db)
        .await
}

pub async fn item_usage(
    db: &PgPool,
    tenant_id: &str,
    item_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT product_usage FROM inventory_items WHERE tenant_id=$1 AND id=$2 AND active=TRUE",
    )
    .bind(tenant_id)
    .bind(item_id)
    .fetch_optional(db)
    .await
}

pub async fn branch_gstin(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(gstin,'') FROM invoice_business_profiles WHERE tenant_id=$1 AND branch_id=$2 AND is_gst_registered=TRUE")
        .bind(tenant_id).bind(branch_id).fetch_optional(&mut **tx).await.map(|row|row.unwrap_or_default())
}

pub async fn mismatches(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<TransferMismatch>, sqlx::Error> {
    sqlx::query_as("SELECT transfer.id AS transfer_id,transfer.transfer_number,shipment.id AS shipment_id,shipment.shipment_number,transfer.source_branch_id,transfer.destination_branch_id,item.name AS product_name,item.sku,shipline.dispatched_retail_quantity+shipline.dispatched_consumable_quantity AS dispatched_quantity,shipline.received_retail_quantity+shipline.received_consumable_quantity AS received_quantity,shipline.damaged_quantity,shipline.expired_quantity,shipline.short_quantity,shipline.variance_reason,shipment.status FROM inventory_transfer_shipment_lines shipline JOIN inventory_transfer_shipments shipment ON shipment.id=shipline.shipment_id AND shipment.tenant_id=shipline.tenant_id JOIN inventory_transfers transfer ON transfer.id=shipment.transfer_id AND transfer.tenant_id=shipment.tenant_id JOIN inventory_transfer_lines line ON line.id=shipline.transfer_line_id JOIN inventory_items item ON item.id=line.source_inventory_item_id WHERE shipline.tenant_id=$1 AND (transfer.source_branch_id=$2 OR transfer.destination_branch_id=$2) AND (shipline.damaged_quantity>0 OR shipline.expired_quantity>0 OR shipline.short_quantity>0 OR shipment.status IN ('dispatched','in_transit')) ORDER BY shipment.dispatched_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn return_allowance_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    parent_transfer_id: &str,
    return_source_item_id: &str,
    return_destination_item_id: &str,
) -> Result<Option<(i32, i32, i64, i64)>, sqlx::Error> {
    sqlx::query_as("SELECT original.received_retail_quantity,original.received_consumable_quantity,COALESCE((SELECT SUM(child_line.retail_quantity)::BIGINT FROM inventory_transfers child JOIN inventory_transfer_lines child_line ON child_line.tenant_id=child.tenant_id AND child_line.transfer_id=child.id WHERE child.tenant_id=original.tenant_id AND child.parent_transfer_id=original.transfer_id AND child.mode='return' AND child.status NOT IN ('cancelled','rejected') AND child_line.source_inventory_item_id=original.destination_inventory_item_id AND child_line.destination_inventory_item_id=original.source_inventory_item_id),0),COALESCE((SELECT SUM(child_line.consumable_quantity)::BIGINT FROM inventory_transfers child JOIN inventory_transfer_lines child_line ON child_line.tenant_id=child.tenant_id AND child_line.transfer_id=child.id WHERE child.tenant_id=original.tenant_id AND child.parent_transfer_id=original.transfer_id AND child.mode='return' AND child.status NOT IN ('cancelled','rejected') AND child_line.source_inventory_item_id=original.destination_inventory_item_id AND child_line.destination_inventory_item_id=original.source_inventory_item_id),0) FROM inventory_transfer_lines original WHERE original.tenant_id=$1 AND original.transfer_id=$2 AND original.destination_inventory_item_id=$3 AND original.source_inventory_item_id=$4 FOR UPDATE OF original")
        .bind(tenant_id).bind(parent_transfer_id).bind(return_source_item_id).bind(return_destination_item_id).fetch_optional(&mut **tx).await
}
