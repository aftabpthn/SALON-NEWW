use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub id: String,
    pub status: String,
    pub source_file_name: String,
    pub source_content_type: String,
    pub source_sha256: String,
    pub source_size_bytes: i64,
    pub supplier_id: Option<String>,
    pub purchase_order_id: Option<String>,
    pub purchase_receipt_id: Option<String>,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub bill_number: String,
    pub bill_date: Option<NaiveDate>,
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub confidence_bps: i32,
    pub warnings: Value,
    pub field_evidence: Value,
    pub version: i32,
    pub created_by: String,
    pub confirmed_by: Option<String>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftLineRecord {
    pub id: String,
    pub line_number: i32,
    pub raw_name: String,
    pub supplier_sku: String,
    pub inventory_item_id: Option<String>,
    pub hsn_sac: String,
    pub purchase_quantity: i32,
    pub pack_size: i32,
    pub conversion_factor: i32,
    pub quantity: i32,
    pub unit_cost_paise: i64,
    pub discount_bps: i32,
    pub discount_paise: i64,
    pub gst_percent: i32,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub batch_number: String,
    pub expiry_date: Option<NaiveDate>,
    pub confidence_bps: i32,
    pub warnings: Value,
    pub field_evidence: Value,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionRecord {
    pub id: String,
    pub provider: String,
    pub model_version: String,
    pub status: String,
    pub raw_response: Value,
    pub error_message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRecord {
    pub id: String,
    pub draft_line_id: Option<String>,
    pub match_type: String,
    pub matched_entity_id: String,
    pub score_bps: i32,
    pub status: String,
    pub evidence: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEventRecord {
    pub id: String,
    pub event_type: String,
    pub actor_user_id: String,
    pub details: Value,
    pub created_at: DateTime<Utc>,
}

pub struct ExtractedDraftData<'a> {
    pub supplier_name: &'a str,
    pub supplier_gstin: &'a str,
    pub bill_number: &'a str,
    pub bill_date: Option<NaiveDate>,
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub confidence_bps: i32,
    pub warnings: &'a Value,
    pub field_evidence: &'a Value,
}

pub struct DraftLineData<'a> {
    pub raw_name: &'a str,
    pub supplier_sku: &'a str,
    pub inventory_item_id: Option<&'a str>,
    pub hsn_sac: &'a str,
    pub purchase_quantity: i32,
    pub pack_size: i32,
    pub conversion_factor: i32,
    pub quantity: i32,
    pub unit_cost_paise: i64,
    pub discount_bps: i32,
    pub discount_paise: i64,
    pub gst_percent: i32,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub batch_number: &'a str,
    pub expiry_date: Option<NaiveDate>,
    pub confidence_bps: i32,
    pub warnings: &'a Value,
    pub field_evidence: &'a Value,
}

const DRAFT_COLUMNS: &str = "id,status,source_file_name,source_content_type,source_sha256,source_size_bytes,supplier_id,purchase_order_id,purchase_receipt_id,supplier_name,supplier_gstin,bill_number,bill_date,subtotal_paise,discount_paise,cgst_paise,sgst_paise,igst_paise,total_paise,confidence_bps,warnings,field_evidence,version,created_by,confirmed_by,confirmed_at,created_at,updated_at";

pub async fn list(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: &str,
) -> Result<Vec<DraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR status=$3) ORDER BY created_at DESC LIMIT 200"))
        .bind(tenant).bind(branch).bind(status).fetch_all(db).await
}

pub async fn get(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<DraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"))
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn by_hash(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sha256: &str,
) -> Result<Option<DraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts WHERE tenant_id=$1 AND branch_id=$2 AND source_sha256=$3"))
        .bind(tenant).bind(branch).bind(sha256).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    file_name: &str,
    content_type: &str,
    sha256: &str,
    bytes: &[u8],
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_bill_drafts(tenant_id,branch_id,status,source_file_name,source_content_type,source_sha256,source_size_bytes,source_bytes,created_by) VALUES($1,$2,'extracting',$3,$4,$5,$6,$7,$8) RETURNING id")
        .bind(tenant).bind(branch).bind(file_name).bind(content_type).bind(sha256)
        .bind(bytes.len() as i64).bind(bytes).bind(actor).fetch_one(&mut **tx).await
}

pub async fn lines(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<Vec<DraftLineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,line_number,raw_name,supplier_sku,inventory_item_id,hsn_sac,purchase_quantity,pack_size,conversion_factor,quantity,unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,expiry_date,confidence_bps,warnings,field_evidence FROM purchase_bill_draft_lines WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY line_number")
        .bind(tenant).bind(branch).bind(draft).fetch_all(db).await
}

pub async fn extractions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<Vec<ExtractionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,provider,model_version,status,raw_response,error_message,created_at FROM purchase_bill_extractions WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).bind(draft).fetch_all(db).await
}

pub async fn matches(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<Vec<MatchRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,draft_line_id,match_type,matched_entity_id,score_bps,status,evidence,created_at FROM purchase_bill_matches WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).bind(draft).fetch_all(db).await
}

