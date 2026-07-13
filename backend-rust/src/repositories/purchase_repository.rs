use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReceipt {
    pub id: String,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_invoice_number: String,
    pub received_date: NaiveDate,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReceiptLine {
    pub id: String,
    pub inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedInventoryItem {
    pub stock_quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 ORDER BY received_date DESC, created_at DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Vec<PurchaseReceiptLine>, sqlx::Error> {
    sqlx::query_as("SELECT id, inventory_item_id, quantity, unit_cost_paise, gst_percent, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise FROM purchase_receipt_lines WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=$3 ORDER BY created_at, id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_all(db).await
}

pub async fn by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

pub async fn lock_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<LockedInventoryItem>, sqlx::Error> {
    sqlx::query_as("SELECT stock_quantity, unit_cost_paise, gst_percent FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&mut **tx).await
}

pub async fn buyer_gstin(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT gstin FROM invoice_business_profiles WHERE tenant_id=$1 AND branch_id=$2 AND is_gst_registered=TRUE")
        .bind(tenant_id).bind(branch_id).fetch_optional(&mut **tx).await.map(|value| value.unwrap_or_default())
}

pub async fn create_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_name: &str,
    supplier_gstin: &str,
    supplier_state_code: &str,
    supplier_invoice_number: &str,
    received_date: NaiveDate,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    actor_user_id: &str,
    idempotency_key: &str,
) -> Result<PurchaseReceipt, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipts (tenant_id, branch_id, supplier_name, supplier_gstin, supplier_state_code, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, actor_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at")
        .bind(tenant_id).bind(branch_id).bind(supplier_name).bind(supplier_gstin).bind(supplier_state_code).bind(supplier_invoice_number).bind(received_date).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(taxable_paise + cgst_paise + sgst_paise + igst_paise).bind(actor_user_id).bind(idempotency_key).fetch_one(&mut **tx).await
}

pub async fn create_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    item_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
) -> Result<PurchaseReceiptLine, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipt_lines (tenant_id, branch_id, purchase_receipt_id, inventory_item_id, quantity, unit_cost_paise, gst_percent, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, inventory_item_id, quantity, unit_cost_paise, gst_percent, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(item_id).bind(quantity).bind(unit_cost_paise).bind(gst_percent).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(taxable_paise + cgst_paise + sgst_paise + igst_paise).fetch_one(&mut **tx).await
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
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(stock_quantity).bind(unit_cost_paise).execute(&mut **tx).await?;
    Ok(())
}

pub async fn add_stock_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    receipt_id: &str,
    receipt_line_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, purchase_receipt_id, purchase_receipt_line_id, movement_type, quantity_delta, unit_cost_paise) VALUES ($1,$2,$3,NULL,NULL,$4,$5,'purchase',$6,$7)")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(receipt_id).bind(receipt_line_id).bind(quantity).bind(unit_cost_paise).execute(&mut **tx).await?;
    Ok(())
}
