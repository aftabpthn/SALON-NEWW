use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool, Postgres, Row, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRecord {
    pub id: String,
    pub status: String,
    pub workflow_mode: String,
    pub source_file_name: String,
    pub source_content_type: String,
    pub source_sha256: String,
    pub source_size_bytes: i64,
    pub migration_source_file_id: Option<String>,
    pub migration_source_artifact_id: Option<String>,
    pub migration_cutover_id: Option<String>,
    pub supplier_id: Option<String>,
    pub purchase_order_id: Option<String>,
    pub purchase_receipt_id: Option<String>,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_phone: String,
    pub supplier_email: String,
    pub supplier_address: String,
    pub bill_contract: Value,
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
    pub review_decision: String,
    pub review_reason: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct BulkEvidenceDocument {
    pub source_file_id: String,
    pub source_artifact_id: Option<String>,
    pub page_count: i32,
}

#[derive(Debug, FromRow)]
pub struct ClaimedBulkDocument {
    pub item_id: String,
    pub job_id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub draft_id: String,
    pub actor_user_id: String,
    pub attempts: i32,
}

fn historical_bulk_external_id(
    source_sha256: &str,
    supplier_gstin: &str,
    supplier_name: &str,
    invoice_number: &str,
    invoice_date: NaiveDate,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!(
            "{}|{}|{}|{}|{}",
            source_sha256,
            supplier_gstin.to_ascii_uppercase(),
            supplier_name.to_ascii_lowercase(),
            invoice_number.to_ascii_lowercase(),
            invoice_date
        ))
    )
}

fn historical_bulk_financially_reconciled(
    line_total: i64,
    reviewed_total: i64,
    review_reason: &str,
) -> bool {
    let difference = (line_total - reviewed_total).abs();
    difference == 0 || (difference <= 100 && !review_reason.trim().is_empty())
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
    pub product_contract: Value,
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

#[derive(Debug, FromRow)]
pub struct DraftSourceRecord {
    pub content_type: String,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryCandidateRecord {
    pub id: String,
    pub name: String,
    pub sku: String,
    pub category: String,
    pub brand: String,
    pub hsn_code: String,
    pub barcode: String,
}

pub struct LinkedProductData<'a> {
    pub sku: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub brand: &'a str,
    pub unit: &'a str,
    pub package_unit: &'a str,
    pub units_per_package: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: &'a str,
    pub gst_percent: i32,
    pub barcode: &'a str,
    pub batch_tracked: bool,
}

pub struct ExtractedDraftData<'a> {
    pub supplier_name: &'a str,
    pub supplier_gstin: &'a str,
    pub supplier_phone: &'a str,
    pub supplier_email: &'a str,
    pub supplier_address: &'a str,
    pub bill_contract: &'a Value,
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
    pub product_contract: &'a Value,
    pub confidence_bps: i32,
    pub warnings: &'a Value,
    pub field_evidence: &'a Value,
}

const DRAFT_COLUMNS: &str = "id,status,workflow_mode,source_file_name,source_content_type,source_sha256,source_size_bytes,migration_source_file_id,migration_source_artifact_id,migration_cutover_id,supplier_id,purchase_order_id,purchase_receipt_id,supplier_name,supplier_gstin,supplier_phone,supplier_email,supplier_address,bill_contract,bill_number,bill_date,subtotal_paise,discount_paise,cgst_paise,sgst_paise,igst_paise,total_paise,confidence_bps,warnings,field_evidence,version,created_by,confirmed_by,confirmed_at,review_decision,review_reason,reviewed_by,reviewed_at,created_at,updated_at";

pub async fn list(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: &str,
    workflow_mode: &str,
) -> Result<Vec<DraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR status=$3) AND ($4='' OR workflow_mode=$4) ORDER BY created_at DESC LIMIT 200"))
        .bind(tenant).bind(branch).bind(status).bind(workflow_mode).fetch_all(db).await
}

pub async fn list_historical_pilot_only(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<DraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts draft
         WHERE tenant_id=$1 AND branch_id=$2 AND workflow_mode='historical_pilot'
           AND NOT EXISTS(
             SELECT 1 FROM historical_purchase_archive_items item
             WHERE item.draft_id=draft.id AND NOT item.pilot_document
           )
         ORDER BY created_at DESC LIMIT 200"
    ))
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await
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

pub async fn source(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<DraftSourceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT source_content_type AS content_type, source_bytes AS bytes FROM purchase_bill_drafts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn create_historical_pilot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
    source_file_id: &str,
    source_artifact_id: Option<&str>,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO purchase_bill_drafts(
           tenant_id,branch_id,status,workflow_mode,source_file_name,source_content_type,
           source_sha256,source_size_bytes,source_bytes,migration_source_file_id,
           migration_source_artifact_id,migration_cutover_id,created_by
         )
         SELECT
           evidence.tenant_id,evidence.branch_id,'extracting','historical_pilot',
           COALESCE(artifact.entry_name,source.original_file_name),
           COALESCE(artifact.detected_content_type,source.detected_content_type),
           COALESCE(artifact.sha256,source.sha256),
           COALESCE(artifact.size_bytes,source.size_bytes),
           NULL,source.id,artifact.id,evidence.cutover_id,$6
         FROM historical_purchase_evidence_items evidence
         JOIN integration_import_source_files source
           ON source.tenant_id=evidence.tenant_id
          AND source.branch_id=evidence.branch_id
          AND source.id=evidence.source_file_id
         LEFT JOIN integration_import_source_artifacts artifact
           ON artifact.tenant_id=evidence.tenant_id
          AND artifact.branch_id=evidence.branch_id
          AND artifact.source_file_id=source.id
          AND artifact.id=NULLIF($5,'')
         WHERE evidence.tenant_id=$1
           AND evidence.branch_id=$2
           AND evidence.cutover_id=$3
           AND evidence.source_file_id=$4
           AND evidence.evidence_kind='historical_bill'
           AND source.evidence_status='verified'
           AND source.read_only=TRUE
           AND source.retention_until>NOW()
           AND ($5='' OR artifact.id IS NOT NULL)
         RETURNING id",
    )
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .bind(source_file_id)
    .bind(source_artifact_id.unwrap_or_default())
    .bind(actor)
    .fetch_one(&mut **tx)
    .await
}