pub async fn events(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<Vec<DraftEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,actor_user_id,details,created_at FROM purchase_bill_draft_events WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).bind(draft).fetch_all(db).await
}

pub async fn add_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    draft: &str,
    event_type: &str,
    actor: &str,
    details: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO purchase_bill_draft_events(tenant_id,branch_id,draft_id,event_type,actor_user_id,details) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant).bind(branch).bind(draft).bind(event_type).bind(actor).bind(details)
        .execute(&mut **tx).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn complete_extraction(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    draft: &str,
    provider: &str,
    model_version: &str,
    data: &ExtractedDraftData<'_>,
    raw: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO purchase_bill_extractions(tenant_id,branch_id,draft_id,provider,model_version,status,raw_response) VALUES($1,$2,$3,$4,$5,'succeeded',$6)")
        .bind(tenant).bind(branch).bind(draft).bind(provider).bind(model_version).bind(raw)
        .execute(&mut **tx).await?;
    sqlx::query("UPDATE purchase_bill_drafts SET status='review',supplier_name=$4,supplier_gstin=$5,bill_number=$6,bill_date=$7,subtotal_paise=$8,discount_paise=$9,cgst_paise=$10,sgst_paise=$11,igst_paise=$12,total_paise=$13,confidence_bps=$14,warnings=$15,field_evidence=$16,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='extracting'")
        .bind(tenant).bind(branch).bind(draft).bind(data.supplier_name).bind(data.supplier_gstin)
        .bind(data.bill_number).bind(data.bill_date).bind(data.subtotal_paise).bind(data.discount_paise)
        .bind(data.cgst_paise).bind(data.sgst_paise).bind(data.igst_paise).bind(data.total_paise)
        .bind(data.confidence_bps).bind(data.warnings).bind(data.field_evidence)
        .execute(&mut **tx).await?;
    Ok(())
}

pub async fn fail_extraction(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    draft: &str,
    provider: &str,
    error: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    let warnings =
        serde_json::json!(["AI extraction unavailable; review and enter the bill manually"]);
    sqlx::query("INSERT INTO purchase_bill_extractions(tenant_id,branch_id,draft_id,provider,status,error_message) VALUES($1,$2,$3,$4,'failed',$5)")
        .bind(tenant).bind(branch).bind(draft).bind(provider).bind(error).execute(&mut **tx).await?;
    sqlx::query("UPDATE purchase_bill_drafts SET status='extraction_failed',warnings=$4,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(draft).bind(&warnings).execute(&mut **tx).await?;
    add_event(
        tx,
        tenant,
        branch,
        draft,
        "extraction_failed",
        actor,
        &serde_json::json!({"error":error}),
    )
    .await
}

pub async fn insert_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    draft: &str,
    line_number: i32,
    line: &DraftLineData<'_>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO purchase_bill_draft_lines(tenant_id,branch_id,draft_id,line_number,raw_name,supplier_sku,inventory_item_id,hsn_sac,purchase_quantity,pack_size,conversion_factor,quantity,unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,expiry_date,confidence_bps,warnings,field_evidence) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id")
        .bind(tenant).bind(branch).bind(draft).bind(line_number).bind(line.raw_name).bind(line.supplier_sku)
        .bind(line.inventory_item_id.unwrap_or_default()).bind(line.hsn_sac).bind(line.purchase_quantity)
        .bind(line.pack_size).bind(line.conversion_factor).bind(line.quantity).bind(line.unit_cost_paise)
        .bind(line.discount_bps).bind(line.discount_paise).bind(line.gst_percent).bind(line.taxable_paise)
        .bind(line.cgst_paise).bind(line.sgst_paise).bind(line.igst_paise).bind(line.total_paise)
        .bind(line.batch_number).bind(line.expiry_date).bind(line.confidence_bps).bind(line.warnings)
        .bind(line.field_evidence).fetch_one(&mut **tx).await
}

pub async fn update_header(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    supplier_id: Option<&str>,
    purchase_order_id: Option<&str>,
    supplier_name: &str,
    supplier_gstin: &str,
    bill_number: &str,
    bill_date: Option<NaiveDate>,
    subtotal: i64,
    discount: i64,
    cgst: i64,
    sgst: i64,
    igst: i64,
    total: i64,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_drafts SET supplier_id=NULLIF($4,''),purchase_order_id=NULLIF($5,''),supplier_name=$6,supplier_gstin=$7,bill_number=$8,bill_date=$9,subtotal_paise=$10,discount_paise=$11,cgst_paise=$12,sgst_paise=$13,igst_paise=$14,total_paise=$15,status='review',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('review','extraction_failed')")
        .bind(tenant).bind(branch).bind(draft).bind(supplier_id.unwrap_or_default()).bind(purchase_order_id.unwrap_or_default())
        .bind(supplier_name).bind(supplier_gstin).bind(bill_number).bind(bill_date).bind(subtotal).bind(discount)
        .bind(cgst).bind(sgst).bind(igst).bind(total).execute(db).await?.rows_affected()==1)
}

