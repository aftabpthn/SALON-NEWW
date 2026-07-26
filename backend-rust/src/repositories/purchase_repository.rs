use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use super::business_code_repository::{next_branch_code, BusinessCodeKind};

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
    pub batch_number: String,
    pub batch_barcode: String,
    pub expiry_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedInventoryItem {
    pub stock_quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
    pub batch_tracked: bool,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierRecord {
    pub id: String,
    pub code: String,
    pub name: String,
    pub gstin: String,
    pub contact_name: String,
    pub phone: String,
    pub email: String,
    pub address: String,
    pub payment_terms_days: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderRecord {
    pub id: String,
    pub order_number: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub status: String,
    pub expected_date: Option<NaiveDate>,
    pub notes: String,
    pub taxable_paise: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
    pub line_count: i64,
    pub created_by: String,
    pub submitted_by: Option<String>,
    pub approved_by: Option<String>,
    pub decision_note: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderLineRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub quantity: i32,
    pub received_quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: i32,
    pub taxable_paise: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReturnRecord {
    pub id: String,
    pub purchase_receipt_id: String,
    pub supplier_name: String,
    pub reason: String,
    pub taxable_paise: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayableRecord {
    pub purchase_receipt_id: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub supplier_invoice_number: String,
    pub received_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub total_paise: i64,
    pub returned_paise: i64,
    pub paid_paise: i64,
    pub balance_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPaymentRecord {
    pub id: String,
    pub supplier_id: String,
    pub purchase_receipt_id: String,
    pub amount_paise: i64,
    pub payment_method: String,
    pub reference: String,
    pub paid_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ReceiptLineForReturn {
    pub id: String,
    pub inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub returned_quantity: i64,
    pub returned_tax_paise: i64,
    pub batch_number: String,
    pub batch_tracked: bool,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PurchaseReceipt>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        "SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND rolled_back_at IS NULL ORDER BY received_date DESC, created_at DESC"
            .to_string(),
        limit,
        offset,
    );
    sqlx::query_as(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND rolled_back_at IS NULL")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Vec<PurchaseReceiptLine>, sqlx::Error> {
    sqlx::query_as("SELECT line.id, line.inventory_item_id, line.quantity, line.unit_cost_paise, line.gst_percent, line.taxable_paise, line.cgst_paise, line.sgst_paise, line.igst_paise, line.total_paise, line.batch_number, line.batch_barcode, line.expiry_date FROM purchase_receipt_lines line JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_receipt_id=$3 AND receipt.rolled_back_at IS NULL ORDER BY line.created_at, line.id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_all(db).await
}

pub async fn by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 AND rolled_back_at IS NULL")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

pub async fn lock_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<LockedInventoryItem>, sqlx::Error> {
    sqlx::query_as("SELECT stock_quantity, unit_cost_paise, gst_percent, batch_tracked FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
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

fn apply_purchase_list_pagination(
    mut query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> String {
    let Some(limit) = limit else {
        return query;
    };
    let limit = limit.max(1);
    query.push_str(" LIMIT ");
    query.push_str(&limit.to_string());

    if let Some(offset) = offset.filter(|value| *value > 0) {
        query.push_str(" OFFSET ");
        query.push_str(&offset.to_string());
    }

    query
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
    supplier_id: Option<&str>,
    purchase_order_id: Option<&str>,
    due_date: Option<NaiveDate>,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    actor_user_id: &str,
    idempotency_key: &str,
) -> Result<PurchaseReceipt, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipts (tenant_id, branch_id, supplier_name, supplier_gstin, supplier_state_code, supplier_invoice_number, received_date, supplier_id, purchase_order_id, due_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, actor_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, supplier_name, supplier_gstin, supplier_invoice_number, received_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at")
        .bind(tenant_id).bind(branch_id).bind(supplier_name).bind(supplier_gstin).bind(supplier_state_code).bind(supplier_invoice_number).bind(received_date).bind(supplier_id).bind(purchase_order_id).bind(due_date).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(taxable_paise + cgst_paise + sgst_paise + igst_paise).bind(actor_user_id).bind(idempotency_key).fetch_one(&mut **tx).await
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
    batch_number: &str,
    batch_barcode: &str,
    expiry_date: Option<NaiveDate>,
) -> Result<PurchaseReceiptLine, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipt_lines (tenant_id, branch_id, purchase_receipt_id, inventory_item_id, quantity, unit_cost_paise, gst_percent, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, batch_number, batch_barcode, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, inventory_item_id, quantity, unit_cost_paise, gst_percent, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, batch_number, batch_barcode, expiry_date")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(item_id).bind(quantity).bind(unit_cost_paise).bind(gst_percent).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(taxable_paise + cgst_paise + sgst_paise + igst_paise).bind(batch_number).bind(batch_barcode).bind(expiry_date).fetch_one(&mut **tx).await
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
    stock_after_quantity: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, purchase_receipt_id, purchase_receipt_line_id, movement_type, quantity_delta, unit_cost_paise, stock_after_quantity) VALUES ($1,$2,$3,NULL,NULL,$4,$5,'purchase',$6,$7,$8) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(receipt_id).bind(receipt_line_id).bind(quantity).bind(unit_cost_paise).bind(stock_after_quantity).fetch_one(&mut **tx).await
}

pub async fn list_suppliers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SupplierRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,name")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_supplier(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: Option<&str>,
    code: &str,
    name: &str,
    gstin: &str,
    contact_name: &str,
    phone: &str,
    email: &str,
    address: &str,
    payment_terms_days: i32,
    active: bool,
) -> Result<Option<SupplierRecord>, sqlx::Error> {
    if let Some(id) = id {
        return sqlx::query_as("UPDATE suppliers SET code=$4,name=$5,gstin=$6,contact_name=$7,phone=$8,email=$9,address=$10,payment_terms_days=$11,active=$12,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
            .bind(tenant_id).bind(branch_id).bind(id).bind(code).bind(name).bind(gstin).bind(contact_name).bind(phone).bind(email).bind(address).bind(payment_terms_days).bind(active).fetch_optional(db).await;
    }
    let mut tx = db.begin().await?;
    let code = next_branch_code(&mut tx, tenant_id, branch_id, BusinessCodeKind::Supplier).await?;
    let row = sqlx::query_as("INSERT INTO suppliers(tenant_id,branch_id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(code).bind(name).bind(gstin).bind(contact_name).bind(phone).bind(email).bind(address).bind(payment_terms_days).bind(active).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn get_supplier(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<SupplierRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn list_orders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PurchaseOrderRecord>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        "SELECT order_row.id,order_row.order_number,order_row.supplier_id,supplier.name AS supplier_name,order_row.status,order_row.expected_date,order_row.notes,order_row.taxable_paise,order_row.tax_paise,order_row.total_paise,(SELECT COUNT(*) FROM purchase_order_lines line WHERE line.tenant_id=order_row.tenant_id AND line.branch_id=order_row.branch_id AND line.purchase_order_id=order_row.id) AS line_count,order_row.created_by,order_row.submitted_by,order_row.approved_by,order_row.decision_note,order_row.created_at,order_row.updated_at FROM purchase_orders order_row JOIN suppliers supplier ON supplier.id=order_row.supplier_id AND supplier.tenant_id=order_row.tenant_id AND supplier.branch_id=order_row.branch_id WHERE order_row.tenant_id=$1 AND order_row.branch_id=$2 ORDER BY order_row.created_at DESC"
            .to_string(),
        limit,
        offset,
    );
    sqlx::query_as(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn get_order(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PurchaseOrderRecord>, sqlx::Error> {
    sqlx::query_as("SELECT order_row.id,order_row.order_number,order_row.supplier_id,supplier.name AS supplier_name,order_row.status,order_row.expected_date,order_row.notes,order_row.taxable_paise,order_row.tax_paise,order_row.total_paise,(SELECT COUNT(*) FROM purchase_order_lines line WHERE line.tenant_id=order_row.tenant_id AND line.branch_id=order_row.branch_id AND line.purchase_order_id=order_row.id) AS line_count,order_row.created_by,order_row.submitted_by,order_row.approved_by,order_row.decision_note,order_row.created_at,order_row.updated_at FROM purchase_orders order_row JOIN suppliers supplier ON supplier.id=order_row.supplier_id AND supplier.tenant_id=order_row.tenant_id AND supplier.branch_id=order_row.branch_id WHERE order_row.tenant_id=$1 AND order_row.branch_id=$2 AND order_row.id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn order_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
) -> Result<Vec<PurchaseOrderLineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,item.name AS item_name,line.quantity,line.received_quantity,line.unit_cost_paise,line.gst_percent,line.taxable_paise,line.tax_paise,line.total_paise FROM purchase_order_lines line JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_order_id=$3 ORDER BY line.id")
        .bind(tenant_id).bind(branch_id).bind(order_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
    expected_date: Option<NaiveDate>,
    notes: &str,
    taxable_paise: i64,
    tax_paise: i64,
    created_by: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_orders(tenant_id,branch_id,order_number,supplier_id,expected_date,notes,taxable_paise,tax_paise,total_paise,created_by) SELECT $1,$2,'PO-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),supplier.id,$4,$5,$6,$7,$6+$7,$8 FROM suppliers supplier WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2 AND supplier.id=$3 AND supplier.active=TRUE RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(expected_date).bind(notes).bind(taxable_paise).bind(tax_paise).bind(created_by).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_order_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
    item_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    tax_paise: i64,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO purchase_order_lines(tenant_id,branch_id,purchase_order_id,inventory_item_id,quantity,unit_cost_paise,gst_percent,taxable_paise,tax_paise,total_paise) SELECT $1,$2,$3,item.id,$5,$6,$7,$8,$9,$8+$9 FROM inventory_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$4 AND item.active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(order_id).bind(item_id).bind(quantity).bind(unit_cost_paise).bind(gst_percent).bind(taxable_paise).bind(tax_paise).execute(&mut **tx).await?.rows_affected() == 1)
}

pub async fn transition_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    from_status: &str,
    to_status: &str,
    actor: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_orders SET status=$5,submitted_by=CASE WHEN $5='pending_approval' THEN $6 ELSE submitted_by END,submitted_at=CASE WHEN $5='pending_approval' THEN NOW() ELSE submitted_at END,approved_by=CASE WHEN $5 IN ('approved','rejected') THEN $6 ELSE approved_by END,approved_at=CASE WHEN $5 IN ('approved','rejected') THEN NOW() ELSE approved_at END,decision_note=CASE WHEN $5 IN ('approved','rejected') THEN $7 ELSE decision_note END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(from_status).bind(to_status).bind(actor).bind(note).execute(&mut **tx).await?.rows_affected() == 1)
}

pub async fn lock_order_for_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT supplier_id,status FROM purchase_orders WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn apply_order_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
    item_id: &str,
    quantity: i32,
) -> Result<bool, sqlx::Error> {
    let updated = sqlx::query("UPDATE purchase_order_lines SET received_quantity=received_quantity+$5 WHERE tenant_id=$1 AND branch_id=$2 AND purchase_order_id=$3 AND inventory_item_id=$4 AND received_quantity+$5<=quantity")
        .bind(tenant_id).bind(branch_id).bind(order_id).bind(item_id).bind(quantity).execute(&mut **tx).await?.rows_affected()==1;
    Ok(updated)
}

pub async fn refresh_order_status(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_orders SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM purchase_order_lines WHERE purchase_order_id=$3 AND received_quantity<quantity) THEN 'received' ELSE 'partially_received' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(order_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn list_returns(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PurchaseReturnRecord>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        "SELECT return_row.id,return_row.purchase_receipt_id,receipt.supplier_name,return_row.reason,return_row.taxable_paise,return_row.tax_paise,return_row.total_paise,return_row.created_at FROM purchase_returns return_row JOIN purchase_receipts receipt ON receipt.id=return_row.purchase_receipt_id AND receipt.tenant_id=return_row.tenant_id AND receipt.branch_id=return_row.branch_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND receipt.rolled_back_at IS NULL ORDER BY return_row.created_at DESC"
            .to_string(),
        limit,
        offset,
    );
    sqlx::query_as(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn return_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

pub async fn lock_receipt_line_for_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    line_id: &str,
) -> Result<Option<ReceiptLineForReturn>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,line.quantity,line.unit_cost_paise,line.cgst_paise,line.sgst_paise,line.igst_paise,COALESCE((SELECT SUM(return_line.quantity) FROM purchase_return_lines return_line JOIN purchase_returns return_row ON return_row.id=return_line.purchase_return_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND return_row.purchase_receipt_id=$3 AND return_line.purchase_receipt_line_id=line.id),0)::BIGINT AS returned_quantity,COALESCE((SELECT SUM(return_line.tax_paise) FROM purchase_return_lines return_line JOIN purchase_returns return_row ON return_row.id=return_line.purchase_return_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND return_row.purchase_receipt_id=$3 AND return_line.purchase_receipt_line_id=line.id),0)::BIGINT AS returned_tax_paise,line.batch_number,item.batch_tracked FROM purchase_receipt_lines line JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_receipt_id=$3 AND line.id=$4 AND receipt.rolled_back_at IS NULL FOR UPDATE OF line,item")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(line_id).fetch_optional(&mut **tx).await
}

pub async fn create_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    reason: &str,
    taxable_paise: i64,
    tax_paise: i64,
    key: &str,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_returns(tenant_id,branch_id,purchase_receipt_id,supplier_id,reason,taxable_paise,tax_paise,total_paise,idempotency_key,created_by) SELECT $1,$2,receipt.id,receipt.supplier_id,$4,$5,$6,$5+$6,$7,$8 FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.rolled_back_at IS NULL RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(reason).bind(taxable_paise).bind(tax_paise).bind(key).bind(actor).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_return_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    return_id: &str,
    receipt_line_id: &str,
    item_id: &str,
    quantity: i32,
    taxable_paise: i64,
    tax_paise: i64,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_return_lines(tenant_id,branch_id,purchase_return_id,purchase_receipt_line_id,inventory_item_id,quantity,taxable_paise,tax_paise,total_paise) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7+$8) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(return_id).bind(receipt_line_id).bind(item_id).bind(quantity).bind(taxable_paise).bind(tax_paise).fetch_one(&mut **tx).await
}

pub async fn add_return_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    return_id: &str,
    return_line_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
    stock_after_quantity: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,purchase_return_id,purchase_return_line_id,stock_after_quantity) VALUES($1,$2,$3,NULL,NULL,'purchase_return',$4,$5,$6,$7,$8) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(-quantity).bind(unit_cost_paise).bind(return_id).bind(return_line_id).bind(stock_after_quantity).fetch_one(&mut **tx).await
}

pub async fn list_payables(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PayableRecord>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        "SELECT receipt.id AS purchase_receipt_id,receipt.supplier_id,supplier.name AS supplier_name,receipt.supplier_invoice_number,receipt.received_date,receipt.due_date,receipt.total_paise,COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)::BIGINT AS returned_paise,COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)::BIGINT AS paid_paise,GREATEST(receipt.total_paise-COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0),0)::BIGINT AS balance_paise FROM purchase_receipts receipt JOIN suppliers supplier ON supplier.id=receipt.supplier_id WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.rolled_back_at IS NULL ORDER BY receipt.received_date DESC"
            .to_string(),
        limit,
        offset,
    );
    sqlx::query_as(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn payable_balance_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar("SELECT GREATEST(receipt.total_paise-COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0),0)::BIGINT FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.supplier_id IS NOT NULL AND receipt.rolled_back_at IS NULL FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_optional(&mut **tx).await
}

pub async fn supplier_payment_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<SupplierPaymentRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,supplier_id,purchase_receipt_id,amount_paise,payment_method,reference,paid_at FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

pub async fn create_supplier_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    amount_paise: i64,
    method: &str,
    reference: &str,
    key: &str,
    actor: &str,
) -> Result<Option<SupplierPaymentRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO supplier_payments(tenant_id,branch_id,supplier_id,purchase_receipt_id,amount_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,receipt.supplier_id,receipt.id,$4,$5,$6,$7,$8 FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.supplier_id IS NOT NULL AND receipt.rolled_back_at IS NULL RETURNING id,supplier_id,purchase_receipt_id,amount_paise,payment_method,reference,paid_at")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(amount_paise).bind(method).bind(reference).bind(key).bind(actor).fetch_optional(&mut **tx).await
}