pub async fn begin_extraction_retry(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_drafts SET status='extracting',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('extraction_failed','review') AND NOT EXISTS(SELECT 1 FROM purchase_bill_draft_lines line WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.draft_id=$3)")
        .bind(tenant).bind(branch).bind(draft).execute(db).await?.rows_affected()==1)
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
    sqlx::query_as("SELECT id,line_number,raw_name,supplier_sku,inventory_item_id,hsn_sac,purchase_quantity,pack_size,conversion_factor,quantity,unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,expiry_date,product_contract,confidence_bps,warnings,field_evidence FROM purchase_bill_draft_lines WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY line_number")
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
    sqlx::query("UPDATE purchase_bill_drafts SET status='review',supplier_name=$4,supplier_gstin=$5,supplier_phone=$6,supplier_email=$7,supplier_address=$8,bill_contract=$9,bill_number=$10,bill_date=$11,subtotal_paise=$12,discount_paise=$13,cgst_paise=$14,sgst_paise=$15,igst_paise=$16,total_paise=$17,confidence_bps=$18,warnings=$19,field_evidence=$20,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='extracting'")
        .bind(tenant).bind(branch).bind(draft).bind(data.supplier_name).bind(data.supplier_gstin)
        .bind(data.supplier_phone).bind(data.supplier_email).bind(data.supplier_address).bind(data.bill_contract)
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
    sqlx::query_scalar("INSERT INTO purchase_bill_draft_lines(tenant_id,branch_id,draft_id,line_number,raw_name,supplier_sku,inventory_item_id,hsn_sac,purchase_quantity,pack_size,conversion_factor,quantity,unit_cost_paise,discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,expiry_date,product_contract,confidence_bps,warnings,field_evidence) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING id")
        .bind(tenant).bind(branch).bind(draft).bind(line_number).bind(line.raw_name).bind(line.supplier_sku)
        .bind(line.inventory_item_id.unwrap_or_default()).bind(line.hsn_sac).bind(line.purchase_quantity)
        .bind(line.pack_size).bind(line.conversion_factor).bind(line.quantity).bind(line.unit_cost_paise)
        .bind(line.discount_bps).bind(line.discount_paise).bind(line.gst_percent).bind(line.taxable_paise)
        .bind(line.cgst_paise).bind(line.sgst_paise).bind(line.igst_paise).bind(line.total_paise)
        .bind(line.batch_number).bind(line.expiry_date).bind(line.product_contract).bind(line.confidence_bps).bind(line.warnings)
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
    supplier_phone: &str,
    supplier_email: &str,
    supplier_address: &str,
    bill_contract: &Value,
    bill_number: &str,
    bill_date: Option<NaiveDate>,
    subtotal: i64,
    discount: i64,
    cgst: i64,
    sgst: i64,
    igst: i64,
    total: i64,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_bill_drafts SET supplier_id=NULLIF($4,''),purchase_order_id=NULLIF($5,''),supplier_name=$6,supplier_gstin=$7,supplier_phone=$8,supplier_email=$9,supplier_address=$10,bill_contract=$11,bill_number=$12,bill_date=$13,subtotal_paise=$14,discount_paise=$15,cgst_paise=$16,sgst_paise=$17,igst_paise=$18,total_paise=$19,status='review',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('review','extraction_failed')")
        .bind(tenant).bind(branch).bind(draft).bind(supplier_id.unwrap_or_default()).bind(purchase_order_id.unwrap_or_default())
        .bind(supplier_name).bind(supplier_gstin).bind(supplier_phone).bind(supplier_email).bind(supplier_address).bind(bill_contract)
        .bind(bill_number).bind(bill_date).bind(subtotal).bind(discount)
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
    Ok(sqlx::query("UPDATE purchase_bill_draft_lines line SET raw_name=$6,supplier_sku=$7,inventory_item_id=NULLIF($8,''),hsn_sac=$9,purchase_quantity=$10,pack_size=$11,conversion_factor=$12,quantity=$13,unit_cost_paise=$14,discount_bps=$15,discount_paise=$16,gst_percent=$17,taxable_paise=$18,cgst_paise=$19,sgst_paise=$20,igst_paise=$21,total_paise=$22,batch_number=$23,expiry_date=$24,product_contract=$25,updated_at=NOW() FROM purchase_bill_drafts draft_row WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.draft_id=$3 AND line.id=$4 AND draft_row.id=line.draft_id AND draft_row.status IN ('review','extraction_failed') AND $5<>''")
        .bind(tenant).bind(branch).bind(draft).bind(id).bind(id).bind(line.raw_name).bind(line.supplier_sku)
        .bind(line.inventory_item_id.unwrap_or_default()).bind(line.hsn_sac).bind(line.purchase_quantity)
        .bind(line.pack_size).bind(line.conversion_factor).bind(line.quantity).bind(line.unit_cost_paise)
        .bind(line.discount_bps).bind(line.discount_paise).bind(line.gst_percent).bind(line.taxable_paise)
        .bind(line.cgst_paise).bind(line.sgst_paise).bind(line.igst_paise).bind(line.total_paise)
        .bind(line.batch_number).bind(line.expiry_date).bind(line.product_contract).execute(db).await?.rows_affected()==1)
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

pub async fn inventory_candidates(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier_sku: &str,
    hsn_sac: &str,
    name_patterns: Vec<String>,
) -> Result<Vec<InventoryCandidateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,name,sku,category,brand,hsn_code,barcode
        FROM inventory_items
        WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
          AND (
            (BTRIM($3)<>'' AND (UPPER(sku)=UPPER(BTRIM($3)) OR UPPER(barcode)=UPPER(BTRIM($3))))
            OR (BTRIM($4)<>'' AND UPPER(hsn_code)=UPPER(BTRIM($4)))
            OR LOWER(name) LIKE ANY($5)
            OR LOWER(category) LIKE ANY($5)
            OR LOWER(brand) LIKE ANY($5)
          )
        ORDER BY
          CASE WHEN BTRIM($3)<>'' AND (UPPER(sku)=UPPER(BTRIM($3)) OR UPPER(barcode)=UPPER(BTRIM($3))) THEN 0 ELSE 1 END,
          CASE WHEN BTRIM($4)<>'' AND UPPER(hsn_code)=UPPER(BTRIM($4)) THEN 0 ELSE 1 END,
          name
        LIMIT 200"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(supplier_sku)
    .bind(hsn_sac)
    .bind(name_patterns)
    .fetch_all(db)
    .await
}

