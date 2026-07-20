use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    models::common::AppError,
    repositories::{purchase_bill_draft_repository as repo, purchase_repository},
    services::purchase_service::{self, ReceiptInput, ReceiptLineInput},
    state::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftDetails {
    pub draft: repo::DraftRecord,
    pub lines: Vec<repo::DraftLineRecord>,
    pub extractions: Vec<repo::ExtractionRecord>,
    pub matches: Vec<repo::MatchRecord>,
    pub events: Vec<repo::DraftEventRecord>,
}

pub struct UploadInput {
    pub file_name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub struct HeaderInput {
    pub supplier_id: Option<String>,
    pub purchase_order_id: Option<String>,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub bill_number: String,
    pub bill_date: Option<String>,
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
}

pub struct LineInput {
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
    pub expiry_date: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AiLine {
    #[serde(default)]
    raw_name: String,
    #[serde(default)]
    supplier_sku: String,
    #[serde(default)]
    hsn_sac: String,
    #[serde(default)]
    purchase_quantity: i32,
    #[serde(default = "one")]
    pack_size: i32,
    #[serde(default = "one")]
    conversion_factor: i32,
    #[serde(default)]
    quantity: i32,
    #[serde(default)]
    unit_cost_paise: i64,
    #[serde(default)]
    discount_bps: i32,
    #[serde(default)]
    discount_paise: i64,
    #[serde(default)]
    gst_percent: i32,
    #[serde(default)]
    taxable_paise: i64,
    #[serde(default)]
    cgst_paise: i64,
    #[serde(default)]
    sgst_paise: i64,
    #[serde(default)]
    igst_paise: i64,
    #[serde(default)]
    total_paise: i64,
    #[serde(default)]
    batch_number: String,
    #[serde(default)]
    expiry_date: String,
    #[serde(default)]
    confidence_bps: i32,
    #[serde(default = "empty_array")]
    warnings: Value,
    #[serde(default = "empty_object")]
    field_evidence: Value,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AiExtraction {
    #[serde(default = "local_provider")]
    provider: String,
    #[serde(default)]
    model_version: String,
    #[serde(default)]
    supplier_name: String,
    #[serde(default)]
    supplier_gstin: String,
    #[serde(default)]
    bill_number: String,
    #[serde(default)]
    bill_date: String,
    #[serde(default)]
    subtotal_paise: i64,
    #[serde(default)]
    discount_paise: i64,
    #[serde(default)]
    cgst_paise: i64,
    #[serde(default)]
    sgst_paise: i64,
    #[serde(default)]
    igst_paise: i64,
    #[serde(default)]
    total_paise: i64,
    #[serde(default)]
    confidence_bps: i32,
    #[serde(default = "empty_array")]
    warnings: Value,
    #[serde(default = "empty_object")]
    field_evidence: Value,
    #[serde(default)]
    lines: Vec<AiLine>,
}

#[derive(Deserialize)]
struct AiEnvelope {
    success: bool,
    data: Option<AiExtraction>,
}
fn one() -> i32 {
    1
}
fn empty_array() -> Value {
    json!([])
}
fn empty_object() -> Value {
    json!({})
}
fn local_provider() -> String {
    "local".into()
}

pub async fn list(
    state: &AppState,
    tenant: &str,
    branch: &str,
    status: &str,
) -> Result<Vec<repo::DraftRecord>, AppError> {
    repo::list(&state.db, tenant, branch, status)
        .await
        .map_err(|_| AppError::internal("failed to list purchase bill drafts"))
}

pub async fn details(
    state: &AppState,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    let (draft, lines, extractions, matches, events) = tokio::try_join!(
        repo::get(&state.db, tenant, branch, id),
        repo::lines(&state.db, tenant, branch, id),
        repo::extractions(&state.db, tenant, branch, id),
        repo::matches(&state.db, tenant, branch, id),
        repo::events(&state.db, tenant, branch, id),
    )
    .map_err(|_| AppError::internal("failed to load purchase bill draft"))?;
    Ok(DraftDetails {
        draft: draft.ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?,
        lines,
        extractions,
        matches,
        events,
    })
}

pub async fn upload(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: UploadInput,
) -> Result<DraftDetails, AppError> {
    validate_upload(&input)?;
    let sha256 = Sha256::digest(&input.bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if let Some(existing) = repo::by_hash(&state.db, tenant, branch, &sha256)
        .await
        .map_err(|_| AppError::internal("failed to check purchase bill duplicate"))?
    {
        return Err(
            AppError::conflict("this purchase bill file is already uploaded")
                .with_details(json!({"draftId":existing.id,"sha256":sha256})),
        );
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase bill upload"))?;
    let id = repo::create(
        &mut tx,
        tenant,
        branch,
        &input.file_name,
        &input.content_type,
        &sha256,
        &input.bytes,
        actor,
    )
    .await
    .map_err(|_| AppError::conflict("this purchase bill file is already uploaded"))?;
    repo::add_event(
        &mut tx,
        tenant,
        branch,
        &id,
        "uploaded",
        actor,
        &json!({"fileName":input.file_name,"contentType":input.content_type,"sha256":sha256}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write purchase bill upload event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase bill upload"))?;
    match extract(state, tenant, branch, &input).await {
        Ok(result) => save_extraction(state, tenant, branch, actor, &id, result).await?,
        Err(error) => {
            let mut tx = state
                .db
                .begin()
                .await
                .map_err(|_| AppError::internal("failed to record extraction failure"))?;
            repo::fail_extraction(&mut tx, tenant, branch, &id, "ai-service", &error, actor)
                .await
                .map_err(|_| AppError::internal("failed to record extraction failure"))?;
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to commit extraction failure"))?;
        }
    }
    match_draft(state, tenant, branch, actor, &id).await
}

async fn extract(
    state: &AppState,
    tenant: &str,
    branch: &str,
    input: &UploadInput,
) -> Result<AiExtraction, String> {
    let (Some(url), Some(token)) = (
        state.settings.ai_service_url.as_deref(),
        state.settings.ai_service_token.as_deref(),
    ) else {
        return Err("AI service is not configured".into());
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|_| "AI client could not be created".to_string())?;
    let response = client.post(format!("{url}/api/v1/purchase-bills/extract")).bearer_auth(token).json(&json!({
        "tenant_id":tenant,"branch_id":branch,"file_name":input.file_name,"content_type":input.content_type,"content_base64":STANDARD.encode(&input.bytes)
    })).send().await.map_err(|_| "AI extraction request failed".to_string())?;
    if !response.status().is_success() {
        return Err("AI extraction service rejected the document".into());
    }
    let envelope = response
        .json::<AiEnvelope>()
        .await
        .map_err(|_| "AI extraction response was invalid".to_string())?;
    if !envelope.success {
        return Err("AI extraction did not succeed".into());
    }
    envelope
        .data
        .ok_or_else(|| "AI extraction returned no data".into())
}

async fn save_extraction(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    extracted: AiExtraction,
) -> Result<(), AppError> {
    let raw = serde_json::to_value(&extracted).unwrap_or_else(|_| json!({}));
    let header = repo::ExtractedDraftData {
        supplier_name: text(&extracted.supplier_name, 200)?,
        supplier_gstin: text(&extracted.supplier_gstin, 15)?,
        bill_number: text(&extracted.bill_number, 120)?,
        bill_date: date(&extracted.bill_date, "billDate")?,
        subtotal_paise: amount(extracted.subtotal_paise)?,
        discount_paise: amount(extracted.discount_paise)?,
        cgst_paise: amount(extracted.cgst_paise)?,
        sgst_paise: amount(extracted.sgst_paise)?,
        igst_paise: amount(extracted.igst_paise)?,
        total_paise: amount(extracted.total_paise)?,
        confidence_bps: extracted.confidence_bps.clamp(0, 10000),
        warnings: &extracted.warnings,
        field_evidence: &extracted.field_evidence,
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase bill extraction"))?;
    repo::complete_extraction(
        &mut tx,
        tenant,
        branch,
        id,
        &extracted.provider,
        &extracted.model_version,
        &header,
        &raw,
    )
    .await
    .map_err(|_| AppError::internal("failed to save purchase bill extraction"))?;
    for (index, source) in extracted.lines.iter().enumerate() {
        let purchase_quantity = source.purchase_quantity.max(0);
        let conversion = source.conversion_factor.max(1);
        let line = repo::DraftLineData {
            raw_name: text(&source.raw_name, 240)?,
            supplier_sku: text(&source.supplier_sku, 120)?,
            inventory_item_id: None,
            hsn_sac: text(&source.hsn_sac, 40)?,
            purchase_quantity,
            pack_size: source.pack_size.max(1),
            conversion_factor: conversion,
            quantity: if source.quantity > 0 {
                source.quantity
            } else {
                purchase_quantity.saturating_mul(conversion)
            },
            unit_cost_paise: amount(source.unit_cost_paise)?,
            discount_bps: source.discount_bps.clamp(0, 10000),
            discount_paise: amount(source.discount_paise)?,
            gst_percent: source.gst_percent.clamp(0, 100),
            taxable_paise: amount(source.taxable_paise)?,
            cgst_paise: amount(source.cgst_paise)?,
            sgst_paise: amount(source.sgst_paise)?,
            igst_paise: amount(source.igst_paise)?,
            total_paise: amount(source.total_paise)?,
            batch_number: text(&source.batch_number, 120)?,
            expiry_date: date(&source.expiry_date, "expiryDate")?,
            confidence_bps: source.confidence_bps.clamp(0, 10000),
            warnings: &source.warnings,
            field_evidence: &source.field_evidence,
        };
        repo::insert_line(&mut tx, tenant, branch, id, (index + 1) as i32, &line)
            .await
            .map_err(|_| AppError::internal("failed to save extracted purchase bill line"))?;
    }
    repo::add_event(
        &mut tx,
        tenant,
        branch,
        id,
        "extracted",
        actor,
        &json!({"provider":extracted.provider,"lineCount":extracted.lines.len()}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write extraction event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase bill extraction"))
}

pub async fn save_header(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    input: HeaderInput,
) -> Result<DraftDetails, AppError> {
    if [
        input.subtotal_paise,
        input.discount_paise,
        input.cgst_paise,
        input.sgst_paise,
        input.igst_paise,
        input.total_paise,
    ]
    .iter()
    .any(|v| *v < 0)
    {
        return Err(AppError::validation(
            "purchase bill amounts cannot be negative",
        ));
    }
    let gstin = text(&input.supplier_gstin, 15)?;
    if !gstin.is_empty() && (gstin.len() != 15 || !gstin.chars().all(|c| c.is_ascii_alphanumeric()))
    {
        return Err(AppError::validation(
            "supplierGstin must be 15 alphanumeric characters",
        ));
    }
    if let Some(supplier) = input
        .supplier_id
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    {
        purchase_repository::get_supplier(&state.db, tenant, branch, supplier)
            .await
            .map_err(|_| AppError::internal("failed to validate supplier"))?
            .ok_or_else(|| AppError::not_found("supplier was not found"))?;
    }
    if let Some(order) = input
        .purchase_order_id
        .as_deref()
        .filter(|v| !v.trim().is_empty())
    {
        purchase_service::order_details(state, tenant, branch, order).await?;
    }
    let saved = repo::update_header(
        &state.db,
        tenant,
        branch,
        id,
        input.supplier_id.as_deref(),
        input.purchase_order_id.as_deref(),
        text(&input.supplier_name, 200)?,
        gstin,
        text(&input.bill_number, 120)?,
        input
            .bill_date
            .as_deref()
            .map(|v| date(v, "billDate"))
            .transpose()?
            .flatten(),
        input.subtotal_paise,
        input.discount_paise,
        input.cgst_paise,
        input.sgst_paise,
        input.igst_paise,
        input.total_paise,
    )
    .await
    .map_err(|_| AppError::internal("failed to save purchase bill header"))?;
    if !saved {
        return Err(AppError::conflict(
            "purchase bill draft cannot be edited in its current state",
        ));
    }
    audit(
        state,
        tenant,
        branch,
        id,
        "header_updated",
        actor,
        json!({}),
    )
    .await?;
    details(state, tenant, branch, id).await
}

pub async fn add_line(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    draft: &str,
    input: LineInput,
) -> Result<DraftDetails, AppError> {
    let warnings = json!([]);
    let evidence = json!({"source":"human_review"});
    let line = line_data(&input, &warnings, &evidence)?;
    validate_item(state, tenant, branch, line.inventory_item_id).await?;
    let number = repo::next_line_number(&state.db, tenant, branch, draft)
        .await
        .map_err(|_| AppError::internal("failed to number purchase bill line"))?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase bill line"))?;
    repo::insert_line(&mut tx, tenant, branch, draft, number, &line)
        .await
        .map_err(|_| AppError::internal("failed to add purchase bill line"))?;
    repo::add_event(
        &mut tx,
        tenant,
        branch,
        draft,
        "line_added",
        actor,
        &json!({"lineNumber":number}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write purchase bill line event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase bill line"))?;
    details(state, tenant, branch, draft).await
}

pub async fn save_line(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    draft: &str,
    id: &str,
    input: LineInput,
) -> Result<DraftDetails, AppError> {
    let warnings = json!([]);
    let evidence = json!({"source":"human_review"});
    let line = line_data(&input, &warnings, &evidence)?;
    validate_item(state, tenant, branch, line.inventory_item_id).await?;
    if !repo::update_line(&state.db, tenant, branch, draft, id, &line)
        .await
        .map_err(|_| AppError::internal("failed to save purchase bill line"))?
    {
        return Err(AppError::not_found(
            "editable purchase bill line was not found",
        ));
    }
    audit(
        state,
        tenant,
        branch,
        draft,
        "line_updated",
        actor,
        json!({"lineId":id}),
    )
    .await?;
    details(state, tenant, branch, draft).await
}

pub async fn remove_line(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    draft: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    if !repo::delete_line(&state.db, tenant, branch, draft, id)
        .await
        .map_err(|_| AppError::internal("failed to delete purchase bill line"))?
    {
        return Err(AppError::not_found(
            "editable purchase bill line was not found",
        ));
    }
    audit(
        state,
        tenant,
        branch,
        draft,
        "line_removed",
        actor,
        json!({"lineId":id}),
    )
    .await?;
    details(state, tenant, branch, draft).await
}

pub async fn match_draft(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    let current = details(state, tenant, branch, id).await?;
    if matches!(current.draft.status.as_str(), "confirmed" | "cancelled") {
        return Ok(current);
    }
    repo::clear_suggested_matches(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to refresh purchase bill matches"))?;
    let supplier = if current.draft.supplier_id.is_some() {
        current.draft.supplier_id.clone()
    } else {
        repo::exact_supplier(
            &state.db,
            tenant,
            branch,
            &current.draft.supplier_gstin,
            &current.draft.supplier_name,
        )
        .await
        .map_err(|_| AppError::internal("failed to match supplier"))?
    };
    if let Some(supplier_id) = supplier.as_deref() {
        repo::set_supplier(&state.db, tenant, branch, id, supplier_id)
            .await
            .map_err(|_| AppError::internal("failed to apply supplier match"))?;
        repo::add_match(
            &state.db,
            tenant,
            branch,
            id,
            None,
            "supplier",
            supplier_id,
            10000,
            "suggested",
            &json!({"method":"exact gstin or name"}),
            actor,
        )
        .await
        .map_err(|_| AppError::internal("failed to save supplier match"))?;
    }
    for line in &current.lines {
        if line.inventory_item_id.is_none() {
            if let Some(item) = repo::exact_inventory_item(
                &state.db,
                tenant,
                branch,
                &line.supplier_sku,
                &line.raw_name,
            )
            .await
            .map_err(|_| AppError::internal("failed to match item"))?
            {
                repo::set_line_item(&state.db, tenant, branch, &line.id, &item)
                    .await
                    .map_err(|_| AppError::internal("failed to apply item match"))?;
                repo::add_match(
                    &state.db,
                    tenant,
                    branch,
                    id,
                    Some(&line.id),
                    "inventory_item",
                    &item,
                    10000,
                    "suggested",
                    &json!({"method":"exact sku, barcode or name"}),
                    actor,
                )
                .await
                .map_err(|_| AppError::internal("failed to save item match"))?;
            }
        }
    }
    if current.draft.purchase_order_id.is_none() {
        if let Some(supplier_id) = supplier.as_deref() {
            if let Some(order) = repo::candidate_order(
                &state.db,
                tenant,
                branch,
                supplier_id,
                current.draft.total_paise,
            )
            .await
            .map_err(|_| AppError::internal("failed to match purchase order"))?
            {
                repo::set_order(&state.db, tenant, branch, id, &order)
                    .await
                    .map_err(|_| AppError::internal("failed to apply order match"))?;
                repo::add_match(
                    &state.db,
                    tenant,
                    branch,
                    id,
                    None,
                    "purchase_order",
                    &order,
                    9000,
                    "suggested",
                    &json!({"method":"supplier and nearest total"}),
                    actor,
                )
                .await
                .map_err(|_| AppError::internal("failed to save order match"))?;
            }
        }
    }
    audit(state, tenant, branch, id, "matched", actor, json!({})).await?;
    details(state, tenant, branch, id).await
}

pub async fn confirm(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    let current = details(state, tenant, branch, id).await?;
    if current.draft.status == "confirmed" {
        return Ok(current);
    }
    if !matches!(
        current.draft.status.as_str(),
        "review" | "extraction_failed"
    ) {
        return Err(AppError::conflict(
            "purchase bill draft is not ready for confirmation",
        ));
    }
    let supplier = current
        .draft
        .supplier_id
        .clone()
        .ok_or_else(|| AppError::validation("matched supplier is required"))?;
    if current.draft.bill_number.trim().is_empty()
        || current.lines.is_empty()
        || current
            .lines
            .iter()
            .any(|line| line.inventory_item_id.is_none() || line.quantity <= 0)
    {
        return Err(AppError::validation(
            "bill number and fully matched positive lines are required",
        ));
    }
    if let Some(order_id) = current.draft.purchase_order_id.as_deref() {
        let order = purchase_service::order_details(state, tenant, branch, order_id).await?;
        if order.order.supplier_id != supplier
            || !matches!(
                order.order.status.as_str(),
                "approved" | "partially_received"
            )
        {
            return Err(AppError::conflict(
                "matched purchase order is not receivable for this supplier",
            ));
        }
    }
    let receipt = purchase_service::receive(
        state,
        tenant,
        branch,
        actor,
        ReceiptInput {
            supplier_id: Some(supplier),
            purchase_order_id: current.draft.purchase_order_id.clone(),
            supplier_name: current.draft.supplier_name.clone(),
            supplier_gstin: current.draft.supplier_gstin.clone(),
            supplier_invoice_number: current.draft.bill_number.clone(),
            received_date: current.draft.bill_date.map(|v| v.to_string()),
            due_date: None,
            idempotency_key: format!("purchase-bill-draft:{id}"),
            lines: current
                .lines
                .iter()
                .map(|line| ReceiptLineInput {
                    inventory_item_id: line.inventory_item_id.clone().unwrap_or_default(),
                    quantity: line.quantity,
                    unit_cost_paise: line.unit_cost_paise,
                    gst_percent: Some(line.gst_percent),
                    batch_number: Some(line.batch_number.clone()),
                    batch_barcode: None,
                    expiry_date: line.expiry_date.map(|v| v.to_string()),
                })
                .collect(),
        },
    )
    .await?;
    if !repo::confirm(&state.db, tenant, branch, id, &receipt.receipt.id, actor)
        .await
        .map_err(|_| AppError::internal("failed to confirm purchase bill draft"))?
    {
        return Err(AppError::conflict(
            "purchase bill draft confirmation state changed",
        ));
    }
    repo::add_match(&state.db,tenant,branch,id,None,if current.draft.purchase_order_id.is_some(){"three_way"}else{"two_way"},&receipt.receipt.id,10000,"confirmed",&json!({"purchaseOrderId":current.draft.purchase_order_id,"grnId":receipt.receipt.id,"supplierInvoice":current.draft.bill_number}),actor).await.map_err(|_|AppError::internal("failed to save confirmed match"))?;
    audit(
        state,
        tenant,
        branch,
        id,
        "confirmed",
        actor,
        json!({"grnId":receipt.receipt.id}),
    )
    .await?;
    details(state, tenant, branch, id).await
}

pub async fn cancel(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    if !repo::cancel(&state.db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to cancel purchase bill draft"))?
    {
        return Err(AppError::conflict(
            "purchase bill draft cannot be cancelled",
        ));
    }
    audit(state, tenant, branch, id, "cancelled", actor, json!({})).await?;
    details(state, tenant, branch, id).await
}

fn line_data<'a>(
    input: &'a LineInput,
    warnings: &'a Value,
    evidence: &'a Value,
) -> Result<repo::DraftLineData<'a>, AppError> {
    if input.purchase_quantity < 0
        || input.pack_size <= 0
        || input.conversion_factor <= 0
        || input.quantity < 0
        || input.unit_cost_paise < 0
        || !(0..=100).contains(&input.gst_percent)
        || !(0..=10000).contains(&input.discount_bps)
    {
        return Err(AppError::validation(
            "purchase bill line values are invalid",
        ));
    }
    Ok(repo::DraftLineData {
        raw_name: text(&input.raw_name, 240)?,
        supplier_sku: text(&input.supplier_sku, 120)?,
        inventory_item_id: input
            .inventory_item_id
            .as_deref()
            .filter(|v| !v.trim().is_empty()),
        hsn_sac: text(&input.hsn_sac, 40)?,
        purchase_quantity: input.purchase_quantity,
        pack_size: input.pack_size,
        conversion_factor: input.conversion_factor,
        quantity: input.quantity,
        unit_cost_paise: input.unit_cost_paise,
        discount_bps: input.discount_bps,
        discount_paise: amount(input.discount_paise)?,
        gst_percent: input.gst_percent,
        taxable_paise: amount(input.taxable_paise)?,
        cgst_paise: amount(input.cgst_paise)?,
        sgst_paise: amount(input.sgst_paise)?,
        igst_paise: amount(input.igst_paise)?,
        total_paise: amount(input.total_paise)?,
        batch_number: text(&input.batch_number, 120)?,
        expiry_date: input
            .expiry_date
            .as_deref()
            .map(|v| date(v, "expiryDate"))
            .transpose()?
            .flatten(),
        confidence_bps: 10000,
        warnings,
        field_evidence: evidence,
    })
}
async fn validate_item(
    state: &AppState,
    tenant: &str,
    branch: &str,
    item: Option<&str>,
) -> Result<(), AppError> {
    if let Some(id) = item {
        crate::repositories::inventory_repository::get(&state.db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to validate inventory item"))?
            .filter(|row| row.active)
            .ok_or_else(|| AppError::not_found("inventory item was not found"))?;
    }
    Ok(())
}
async fn audit(
    state: &AppState,
    tenant: &str,
    branch: &str,
    draft: &str,
    event: &str,
    actor: &str,
    details: Value,
) -> Result<(), AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase bill audit"))?;
    repo::add_event(&mut tx, tenant, branch, draft, event, actor, &details)
        .await
        .map_err(|_| AppError::internal("failed to write purchase bill audit"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase bill audit"))
}
fn validate_upload(input: &UploadInput) -> Result<(), AppError> {
    if input.bytes.is_empty() || input.bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::validation(
            "purchase bill file must be between 1 byte and 10 MB",
        ));
    }
    if !["application/pdf", "image/jpeg", "image/png", "image/webp"]
        .contains(&input.content_type.as_str())
    {
        return Err(AppError::validation(
            "purchase bill file must be PDF, JPEG, PNG or WebP",
        ));
    }
    text(&input.file_name, 240)?;
    Ok(())
}
fn text(value: &str, max: usize) -> Result<&str, AppError> {
    let value = value.trim();
    if value.chars().count() > max {
        Err(AppError::validation("text value is too long"))
    } else {
        Ok(value)
    }
}
fn amount(value: i64) -> Result<i64, AppError> {
    if value < 0 {
        Err(AppError::validation("money values cannot be negative"))
    } else {
        Ok(value)
    }
}
fn date(value: &str, field: &str) -> Result<Option<NaiveDate>, AppError> {
    let value = value.trim();
    if value.is_empty() {
        Ok(None)
    } else {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| AppError::validation(format!("{field} must be YYYY-MM-DD")))
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_upload, UploadInput};
    #[test]
    fn upload_validation_accepts_pdf_and_rejects_text() {
        assert!(validate_upload(&UploadInput {
            file_name: "bill.pdf".into(),
            content_type: "application/pdf".into(),
            bytes: vec![1]
        })
        .is_ok());
        assert!(validate_upload(&UploadInput {
            file_name: "bill.txt".into(),
            content_type: "text/plain".into(),
            bytes: vec![1]
        })
        .is_err());
    }
}
