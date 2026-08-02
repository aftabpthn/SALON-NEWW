use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use super::business_code_repository::{next_branch_code, BusinessCodeKind};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReceipt {
    pub id: String,
    pub grr_number: String,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_invoice_number: String,
    pub supplier_invoice_date: NaiveDate,
    pub received_date: NaiveDate,
    pub challan_number: String,
    pub delivery_reference: String,
    pub shipping_paise: i64,
    pub handling_paise: i64,
    pub round_off_paise: i64,
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
    pub package_unit: String,
    pub stock_unit: String,
    pub units_per_package: i32,
    pub stock_quantity: i32,
    pub quantity: i32,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub free_quantity: i32,
    pub delivered_quantity: i32,
    pub ordered_quantity: Option<i32>,
    pub short_quantity: i32,
    pub excess_quantity: i32,
    pub damaged_quantity: i32,
    pub rejected_quantity: i32,
    pub quarantine_status: String,
    pub variance_reason: String,
    pub gross_unit_cost_paise: i64,
    pub unit_cost_paise: i64,
    pub landed_cost_paise: i64,
    pub landed_unit_cost_paise: i64,
    pub stock_unit_cost_paise: i64,
    pub discount_bps: i32,
    pub discount_paise: i64,
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
    pub package_unit: String,
    pub stock_unit: String,
    pub units_per_package: i32,
    pub product_usage: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryReceiptPolicy {
    pub partial_delivery_policy: String,
    pub excess_receiving_policy: String,
    pub price_difference_prompt: bool,
    pub price_difference_threshold_bps: i32,
    pub financial_lock_date: Option<NaiveDate>,
    pub edit_lock_days: i32,
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
    pub shipping_paise: i64,
    pub handling_paise: i64,
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
    pub package_unit: String,
    pub stock_unit: String,
    pub units_per_package: i32,
    pub quantity: i32,
    pub received_quantity: i32,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub retail_received_quantity: i32,
    pub consumable_received_quantity: i32,
    pub unit_cost_paise: i64,
    pub discount_bps: i32,
    pub discount_paise: i64,
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
    pub return_date: NaiveDate,
    pub credit_note_number: String,
    pub credit_note_date: Option<NaiveDate>,
    pub evidence_reference: String,
    pub taxable_paise: i64,
    pub tax_paise: i64,
    pub total_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivingQuarantineRecord {
    pub id: String,
    pub purchase_receipt_id: String,
    pub purchase_receipt_line_id: String,
    pub inventory_item_id: String,
    pub product_name: String,
    pub supplier_name: String,
    pub quantity: i32,
    pub remaining_quantity: i32,
    pub package_unit: String,
    pub stock_unit: String,
    pub units_per_package: i32,
    pub quantity_basis: String,
    pub status: String,
    pub reason: String,
    pub batch_number: String,
    pub batch_barcode: String,
    pub expiry_date: Option<NaiveDate>,
    pub received_date: NaiveDate,
    pub unit_cost_paise: i64,
    pub dispositions: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedReceivingQuarantine {
    pub id: String,
    pub purchase_receipt_id: String,
    pub purchase_receipt_line_id: String,
    pub inventory_item_id: String,
    pub quantity: i32,
    pub remaining_quantity: i32,
    pub units_per_package: i32,
    pub quantity_basis: String,
    pub status: String,
    pub batch_number: String,
    pub batch_barcode: String,
    pub expiry_date: Option<NaiveDate>,
    pub received_date: NaiveDate,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayableRecord {
    pub purchase_receipt_id: String,
    pub source_type: String,
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
    pub units_per_package: i32,
    pub stock_unit_cost_paise: i64,
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

#[derive(Debug, Clone, FromRow)]
pub struct LockedOrderLine {
    pub quantity: i32,
    pub received_quantity: i32,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub retail_received_quantity: i32,
    pub consumable_received_quantity: i32,
    pub unit_cost_paise: i64,
    pub package_unit: String,
    pub stock_unit: String,
    pub units_per_package: i32,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchasePriceUpdateRequest {
    pub id: String,
    pub purchase_receipt_id: String,
    pub grr_number: String,
    pub supplier_name: String,
    pub inventory_item_id: String,
    pub product_name: String,
    pub current_unit_cost_paise: Option<i64>,
    pub requested_unit_cost_paise: i64,
    pub requested_discount_bps: i32,
    pub requested_gst_percent: i32,
    pub status: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_note: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct PurchaseImportProduct {
    pub supplier_id: String,
    pub inventory_item_id: String,
    pub product_usage: String,
    pub unit_cost_paise: Option<i64>,
    pub discount_bps: Option<i32>,
    pub gst_percent: i32,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseBarcodeLabel {
    pub product_name: String,
    pub sku: String,
    pub product_usage: String,
    pub barcode: String,
    pub batch_number: String,
    pub expiry_date: Option<NaiveDate>,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub free_quantity: i32,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PurchaseReceipt>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        "SELECT id,grr_number,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,received_date,challan_number,delivery_reference,shipping_paise,handling_paise,round_off_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND rolled_back_at IS NULL ORDER BY received_date DESC, created_at DESC"
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
    sqlx::query_as("SELECT id,grr_number,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,received_date,challan_number,delivery_reference,shipping_paise,handling_paise,round_off_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND rolled_back_at IS NULL")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn historical_invoice_collision(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    supplier_name: &str,
    supplier_gstin: &str,
    invoice_number: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM historical_purchase_bills bill
             WHERE bill.tenant_id=$1 AND bill.branch_id=$2
               AND LOWER(BTRIM(bill.invoice_number))=LOWER(BTRIM($5))
               AND ((BTRIM($4)<>'' AND UPPER(BTRIM(bill.supplier_gstin))=UPPER(BTRIM($4)))
                    OR (BTRIM($4)='' AND LOWER(BTRIM(bill.supplier_name))=LOWER(BTRIM($3))))
           )"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(supplier_name)
    .bind(supplier_gstin)
    .bind(invoice_number)
    .fetch_one(db)
    .await
}

pub async fn lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Vec<PurchaseReceiptLine>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,line.package_unit,line.stock_unit,line.units_per_package,line.stock_quantity,line.quantity,line.retail_quantity,line.consumable_quantity,line.free_quantity,line.delivered_quantity,line.ordered_quantity,line.short_quantity,line.excess_quantity,line.damaged_quantity,line.rejected_quantity,COALESCE(quarantine.status,'') AS quarantine_status,line.variance_reason,line.gross_unit_cost_paise,line.unit_cost_paise,line.landed_cost_paise,line.landed_unit_cost_paise,line.stock_unit_cost_paise,line.discount_bps,line.discount_paise,line.gst_percent,line.taxable_paise,line.cgst_paise,line.sgst_paise,line.igst_paise,line.total_paise,line.batch_number,line.batch_barcode,line.expiry_date FROM purchase_receipt_lines line JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id LEFT JOIN inventory_receiving_quarantine quarantine ON quarantine.tenant_id=line.tenant_id AND quarantine.branch_id=line.branch_id AND quarantine.purchase_receipt_line_id=line.id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_receipt_id=$3 AND receipt.rolled_back_at IS NULL ORDER BY line.created_at, line.id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_all(db).await
}

pub async fn by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<PurchaseReceipt>, sqlx::Error> {
    sqlx::query_as("SELECT id,grr_number,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,received_date,challan_number,delivery_reference,shipping_paise,handling_paise,round_off_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,created_at FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 AND rolled_back_at IS NULL")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

pub async fn lock_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
) -> Result<Option<LockedInventoryItem>, sqlx::Error> {
    sqlx::query_as("SELECT stock_quantity,unit_cost_paise,gst_percent,batch_tracked,package_unit,unit AS stock_unit,units_per_package,product_usage FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND center_available=TRUE FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&mut **tx).await
}

pub async fn inventory_receipt_policy(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryReceiptPolicy, sqlx::Error> {
    sqlx::query_as("SELECT COALESCE((SELECT partial_delivery_policy FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'allow') AS partial_delivery_policy,COALESCE((SELECT excess_receiving_policy FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'permission_required') AS excess_receiving_policy,COALESCE((SELECT price_difference_prompt FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),TRUE) AS price_difference_prompt,COALESCE((SELECT price_difference_threshold_bps FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),0) AS price_difference_threshold_bps,(SELECT financial_lock_date FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2) AS financial_lock_date,COALESCE((SELECT edit_lock_days FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),90) AS edit_lock_days")
        .bind(tenant_id).bind(branch_id).fetch_one(&mut **tx).await
}

pub async fn supplier_item_available(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
    item_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM supplier_inventory_terms WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3 AND inventory_item_id=$4 AND active=TRUE AND center_available=TRUE)")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(item_id).fetch_one(&mut **tx).await
}

pub async fn active_supplier_price(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
    item_id: &str,
    on_date: NaiveDate,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar("SELECT unit_cost_paise FROM supplier_price_lists WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3 AND inventory_item_id=$4 AND effective_from<=$5 AND (effective_to IS NULL OR effective_to>=$5) ORDER BY effective_from DESC,created_at DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(item_id).bind(on_date)
        .fetch_optional(&mut **tx).await
}

pub async fn create_price_update_request(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    receipt_line_id: &str,
    supplier_id: &str,
    item_id: &str,
    current_cost: Option<i64>,
    requested_cost: i64,
    discount_bps: i32,
    gst_percent: i32,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO purchase_price_update_requests(tenant_id,branch_id,purchase_receipt_id,purchase_receipt_line_id,supplier_id,inventory_item_id,current_unit_cost_paise,requested_unit_cost_paise,requested_discount_bps,requested_gst_percent,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(receipt_line_id).bind(supplier_id)
        .bind(item_id).bind(current_cost).bind(requested_cost).bind(discount_bps).bind(gst_percent).bind(actor)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn mark_excess_approved(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_receipts SET excess_approved_by=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn list_price_update_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: Option<&str>,
) -> Result<Vec<PurchasePriceUpdateRequest>, sqlx::Error> {
    sqlx::query_as("SELECT request.id,request.purchase_receipt_id,receipt.grr_number,supplier.name AS supplier_name,request.inventory_item_id,item.name AS product_name,request.current_unit_cost_paise,request.requested_unit_cost_paise,request.requested_discount_bps,request.requested_gst_percent,request.status,request.requested_by,request.requested_at,request.reviewed_by,request.reviewed_at,request.review_note FROM purchase_price_update_requests request JOIN purchase_receipts receipt ON receipt.id=request.purchase_receipt_id AND receipt.tenant_id=request.tenant_id AND receipt.branch_id=request.branch_id JOIN suppliers supplier ON supplier.id=request.supplier_id JOIN inventory_items item ON item.id=request.inventory_item_id WHERE request.tenant_id=$1 AND request.branch_id=$2 AND ($3::TEXT IS NULL OR request.status=$3) ORDER BY request.requested_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).bind(status).fetch_all(db).await
}

#[derive(Debug, Clone, FromRow)]
pub struct LockedPriceUpdateRequest {
    pub supplier_id: String,
    pub inventory_item_id: String,
    pub requested_unit_cost_paise: i64,
    pub requested_discount_bps: i32,
    pub requested_gst_percent: i32,
    pub requested_by: String,
}

pub async fn lock_price_update_request(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<LockedPriceUpdateRequest>, sqlx::Error> {
    sqlx::query_as("SELECT supplier_id,inventory_item_id,requested_unit_cost_paise,requested_discount_bps,requested_gst_percent,requested_by FROM purchase_price_update_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn apply_approved_supplier_price(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
    item_id: &str,
    cost: i64,
    discount_bps: i32,
    gst_percent: i32,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE supplier_price_lists SET effective_to=CURRENT_DATE-1 WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3 AND inventory_item_id=$4 AND effective_from<CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(item_id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO supplier_price_lists(tenant_id,branch_id,supplier_id,inventory_item_id,unit_cost_paise,discount_bps,gst_percent,effective_from,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8) ON CONFLICT(tenant_id,branch_id,supplier_id,inventory_item_id,effective_from) DO UPDATE SET unit_cost_paise=EXCLUDED.unit_cost_paise,discount_bps=EXCLUDED.discount_bps,gst_percent=EXCLUDED.gst_percent,effective_to=NULL,created_by=EXCLUDED.created_by")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(item_id).bind(cost).bind(discount_bps).bind(gst_percent).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

pub async fn finish_price_update_request(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    actor: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_price_update_requests SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(actor).bind(note)
        .execute(&mut **tx).await?.rows_affected()==1)
}

pub async fn import_product(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    supplier_code: &str,
    product_code: &str,
) -> Result<Option<PurchaseImportProduct>, sqlx::Error> {
    sqlx::query_as("SELECT supplier.id AS supplier_id,item.id AS inventory_item_id,item.product_usage,price.unit_cost_paise,price.discount_bps,COALESCE(price.gst_percent,item.gst_percent) AS gst_percent FROM suppliers supplier JOIN inventory_items item ON item.tenant_id=supplier.tenant_id AND item.branch_id=supplier.branch_id AND item.active=TRUE AND item.center_available=TRUE JOIN supplier_inventory_terms terms ON terms.tenant_id=item.tenant_id AND terms.branch_id=item.branch_id AND terms.supplier_id=supplier.id AND terms.inventory_item_id=item.id AND terms.active=TRUE AND terms.center_available=TRUE LEFT JOIN LATERAL (SELECT unit_cost_paise,discount_bps,gst_percent FROM supplier_price_lists price WHERE price.tenant_id=item.tenant_id AND price.branch_id=item.branch_id AND price.supplier_id=supplier.id AND price.inventory_item_id=item.id AND price.effective_from<=CURRENT_DATE AND (price.effective_to IS NULL OR price.effective_to>=CURRENT_DATE) ORDER BY price.effective_from DESC LIMIT 1) price ON TRUE WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2 AND supplier.active=TRUE AND UPPER(supplier.code)=UPPER($3) AND (UPPER(item.sku)=UPPER($4) OR EXISTS(SELECT 1 FROM inventory_item_barcodes barcode WHERE barcode.tenant_id=item.tenant_id AND barcode.branch_id=item.branch_id AND barcode.inventory_item_id=item.id AND barcode.active=TRUE AND UPPER(barcode.barcode)=UPPER($4))) LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(supplier_code).bind(product_code).fetch_optional(db).await
}

pub async fn barcode_labels(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Vec<PurchaseBarcodeLabel>, sqlx::Error> {
    sqlx::query_as("SELECT item.name AS product_name,item.sku,item.product_usage,COALESCE(NULLIF(line.batch_barcode,''),NULLIF(primary_barcode.barcode,''),NULLIF(item.barcode,''),'') AS barcode,line.batch_number,line.expiry_date,line.retail_quantity,line.consumable_quantity,line.free_quantity FROM purchase_receipt_lines line JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id LEFT JOIN LATERAL (SELECT barcode FROM inventory_item_barcodes WHERE tenant_id=item.tenant_id AND branch_id=item.branch_id AND inventory_item_id=item.id AND active=TRUE ORDER BY is_primary DESC,created_at LIMIT 1) primary_barcode ON TRUE WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_receipt_id=$3 AND receipt.rolled_back_at IS NULL ORDER BY item.name,line.id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_all(db).await
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
#[allow(clippy::too_many_arguments)]
pub async fn create_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_name: &str,
    supplier_gstin: &str,
    supplier_state_code: &str,
    supplier_invoice_number: &str,
    supplier_invoice_date: NaiveDate,
    received_date: NaiveDate,
    challan_number: &str,
    delivery_reference: &str,
    supplier_id: Option<&str>,
    purchase_order_id: Option<&str>,
    due_date: Option<NaiveDate>,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    shipping_paise: i64,
    handling_paise: i64,
    round_off_paise: i64,
    actor_user_id: &str,
    idempotency_key: &str,
) -> Result<PurchaseReceipt, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipts (tenant_id,branch_id,grr_number,supplier_name,supplier_gstin,supplier_state_code,supplier_invoice_number,supplier_invoice_date,received_date,challan_number,delivery_reference,supplier_id,purchase_order_id,due_date,taxable_paise,cgst_paise,sgst_paise,igst_paise,shipping_paise,handling_paise,round_off_paise,total_paise,actor_user_id,idempotency_key) VALUES ($1,$2,'GRR-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$14+$15+$16+$17+$18+$19+$20,$21,$22) RETURNING id,grr_number,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,received_date,challan_number,delivery_reference,shipping_paise,handling_paise,round_off_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,created_at")
        .bind(tenant_id).bind(branch_id).bind(supplier_name).bind(supplier_gstin).bind(supplier_state_code).bind(supplier_invoice_number).bind(supplier_invoice_date).bind(received_date).bind(challan_number).bind(delivery_reference).bind(supplier_id).bind(purchase_order_id).bind(due_date).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(shipping_paise).bind(handling_paise).bind(round_off_paise).bind(actor_user_id).bind(idempotency_key).fetch_one(&mut **tx).await
}

pub async fn record_backdated_operational_approval(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE purchase_receipts SET backdated_operational_approved_by=$4,backdated_operational_approved_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(receipt_id)
    .bind(actor_user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    item_id: &str,
    package_unit: &str,
    stock_unit: &str,
    units_per_package: i32,
    stock_quantity: i32,
    stock_unit_cost_paise: i64,
    quantity: i32,
    retail_quantity: i32,
    consumable_quantity: i32,
    delivered_quantity: i32,
    ordered_quantity: Option<i32>,
    short_quantity: i32,
    excess_quantity: i32,
    damaged_quantity: i32,
    rejected_quantity: i32,
    variance_reason: &str,
    gross_unit_cost_paise: i64,
    unit_cost_paise: i64,
    landed_cost_paise: i64,
    landed_unit_cost_paise: i64,
    discount_bps: i32,
    discount_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    batch_number: &str,
    batch_barcode: &str,
    expiry_date: Option<NaiveDate>,
    free_quantity: i32,
) -> Result<PurchaseReceiptLine, sqlx::Error> {
    sqlx::query_as("INSERT INTO purchase_receipt_lines (tenant_id,branch_id,purchase_receipt_id,inventory_item_id,quantity,retail_quantity,consumable_quantity,delivered_quantity,ordered_quantity,short_quantity,excess_quantity,damaged_quantity,rejected_quantity,variance_reason,gross_unit_cost_paise,unit_cost_paise,landed_cost_paise,landed_unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,batch_barcode,expiry_date,package_unit,stock_unit,units_per_package,stock_quantity,stock_unit_cost_paise,free_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$22+$23+$24+$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING id,inventory_item_id,package_unit,stock_unit,units_per_package,stock_quantity,quantity,retail_quantity,consumable_quantity,free_quantity,delivered_quantity,ordered_quantity,short_quantity,excess_quantity,damaged_quantity,rejected_quantity,'' AS quarantine_status,variance_reason,gross_unit_cost_paise,unit_cost_paise,landed_cost_paise,landed_unit_cost_paise,stock_unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,batch_barcode,expiry_date")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(item_id).bind(quantity).bind(retail_quantity).bind(consumable_quantity).bind(delivered_quantity).bind(ordered_quantity).bind(short_quantity).bind(excess_quantity).bind(damaged_quantity).bind(rejected_quantity).bind(variance_reason).bind(gross_unit_cost_paise).bind(unit_cost_paise).bind(landed_cost_paise).bind(landed_unit_cost_paise).bind(discount_bps).bind(discount_paise).bind(gst_percent).bind(taxable_paise).bind(cgst_paise).bind(sgst_paise).bind(igst_paise).bind(batch_number).bind(batch_barcode).bind(expiry_date).bind(package_unit).bind(stock_unit).bind(units_per_package).bind(stock_quantity).bind(stock_unit_cost_paise).bind(free_quantity).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_receiving_quarantine(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    receipt_line_id: &str,
    item_id: &str,
    quantity: i32,
    reason: &str,
    batch_number: &str,
    batch_barcode: &str,
    expiry_date: Option<NaiveDate>,
    unit_cost_paise: i64,
    actor_user_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_receiving_quarantine (tenant_id,branch_id,purchase_receipt_id,purchase_receipt_line_id,inventory_item_id,quantity,remaining_quantity,quantity_basis,reason,batch_number,batch_barcode,expiry_date,unit_cost_paise,created_by) VALUES ($1,$2,$3,$4,$5,$6,$6,'base_unit',$7,$8,$9,$10,$11,$12)")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(receipt_line_id).bind(item_id).bind(quantity).bind(reason).bind(batch_number).bind(batch_barcode).bind(expiry_date).bind(unit_cost_paise).bind(actor_user_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn list_receiving_quarantine(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ReceivingQuarantineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT quarantine.id,quarantine.purchase_receipt_id,quarantine.purchase_receipt_line_id,quarantine.inventory_item_id,item.name AS product_name,receipt.supplier_name,quarantine.quantity,quarantine.remaining_quantity,line.package_unit,line.stock_unit,line.units_per_package,quarantine.quantity_basis,quarantine.status,quarantine.reason,quarantine.batch_number,quarantine.batch_barcode,quarantine.expiry_date,receipt.received_date,quarantine.unit_cost_paise,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',disposition.id,'action',disposition.action,'quantity',disposition.quantity,'reason',disposition.reason,'evidenceReference',disposition.evidence_reference,'creditNoteNumber',disposition.credit_note_number,'actorUserId',disposition.actor_user_id,'createdAt',disposition.created_at) ORDER BY disposition.created_at,disposition.id) FROM inventory_quarantine_dispositions disposition WHERE disposition.tenant_id=quarantine.tenant_id AND disposition.branch_id=quarantine.branch_id AND disposition.quarantine_id=quarantine.id),'[]'::JSONB) AS dispositions,quarantine.created_at FROM inventory_receiving_quarantine quarantine JOIN purchase_receipt_lines line ON line.id=quarantine.purchase_receipt_line_id AND line.tenant_id=quarantine.tenant_id AND line.branch_id=quarantine.branch_id JOIN purchase_receipts receipt ON receipt.id=quarantine.purchase_receipt_id AND receipt.tenant_id=quarantine.tenant_id AND receipt.branch_id=quarantine.branch_id JOIN inventory_items item ON item.id=quarantine.inventory_item_id AND item.tenant_id=quarantine.tenant_id AND item.branch_id=quarantine.branch_id WHERE quarantine.tenant_id=$1 AND quarantine.branch_id=$2 ORDER BY (quarantine.remaining_quantity>0) DESC,quarantine.created_at DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn lock_receiving_quarantine(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<LockedReceivingQuarantine>, sqlx::Error> {
    sqlx::query_as("SELECT quarantine.id,quarantine.purchase_receipt_id,quarantine.purchase_receipt_line_id,quarantine.inventory_item_id,quarantine.quantity,quarantine.remaining_quantity,line.units_per_package,quarantine.quantity_basis,quarantine.status,quarantine.batch_number,quarantine.batch_barcode,quarantine.expiry_date,receipt.received_date,quarantine.unit_cost_paise FROM inventory_receiving_quarantine quarantine JOIN purchase_receipt_lines line ON line.id=quarantine.purchase_receipt_line_id AND line.tenant_id=quarantine.tenant_id AND line.branch_id=quarantine.branch_id JOIN purchase_receipts receipt ON receipt.id=quarantine.purchase_receipt_id AND receipt.tenant_id=quarantine.tenant_id AND receipt.branch_id=quarantine.branch_id WHERE quarantine.tenant_id=$1 AND quarantine.branch_id=$2 AND quarantine.id=$3 FOR UPDATE OF quarantine")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn quarantine_disposition_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<(String, String, String, i32)>, sqlx::Error> {
    sqlx::query_as("SELECT id,quarantine_id,action,quantity FROM inventory_quarantine_dispositions WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_quarantine_disposition(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    quarantine_id: &str,
    action: &str,
    quantity: i32,
    unit_cost_paise: i64,
    reason: &str,
    evidence_reference: &str,
    credit_note_number: &str,
    actor: &str,
    key: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_quarantine_dispositions(tenant_id,branch_id,quarantine_id,action,quantity,unit_cost_paise,reason,evidence_reference,credit_note_number,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(quarantine_id).bind(action).bind(quantity).bind(unit_cost_paise).bind(reason).bind(evidence_reference).bind(credit_note_number).bind(actor).bind(key).fetch_one(&mut **tx).await
}

pub async fn finish_quarantine_disposition(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    quarantine_id: &str,
    _disposition_id: &str,
    remaining_quantity: i32,
    _stock_ledger_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE inventory_receiving_quarantine SET remaining_quantity=$4,status=CASE WHEN $4>0 THEN 'partially_disposed' WHEN (SELECT COUNT(DISTINCT action) FROM inventory_quarantine_dispositions WHERE tenant_id=$1 AND branch_id=$2 AND quarantine_id=$3)=1 THEN (SELECT CASE action WHEN 'release' THEN 'released' WHEN 'return' THEN 'returned' ELSE 'discarded' END FROM inventory_quarantine_dispositions WHERE tenant_id=$1 AND branch_id=$2 AND quarantine_id=$3 LIMIT 1) ELSE 'mixed' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(quarantine_id).bind(remaining_quantity).execute(&mut **tx).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn add_quarantine_release_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    receipt_id: &str,
    receipt_line_id: &str,
    disposition_id: &str,
    quantity: i32,
    unit_cost_paise: i64,
    stock_after: i32,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,purchase_receipt_id,purchase_receipt_line_id,quarantine_disposition_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,$6,'quarantine_release',$7,$8,$9) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(item_id).bind(receipt_id).bind(receipt_line_id).bind(disposition_id).bind(quantity).bind(unit_cost_paise).bind(stock_after).fetch_one(&mut **tx).await
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
        return sqlx::query_as("UPDATE suppliers SET code=COALESCE(NULLIF($4,''),code),name=$5,gstin=$6,contact_name=$7,phone=$8,email=$9,address=$10,payment_terms_days=$11,active=$12,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
            .bind(tenant_id).bind(branch_id).bind(id).bind(code).bind(name).bind(gstin).bind(contact_name).bind(phone).bind(email).bind(address).bind(payment_terms_days).bind(active).fetch_optional(db).await;
    }
    let mut tx = db.begin().await?;
    let code = next_branch_code(&mut tx, tenant_id, branch_id, BusinessCodeKind::Supplier).await?;
    let row = sqlx::query_as("INSERT INTO suppliers(tenant_id,branch_id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(code).bind(name).bind(gstin).bind(contact_name).bind(phone).bind(email).bind(address).bind(payment_terms_days).bind(active).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub struct SupplierFromBillResult {
    pub supplier: SupplierRecord,
}

#[allow(clippy::too_many_arguments)]
pub async fn save_supplier_from_bill(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    gstin: &str,
    phone: &str,
    email: &str,
    address: &str,
    draft_id: &str,
    actor: &str,
) -> Result<SupplierFromBillResult, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{tenant_id}:{branch_id}:supplier-identity"))
        .execute(&mut *tx)
        .await?;
    let existing: Option<SupplierRecord> = sqlx::query_as(r"SELECT id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND ((BTRIM($3)<>'' AND UPPER(gstin)=UPPER(BTRIM($3))) OR LOWER(REGEXP_REPLACE(BTRIM(name),'\s+',' ','g'))=LOWER(REGEXP_REPLACE(BTRIM($4),'\s+',' ','g'))) ORDER BY CASE WHEN BTRIM($3)<>'' AND UPPER(gstin)=UPPER(BTRIM($3)) THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(gstin).bind(name).fetch_optional(&mut *tx).await?;
    let (supplier, matched_existing) = if let Some(existing) = existing {
        if !existing.active {
            tx.commit().await?;
            return Ok(SupplierFromBillResult { supplier: existing });
        }
        let supplier: SupplierRecord = sqlx::query_as("UPDATE suppliers SET gstin=CASE WHEN BTRIM(gstin)='' THEN $4 ELSE gstin END,phone=CASE WHEN BTRIM(phone)='' THEN $5 ELSE phone END,email=CASE WHEN BTRIM(email)='' THEN $6 ELSE email END,address=CASE WHEN BTRIM(address)='' THEN $7 ELSE address END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
            .bind(tenant_id).bind(branch_id).bind(&existing.id).bind(gstin).bind(phone).bind(email).bind(address).fetch_one(&mut *tx).await?;
        (supplier, true)
    } else {
        let code =
            next_branch_code(&mut tx, tenant_id, branch_id, BusinessCodeKind::Supplier).await?;
        let supplier: SupplierRecord = sqlx::query_as("INSERT INTO suppliers(tenant_id,branch_id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active) VALUES($1,$2,$3,$4,$5,'',$6,$7,$8,0,TRUE) RETURNING id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active,created_at,updated_at")
            .bind(tenant_id).bind(branch_id).bind(code).bind(name).bind(gstin).bind(phone).bind(email).bind(address).fetch_one(&mut *tx).await?;
        (supplier, false)
    };
    let linked = sqlx::query("UPDATE purchase_bill_drafts SET supplier_id=$4,supplier_name=$5,supplier_gstin=$6,supplier_phone=$7,supplier_email=$8,supplier_address=$9,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('review','extraction_failed')")
        .bind(tenant_id).bind(branch_id).bind(draft_id).bind(&supplier.id).bind(&supplier.name)
        .bind(&supplier.gstin).bind(&supplier.phone).bind(&supplier.email).bind(&supplier.address)
        .execute(&mut *tx).await?.rows_affected()==1;
    if !linked {
        return Err(sqlx::Error::RowNotFound);
    }
    sqlx::query("INSERT INTO purchase_bill_draft_events(tenant_id,branch_id,draft_id,event_type,actor_user_id,details) VALUES($1,$2,$3,'supplier_linked',$4,JSONB_BUILD_OBJECT('supplierId',$5,'matchedExisting',$6))")
        .bind(tenant_id).bind(branch_id).bind(draft_id).bind(actor).bind(&supplier.id).bind(matched_existing)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(SupplierFromBillResult { supplier })
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierAdvanceRecord {
    pub id: String,
    pub supplier_id: String,
    pub amount_paise: i64,
    pub payment_method: String,
    pub reference: String,
    pub paid_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPaymentMetricRecord {
    pub supplier_id: String,
    pub paid_paise: i64,
    pub unpaid_paise: i64,
    pub extra_paid_paise: i64,
    pub pending_bill_count: i64,
    pub pending_bills_paise: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPaymentSummary {
    pub paid_paise: i64,
    pub unpaid_paise: i64,
    pub extra_paid_paise: i64,
    pub pending_bills_paise: i64,
    pub suppliers: Vec<SupplierPaymentMetricRecord>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierLedgerEntryRecord {
    pub id: String,
    pub entry_type: String,
    pub entry_date: NaiveDate,
    pub particulars: String,
    pub reference: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
    pub balance_paise: i64,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSupplierBillRecord {
    pub id: String,
    pub bill_number: String,
    pub bill_date: Option<NaiveDate>,
    pub total_paise: i64,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierLedgerSummary {
    pub bills_paise: i64,
    pub paid_paise: i64,
    pub outstanding_paise: i64,
    pub advance_paise: i64,
    pub pending_bills_paise: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierLedgerResponse {
    pub supplier: SupplierRecord,
    pub summary: SupplierLedgerSummary,
    pub payables: Vec<PayableRecord>,
    pub pending_bills: Vec<PendingSupplierBillRecord>,
    pub entries: Vec<SupplierLedgerEntryRecord>,
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
        "SELECT order_row.id,order_row.order_number,order_row.supplier_id,supplier.name AS supplier_name,order_row.status,order_row.expected_date,order_row.notes,order_row.taxable_paise,order_row.tax_paise,order_row.shipping_paise,order_row.handling_paise,order_row.total_paise,(SELECT COUNT(*) FROM purchase_order_lines line WHERE line.tenant_id=order_row.tenant_id AND line.branch_id=order_row.branch_id AND line.purchase_order_id=order_row.id) AS line_count,order_row.created_by,order_row.submitted_by,order_row.approved_by,order_row.decision_note,order_row.created_at,order_row.updated_at FROM purchase_orders order_row JOIN suppliers supplier ON supplier.id=order_row.supplier_id AND supplier.tenant_id=order_row.tenant_id AND supplier.branch_id=order_row.branch_id WHERE order_row.tenant_id=$1 AND order_row.branch_id=$2 ORDER BY order_row.created_at DESC"
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
    sqlx::query_as("SELECT order_row.id,order_row.order_number,order_row.supplier_id,supplier.name AS supplier_name,order_row.status,order_row.expected_date,order_row.notes,order_row.taxable_paise,order_row.tax_paise,order_row.shipping_paise,order_row.handling_paise,order_row.total_paise,(SELECT COUNT(*) FROM purchase_order_lines line WHERE line.tenant_id=order_row.tenant_id AND line.branch_id=order_row.branch_id AND line.purchase_order_id=order_row.id) AS line_count,order_row.created_by,order_row.submitted_by,order_row.approved_by,order_row.decision_note,order_row.created_at,order_row.updated_at FROM purchase_orders order_row JOIN suppliers supplier ON supplier.id=order_row.supplier_id AND supplier.tenant_id=order_row.tenant_id AND supplier.branch_id=order_row.branch_id WHERE order_row.tenant_id=$1 AND order_row.branch_id=$2 AND order_row.id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn order_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
) -> Result<Vec<PurchaseOrderLineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,item.name AS item_name,line.package_unit,line.stock_unit,line.units_per_package,line.quantity,line.received_quantity,line.retail_quantity,line.consumable_quantity,line.retail_received_quantity,line.consumable_received_quantity,line.unit_cost_paise,line.discount_bps,line.discount_paise,line.gst_percent,line.taxable_paise,line.tax_paise,line.total_paise FROM purchase_order_lines line JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_order_id=$3 ORDER BY line.id")
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
    shipping_paise: i64,
    handling_paise: i64,
    created_by: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_orders(tenant_id,branch_id,order_number,supplier_id,expected_date,notes,taxable_paise,tax_paise,shipping_paise,handling_paise,total_paise,created_by) SELECT $1,$2,'PO-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),supplier.id,$4,$5,$6,$7,$8,$9,$6+$7+$8+$9,$10 FROM suppliers supplier WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2 AND supplier.id=$3 AND supplier.active=TRUE RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(expected_date).bind(notes).bind(taxable_paise).bind(tax_paise).bind(shipping_paise).bind(handling_paise).bind(created_by).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_order_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
    supplier_id: &str,
    item_id: &str,
    quantity: i32,
    retail_quantity: i32,
    consumable_quantity: i32,
    unit_cost_paise: i64,
    discount_bps: i32,
    discount_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    tax_paise: i64,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO purchase_order_lines(tenant_id,branch_id,purchase_order_id,inventory_item_id,quantity,retail_quantity,consumable_quantity,unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,tax_paise,total_paise,package_unit,stock_unit,units_per_package) SELECT $1,$2,$3,item.id,$6,CASE WHEN $7+$8=0 THEN CASE WHEN item.product_usage='consumable' THEN 0 ELSE $6 END ELSE $7 END,CASE WHEN $7+$8=0 THEN CASE WHEN item.product_usage='consumable' THEN $6 ELSE 0 END ELSE $8 END,$9,$10,$11,$12,$13,$14,$13+$14,item.package_unit,item.unit,item.units_per_package FROM inventory_items item JOIN supplier_inventory_terms terms ON terms.tenant_id=item.tenant_id AND terms.branch_id=item.branch_id AND terms.inventory_item_id=item.id AND terms.supplier_id=$4 AND terms.active=TRUE AND terms.center_available=TRUE WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$5 AND item.active=TRUE AND item.center_available=TRUE AND ($7+$8=0 OR $7+$8=$6) AND ($7=0 OR item.product_usage IN ('retail','dual_use')) AND ($8=0 OR item.product_usage IN ('consumable','dual_use'))")
        .bind(tenant_id).bind(branch_id).bind(order_id).bind(supplier_id).bind(item_id).bind(quantity).bind(retail_quantity).bind(consumable_quantity).bind(unit_cost_paise).bind(discount_bps).bind(discount_paise).bind(gst_percent).bind(taxable_paise).bind(tax_paise).execute(&mut **tx).await?.rows_affected() == 1)
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
    retail_quantity: i32,
    consumable_quantity: i32,
) -> Result<bool, sqlx::Error> {
    let updated = sqlx::query("UPDATE purchase_order_lines SET retail_received_quantity=retail_received_quantity+$5,consumable_received_quantity=consumable_received_quantity+$6,received_quantity=received_quantity+$5+$6 WHERE tenant_id=$1 AND branch_id=$2 AND purchase_order_id=$3 AND inventory_item_id=$4 AND retail_received_quantity+$5<=retail_quantity AND consumable_received_quantity+$6<=consumable_quantity")
        .bind(tenant_id).bind(branch_id).bind(order_id).bind(item_id).bind(retail_quantity).bind(consumable_quantity).execute(&mut **tx).await?.rows_affected()==1;
    Ok(updated)
}

pub async fn lock_order_line_for_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    order_id: &str,
    item_id: &str,
) -> Result<Option<LockedOrderLine>, sqlx::Error> {
    sqlx::query_as("SELECT quantity,received_quantity,retail_quantity,consumable_quantity,retail_received_quantity,consumable_received_quantity,unit_cost_paise,package_unit,stock_unit,units_per_package FROM purchase_order_lines WHERE tenant_id=$1 AND branch_id=$2 AND purchase_order_id=$3 AND inventory_item_id=$4 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(order_id).bind(item_id).fetch_optional(&mut **tx).await
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
        "SELECT return_row.id,return_row.purchase_receipt_id,receipt.supplier_name,return_row.reason,return_row.return_date,return_row.credit_note_number,return_row.credit_note_date,return_row.evidence_reference,return_row.taxable_paise,return_row.tax_paise,return_row.total_paise,return_row.created_at FROM purchase_returns return_row JOIN purchase_receipts receipt ON receipt.id=return_row.purchase_receipt_id AND receipt.tenant_id=return_row.tenant_id AND receipt.branch_id=return_row.branch_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND receipt.rolled_back_at IS NULL ORDER BY return_row.return_date DESC,return_row.created_at DESC"
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
    sqlx::query_as("SELECT line.id,line.inventory_item_id,line.units_per_package,line.stock_unit_cost_paise,line.quantity,line.unit_cost_paise,line.cgst_paise,line.sgst_paise,line.igst_paise,COALESCE((SELECT SUM(return_line.quantity) FROM purchase_return_lines return_line JOIN purchase_returns return_row ON return_row.id=return_line.purchase_return_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND return_row.purchase_receipt_id=$3 AND return_line.purchase_receipt_line_id=line.id),0)::BIGINT AS returned_quantity,COALESCE((SELECT SUM(return_line.tax_paise) FROM purchase_return_lines return_line JOIN purchase_returns return_row ON return_row.id=return_line.purchase_return_id WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND return_row.purchase_receipt_id=$3 AND return_line.purchase_receipt_line_id=line.id),0)::BIGINT AS returned_tax_paise,line.batch_number,item.batch_tracked FROM purchase_receipt_lines line JOIN purchase_receipts receipt ON receipt.id=line.purchase_receipt_id AND receipt.tenant_id=line.tenant_id AND receipt.branch_id=line.branch_id JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.purchase_receipt_id=$3 AND line.id=$4 AND receipt.rolled_back_at IS NULL FOR UPDATE OF line,item")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(line_id).fetch_optional(&mut **tx).await
}

pub async fn create_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    reason: &str,
    return_date: NaiveDate,
    credit_note_number: &str,
    credit_note_date: NaiveDate,
    evidence_reference: &str,
    taxable_paise: i64,
    tax_paise: i64,
    key: &str,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_returns(tenant_id,branch_id,purchase_receipt_id,supplier_id,reason,return_date,credit_note_number,credit_note_date,evidence_reference,taxable_paise,tax_paise,total_paise,idempotency_key,created_by) SELECT $1,$2,receipt.id,receipt.supplier_id,$4,$5,$6,$7,$8,$9,$10,$9+$10,$11,$12 FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.rolled_back_at IS NULL RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(reason).bind(return_date).bind(credit_note_number).bind(credit_note_date).bind(evidence_reference).bind(taxable_paise).bind(tax_paise).bind(key).bind(actor).fetch_one(&mut **tx).await
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
    supplier_id: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PayableRecord>, sqlx::Error> {
    let query = apply_purchase_list_pagination(
        r#"WITH quarantine_release_totals AS (
             SELECT quarantine.purchase_receipt_id,SUM(disposition.quantity::BIGINT*disposition.unit_cost_paise*CASE WHEN quarantine.quantity_basis='base_unit' THEN 1 ELSE GREATEST(line.units_per_package,1) END)::BIGINT AS released_paise
             FROM inventory_quarantine_dispositions disposition JOIN inventory_receiving_quarantine quarantine ON quarantine.id=disposition.quarantine_id AND quarantine.tenant_id=disposition.tenant_id AND quarantine.branch_id=disposition.branch_id JOIN purchase_receipt_lines line ON line.id=quarantine.purchase_receipt_line_id
             WHERE disposition.tenant_id=$1 AND disposition.branch_id=$2 AND disposition.action='release' GROUP BY quarantine.purchase_receipt_id
           ) SELECT * FROM (
             SELECT receipt.id AS purchase_receipt_id,'live_receipt'::TEXT AS source_type,
                    receipt.supplier_id,supplier.name AS supplier_name,receipt.supplier_invoice_number,
                    receipt.received_date,receipt.due_date,receipt.total_paise+COALESCE(release.released_paise,0) AS total_paise,
                    COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)::BIGINT AS returned_paise,
                    COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)::BIGINT AS paid_paise,
                    GREATEST(receipt.total_paise+COALESCE(release.released_paise,0)-COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0),0)::BIGINT AS balance_paise
               FROM purchase_receipts receipt JOIN suppliers supplier ON supplier.id=receipt.supplier_id
               LEFT JOIN quarantine_release_totals release ON release.purchase_receipt_id=receipt.id
              WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.rolled_back_at IS NULL
             UNION ALL
             SELECT 'opening:'||line.id,'opening_migration',line.supplier_id,supplier.name,
                    line.external_id,cutover.cutover_at::DATE,line.due_date,line.amount_paise,0::BIGINT,
                    COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND opening_payable_id=line.id),0)::BIGINT,
                    GREATEST(line.amount_paise-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND opening_payable_id=line.id),0),0)::BIGINT
               FROM supplier_opening_payables line
               JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id
               JOIN integration_migration_cutovers cutover ON cutover.id=opening.cutover_id
                AND cutover.tenant_id::TEXT=opening.tenant_id AND cutover.branch_id::TEXT=opening.branch_id
               JOIN suppliers supplier ON supplier.id=line.supplier_id
              WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.balance_side='credit'
                AND opening.applied_at IS NOT NULL AND opening.rolled_back_at IS NULL
           ) payable WHERE ($3='' OR supplier_id=$3)
           ORDER BY received_date DESC"#
            .to_string(),
        limit,
        offset,
    );
    sqlx::query_as(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(supplier_id.unwrap_or_default())
        .fetch_all(db)
        .await
}

pub async fn supplier_payment_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SupplierPaymentSummary, sqlx::Error> {
    let suppliers: Vec<SupplierPaymentMetricRecord> = sqlx::query_as(
        r#"WITH return_totals AS (
             SELECT purchase_receipt_id,SUM(total_paise)::BIGINT AS returned_paise
             FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 GROUP BY purchase_receipt_id
           ), quarantine_release_totals AS (
             SELECT quarantine.purchase_receipt_id,SUM(disposition.quantity::BIGINT*disposition.unit_cost_paise*CASE WHEN quarantine.quantity_basis='base_unit' THEN 1 ELSE GREATEST(line.units_per_package,1) END)::BIGINT AS released_paise
             FROM inventory_quarantine_dispositions disposition JOIN inventory_receiving_quarantine quarantine ON quarantine.id=disposition.quarantine_id AND quarantine.tenant_id=disposition.tenant_id AND quarantine.branch_id=disposition.branch_id JOIN purchase_receipt_lines line ON line.id=quarantine.purchase_receipt_line_id
             WHERE disposition.tenant_id=$1 AND disposition.branch_id=$2 AND disposition.action='release' GROUP BY quarantine.purchase_receipt_id
           ), payment_totals AS (
             SELECT purchase_receipt_id,SUM(amount_paise)::BIGINT AS paid_paise
             FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 GROUP BY purchase_receipt_id
           ), receipt_totals AS (
             SELECT receipt.supplier_id,
                    SUM(COALESCE(payment.paid_paise,0))::BIGINT AS paid_paise,
                    SUM(GREATEST(receipt.total_paise+COALESCE(release.released_paise,0)-COALESCE(ret.returned_paise,0)-COALESCE(payment.paid_paise,0),0))::BIGINT AS unpaid_paise
             FROM purchase_receipts receipt
             LEFT JOIN return_totals ret ON ret.purchase_receipt_id=receipt.id
             LEFT JOIN payment_totals payment ON payment.purchase_receipt_id=receipt.id
             LEFT JOIN quarantine_release_totals release ON release.purchase_receipt_id=receipt.id
             WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.supplier_id IS NOT NULL AND receipt.rolled_back_at IS NULL
             GROUP BY receipt.supplier_id
           ), advance_totals AS (
             SELECT supplier_id,SUM(amount_paise)::BIGINT AS extra_paid_paise
             FROM supplier_advances WHERE tenant_id=$1 AND branch_id=$2 GROUP BY supplier_id
           ), opening_totals AS (
             SELECT line.supplier_id,
                    COALESCE(SUM(CASE WHEN line.balance_side='credit' THEN
                      GREATEST(line.amount_paise-COALESCE((SELECT SUM(payment.amount_paise) FROM supplier_payments payment
                        WHERE payment.tenant_id=line.tenant_id AND payment.branch_id=line.branch_id
                          AND payment.opening_payable_id=line.id),0),0) ELSE 0 END),0)::BIGINT AS unpaid_paise,
                    COALESCE(SUM(CASE WHEN line.balance_side='credit' THEN
                      COALESCE((SELECT SUM(payment.amount_paise) FROM supplier_payments payment
                        WHERE payment.tenant_id=line.tenant_id AND payment.branch_id=line.branch_id
                          AND payment.opening_payable_id=line.id),0) ELSE 0 END),0)::BIGINT AS paid_paise,
                    COALESCE(SUM(line.amount_paise) FILTER(WHERE line.balance_side='debit'),0)::BIGINT AS extra_paid_paise
               FROM supplier_opening_payables line
               JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id
              WHERE line.tenant_id=$1 AND line.branch_id=$2
                AND opening.applied_at IS NOT NULL AND opening.rolled_back_at IS NULL
              GROUP BY line.supplier_id
           ), pending_totals AS (
             SELECT supplier_id,COUNT(*)::BIGINT AS pending_bill_count,
                    COALESCE(SUM(total_paise),0)::BIGINT AS pending_bills_paise
               FROM purchase_bill_drafts
              WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id IS NOT NULL
                AND purchase_receipt_id IS NULL AND status NOT IN ('confirmed','cancelled')
              GROUP BY supplier_id
           )
           SELECT supplier.id AS supplier_id,
                  (COALESCE(receipt.paid_paise,0)+COALESCE(opening.paid_paise,0))::BIGINT AS paid_paise,
                  (COALESCE(receipt.unpaid_paise,0)+COALESCE(opening.unpaid_paise,0))::BIGINT AS unpaid_paise,
                  (COALESCE(advance.extra_paid_paise,0)+COALESCE(opening.extra_paid_paise,0))::BIGINT AS extra_paid_paise,
                  COALESCE(pending.pending_bill_count,0)::BIGINT AS pending_bill_count,
                  COALESCE(pending.pending_bills_paise,0)::BIGINT AS pending_bills_paise
           FROM suppliers supplier
           LEFT JOIN receipt_totals receipt ON receipt.supplier_id=supplier.id
           LEFT JOIN advance_totals advance ON advance.supplier_id=supplier.id
           LEFT JOIN opening_totals opening ON opening.supplier_id=supplier.id
           LEFT JOIN pending_totals pending ON pending.supplier_id=supplier.id
           WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await?;
    Ok(SupplierPaymentSummary {
        paid_paise: suppliers.iter().map(|row| row.paid_paise).sum(),
        unpaid_paise: suppliers.iter().map(|row| row.unpaid_paise).sum(),
        extra_paid_paise: suppliers.iter().map(|row| row.extra_paid_paise).sum(),
        pending_bills_paise: suppliers.iter().map(|row| row.pending_bills_paise).sum(),
        suppliers,
    })
}

pub async fn supplier_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
) -> Result<Option<SupplierLedgerResponse>, sqlx::Error> {
    let Some(supplier) = get_supplier(db, tenant_id, branch_id, supplier_id).await? else {
        return Ok(None);
    };
    let payables = list_payables(db, tenant_id, branch_id, Some(supplier_id), None, None).await?;
    let bills_paise = payables
        .iter()
        .map(|row| (row.total_paise - row.returned_paise).max(0))
        .sum();
    let metric = supplier_payment_summary(db, tenant_id, branch_id)
        .await?
        .suppliers
        .into_iter()
        .find(|row| row.supplier_id == supplier_id)
        .unwrap_or(SupplierPaymentMetricRecord {
            supplier_id: supplier_id.to_string(),
            paid_paise: 0,
            unpaid_paise: 0,
            extra_paid_paise: 0,
            pending_bill_count: 0,
            pending_bills_paise: 0,
        });
    let entries = sqlx::query_as(
        r#"WITH ledger_entries AS (
             SELECT 'bill:'||receipt.id AS id,'purchase_bill'::TEXT AS entry_type,
                    receipt.supplier_invoice_date AS entry_date,
                    receipt.supplier_invoice_date::TIMESTAMP AT TIME ZONE 'UTC' AS posted_at,
                    10 AS sort_order,'Purchase bill'::TEXT AS particulars,
                    COALESCE(NULLIF(receipt.supplier_invoice_number,''),receipt.grr_number) AS reference,
                    0::BIGINT AS debit_paise,receipt.total_paise::BIGINT AS credit_paise
               FROM purchase_receipts receipt
              WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.supplier_id=$3
                AND receipt.rolled_back_at IS NULL
             UNION ALL
             SELECT 'return:'||return_row.id,'purchase_return',return_row.created_at::DATE,
                    return_row.created_at,20,'Purchase return',
                    COALESCE(NULLIF(receipt.supplier_invoice_number,''),return_row.id),
                    return_row.total_paise::BIGINT,0::BIGINT
               FROM purchase_returns return_row
               JOIN purchase_receipts receipt ON receipt.id=return_row.purchase_receipt_id
                AND receipt.tenant_id=return_row.tenant_id AND receipt.branch_id=return_row.branch_id
              WHERE return_row.tenant_id=$1 AND return_row.branch_id=$2 AND receipt.supplier_id=$3
                AND receipt.rolled_back_at IS NULL
             UNION ALL
             SELECT 'payment:'||payment.id,'supplier_payment',payment.paid_at::DATE,
                    payment.paid_at,30,'Supplier payment',
                    COALESCE(NULLIF(payment.reference,''),NULLIF(receipt.supplier_invoice_number,''),
                             NULLIF(opening.external_id,''),'Payment'),
                    payment.amount_paise::BIGINT,0::BIGINT
               FROM supplier_payments payment
               LEFT JOIN purchase_receipts receipt ON receipt.id=payment.purchase_receipt_id
                AND receipt.tenant_id=payment.tenant_id AND receipt.branch_id=payment.branch_id
               LEFT JOIN supplier_opening_payables opening ON opening.id=payment.opening_payable_id
                AND opening.tenant_id=payment.tenant_id AND opening.branch_id=payment.branch_id
              WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND payment.supplier_id=$3
             UNION ALL
             SELECT 'advance:'||advance.id,'supplier_advance',advance.paid_at::DATE,
                    advance.paid_at,40,'Supplier advance',
                    COALESCE(NULLIF(advance.reference,''),'Advance payment'),
                    advance.amount_paise::BIGINT,0::BIGINT
               FROM supplier_advances advance
              WHERE advance.tenant_id=$1 AND advance.branch_id=$2 AND advance.supplier_id=$3
             UNION ALL
             SELECT 'opening:'||line.id,
                    CASE WHEN line.balance_side='credit' THEN 'opening_payable' ELSE 'opening_advance' END,
                    line.created_at::DATE,line.created_at,0,
                    CASE WHEN line.balance_side='credit' THEN 'Opening payable' ELSE 'Opening advance' END,
                    COALESCE(NULLIF(line.external_id,''),'Opening balance'),
                    CASE WHEN line.balance_side='debit' THEN line.amount_paise ELSE 0 END::BIGINT,
                    CASE WHEN line.balance_side='credit' THEN line.amount_paise ELSE 0 END::BIGINT
               FROM supplier_opening_payables line
               JOIN supplier_opening_payable_imports opening_import ON opening_import.id=line.opening_import_id
              WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.supplier_id=$3
                AND opening_import.applied_at IS NOT NULL AND opening_import.rolled_back_at IS NULL
           ), balanced AS (
             SELECT *,SUM(credit_paise-debit_paise) OVER (
                      ORDER BY posted_at,sort_order,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )::BIGINT AS balance_paise
               FROM ledger_entries
           )
           SELECT id,entry_type,entry_date,particulars,reference,debit_paise,credit_paise,balance_paise
             FROM balanced ORDER BY posted_at DESC,sort_order DESC,id DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(supplier_id)
    .fetch_all(db)
    .await?;
    let pending_bills = sqlx::query_as(
        r#"SELECT id,bill_number,bill_date,total_paise,status
             FROM purchase_bill_drafts
            WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3
              AND purchase_receipt_id IS NULL AND status NOT IN ('confirmed','cancelled')
            ORDER BY created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(supplier_id)
    .fetch_all(db)
    .await?;
    Ok(Some(SupplierLedgerResponse {
        supplier,
        summary: SupplierLedgerSummary {
            bills_paise,
            paid_paise: metric.paid_paise,
            outstanding_paise: metric.unpaid_paise,
            advance_paise: metric.extra_paid_paise,
            pending_bills_paise: metric.pending_bills_paise,
        },
        payables,
        pending_bills,
        entries,
    }))
}

pub async fn payable_balance_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
) -> Result<Option<i64>, sqlx::Error> {
    if let Some(opening_id) = receipt_id.strip_prefix("opening:") {
        return sqlx::query_scalar(
            "SELECT GREATEST(line.amount_paise-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND opening_payable_id=line.id),0),0)::BIGINT FROM supplier_opening_payables line JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.id=$3 AND line.balance_side='credit' AND opening.applied_at IS NOT NULL AND opening.rolled_back_at IS NULL FOR UPDATE OF line",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(opening_id)
        .fetch_optional(&mut **tx)
        .await;
    }
    sqlx::query_scalar("SELECT GREATEST(receipt.total_paise+COALESCE((SELECT SUM(disposition.quantity::BIGINT*disposition.unit_cost_paise*CASE WHEN quarantine.quantity_basis='base_unit' THEN 1 ELSE GREATEST(line.units_per_package,1) END) FROM inventory_quarantine_dispositions disposition JOIN inventory_receiving_quarantine quarantine ON quarantine.id=disposition.quarantine_id JOIN purchase_receipt_lines line ON line.id=quarantine.purchase_receipt_line_id WHERE disposition.tenant_id=$1 AND disposition.branch_id=$2 AND disposition.action='release' AND quarantine.purchase_receipt_id=receipt.id),0)-COALESCE((SELECT SUM(total_paise) FROM purchase_returns WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0)-COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND purchase_receipt_id=receipt.id),0),0)::BIGINT FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.supplier_id IS NOT NULL AND receipt.rolled_back_at IS NULL FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).fetch_optional(&mut **tx).await
}

pub async fn supplier_payment_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<SupplierPaymentRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,supplier_id,COALESCE(purchase_receipt_id,'opening:'||opening_payable_id) purchase_receipt_id,amount_paise,payment_method,reference,paid_at FROM supplier_payments WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
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
    if let Some(opening_id) = receipt_id.strip_prefix("opening:") {
        return sqlx::query_as("INSERT INTO supplier_payments(tenant_id,branch_id,supplier_id,opening_payable_id,amount_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,line.supplier_id,line.id,$4,$5,$6,$7,$8 FROM supplier_opening_payables line JOIN supplier_opening_payable_imports opening ON opening.id=line.opening_import_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.id=$3 AND line.balance_side='credit' AND opening.applied_at IS NOT NULL AND opening.rolled_back_at IS NULL RETURNING id,supplier_id,'opening:'||opening_payable_id AS purchase_receipt_id,amount_paise,payment_method,reference,paid_at")
            .bind(tenant_id).bind(branch_id).bind(opening_id).bind(amount_paise).bind(method).bind(reference).bind(key).bind(actor).fetch_optional(&mut **tx).await;
    }
    sqlx::query_as("INSERT INTO supplier_payments(tenant_id,branch_id,supplier_id,purchase_receipt_id,amount_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,receipt.supplier_id,receipt.id,$4,$5,$6,$7,$8 FROM purchase_receipts receipt WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.id=$3 AND receipt.supplier_id IS NOT NULL AND receipt.rolled_back_at IS NULL RETURNING id,supplier_id,purchase_receipt_id,amount_paise,payment_method,reference,paid_at")
        .bind(tenant_id).bind(branch_id).bind(receipt_id).bind(amount_paise).bind(method).bind(reference).bind(key).bind(actor).fetch_optional(&mut **tx).await
}

pub async fn supplier_advance_replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<SupplierAdvanceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,supplier_id,amount_paise,payment_method,reference,paid_at FROM supplier_advances WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_supplier_advance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    supplier_id: &str,
    amount_paise: i64,
    method: &str,
    reference: &str,
    key: &str,
    actor: &str,
) -> Result<Option<SupplierAdvanceRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO supplier_advances(tenant_id,branch_id,supplier_id,amount_paise,payment_method,reference,idempotency_key,paid_by) SELECT $1,$2,supplier.id,$4,$5,$6,$7,$8 FROM suppliers supplier WHERE supplier.tenant_id=$1 AND supplier.branch_id=$2 AND supplier.id=$3 RETURNING id,supplier_id,amount_paise,payment_method,reference,paid_at")
        .bind(tenant_id).bind(branch_id).bind(supplier_id).bind(amount_paise).bind(method).bind(reference).bind(key).bind(actor).fetch_optional(&mut **tx).await
}