pub async fn alias_inventory_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: Option<&str>,
    supplier_sku: &str,
    raw_name: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT alias.inventory_item_id
        FROM purchase_bill_item_aliases alias
        JOIN inventory_items item ON item.id=alias.inventory_item_id
          AND item.tenant_id=alias.tenant_id AND item.branch_id=alias.branch_id AND item.active=TRUE
        WHERE alias.tenant_id=$1 AND alias.branch_id=$2
          AND (alias.supplier_id IS NULL OR alias.supplier_id=$3::TEXT)
          AND ((BTRIM($4)<>'' AND alias.supplier_sku_normalized=LOWER(REGEXP_REPLACE(BTRIM($4),'\s+',' ','g')))
            OR (BTRIM($5)<>'' AND alias.raw_name_normalized=LOWER(REGEXP_REPLACE(BTRIM($5),'\s+',' ','g'))))
        ORDER BY CASE WHEN alias.supplier_id=$3::TEXT THEN 0 ELSE 1 END,alias.match_count DESC,alias.last_matched_at DESC
        LIMIT 1"#)
        .bind(tenant).bind(branch).bind(supplier).bind(supplier_sku).bind(raw_name)
        .fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn learn_item_alias(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: Option<&str>,
    supplier_sku: &str,
    raw_name: &str,
    item: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(r#"WITH normalized AS (
          SELECT LOWER(REGEXP_REPLACE(BTRIM($4),'\s+',' ','g')) sku,
                 LOWER(REGEXP_REPLACE(BTRIM($5),'\s+',' ','g')) raw_name
        ), updated AS (
          UPDATE purchase_bill_item_aliases alias
          SET inventory_item_id=$6,match_count=alias.match_count+1,last_matched_at=NOW()
          FROM normalized n
          WHERE alias.tenant_id=$1 AND alias.branch_id=$2
            AND COALESCE(alias.supplier_id,'')=COALESCE($3::TEXT,'')
            AND alias.supplier_sku_normalized=n.sku AND alias.raw_name_normalized=n.raw_name
          RETURNING alias.id
        )
        INSERT INTO purchase_bill_item_aliases(
          tenant_id,branch_id,supplier_id,supplier_sku_normalized,raw_name_normalized,inventory_item_id,created_by
        )
        SELECT $1,$2,s.id,n.sku,n.raw_name,item.id,$7
        FROM normalized n
        JOIN inventory_items item ON item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$6 AND item.active=TRUE
        LEFT JOIN suppliers s ON s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE
        WHERE NOT EXISTS(SELECT 1 FROM updated) AND (n.sku<>'' OR n.raw_name<>'')
          AND ($3::TEXT IS NULL OR s.id IS NOT NULL)
        ON CONFLICT DO NOTHING"#)
        .bind(tenant).bind(branch).bind(supplier).bind(supplier_sku).bind(raw_name).bind(item).bind(actor)
        .execute(db).await?;
    Ok(())
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

pub async fn create_and_link_product(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    line: &str,
    actor: &str,
    product: &LinkedProductData<'_>,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(r#"WITH identity_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2||':inventory-identity',0))
        ), editable AS (
          SELECT line.id FROM purchase_bill_draft_lines line
          JOIN purchase_bill_drafts draft ON draft.id=line.draft_id AND draft.tenant_id=line.tenant_id AND draft.branch_id=line.branch_id
          WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.draft_id=$3 AND line.id=$4
            AND draft.status IN ('review','extraction_failed') FOR UPDATE OF line
        ), duplicate AS (
          SELECT inventory_items.id FROM inventory_items, identity_lock WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND (
            (BTRIM($5)<>'' AND UPPER(sku)=UPPER(BTRIM($5))) OR
            (BTRIM($15)<>'' AND UPPER(barcode)=UPPER(BTRIM($15))) OR
            LOWER(REGEXP_REPLACE(BTRIM(name),'\s+',' ','g'))=LOWER(REGEXP_REPLACE(BTRIM($6),'\s+',' ','g'))
          ) LIMIT 1
        ), created AS (
          INSERT INTO inventory_items(tenant_id,branch_id,sku,name,category,brand,unit,package_unit,units_per_package,stock_quantity,reorder_point,unit_cost_paise,hsn_code,gst_percent,barcode,batch_tracked,dual_use_stock,active)
          SELECT $1,$2,$5,$6,$7,$8,$9,$10,$11,0,0,$12,$13,$14,$15,$16,FALSE,TRUE
          FROM editable, identity_lock WHERE NOT EXISTS(SELECT 1 FROM duplicate) RETURNING id
        ), linked AS (
          UPDATE purchase_bill_draft_lines target SET inventory_item_id=created.id,updated_at=NOW()
          FROM created WHERE target.id=$4 AND target.tenant_id=$1 AND target.branch_id=$2 RETURNING created.id
        ), event AS (
          INSERT INTO purchase_bill_draft_events(tenant_id,branch_id,draft_id,event_type,actor_user_id,details)
          SELECT $1,$2,$3,'product_created_and_linked',$17,JSONB_BUILD_OBJECT('lineId',$4,'inventoryItemId',linked.id) FROM linked
        ) SELECT id FROM linked"#)
        .bind(tenant).bind(branch).bind(draft).bind(line)
        .bind(product.sku).bind(product.name).bind(product.category).bind(product.brand)
        .bind(product.unit).bind(product.package_unit).bind(product.units_per_package)
        .bind(product.unit_cost_paise).bind(product.hsn_code).bind(product.gst_percent)
        .bind(product.barcode).bind(product.batch_tracked).bind(actor)
        .fetch_optional(db).await
}