pub async fn update_line(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    id: &str,
    line: &DraftLineData<'_>,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_draft_lines line SET raw_name=$6,supplier_sku=$7,inventory_item_id=NULLIF($8,''),hsn_sac=$9,purchase_quantity=$10,pack_size=$11,conversion_factor=$12,quantity=$13,unit_cost_paise=$14,discount_bps=$15,discount_paise=$16,gst_percent=$17,taxable_paise=$18,cgst_paise=$19,sgst_paise=$20,igst_paise=$21,total_paise=$22,batch_number=$23,expiry_date=$24,updated_at=NOW() FROM purchase_bill_drafts draft_row WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.draft_id=$3 AND line.id=$4 AND draft_row.id=line.draft_id AND draft_row.status IN ('review','extraction_failed') AND $5<>''")
        .bind(tenant).bind(branch).bind(draft).bind(id).bind(id).bind(line.raw_name).bind(line.supplier_sku)
        .bind(line.inventory_item_id.unwrap_or_default()).bind(line.hsn_sac).bind(line.purchase_quantity)
        .bind(line.pack_size).bind(line.conversion_factor).bind(line.quantity).bind(line.unit_cost_paise)
        .bind(line.discount_bps).bind(line.discount_paise).bind(line.gst_percent).bind(line.taxable_paise)
        .bind(line.cgst_paise).bind(line.sgst_paise).bind(line.igst_paise).bind(line.total_paise)
        .bind(line.batch_number).bind(line.expiry_date).execute(db).await?.rows_affected()==1)
}

pub async fn next_line_number(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(MAX(line_number),0)+1 FROM purchase_bill_draft_lines WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3")
        .bind(tenant).bind(branch).bind(draft).fetch_one(db).await
}

pub async fn delete_line(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM purchase_bill_draft_lines line USING purchase_bill_drafts draft_row WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.draft_id=$3 AND line.id=$4 AND draft_row.id=line.draft_id AND draft_row.status IN ('review','extraction_failed')")
        .bind(tenant).bind(branch).bind(draft).bind(id).execute(db).await?.rows_affected()==1)
}

pub async fn exact_supplier(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    gstin: &str,
    name: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND ((BTRIM($3)<>'' AND UPPER(gstin)=UPPER(BTRIM($3))) OR (BTRIM($4)<>'' AND LOWER(name)=LOWER(BTRIM($4)))) ORDER BY CASE WHEN UPPER(gstin)=UPPER(BTRIM($3)) THEN 0 ELSE 1 END LIMIT 1")
        .bind(tenant).bind(branch).bind(gstin).bind(name).fetch_optional(db).await
}

pub async fn exact_inventory_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier_sku: &str,
    raw_name: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND ((BTRIM($3)<>'' AND (UPPER(sku)=UPPER(BTRIM($3)) OR UPPER(barcode)=UPPER(BTRIM($3)))) OR (BTRIM($4)<>'' AND LOWER(name)=LOWER(BTRIM($4)))) ORDER BY CASE WHEN UPPER(sku)=UPPER(BTRIM($3)) OR UPPER(barcode)=UPPER(BTRIM($3)) THEN 0 ELSE 1 END LIMIT 1")
        .bind(tenant).bind(branch).bind(supplier_sku).bind(raw_name).fetch_optional(db).await
}

pub async fn candidate_order(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: &str,
    total: i64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM purchase_orders WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3 AND status IN ('approved','partially_received') ORDER BY ABS(total_paise-$4),created_at DESC LIMIT 1")
        .bind(tenant).bind(branch).bind(supplier).bind(total).fetch_optional(db).await
}

pub async fn set_supplier(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    supplier: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_bill_drafts SET supplier_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(draft).bind(supplier).execute(db).await?;
    Ok(())
}

pub async fn set_line_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    line: &str,
    item: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_bill_draft_lines SET inventory_item_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(line).bind(item).execute(db).await?;
    Ok(())
}

pub async fn set_order(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    order: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_bill_drafts SET purchase_order_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(draft).bind(order).execute(db).await?;
    Ok(())
}

pub async fn clear_suggested_matches(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM purchase_bill_matches WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 AND status='suggested'")
        .bind(tenant).bind(branch).bind(draft).execute(db).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn add_match(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    line: Option<&str>,
    match_type: &str,
    entity: &str,
    score: i32,
    status: &str,
    evidence: &Value,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO purchase_bill_matches(tenant_id,branch_id,draft_id,draft_line_id,match_type,matched_entity_id,score_bps,status,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(tenant).bind(branch).bind(draft).bind(line).bind(match_type).bind(entity).bind(score)
        .bind(status).bind(evidence).bind(actor).execute(db).await?;
    Ok(())
}

pub async fn cancel(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_drafts SET status='cancelled',cancelled_by=$4,cancelled_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status NOT IN ('confirmed','cancelled')")
        .bind(tenant).bind(branch).bind(draft).bind(actor).execute(db).await?.rows_affected()==1)
}

pub async fn confirm(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    receipt: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_drafts SET status='confirmed',purchase_receipt_id=$4,confirmed_by=$5,confirmed_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('review','extraction_failed')")
        .bind(tenant).bind(branch).bind(draft).bind(receipt).bind(actor).execute(db).await?.rows_affected()==1)
}