pub async fn clear_suggested_matches(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM purchase_bill_matches WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 AND status IN ('suggested','fuzzy','exact','learned')")
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

pub async fn review_historical_pilot(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft: &str,
    decision: &str,
    reason: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let status = if decision == "approved" {
        "reviewed"
    } else {
        "quarantined"
    };
    Ok(sqlx::query(
        "UPDATE purchase_bill_drafts
         SET status=$4,review_decision=$5,review_reason=$6,reviewed_by=$7,
             reviewed_at=NOW(),version=version+1,updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           AND workflow_mode='historical_pilot'
           AND status IN ('review','extraction_failed')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(draft)
    .bind(status)
    .bind(decision)
    .bind(reason)
    .bind(actor)
    .execute(db)
    .await?
    .rows_affected()
        == 1)
}

pub async fn bulk_evidence_documents(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
    source_file_id: &str,
) -> Result<Vec<BulkEvidenceDocument>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT source.id source_file_id,artifact.id source_artifact_id,
                  COALESCE(artifact.page_count,source.page_count) page_count
           FROM historical_purchase_evidence_items evidence
           JOIN historical_purchase_cutover_approvals approval
             ON approval.tenant_id=evidence.tenant_id
            AND approval.branch_id=evidence.branch_id
            AND approval.cutover_id=evidence.cutover_id
           JOIN integration_import_source_files source
             ON source.tenant_id=evidence.tenant_id
            AND source.branch_id=evidence.branch_id
            AND source.id=evidence.source_file_id
           LEFT JOIN integration_import_source_artifacts artifact
             ON artifact.tenant_id=source.tenant_id
            AND artifact.branch_id=source.branch_id
            AND artifact.source_file_id=source.id
            AND artifact.file_format IN ('pdf','png','jpeg','webp')
           WHERE evidence.tenant_id=$1 AND evidence.branch_id=$2
             AND evidence.cutover_id=$3 AND evidence.source_file_id=$4
             AND evidence.evidence_kind='historical_bill'
             AND source.evidence_status='verified' AND source.read_only
             AND source.retention_until>NOW()
             AND ((source.file_format='zip' AND artifact.id IS NOT NULL)
               OR (source.file_format<>'zip' AND artifact.id IS NULL))
           ORDER BY COALESCE(artifact.entry_name,source.original_file_name)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .bind(source_file_id)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_historical_bulk_batch(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
    source_file_id: &str,
    supplier_batch: &str,
    provider: &str,
    expected_bill_count: i32,
    expected_total_paise: Option<i64>,
    mapping_version: i32,
    transformer_version: &str,
    worker_limit: i32,
    documents: &[BulkEvidenceDocument],
    actor: &str,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let source: (String, String) = sqlx::query_as(
        "SELECT original_file_name,sha256 FROM integration_import_source_files
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           AND evidence_status='verified' AND read_only AND retention_until>NOW()
         FOR SHARE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(source_file_id)
    .fetch_one(&mut *tx)
    .await?;
    let job_id: String = sqlx::query_scalar(
        r#"INSERT INTO integration_import_jobs(
             tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,
             source_row_count,valid_row_count,total_rows,source_file_id,chunk_size,
             allow_partial_import,worker_phase,heartbeat_at,total_chunks,created_by,
             owner_user_id,approval_status,approval_requested_at,approval_decided_at,
             approval_decided_by,analysis_json,transformer_versions_json,mapping_version)
           VALUES($1,$2,'purchase-bills',$3,'commit','queued',$4,$5,$6,$6,$6,$7,100,
             FALSE,'historical_archive',NOW(),$6,$8,$8,'approved',NOW(),NOW(),$8,$9,
             JSONB_BUILD_OBJECT('documentExtractor',$10),$11)
           RETURNING id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(&source.0)
    .bind(&source.1)
    .bind(format!("{provider}|historical-archive"))
    .bind(expected_bill_count)
    .bind(source_file_id)
    .bind(actor)
    .bind(json!({
        "postingContract":{
            "postingMode":"history_only",
            "cutoverId":cutover_id,
            "stockEffect":"none",
            "accountingEffect":"none",
            "gstEffect":"none",
            "payableEffect":"none"
        },
        "supplierBatch":supplier_batch,
        "expectedBillCount":expected_bill_count,
        "expectedTotalPaise":expected_total_paise,
        "workerLimit":worker_limit
    }))
    .bind(transformer_version)
    .bind(mapping_version)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO historical_purchase_archive_batches(
             job_id,tenant_id,branch_id,cutover_id,supplier_batch,provider,
             expected_bill_count,expected_total_paise,mapping_version,
             transformer_version,worker_limit,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
    )
    .bind(&job_id)
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .bind(supplier_batch)
    .bind(provider)
    .bind(expected_bill_count)
    .bind(expected_total_paise)
    .bind(mapping_version)
    .bind(transformer_version)
    .bind(worker_limit)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for document in documents {
        let existing: Option<(String, String)> = sqlx::query_as(
            "SELECT id,status FROM purchase_bill_drafts
             WHERE tenant_id=$1 AND branch_id=$2
               AND migration_source_file_id=$3
               AND migration_source_artifact_id IS NOT DISTINCT FROM $4
               AND workflow_mode='historical_pilot'
             FOR UPDATE",
        )
        .bind(tenant)
        .bind(branch)
        .bind(&document.source_file_id)
        .bind(&document.source_artifact_id)
        .fetch_optional(&mut *tx)
        .await?;
        let pilot_document = existing.is_some();
        let (draft_id, draft_status) = if let Some(existing) = existing {
            existing
        } else {
            (
                create_historical_pilot(
                    &mut tx,
                    tenant,
                    branch,
                    cutover_id,
                    &document.source_file_id,
                    document.source_artifact_id.as_deref(),
                    actor,
                )
                .await?,
                "extracting".to_string(),
            )
        };
        let status = match draft_status.as_str() {
            "reviewed" => "ready",
            "review" => "review_required",
            "quarantined" => "quarantined",
            "extraction_failed" => "failed",
            _ => "uploaded",
        };
        sqlx::query(
            r#"INSERT INTO historical_purchase_archive_items(
                 tenant_id,branch_id,job_id,source_file_id,source_artifact_id,
                 draft_id,pilot_document,status,source_page_count)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&job_id)
        .bind(&document.source_file_id)
        .bind(&document.source_artifact_id)
        .bind(&draft_id)
        .bind(pilot_document)
        .bind(status)
        .bind(document.page_count)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"INSERT INTO integration_import_audit_events(
             tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json)
           VALUES($1,$2,$3,'migration.historical_bulk.created','success',$4,$5)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(&job_id)
    .bind(actor)
    .bind(json!({
        "sourceFileId":source_file_id,
        "sourceChecksum":source.1,
        "supplierBatch":supplier_batch,
        "provider":provider,
        "cutoverId":cutover_id,
        "postingMode":"history_only",
        "expectedBillCount":expected_bill_count,
        "expectedTotalPaise":expected_total_paise,
        "mappingVersion":mapping_version,
        "transformerVersion":transformer_version,
        "workerLimit":worker_limit
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(job_id)
}

pub async fn claim_historical_bulk_document(
    db: &PgPool,
    worker_id: &str,
) -> Result<Option<ClaimedBulkDocument>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let claimed = sqlx::query_as::<_, ClaimedBulkDocument>(
        r#"WITH due AS (
             SELECT item.id
             FROM historical_purchase_archive_items item
             JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
             JOIN integration_import_jobs job ON job.id=batch.job_id
             WHERE job.worker_phase='historical_archive'
               AND job.status IN ('queued','processing')
               AND (
                 item.status='uploaded'
                 OR (item.status='failed' AND item.retry_eligible AND item.attempts<3
                     AND COALESCE(item.next_retry_at,NOW())<=NOW())
                 OR (item.status IN ('profiling','extracting') AND item.lease_expires_at<NOW())
               )
               AND (
                 SELECT COUNT(*) FROM historical_purchase_archive_items active
                 WHERE active.job_id=item.job_id
                   AND active.status IN ('profiling','extracting')
                   AND active.lease_expires_at>NOW()
               ) < batch.worker_limit
             ORDER BY job.created_at,item.created_at
             FOR UPDATE OF item SKIP LOCKED LIMIT 1
           ), updated AS (
             UPDATE historical_purchase_archive_items item
             SET status='profiling',worker_id=$1,heartbeat_at=NOW(),
                 lease_expires_at=NOW()+INTERVAL '2 minutes',attempts=attempts+1,
                 error_code='',error_message='',updated_at=NOW()
             FROM due WHERE item.id=due.id RETURNING item.*
           )
           SELECT updated.id item_id,updated.job_id,updated.tenant_id,updated.branch_id,
                  updated.draft_id,batch.created_by actor_user_id,updated.attempts
           FROM updated
           JOIN historical_purchase_archive_batches batch ON batch.job_id=updated.job_id"#,
    )
    .bind(worker_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(item) = &claimed {
        sqlx::query(
            "UPDATE integration_import_jobs SET status='processing',worker_id=$2,
             heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',updated_at=NOW()
             WHERE id=$1 AND status IN ('queued','processing')",
        )
        .bind(&item.job_id)
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(claimed)
}

pub async fn mark_historical_bulk_extracting(
    db: &PgPool,
    item_id: &str,
    worker_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE historical_purchase_archive_items
         SET status='extracting',heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',
             updated_at=NOW()
         WHERE id=$1 AND status='profiling' AND worker_id=$2",
    )
    .bind(item_id)
    .bind(worker_id)
    .execute(db)
    .await?
    .rows_affected()
        == 1)
}

pub async fn finish_historical_bulk_document(
    db: &PgPool,
    item: &ClaimedBulkDocument,
    worker_id: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(error) = error {
        let exhausted = item.attempts >= 3;
        sqlx::query(
            r#"UPDATE historical_purchase_archive_items
               SET status=CASE WHEN $4 THEN 'quarantined' ELSE 'failed' END,
                   retry_eligible=NOT $4,next_retry_at=CASE WHEN $4 THEN NULL
                     ELSE NOW()+(INTERVAL '30 seconds' * POWER(2,GREATEST(attempts-1,0))) END,
                   error_code='EXTRACTION_FAILED',error_message=$5,
                   suggested_correction='Review the evidence and retry this document',
                   worker_id='',lease_expires_at=NULL,heartbeat_at=NOW(),updated_at=NOW(),
                   completed_at=CASE WHEN $4 THEN NOW() ELSE NULL END
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND worker_id=$6"#,
        )
        .bind(&item.tenant_id)
        .bind(&item.branch_id)
        .bind(&item.item_id)
        .bind(exhausted)
        .bind(error.chars().take(500).collect::<String>())
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            r#"UPDATE historical_purchase_archive_items item
               SET status=CASE draft.status
                     WHEN 'reviewed' THEN 'ready'
                     WHEN 'quarantined' THEN 'quarantined'
                     WHEN 'extraction_failed' THEN 'failed'
                     ELSE 'review_required'
                   END,
                   source_total_paise=draft.total_paise,worker_id='',
                   lease_expires_at=NULL,heartbeat_at=NOW(),updated_at=NOW()
               FROM purchase_bill_drafts draft
               WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3
                 AND item.worker_id=$4 AND draft.id=item.draft_id"#,
        )
        .bind(&item.tenant_id)
        .bind(&item.branch_id)
        .bind(&item.item_id)
        .bind(worker_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE integration_import_jobs job
           SET heartbeat_at=NOW(),lease_expires_at=NULL,worker_id='',
               processed_rows=(SELECT COUNT(*)::INTEGER
                 FROM historical_purchase_archive_items item
                 WHERE item.job_id=job.id AND item.status NOT IN ('uploaded','profiling','extracting','failed')),
               error_row_count=(SELECT COUNT(*)::INTEGER
                 FROM historical_purchase_archive_items item
                 WHERE item.job_id=job.id AND item.status IN ('failed','quarantined')),
               updated_at=NOW()
           WHERE job.id=$1"#,
    )
    .bind(&item.job_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub async fn sync_historical_bulk_review(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    draft_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE historical_purchase_archive_items item
           SET status=CASE draft.status
                 WHEN 'reviewed' THEN 'ready'
                 WHEN 'quarantined' THEN CASE
                   WHEN draft.review_decision='rejected' THEN 'rejected'
                   ELSE 'quarantined' END
                 WHEN 'extraction_failed' THEN 'failed'
                 WHEN 'review' THEN 'review_required'
                 ELSE item.status END,
               source_total_paise=draft.total_paise,updated_at=NOW()
           FROM purchase_bill_drafts draft
           WHERE item.tenant_id=$1 AND item.branch_id=$2
             AND item.draft_id=$3 AND draft.id=item.draft_id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(draft_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn historical_bulk_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT JSONB_BUILD_OBJECT(
             'jobId',batch.job_id,'cutoverId',batch.cutover_id,
             'supplierBatch',batch.supplier_batch,'provider',batch.provider,
             'postingMode',batch.posting_mode,'expectedBillCount',batch.expected_bill_count,
             'expectedTotalPaise',batch.expected_total_paise,
             'mappingVersion',batch.mapping_version,'transformerVersion',batch.transformer_version,
             'workerLimit',batch.worker_limit,'jobStatus',job.status,
             'heartbeatAt',job.heartbeat_at,'lastError',job.last_error,
             'partialApproval',batch.partial_approval,
             'summary',JSONB_BUILD_OBJECT(
               'uploaded',COUNT(*) FILTER(WHERE item.status='uploaded'),
               'profiling',COUNT(*) FILTER(WHERE item.status='profiling'),
               'extracting',COUNT(*) FILTER(WHERE item.status='extracting'),
               'reviewRequired',COUNT(*) FILTER(WHERE item.status='review_required'),
               'ready',COUNT(*) FILTER(WHERE item.status='ready'),
               'archived',COUNT(*) FILTER(WHERE item.status='archived'),
               'duplicates',COUNT(*) FILTER(WHERE item.status='duplicate'),
               'quarantined',COUNT(*) FILTER(WHERE item.status='quarantined'),
               'failed',COUNT(*) FILTER(WHERE item.status='failed'),
               'dependencyPending',COUNT(*) FILTER(WHERE item.status='dependency_pending'),
               'rejected',COUNT(*) FILTER(WHERE item.status='rejected'),
               'cancelled',COUNT(*) FILTER(WHERE item.status='cancelled'),
               'accounted',COUNT(*) FILTER(WHERE item.status IN ('archived','duplicate','quarantined','rejected','cancelled')),
               'totalDocuments',COUNT(*),'totalPages',COALESCE(SUM(item.source_page_count),0),
               'sourceTotalPaise',COALESCE(SUM(item.source_total_paise),0),
               'archiveTotalPaise',COALESCE(SUM(item.archive_total_paise),0),
               'stockEffectPaise',0,'accountingEffectPaise',0,
               'gstEffectPaise',0,'payableEffectPaise',0),
             'items',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'id',item.id,'draftId',item.draft_id,'sourceFileId',item.source_file_id,
               'sourceArtifactId',item.source_artifact_id,'fileName',draft.source_file_name,
               'sha256',draft.source_sha256,'status',item.status,'pageCount',item.source_page_count,
               'attempts',item.attempts,'retryEligible',item.retry_eligible,
               'errorCode',item.error_code,'errorMessage',item.error_message,
               'suggestedCorrection',item.suggested_correction,
               'supplierName',draft.supplier_name,'invoiceNumber',draft.bill_number,
               'invoiceDate',draft.bill_date,'totalPaise',draft.total_paise,
               'confidenceBps',draft.confidence_bps,'reviewDecision',draft.review_decision,
               'archivedBillId',item.archived_historical_bill_id,
               'duplicateOfBillId',item.duplicate_of_historical_bill_id,
               'heartbeatAt',item.heartbeat_at) ORDER BY item.created_at),'[]'::JSONB)
           ) payload
           FROM historical_purchase_archive_batches batch
           JOIN integration_import_jobs job ON job.id=batch.job_id
           JOIN historical_purchase_archive_items item ON item.job_id=batch.job_id
           JOIN purchase_bill_drafts draft ON draft.id=item.draft_id
           WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3
           GROUP BY batch.job_id,batch.cutover_id,batch.supplier_batch,batch.provider,
             batch.posting_mode,batch.expected_bill_count,batch.expected_total_paise,
             batch.mapping_version,batch.transformer_version,batch.worker_limit,
             batch.partial_approval,job.status,job.heartbeat_at,job.last_error,batch.created_at
           ORDER BY batch.created_at DESC"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|row| row.get("payload")).collect())
}

pub async fn archive_historical_bulk_batch(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job_id: &str,
    actor: &str,
    allow_partial: bool,
    allow_live_collisions: bool,
    reason: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{tenant}:{branch}:historical-purchase-archive"))
        .execute(&mut *tx)
        .await?;
    let batch: (String, String, i32, Option<i64>, i32) = sqlx::query_as(
        "SELECT cutover_id,provider,expected_bill_count,expected_total_paise,mapping_version
         FROM historical_purchase_archive_batches
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    let unresolved: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM historical_purchase_archive_items
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3
           AND status NOT IN ('ready','duplicate','quarantined','rejected','archived')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    if unresolved > 0 && !allow_partial {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_BULK_UNRESOLVED_DOCUMENTS".into(),
        ));
    }
    if allow_partial {
        sqlx::query(
            "UPDATE historical_purchase_archive_items
             SET status='quarantined',retry_eligible=FALSE,
                 error_code=CASE WHEN error_code='' THEN 'PARTIAL_APPROVAL' ELSE error_code END,
                 error_message=CASE WHEN error_message='' THEN $4 ELSE error_message END,
                 completed_at=NOW(),updated_at=NOW()
             WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3
               AND status IN ('failed','dependency_pending')",
        )
        .bind(tenant)
        .bind(branch)
        .bind(job_id)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
    }
    let ready_items: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id,draft_id,source_file_id,source_artifact_id
         FROM historical_purchase_archive_items
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='ready'
         ORDER BY created_at FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_all(&mut *tx)
    .await?;
    if !allow_live_collisions {
        let live_collision: Option<String> = sqlx::query_scalar(
            r#"SELECT receipt.id
               FROM historical_purchase_archive_items item
               JOIN purchase_bill_drafts draft ON draft.id=item.draft_id
               JOIN purchase_receipts receipt
                 ON receipt.tenant_id=item.tenant_id AND receipt.branch_id=item.branch_id
                AND receipt.rolled_back_at IS NULL
                AND LOWER(BTRIM(receipt.supplier_invoice_number))=LOWER(BTRIM(draft.bill_number))
                AND (
                  (BTRIM(draft.supplier_gstin)<>'' AND UPPER(BTRIM(receipt.supplier_gstin))=UPPER(BTRIM(draft.supplier_gstin)))
                  OR LOWER(BTRIM(receipt.supplier_name))=LOWER(BTRIM(draft.supplier_name))
                )
               WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.job_id=$3
                 AND item.status='ready' LIMIT 1"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?;
        if live_collision.is_some() {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_BULK_LIVE_RECEIPT_COLLISION".into(),
            ));
        }
    }

    let mut archived = 0_i64;
    let mut duplicates = 0_i64;
    for (item_id, draft_id, source_file_id, source_artifact_id) in ready_items {
        let draft: DraftRecord = sqlx::query_as(&format!(
            "SELECT {DRAFT_COLUMNS} FROM purchase_bill_drafts
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
               AND workflow_mode='historical_pilot' AND status='reviewed' FOR UPDATE"
        ))
        .bind(tenant)
        .bind(branch)
        .bind(&draft_id)
        .fetch_one(&mut *tx)
        .await?;
        let bill_date = draft
            .bill_date
            .ok_or_else(|| sqlx::Error::Protocol("HISTORICAL_BULK_BILL_DATE_REQUIRED".into()))?;
        if draft.bill_number.trim().is_empty() || draft.supplier_name.trim().is_empty() {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_BULK_BILL_IDENTITY_REQUIRED".into(),
            ));
        }
        let lines: Vec<DraftLineRecord> = sqlx::query_as(
            "SELECT id,line_number,raw_name,supplier_sku,inventory_item_id,hsn_sac,
             purchase_quantity,pack_size,conversion_factor,quantity,unit_cost_paise,
             discount_bps,discount_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,
             igst_paise,total_paise,batch_number,expiry_date,product_contract,
             confidence_bps,warnings,field_evidence
             FROM purchase_bill_draft_lines
             WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3 ORDER BY line_number",
        )
        .bind(tenant)
        .bind(branch)
        .bind(&draft_id)
        .fetch_all(&mut *tx)
        .await?;
        if lines.is_empty() {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_BULK_PRODUCT_LINE_REQUIRED".into(),
            ));
        }
        let line_total = lines.iter().map(|line| line.total_paise).sum::<i64>();
        if !historical_bulk_financially_reconciled(
            line_total,
            draft.total_paise,
            &draft.review_reason,
        ) {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_BULK_FINANCIAL_MISMATCH".into(),
            ));
        }
        let duplicate: Option<String> = sqlx::query_scalar(
            r#"SELECT bill.id FROM historical_purchase_bills bill
               WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND bill.cutover_id=$3
                 AND (
                   LOWER(bill.source_checksum)=LOWER($4)
                   OR (
                     LOWER(BTRIM(bill.invoice_number))=LOWER(BTRIM($5))
                     AND bill.invoice_date=$6
                     AND (
                       (BTRIM($7)<>'' AND UPPER(BTRIM(bill.supplier_gstin))=UPPER(BTRIM($7)))
                       OR LOWER(BTRIM(bill.supplier_name))=LOWER(BTRIM($8))
                     )
                   )
                 )
               ORDER BY bill.created_at LIMIT 1"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&batch.0)
        .bind(&draft.source_sha256)
        .bind(&draft.bill_number)
        .bind(bill_date)
        .bind(&draft.supplier_gstin)
        .bind(&draft.supplier_name)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = duplicate {
            sqlx::query(
                "UPDATE historical_purchase_archive_items
                 SET status='duplicate',duplicate_of_historical_bill_id=$4,
                     retry_eligible=FALSE,completed_at=NOW(),updated_at=NOW()
                 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(tenant)
            .bind(branch)
            .bind(&item_id)
            .bind(existing)
            .execute(&mut *tx)
            .await?;
            duplicates += 1;
            continue;
        }
        let evidence: (String, String, String, String) = sqlx::query_as(
            r#"SELECT COALESCE(artifact.entry_name,source.original_file_name),
                      COALESCE(artifact.detected_content_type,source.detected_content_type),
                      COALESCE(artifact.sha256,source.sha256),
                      COALESCE(artifact.storage_key,source.storage_key)
               FROM integration_import_source_files source
               LEFT JOIN integration_import_source_artifacts artifact
                 ON artifact.id=$4 AND artifact.tenant_id=source.tenant_id
                AND artifact.branch_id=source.branch_id AND artifact.source_file_id=source.id
               WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.id=$3
                 AND source.evidence_status='verified' AND source.read_only"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&source_file_id)
        .bind(&source_artifact_id)
        .fetch_one(&mut *tx)
        .await?;
        let extraction_history: Value = sqlx::query_scalar(
            "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'provider',provider,'modelVersion',model_version,'status',status,
               'rawResponse',raw_response,'errorMessage',error_message,'createdAt',created_at)
               ORDER BY created_at),'[]'::JSONB)
             FROM purchase_bill_extractions
             WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(&draft_id)
        .fetch_one(&mut *tx)
        .await?;
        let corrections: Value = sqlx::query_scalar(
            "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'eventType',event_type,'actorUserId',actor_user_id,
               'details',details,'createdAt',created_at) ORDER BY created_at),'[]'::JSONB)
             FROM purchase_bill_draft_events
             WHERE tenant_id=$1 AND branch_id=$2 AND draft_id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(&draft_id)
        .fetch_one(&mut *tx)
        .await?;
        let external_bill_id = historical_bulk_external_id(
            &draft.source_sha256,
            &draft.supplier_gstin,
            &draft.supplier_name,
            &draft.bill_number,
            bill_date,
        );
        let original_json = json!({
            "draftId":draft.id,
            "source":{"fileId":source_file_id,"artifactId":source_artifact_id,
                "fileName":evidence.0,"sha256":evidence.2},
            "originalAndExtracted":extraction_history,
            "corrected":{"supplierName":draft.supplier_name,"supplierGstin":draft.supplier_gstin,
                "invoiceNumber":draft.bill_number,"invoiceDate":bill_date,
                "subtotalPaise":draft.subtotal_paise,"discountPaise":draft.discount_paise,
                "cgstPaise":draft.cgst_paise,"sgstPaise":draft.sgst_paise,
                "igstPaise":draft.igst_paise,"totalPaise":draft.total_paise},
            "fieldEvidence":draft.field_evidence,"warnings":draft.warnings,
            "corrections":corrections,"reviewReason":draft.review_reason
        });
        let document_type = draft
            .bill_contract
            .get("documentType")
            .and_then(Value::as_str)
            .unwrap_or("bill");
        let bill_id: String = sqlx::query_scalar(
            r#"INSERT INTO historical_purchase_bills(
                 tenant_id,branch_id,provider,source_file_id,import_job_id,cutover_id,
                 external_bill_id,supplier_name,supplier_gstin,invoice_number,invoice_date,
                 received_date,currency,document_type,source_status,payment_status,
                 taxable_paise,cgst_paise,sgst_paise,igst_paise,discount_paise,
                 line_total_paise,total_paise,original_json,source_checksum,created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'INR',$12,
                 'history_only','unknown',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
               RETURNING id"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&batch.1)
        .bind(&source_file_id)
        .bind(job_id)
        .bind(&batch.0)
        .bind(&external_bill_id)
        .bind(&draft.supplier_name)
        .bind(&draft.supplier_gstin)
        .bind(&draft.bill_number)
        .bind(bill_date)
        .bind(document_type)
        .bind(draft.subtotal_paise)
        .bind(draft.cgst_paise)
        .bind(draft.sgst_paise)
        .bind(draft.igst_paise)
        .bind(draft.discount_paise)
        .bind(line_total)
        .bind(draft.total_paise)
        .bind(&original_json)
        .bind(&draft.source_sha256)
        .bind(actor)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO historical_purchase_bill_files(
                 tenant_id,branch_id,historical_bill_id,source_file_id,source_artifact_id,
                 original_file_name,media_type,sha256,storage_key)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&bill_id)
        .bind(&source_file_id)
        .bind(&source_artifact_id)
        .bind(&evidence.0)
        .bind(&evidence.1)
        .bind(&evidence.2)
        .bind(&evidence.3)
        .execute(&mut *tx)
        .await?;
        for line in lines {
            let line_original = json!({
                "originalAndExtracted":line.field_evidence,
                "corrected":{"name":line.raw_name,"sku":line.supplier_sku,
                    "quantity":line.purchase_quantity,"unitCostPaise":line.unit_cost_paise,
                    "gstPercent":line.gst_percent,"taxablePaise":line.taxable_paise,
                    "cgstPaise":line.cgst_paise,"sgstPaise":line.sgst_paise,
                    "igstPaise":line.igst_paise,"totalPaise":line.total_paise,
                    "batchNumber":line.batch_number,"expiryDate":line.expiry_date},
                "warnings":line.warnings,"productContract":line.product_contract,
                "source":{"fileId":source_file_id,"artifactId":source_artifact_id,
                    "page":line.field_evidence.get("page"),"row":line.line_number}
            });
            let checksum = format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&line_original)
                        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
                )
            );
            let package_unit = line
                .product_contract
                .get("packageUnit")
                .and_then(Value::as_str)
                .unwrap_or("");
            let stock_unit = line
                .product_contract
                .get("unit")
                .and_then(Value::as_str)
                .unwrap_or("");
            let line_id: String = sqlx::query_scalar(
                r#"INSERT INTO historical_purchase_bill_lines(
                     tenant_id,branch_id,historical_bill_id,original_product_name,sku,
                     mapped_inventory_item_id,package_unit,stock_unit,units_per_package,
                     purchased_quantity,accepted_quantity,damaged_quantity,rejected_quantity,
                     unit_cost_paise,gst_percent_bps,taxable_paise,cgst_paise,sgst_paise,
                     igst_paise,total_paise,batch_number,expiry_date,source_line_id,
                     source_sheet,source_row_number,original_json,source_row_checksum)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,0,$11,$12,$13,$14,$15,
                     $16,$17,$18,$19,$20,'document',$21,$22,$23)
                   RETURNING id"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(&bill_id)
            .bind(&line.raw_name)
            .bind(&line.supplier_sku)
            .bind(&line.inventory_item_id)
            .bind(package_unit)
            .bind(stock_unit)
            .bind(i64::from(line.conversion_factor.max(1)))
            .bind(i64::from(line.purchase_quantity))
            .bind(line.unit_cost_paise)
            .bind(line.gst_percent * 100)
            .bind(line.taxable_paise)
            .bind(line.cgst_paise)
            .bind(line.sgst_paise)
            .bind(line.igst_paise)
            .bind(line.total_paise)
            .bind(&line.batch_number)
            .bind(line.expiry_date)
            .bind(&line.id)
            .bind(line.line_number)
            .bind(&line_original)
            .bind(&checksum)
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query(
                r#"INSERT INTO historical_purchase_product_mappings(
                     tenant_id,branch_id,historical_bill_line_id,mapping_version,
                     original_product_name,sku,mapped_inventory_item_id,mapping_status,
                     mapping_source,approved_by,approved_at)
                   VALUES($1,$2,$3,$4,$5,$6,$7,
                     CASE WHEN $7 IS NULL THEN 'unmapped' ELSE 'mapped' END,
                     'purchase_bill_review',$8,NOW())"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(&line_id)
            .bind(batch.4)
            .bind(&line.raw_name)
            .bind(&line.supplier_sku)
            .bind(&line.inventory_item_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "UPDATE historical_purchase_archive_items
             SET status='archived',archived_historical_bill_id=$4,
                 archive_total_paise=$5,retry_eligible=FALSE,
                 completed_at=NOW(),updated_at=NOW()
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(&item_id)
        .bind(&bill_id)
        .bind(draft.total_paise)
        .execute(&mut *tx)
        .await?;
        archived += 1;
    }
    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT,
           COUNT(*) FILTER(WHERE status='archived')::BIGINT,
           COUNT(*) FILTER(WHERE status='duplicate')::BIGINT,
           COUNT(*) FILTER(WHERE status IN ('quarantined','rejected'))::BIGINT
         FROM historical_purchase_archive_items
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    if counts.0 != i64::from(batch.2) {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_BULK_EXPECTED_COUNT_MISMATCH".into(),
        ));
    }
    let archive_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(archive_total_paise),0)::BIGINT
         FROM historical_purchase_archive_items
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(expected) = batch.3 {
        if counts.1 == counts.0 && archive_total != expected {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_BULK_EXPECTED_TOTAL_MISMATCH".into(),
            ));
        }
    }
    sqlx::query(
        "UPDATE historical_purchase_archive_batches
         SET partial_approval=$4,partial_approved_by=CASE WHEN $4 THEN $5 ELSE NULL END,
             partial_approved_at=CASE WHEN $4 THEN NOW() ELSE NULL END,
             partial_approval_reason=CASE WHEN $4 THEN $6 ELSE '' END,updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(allow_partial)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE integration_import_jobs SET status='completed',processed_rows=$4,
         completed_chunks=total_chunks,worker_id='',lease_expires_at=NULL,
         heartbeat_at=NOW(),completed_at=NOW(),updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(counts.0 as i32)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO integration_import_audit_events(
             tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json)
           VALUES($1,$2,$3,'migration.historical_bulk.archived','success',$4,$5)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(actor)
    .bind(json!({
        "archivedNow":archived,"duplicatesNow":duplicates,
        "archivedTotal":counts.1,"duplicateTotal":counts.2,
        "quarantinedOrRejected":counts.3,"expectedBillCount":batch.2,
        "expectedTotalPaise":batch.3,"archiveTotalPaise":archive_total,
        "allowPartial":allow_partial,"allowLiveCollisions":allow_live_collisions,
        "reason":reason,"stockEffectPaise":0,"accountingEffectPaise":0,
        "gstEffectPaise":0,"payableEffectPaise":0
    }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({
        "jobId":job_id,"status":"completed","archived":counts.1,
        "duplicates":counts.2,"quarantinedOrRejected":counts.3,
        "expectedBillCount":batch.2,"archiveTotalPaise":archive_total,
        "stockEffectPaise":0,"accountingEffectPaise":0,
        "gstEffectPaise":0,"payableEffectPaise":0
    }))
}

#[cfg(test)]
mod historical_bulk_tests {
    use super::{historical_bulk_external_id, historical_bulk_financially_reconciled};
    use chrono::NaiveDate;

    #[test]
    fn archive_identity_is_normalized_and_stable() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 31).unwrap();
        assert_eq!(
            historical_bulk_external_id("abc", "27abcde1234f1z5", "S Sense Studio", "TW-517", date),
            historical_bulk_external_id("abc", "27ABCDE1234F1Z5", "s sense studio", "tw-517", date)
        );
    }

    #[test]
    fn rounding_difference_requires_an_explanation() {
        assert!(historical_bulk_financially_reconciled(10_000, 10_000, ""));
        assert!(!historical_bulk_financially_reconciled(10_050, 10_000, ""));
        assert!(historical_bulk_financially_reconciled(
            10_050,
            10_000,
            "Printed round-off approved"
        ));
        assert!(!historical_bulk_financially_reconciled(
            10_101,
            10_000,
            "Too large"
        ));
    }
}
