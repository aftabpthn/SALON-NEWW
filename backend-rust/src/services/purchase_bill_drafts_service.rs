use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use crate::{
    models::{common::AppError, migration_file::HistoricalEvidenceGroupDecisionRequest},
    repositories::{
        migration_file_repository, purchase_bill_draft_repository as repo, purchase_repository,
    },
    services::{
        migration_adapter_service, migration_file_service,
        purchase_service::{self, ReceiptInput, ReceiptLineInput, ReceiptTaxTotals},
    },
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
    pub ready_to_confirm: bool,
    pub blocking_issues: Vec<String>,
}

pub struct UploadInput {
    pub file_name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub struct SourceDocument {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalPilotDocumentInput {
    pub source_file_id: String,
    #[serde(default)]
    pub source_artifact_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalBulkStartInput {
    pub cutover_id: String,
    pub source_file_id: String,
    pub supplier_batch: String,
    pub provider: String,
    pub expected_bill_count: i32,
    pub expected_total_paise: Option<i64>,
    pub mapping_version: i32,
    pub worker_limit: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalBulkArchiveInput {
    #[serde(default)]
    pub allow_partial: bool,
    #[serde(default)]
    pub allow_live_collisions: bool,
    pub reason: String,
}

pub struct HeaderInput {
    pub supplier_id: Option<String>,
    pub purchase_order_id: Option<String>,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_phone: String,
    pub supplier_email: String,
    pub supplier_address: String,
    pub bill_contract: Value,
    pub bill_number: String,
    pub bill_date: Option<String>,
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_paise: i64,
    pub correction_reason: String,
}

pub struct SupplierInput {
    pub name: String,
    pub gstin: String,
    pub phone: String,
    pub email: String,
    pub address: String,
}

pub struct ProductInput {
    pub sku: String,
    pub name: String,
    pub category: String,
    pub brand: String,
    pub unit: String,
    pub package_unit: String,
    pub units_per_package: i32,
    pub unit_cost_paise: i64,
    pub hsn_code: String,
    pub gst_percent: i32,
    pub barcode: String,
    pub batch_tracked: bool,
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
    pub product_contract: Value,
    pub correction_reason: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AiLine {
    #[serde(default)]
    raw_name: String,
    #[serde(default)]
    supplier_sku: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    brand: String,
    #[serde(default)]
    barcode: String,
    #[serde(default)]
    unit: String,
    #[serde(default)]
    package_unit: String,
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
    #[serde(default = "empty_object")]
    product_contract: Value,
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
    supplier_phone: String,
    #[serde(default)]
    supplier_email: String,
    #[serde(default)]
    supplier_address: String,
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
    #[serde(default = "empty_object")]
    bill_contract: Value,
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
    workflow_mode: &str,
) -> Result<Vec<repo::DraftRecord>, AppError> {
    repo::list(&state.db, tenant, branch, status, workflow_mode)
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
    let draft = draft.ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    let blocking_issues = readiness_issues(&draft, &lines);
    Ok(DraftDetails {
        draft,
        lines,
        extractions,
        matches,
        events,
        ready_to_confirm: blocking_issues.is_empty(),
        blocking_issues,
    })
}

pub async fn source(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<SourceDocument, AppError> {
    let draft = repo::get(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill source"))?
        .ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    if draft.workflow_mode == "historical_pilot" {
        let evidence = migration_file_service::read_evidence_document(
            &state.db,
            tenant,
            branch,
            actor,
            draft
                .migration_source_file_id
                .as_deref()
                .ok_or_else(|| AppError::internal("historical pilot source is missing"))?,
            draft.migration_source_artifact_id.as_deref(),
        )
        .await?;
        return Ok(SourceDocument {
            content_type: evidence.content_type,
            bytes: evidence.bytes,
        });
    }
    let source = repo::source(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill source"))?
        .ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    Ok(SourceDocument {
        content_type: source.content_type,
        bytes: source
            .bytes
            .ok_or_else(|| AppError::internal("purchase bill source bytes are missing"))?,
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

pub async fn start_historical_pilot(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    cutover_id: &str,
    documents: Vec<HistoricalPilotDocumentInput>,
) -> Result<Value, AppError> {
    if !(20..=50).contains(&documents.len()) {
        return Err(AppError::validation(
            "historical pilot requires 20 to 50 evidence documents",
        ));
    }
    let mut identities = HashSet::new();
    if documents.iter().any(|document| {
        document.source_file_id.trim().is_empty()
            || !identities.insert((
                document.source_file_id.trim().to_string(),
                document
                    .source_artifact_id
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
            ))
    }) {
        return Err(AppError::validation(
            "historical pilot document selection contains an invalid duplicate",
        ));
    }
    if migration_file_repository::historical_evidence_cutover_approval(
        &state.db, tenant, branch, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to verify Phase 1 cutover approval"))?
    .is_none()
    {
        return Err(AppError::conflict(
            "Owner-approved Phase 1 cutover is required before the pilot",
        ));
    }
    let evidence_report =
        migration_file_service::historical_evidence_report(&state.db, tenant, branch, cutover_id)
            .await?;
    let active_files = evidence_report["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|file| file["evidenceState"] == "active")
        .filter_map(|file| file["sourceFileId"].as_str())
        .collect::<HashSet<_>>();
    let rejected_documents = evidence_report["groups"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|group| group["status"] == "rejected")
        .flat_map(|group| {
            group["documentKeys"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
        })
        .collect::<HashSet<_>>();
    if documents.iter().any(|document| {
        let source_file_id = document.source_file_id.trim();
        let key = document
            .source_artifact_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|artifact_id| format!("{source_file_id}:{}", artifact_id.trim()))
            .unwrap_or_else(|| source_file_id.to_string());
        !active_files.contains(source_file_id) || rejected_documents.contains(key.as_str())
    }) {
        return Err(AppError::conflict(
            "excluded or rejected evidence cannot be selected for the pilot",
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start historical purchase pilot"))?;
    let mut draft_ids = Vec::with_capacity(documents.len());
    for document in &documents {
        let id = repo::create_historical_pilot(
            &mut tx,
            tenant,
            branch,
            cutover_id,
            document.source_file_id.trim(),
            document
                .source_artifact_id
                .as_deref()
                .filter(|value| !value.trim().is_empty()),
            actor,
        )
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                AppError::conflict("a selected evidence document is already in this pilot")
            } else {
                AppError::conflict(
                    "pilot evidence is unavailable, unapproved, or outside this branch",
                )
            }
        })?;
        repo::add_event(
            &mut tx,
            tenant,
            branch,
            &id,
            "historical_pilot_queued",
            actor,
            &json!({
                "cutoverId":cutover_id,
                "sourceFileId":document.source_file_id,
                "sourceArtifactId":document.source_artifact_id,
                "stockEffectPaise":0,
                "accountingEffectPaise":0,
                "gstEffectPaise":0
            }),
        )
        .await
        .map_err(|_| AppError::internal("failed to audit historical pilot selection"))?;
        draft_ids.push(id);
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit historical purchase pilot"))?;

    let worker_state = state.clone();
    let worker_tenant = tenant.to_string();
    let worker_branch = branch.to_string();
    let worker_actor = actor.to_string();
    let worker_ids = draft_ids.clone();
    tokio::spawn(async move {
        for id in worker_ids {
            if let Err(error) = process_historical_pilot_document(
                &worker_state,
                &worker_tenant,
                &worker_branch,
                &worker_actor,
                &id,
            )
            .await
            {
                let _ = record_extraction_failure(
                    &worker_state,
                    &worker_tenant,
                    &worker_branch,
                    &worker_actor,
                    &id,
                    &error,
                )
                .await;
            }
        }
    });

    Ok(json!({
        "cutoverId":cutover_id,
        "draftIds":draft_ids,
        "status":"extracting",
        "stockEffectPaise":0,
        "accountingEffectPaise":0,
        "gstEffectPaise":0
    }))
}

async fn process_historical_pilot_document(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<(), String> {
    let draft = repo::get(&state.db, tenant, branch, id)
        .await
        .map_err(|_| "pilot draft could not be loaded".to_string())?
        .ok_or_else(|| "pilot draft was not found".to_string())?;
    let evidence = migration_file_service::read_evidence_document(
        &state.db,
        tenant,
        branch,
        actor,
        draft
            .migration_source_file_id
            .as_deref()
            .ok_or_else(|| "pilot source is missing".to_string())?,
        draft.migration_source_artifact_id.as_deref(),
    )
    .await
    .map_err(|_| "pilot evidence could not be read".to_string())?;
    let input = UploadInput {
        file_name: evidence.file_name,
        content_type: evidence.content_type,
        bytes: evidence.bytes,
    };
    validate_upload(&input).map_err(|_| "pilot evidence type or size is invalid".to_string())?;
    let extracted = extract(state, tenant, branch, &input).await?;
    save_extraction(state, tenant, branch, actor, id, extracted)
        .await
        .map_err(|_| "pilot extraction could not be saved".to_string())?;
    match_draft(state, tenant, branch, actor, id)
        .await
        .map_err(|_| "pilot matching could not be saved".to_string())?;
    Ok(())
}

async fn record_extraction_failure(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    error: &str,
) -> Result<(), AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to record extraction failure"))?;
    repo::fail_extraction(
        &mut tx,
        tenant,
        branch,
        id,
        "ai-service",
        &error.chars().take(500).collect::<String>(),
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to record extraction failure"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit extraction failure"))
}

#[derive(Default)]
struct AccuracyMetric {
    matched: usize,
    checked: usize,
}

impl AccuracyMetric {
    fn observe(&mut self, matched: bool) {
        self.checked += 1;
        self.matched += usize::from(matched);
    }

    fn json(&self, threshold_bps: i64) -> Value {
        let bps = (self.checked > 0).then(|| (self.matched as i64 * 10_000) / self.checked as i64);
        json!({
            "matched":self.matched,
            "checked":self.checked,
            "accuracyBps":bps,
            "thresholdBps":threshold_bps,
            "accepted":bps.map(|value| value >= threshold_bps)
        })
    }
}

fn same_text(raw: &Value, key: &str, reviewed: &str) -> bool {
    raw.get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(reviewed.trim()))
}

fn observe_text(metric: &mut AccuracyMetric, raw: &Value, key: &str, reviewed: &str) {
    let extracted = raw.get(key).and_then(Value::as_str).unwrap_or_default();
    if !extracted.trim().is_empty() || !reviewed.trim().is_empty() {
        metric.observe(extracted.trim().eq_ignore_ascii_case(reviewed.trim()));
    }
}

#[derive(Clone)]
struct PilotGroupingDocument {
    draft_id: String,
    file_name: String,
    supplier_batch: String,
    supplier_name: String,
    supplier_gstin: String,
    invoice_number: String,
    invoice_date: String,
    total_paise: i64,
    page_number: i64,
    page_count: i64,
    carry_forward_paise: i64,
    layout_fingerprint: String,
}

fn grouping_similarity(
    left: &PilotGroupingDocument,
    right: &PilotGroupingDocument,
) -> Option<(i64, Vec<&'static str>)> {
    if !left
        .supplier_batch
        .trim()
        .eq_ignore_ascii_case(right.supplier_batch.trim())
    {
        return None;
    }
    let left_supplier = if left.supplier_gstin.trim().is_empty() {
        normalize_product_text(&left.supplier_name)
    } else {
        normalize_product_text(&left.supplier_gstin)
    };
    let right_supplier = if right.supplier_gstin.trim().is_empty() {
        normalize_product_text(&right.supplier_name)
    } else {
        normalize_product_text(&right.supplier_gstin)
    };
    if left_supplier.is_empty() || left_supplier != right_supplier {
        return None;
    }
    let left_invoice = normalize_product_text(&left.invoice_number);
    let right_invoice = normalize_product_text(&right.invoice_number);
    if !left_invoice.is_empty() && !right_invoice.is_empty() && left_invoice != right_invoice {
        return None;
    }
    if !left.invoice_date.is_empty()
        && !right.invoice_date.is_empty()
        && left.invoice_date != right.invoice_date
    {
        return None;
    }
    let mut score = 1_500_i64;
    let mut signals = vec!["supplier"];
    let same_invoice = !left_invoice.is_empty() && left_invoice == right_invoice;
    if same_invoice {
        score += 4_500;
        signals.push("invoice_number");
    }
    let same_date = !left.invoice_date.is_empty() && left.invoice_date == right.invoice_date;
    if same_date {
        score += 1_000;
        signals.push("invoice_date");
    }
    if left.total_paise > 0 && left.total_paise == right.total_paise {
        score += 500;
        signals.push("total_amount");
    }
    let same_layout =
        !left.layout_fingerprint.is_empty() && left.layout_fingerprint == right.layout_fingerprint;
    if same_layout {
        score += 1_000;
        signals.push("layout");
    }
    let page_sequence = left.page_number > 0
        && right.page_number > 0
        && (left.page_number - right.page_number).abs() == 1;
    if page_sequence {
        score += 1_000;
        signals.push("page_sequence");
    }
    let carry_forward = left.carry_forward_paise > 0 || right.carry_forward_paise > 0;
    if carry_forward {
        score += 1_500;
        signals.push("carry_forward_total");
    }
    (same_invoice || (same_date && same_layout && (page_sequence || carry_forward)))
        .then_some((score.min(10_000), signals))
}

fn pilot_grouping_suggestions(documents: &[PilotGroupingDocument]) -> Vec<Value> {
    // ponytail: O(n²) is bounded by the enforced 50-document pilot.
    let mut parent = (0..documents.len()).collect::<Vec<_>>();
    fn root(parent: &mut [usize], mut index: usize) -> usize {
        while parent[index] != index {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        index
    }
    for left in 0..documents.len() {
        for right in left + 1..documents.len() {
            if grouping_similarity(&documents[left], &documents[right]).is_some() {
                let left_root = root(&mut parent, left);
                let right_root = root(&mut parent, right);
                parent[right_root] = left_root;
            }
        }
    }
    let mut components = HashMap::<usize, Vec<usize>>::new();
    for index in 0..documents.len() {
        let component = root(&mut parent, index);
        components.entry(component).or_default().push(index);
    }
    let mut suggestions = Vec::new();
    for members in components.into_values().filter(|members| members.len() > 1) {
        let mut member_scores = vec![0_i64; members.len()];
        let mut signals = HashSet::new();
        for left in 0..members.len() {
            for right in left + 1..members.len() {
                if let Some((score, pair_signals)) =
                    grouping_similarity(&documents[members[left]], &documents[members[right]])
                {
                    member_scores[left] = member_scores[left].max(score);
                    member_scores[right] = member_scores[right].max(score);
                    signals.extend(pair_signals);
                }
            }
        }
        let confidence_bps = member_scores.into_iter().min().unwrap_or(0);
        let mut pages = members
            .iter()
            .filter_map(|index| {
                (documents[*index].page_number > 0).then_some(documents[*index].page_number)
            })
            .collect::<Vec<_>>();
        pages.sort_unstable();
        pages.dedup();
        let missing_page = !pages.is_empty()
            && (pages[0] > 1 || pages.windows(2).any(|pair| pair[1] - pair[0] > 1));
        if missing_page {
            signals.insert("missing_page");
        }
        let all_invoice_identified = members
            .iter()
            .all(|index| !documents[*index].invoice_number.trim().is_empty());
        let confidence_level = if missing_page || confidence_bps < 6_500 {
            "red"
        } else if confidence_bps >= 9_000 && all_invoice_identified {
            "green"
        } else {
            "yellow"
        };
        let mut draft_ids = members
            .iter()
            .map(|index| documents[*index].draft_id.as_str())
            .collect::<Vec<_>>();
        draft_ids.sort_unstable();
        let digest = format!("{:x}", Sha256::digest(draft_ids.join("|").as_bytes()));
        let mut signal_list = signals.into_iter().collect::<Vec<_>>();
        signal_list.sort_unstable();
        let supplier_batch = documents[members[0]].supplier_batch.clone();
        suggestions.push(json!({
            "supplierBatch":supplier_batch,
            "groupKey":format!("pilot-{}", &digest[..16]),
            "detectedPageCount":members.iter().map(|index| documents[*index].page_count.max(1)).sum::<i64>(),
            "confidenceBps":confidence_bps,
            "confidenceLevel":confidence_level,
            "status":match confidence_level { "green" => "auto_grouped", "red" => "blocked", _ => "suggested" },
            "signals":signal_list,
            "documentIds":members.iter().map(|index| documents[*index].draft_id.clone()).collect::<Vec<_>>(),
            "fileNames":members.iter().map(|index| documents[*index].file_name.clone()).collect::<Vec<_>>()
        }));
    }
    suggestions.sort_by(|left, right| left["groupKey"].as_str().cmp(&right["groupKey"].as_str()));
    suggestions
}

pub async fn historical_pilot_report(
    state: &AppState,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
) -> Result<Value, AppError> {
    let drafts = repo::list_historical_pilot_only(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load historical pilot drafts"))?
        .into_iter()
        .filter(|draft| draft.migration_cutover_id.as_deref() == Some(cutover_id))
        .collect::<Vec<_>>();
    let evidence = migration_file_repository::list_historical_evidence_sources(
        &state.db, tenant, branch, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load historical pilot evidence"))?;
    let evidence_failures = migration_file_repository::list_historical_evidence_failures(
        &state.db, tenant, branch, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load historical evidence failures"))?;
    let grouping_decisions = migration_file_repository::list_historical_evidence_group_decisions(
        &state.db, tenant, branch, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load pilot grouping decisions"))?;
    let mut total_pages = 0_i64;
    let mut extracted_lines = 0_usize;
    let mut mapped_products = 0_usize;
    let mut manual_corrections = 0_usize;
    let mut financial_matched = 0_usize;
    let mut supplier_accuracy = AccuracyMetric::default();
    let mut invoice_accuracy = AccuracyMetric::default();
    let mut financial_accuracy = AccuracyMetric::default();
    let mut line_detection_accuracy = AccuracyMetric::default();
    let mut quantity_rate_tax_accuracy = AccuracyMetric::default();
    let mut batch_expiry_accuracy = AccuracyMetric::default();
    let mut supplier_mapping_accuracy = AccuracyMetric::default();
    let mut product_mapping_accuracy = AccuracyMetric::default();
    let mut silent_skips = 0_usize;
    let mut grouping_documents = Vec::new();
    let mut documents = Vec::with_capacity(drafts.len());
    for draft in &drafts {
        let details = details(state, tenant, branch, &draft.id).await?;
        let source = evidence.iter().find(|source| {
            Some(source.source_file_id.as_str()) == draft.migration_source_file_id.as_deref()
        });
        let document_pages = source
            .and_then(|source| {
                draft
                    .migration_source_artifact_id
                    .as_deref()
                    .and_then(|artifact_id| {
                        source
                            .artifacts_json
                            .as_array()?
                            .iter()
                            .find_map(|artifact| {
                                (artifact.get("id")?.as_str()? == artifact_id)
                                    .then(|| artifact.get("pageCount")?.as_i64())
                                    .flatten()
                            })
                    })
                    .or(Some(i64::from(source.page_count)))
            })
            .unwrap_or(0);
        total_pages += document_pages;
        let mut source_reconciliation = Value::Null;
        if let Some(raw) = details
            .extractions
            .iter()
            .find(|row| row.status == "succeeded")
            .map(|row| &row.raw_response)
        {
            source_reconciliation = json!({
                "source":{
                    "taxablePaise":raw.get("subtotal_paise").and_then(Value::as_i64),
                    "taxPaise":raw.get("cgst_paise").and_then(Value::as_i64).unwrap_or(0)
                        + raw.get("sgst_paise").and_then(Value::as_i64).unwrap_or(0)
                        + raw.get("igst_paise").and_then(Value::as_i64).unwrap_or(0),
                    "totalPaise":raw.get("total_paise").and_then(Value::as_i64)
                },
                "reviewed":{
                    "taxablePaise":draft.subtotal_paise,
                    "taxPaise":draft.cgst_paise + draft.sgst_paise + draft.igst_paise,
                    "totalPaise":draft.total_paise
                }
            });
            let contract = raw.get("bill_contract").unwrap_or(&Value::Null);
            grouping_documents.push(PilotGroupingDocument {
                draft_id: draft.id.clone(),
                file_name: draft.source_file_name.clone(),
                supplier_batch: source
                    .map(|row| row.supplier_batch.clone())
                    .unwrap_or_else(|| "Unidentified-Supplier".into()),
                supplier_name: raw
                    .get("supplier_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                supplier_gstin: raw
                    .get("supplier_gstin")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                invoice_number: raw
                    .get("bill_number")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                invoice_date: raw
                    .get("bill_date")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                total_paise: raw.get("total_paise").and_then(Value::as_i64).unwrap_or(0),
                page_number: contract
                    .get("pageNumber")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                page_count: document_pages.max(1),
                carry_forward_paise: contract
                    .get("carryForwardPaise")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
                layout_fingerprint: contract
                    .get("layoutFingerprint")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            });
            observe_text(
                &mut supplier_accuracy,
                raw,
                "supplier_name",
                &draft.supplier_name,
            );
            observe_text(
                &mut supplier_accuracy,
                raw,
                "supplier_gstin",
                &draft.supplier_gstin,
            );
            observe_text(
                &mut invoice_accuracy,
                raw,
                "bill_number",
                &draft.bill_number,
            );
            observe_text(
                &mut invoice_accuracy,
                raw,
                "bill_date",
                &draft
                    .bill_date
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
            );
            for (key, reviewed) in [
                ("subtotal_paise", draft.subtotal_paise),
                ("discount_paise", draft.discount_paise),
                ("cgst_paise", draft.cgst_paise),
                ("sgst_paise", draft.sgst_paise),
                ("igst_paise", draft.igst_paise),
                ("total_paise", draft.total_paise),
            ] {
                financial_accuracy.observe(raw.get(key).and_then(Value::as_i64) == Some(reviewed));
            }
            let raw_lines = raw
                .get("lines")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            line_detection_accuracy.observe(raw_lines.len() == details.lines.len());
            for (raw_line, reviewed) in raw_lines.iter().zip(&details.lines) {
                line_detection_accuracy.observe(same_text(
                    raw_line,
                    "raw_name",
                    &reviewed.raw_name,
                ));
                for (key, value) in [
                    ("purchase_quantity", i64::from(reviewed.purchase_quantity)),
                    ("unit_cost_paise", reviewed.unit_cost_paise),
                    ("gst_percent", i64::from(reviewed.gst_percent)),
                    ("taxable_paise", reviewed.taxable_paise),
                    ("cgst_paise", reviewed.cgst_paise),
                    ("sgst_paise", reviewed.sgst_paise),
                    ("igst_paise", reviewed.igst_paise),
                    ("total_paise", reviewed.total_paise),
                ] {
                    quantity_rate_tax_accuracy
                        .observe(raw_line.get(key).and_then(Value::as_i64) == Some(value));
                }
                let reviewed_expiry = reviewed
                    .expiry_date
                    .map(|date| date.to_string())
                    .unwrap_or_default();
                for (key, value) in [
                    ("batch_number", reviewed.batch_number.as_str()),
                    ("expiry_date", reviewed_expiry.as_str()),
                ] {
                    if !value.is_empty()
                        || raw_line
                            .get(key)
                            .and_then(Value::as_str)
                            .is_some_and(|value| !value.trim().is_empty())
                    {
                        batch_expiry_accuracy.observe(same_text(raw_line, key, value));
                    }
                }
            }
        }
        extracted_lines += details.lines.len();
        supplier_mapping_accuracy.observe(
            draft.supplier_id.is_some()
                || contract_text(&draft.bill_contract, "supplierMappingDecision")
                    == "keep_historical_only",
        );
        for line in &details.lines {
            product_mapping_accuracy.observe(
                line.inventory_item_id.is_some()
                    || contract_text(&line.product_contract, "mappingDecision")
                        == "keep_historical_only",
            );
        }
        if !matches!(
            draft.status.as_str(),
            "extraction_failed" | "quarantined" | "cancelled"
        ) && (draft.bill_number.trim().is_empty() || details.lines.is_empty())
        {
            silent_skips += 1;
        }
        mapped_products += details
            .lines
            .iter()
            .filter(|line| line.inventory_item_id.is_some())
            .count();
        manual_corrections += details
            .events
            .iter()
            .filter(|event| matches!(event.event_type.as_str(), "header_updated" | "line_updated"))
            .count();
        if !details
            .blocking_issues
            .iter()
            .any(|issue| issue.contains("reconcile") || issue.contains("total"))
        {
            financial_matched += 1;
        }
        documents.push(json!({
            "draftId":draft.id,
            "sourceFileId":draft.migration_source_file_id,
            "sourceArtifactId":draft.migration_source_artifact_id,
            "fileName":draft.source_file_name,
            "status":draft.status,
            "reviewDecision":draft.review_decision,
            "confidenceBps":draft.confidence_bps,
            "billNumber":draft.bill_number,
            "supplierName":draft.supplier_name,
            "lineCount":details.lines.len(),
            "blockingIssues":details.blocking_issues,
            "sourceVersusReviewed":source_reconciliation,
            "sha256":draft.source_sha256
        }));
    }
    let decision_map = grouping_decisions
        .iter()
        .map(|decision| {
            (
                (
                    decision.supplier_batch.as_str(),
                    decision.group_key.as_str(),
                ),
                decision,
            )
        })
        .collect::<HashMap<_, _>>();
    let mut grouping_suggestions = pilot_grouping_suggestions(&grouping_documents);
    for group in &mut grouping_suggestions {
        let supplier_batch = group["supplierBatch"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let group_key = group["groupKey"].as_str().unwrap_or_default().to_string();
        if let Some(decision) = decision_map.get(&(supplier_batch.as_str(), group_key.as_str())) {
            group["status"] = json!(decision.decision);
            group["approvedPageCount"] = json!(decision.approved_page_count);
            group["decidedBy"] = json!(decision.actor_user_id);
            group["decidedAt"] = json!(decision.created_at);
        }
    }
    let accepted_groups = grouping_suggestions
        .iter()
        .filter(|group| matches!(group["status"].as_str(), Some("auto_grouped" | "approved")))
        .collect::<Vec<_>>();
    let accepted_members = accepted_groups
        .iter()
        .flat_map(|group| group["documentIds"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let recognized = accepted_groups.len()
        + drafts
            .iter()
            .filter(|draft| {
                !accepted_members.contains(draft.id.as_str())
                    && !draft.bill_number.trim().is_empty()
            })
            .count();
    let mut invoice_identities = HashSet::new();
    let duplicate_bills = drafts
        .iter()
        .filter(|draft| {
            if accepted_members.contains(draft.id.as_str()) || draft.bill_number.trim().is_empty() {
                return false;
            }
            !invoice_identities.insert((
                normalize_product_text(&draft.supplier_name),
                draft.bill_number.trim().to_ascii_lowercase(),
            ))
        })
        .count();
    let failed = drafts
        .iter()
        .filter(|draft| matches!(draft.status.as_str(), "extraction_failed" | "quarantined"))
        .count();
    let supplier_mapped = drafts
        .iter()
        .filter(|draft| draft.supplier_id.is_some())
        .count();
    let total_confidence: i64 = drafts
        .iter()
        .map(|draft| i64::from(draft.confidence_bps))
        .sum();
    let duplicate_files = evidence_failures
        .iter()
        .filter(|failure| {
            failure
                .last_error
                .to_ascii_lowercase()
                .contains("duplicate")
        })
        .count();
    let grouping_approval_required = grouping_suggestions
        .iter()
        .filter(|group| group["status"] == "suggested")
        .count();
    let grouping_blocked = grouping_suggestions
        .iter()
        .filter(|group| group["status"] == "blocked")
        .count();
    Ok(json!({
        "cutoverId":cutover_id,
        "documents":documents,
        "summary":{
            "uploadedDocuments":drafts.len(),
            "recognizedBills":recognized,
            "totalPages":total_pages,
            "extractedProductLines":extracted_lines,
            "failedOrQuarantinedDocuments":failed,
            "duplicateFilesOrBills":duplicate_files + duplicate_bills,
            "duplicateArchiveCommits":0,
            "silentSkippedDocuments":silent_skips,
            "mappedSuppliers":supplier_mapped,
            "unmappedSuppliers":drafts.len().saturating_sub(supplier_mapped),
            "mappedProducts":mapped_products,
            "unmappedProducts":extracted_lines.saturating_sub(mapped_products),
            "manualCorrections":manual_corrections,
            "averageConfidenceBps":(!drafts.is_empty()).then(|| total_confidence / drafts.len() as i64),
            "financiallyReconciledDocuments":financial_matched,
            "groupedBills":accepted_groups.len(),
            "groupingApprovalRequired":grouping_approval_required,
            "groupingBlocked":grouping_blocked,
            "stockEffectPaise":0,
            "accountingEffectPaise":0,
            "gstEffectPaise":0
        },
        "accuracy":{
            "supplier":supplier_accuracy.json(9_800),
            "invoiceNumberAndDate":invoice_accuracy.json(9_900),
            "financial":financial_accuracy.json(10_000),
            "productLineDetection":line_detection_accuracy.json(9_700),
            "quantityRateAndTax":quantity_rate_tax_accuracy.json(9_900),
            "batchAndExpiry":batch_expiry_accuracy.json(9_900),
            "supplierMapping":supplier_mapping_accuracy.json(10_000),
            "productMapping":product_mapping_accuracy.json(10_000)
        },
        "grouping":{
            "suggestions":grouping_suggestions,
            "acceptanceRule":"Green groups are automatic; Yellow requires approval; Red cannot be approved"
        }
    }))
}

pub async fn decide_historical_pilot_group(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: HistoricalEvidenceGroupDecisionRequest,
) -> Result<Value, AppError> {
    let decision = request.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected")
        || request.cutover_id.trim().is_empty()
        || request.supplier_batch.trim().is_empty()
        || request.group_key.trim().is_empty()
        || request.approved_page_count <= 0
    {
        return Err(AppError::validation(
            "pilot group decision, group identity and positive page count are required",
        ));
    }
    let report = historical_pilot_report(state, tenant, branch, request.cutover_id.trim()).await?;
    let group = report["grouping"]["suggestions"]
        .as_array()
        .and_then(|groups| {
            groups.iter().find(|group| {
                group["supplierBatch"] == request.supplier_batch.trim()
                    && group["groupKey"] == request.group_key.trim()
            })
        })
        .ok_or_else(|| AppError::not_found("pilot grouping suggestion was not found"))?;
    let detected_pages = group["detectedPageCount"].as_i64().unwrap_or(0);
    if i64::from(request.approved_page_count) != detected_pages {
        return Err(AppError::validation(
            "approvedPageCount must exactly match the detected pilot pages",
        ));
    }
    if decision == "approved" && group["confidenceLevel"] == "red" {
        return Err(AppError::validation(
            "Red pilot grouping cannot be approved",
        ));
    }
    migration_file_repository::decide_historical_evidence_group(
        &state.db,
        tenant,
        branch,
        actor,
        request.cutover_id.trim(),
        request.supplier_batch.trim(),
        request.group_key.trim(),
        &decision,
        request.approved_page_count,
    )
    .await
    .map_err(|_| AppError::internal("failed to save pilot grouping decision"))?;
    historical_pilot_report(state, tenant, branch, request.cutover_id.trim()).await
}

pub async fn start_historical_bulk(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: HistoricalBulkStartInput,
) -> Result<Value, AppError> {
    let cutover_id = input.cutover_id.trim();
    let source_file_id = input.source_file_id.trim();
    let supplier_batch = input.supplier_batch.trim();
    let provider = input.provider.trim().to_ascii_lowercase();
    if cutover_id.is_empty()
        || source_file_id.is_empty()
        || supplier_batch.is_empty()
        || supplier_batch.chars().count() > 120
        || provider.is_empty()
        || provider.chars().count() > 40
        || !provider
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        || !(1..=250).contains(&input.expected_bill_count)
        || input.mapping_version <= 0
        || !(1..=4).contains(&input.worker_limit)
    {
        return Err(AppError::validation(
            "bulk batch metadata, 1-250 expected bills, positive mapping version and 1-4 workers are required",
        ));
    }
    let pilot = historical_pilot_report(state, tenant, branch, cutover_id).await?;
    let pilot_documents = pilot["documents"].as_array().cloned().unwrap_or_default();
    let pilot_summary = &pilot["summary"];
    let pilot_accuracy_passed = pilot["accuracy"].as_object().is_some_and(|metrics| {
        !metrics.is_empty() && metrics.values().all(|metric| metric["accepted"] == true)
    });
    let recognized_bills = pilot_summary["recognizedBills"].as_u64().unwrap_or(0);
    if !(20..=50).contains(&recognized_bills)
        || pilot_documents.iter().any(|document| {
            document["reviewDecision"].as_str() != Some("approved")
                || document["status"].as_str() != Some("reviewed")
        })
        || pilot_summary["failedOrQuarantinedDocuments"]
            .as_u64()
            .unwrap_or(1)
            > 0
        || pilot_summary["silentSkippedDocuments"]
            .as_u64()
            .unwrap_or(1)
            > 0
        || pilot_summary["financiallyReconciledDocuments"]
            .as_u64()
            .unwrap_or(0)
            != pilot_documents.len() as u64
        || pilot_summary["groupingApprovalRequired"]
            .as_u64()
            .unwrap_or(1)
            > 0
        || pilot_summary["groupingBlocked"].as_u64().unwrap_or(1) > 0
        || !pilot_accuracy_passed
    {
        return Err(AppError::conflict(
            "Phase 2 pilot must pass review and reconciliation before bulk archive starts",
        ));
    }
    let documents =
        repo::bulk_evidence_documents(&state.db, tenant, branch, cutover_id, source_file_id)
            .await
            .map_err(|_| AppError::internal("failed to load verified bulk evidence"))?;
    if documents.is_empty() {
        return Err(AppError::conflict(
            "verified historical bill documents were not found in this evidence batch",
        ));
    }
    if documents.len() != input.expected_bill_count as usize {
        return Err(AppError::conflict(
            "expected bill count does not match the approved evidence document count",
        )
        .with_details(json!({
            "expectedBillCount":input.expected_bill_count,
            "approvedDocumentCount":documents.len(),
            "action":"Resolve grouping or split multiple-bill PDFs before starting this batch"
        })));
    }
    let result = repo::create_historical_bulk_batch(
        &state.db,
        tenant,
        branch,
        cutover_id,
        source_file_id,
        supplier_batch,
        &provider,
        input.expected_bill_count,
        input.expected_total_paise,
        input.mapping_version,
        migration_adapter_service::MIGRATION_TRANSFORMER_VERSION,
        input.worker_limit,
        &documents,
        actor,
    )
    .await;
    let job_id = match result {
        Ok(id) => id,
        Err(error)
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation()) =>
        {
            return Err(AppError::conflict(
                "this evidence batch or one of its documents is already registered",
            ))
        }
        Err(_) => return Err(AppError::internal("failed to create historical bulk batch")),
    };
    Ok(json!({
        "jobId":job_id,
        "status":"queued",
        "postingMode":"history_only",
        "documentCount":documents.len(),
        "stockEffectPaise":0,
        "accountingEffectPaise":0,
        "gstEffectPaise":0,
        "payableEffectPaise":0
    }))
}

pub async fn historical_bulk_report(
    state: &AppState,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
) -> Result<Value, AppError> {
    let batches = repo::historical_bulk_report(&state.db, tenant, branch, cutover_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load historical bulk archive"))?;
    Ok(json!({
        "cutoverId":cutover_id.trim(),
        "batches":batches,
        "stockEffectPaise":0,
        "accountingEffectPaise":0,
        "gstEffectPaise":0,
        "payableEffectPaise":0
    }))
}

pub async fn archive_historical_bulk(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    job_id: &str,
    input: HistoricalBulkArchiveInput,
) -> Result<Value, AppError> {
    let job_id = job_id.trim();
    let reason = text(&input.reason, 500)?;
    if job_id.is_empty() {
        return Err(AppError::validation("bulk archive job id is required"));
    }
    if (input.allow_partial || input.allow_live_collisions) && reason.is_empty() {
        return Err(AppError::validation(
            "authorized exception reason is required",
        ));
    }
    repo::archive_historical_bulk_batch(
        &state.db,
        tenant,
        branch,
        job_id,
        actor,
        input.allow_partial,
        input.allow_live_collisions,
        &reason,
    )
    .await
    .map_err(|error| {
        let code = error.to_string();
        if code.contains("HISTORICAL_BULK_UNRESOLVED_DOCUMENTS") {
            AppError::conflict(
                "all documents must be ready or explicitly quarantined before archive approval",
            )
        } else if code.contains("HISTORICAL_BULK_LIVE_RECEIPT_COLLISION") {
            AppError::conflict(
                "historical invoice collides with a live receipt; Owner explanation is required",
            )
        } else if code.contains("HISTORICAL_BULK_EXPECTED_COUNT_MISMATCH") {
            AppError::conflict("batch bill count does not reconcile")
        } else if code.contains("HISTORICAL_BULK_EXPECTED_TOTAL_MISMATCH") {
            AppError::conflict("batch total does not reconcile with the expected total")
        } else if code.contains("HISTORICAL_BULK_FINANCIAL_MISMATCH") {
            AppError::conflict("one or more reviewed bills do not financially reconcile")
        } else if code.contains("HISTORICAL_BULK_BILL")
            || code.contains("HISTORICAL_BULK_PRODUCT_LINE")
        {
            AppError::conflict("one or more reviewed bills still have missing required data")
        } else if matches!(error, sqlx::Error::RowNotFound) {
            AppError::not_found("historical bulk archive batch was not found")
        } else {
            AppError::internal("failed to archive historical bulk batch")
        }
    })
}

pub async fn process_due_historical_bulk(state: &AppState) -> Result<usize, AppError> {
    let mut workers = tokio::task::JoinSet::new();
    for slot in 0..4 {
        let worker_id = format!("historical-bulk-{}-{slot}", Utc::now().timestamp_millis());
        let Some(item) = repo::claim_historical_bulk_document(&state.db, &worker_id)
            .await
            .map_err(|_| AppError::internal("failed to claim historical bulk document"))?
        else {
            break;
        };
        let worker_state = state.clone();
        workers.spawn(async move {
            let draft = repo::get(
                &worker_state.db,
                &item.tenant_id,
                &item.branch_id,
                &item.draft_id,
            )
            .await
            .map_err(|_| "bulk draft could not be loaded".to_string())?
            .ok_or_else(|| "bulk draft was not found".to_string())?;
            if draft.status == "extraction_failed"
                && !repo::begin_extraction_retry(
                    &worker_state.db,
                    &item.tenant_id,
                    &item.branch_id,
                    &item.draft_id,
                )
                .await
                .map_err(|_| "bulk extraction retry could not start".to_string())?
            {
                return Err("bulk draft is not retry eligible".to_string());
            }
            if !repo::mark_historical_bulk_extracting(&worker_state.db, &item.item_id, &worker_id)
                .await
                .map_err(|_| "bulk extraction checkpoint could not be saved".to_string())?
            {
                return Ok(());
            }
            let extraction = tokio::time::timeout(
                Duration::from_secs(90),
                process_historical_pilot_document(
                    &worker_state,
                    &item.tenant_id,
                    &item.branch_id,
                    &item.actor_user_id,
                    &item.draft_id,
                ),
            )
            .await
            .map_err(|_| "historical bill extraction timed out".to_string())
            .and_then(|result| result);
            if let Err(error) = &extraction {
                let _ = record_extraction_failure(
                    &worker_state,
                    &item.tenant_id,
                    &item.branch_id,
                    &item.actor_user_id,
                    &item.draft_id,
                    error,
                )
                .await;
            }
            repo::finish_historical_bulk_document(
                &worker_state.db,
                &item,
                &worker_id,
                extraction.as_ref().err().map(String::as_str),
            )
            .await
            .map_err(|_| "bulk extraction result could not be checkpointed".to_string())?;
            extraction
        });
    }
    let mut processed = 0;
    while let Some(result) = workers.join_next().await {
        processed += 1;
        if let Ok(Err(error)) = result {
            tracing::warn!(error = %error, "historical bulk document failed");
        }
    }
    Ok(processed)
}

pub async fn review_historical_pilot(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    decision: &str,
    reason: &str,
) -> Result<DraftDetails, AppError> {
    if !matches!(decision, "approved" | "quarantined" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved, quarantined, or rejected",
        ));
    }
    let reason = text(reason, 500)?;
    if reason.is_empty() {
        return Err(AppError::validation("review reason is required"));
    }
    let current = details(state, tenant, branch, id).await?;
    if current.draft.workflow_mode != "historical_pilot" {
        return Err(AppError::conflict(
            "only a historical pilot document can use this review action",
        ));
    }
    if decision == "approved" && !current.blocking_issues.is_empty() {
        return Err(
            AppError::conflict("pilot review has unresolved blocking issues")
                .with_details(json!({"blockingIssues":current.blocking_issues})),
        );
    }
    if !repo::review_historical_pilot(&state.db, tenant, branch, id, decision, reason, actor)
        .await
        .map_err(|_| AppError::internal("failed to save historical pilot review"))?
    {
        return Err(AppError::conflict(
            "historical pilot document cannot be reviewed in its current state",
        ));
    }
    repo::sync_historical_bulk_review(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to update historical bulk review state"))?;
    audit(
        state,
        tenant,
        branch,
        id,
        "historical_pilot_reviewed",
        actor,
        json!({"decision":decision,"reason":reason,"stockEffectPaise":0,"accountingEffectPaise":0,"gstEffectPaise":0}),
    )
    .await?;
    details(state, tenant, branch, id).await
}

pub async fn retry_extraction(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    let current = details(state, tenant, branch, id).await?;
    if !repo::begin_extraction_retry(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to start purchase bill extraction retry"))?
    {
        return Err(AppError::conflict(
            "only an empty failed or incomplete extraction can be retried",
        ));
    }
    let source = source(state, tenant, branch, actor, id).await?;
    let input = UploadInput {
        file_name: current.draft.source_file_name,
        content_type: source.content_type,
        bytes: source.bytes,
    };
    match extract(state, tenant, branch, &input).await {
        Ok(result) => save_extraction(state, tenant, branch, actor, id, result).await?,
        Err(error) => {
            let mut tx = state
                .db
                .begin()
                .await
                .map_err(|_| AppError::internal("failed to record extraction retry failure"))?;
            repo::fail_extraction(&mut tx, tenant, branch, id, "ai-service", &error, actor)
                .await
                .map_err(|_| AppError::internal("failed to record extraction retry failure"))?;
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to commit extraction retry failure"))?;
        }
    }
    let result = match_draft(state, tenant, branch, actor, id).await?;
    repo::sync_historical_bulk_review(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to update historical bulk retry state"))?;
    Ok(result)
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
    let extracted = envelope
        .data
        .ok_or_else(|| "AI extraction returned no data".to_string())?;
    if extracted.provider == "manual_review" {
        return Err(extracted
            .warnings
            .as_array()
            .and_then(|items| items.first())
            .and_then(Value::as_str)
            .unwrap_or("Manual entry required")
            .to_string());
    }
    Ok(extracted)
}

async fn save_extraction(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    extracted: AiExtraction,
) -> Result<(), AppError> {
    validate_bill_contract(&extracted.bill_contract)?;
    let raw = serde_json::to_value(&extracted).unwrap_or_else(|_| json!({}));
    let header = repo::ExtractedDraftData {
        supplier_name: text(&extracted.supplier_name, 200)?,
        supplier_gstin: text(&extracted.supplier_gstin, 15)?,
        supplier_phone: text(&extracted.supplier_phone, 40)?,
        supplier_email: text(&extracted.supplier_email, 254)?,
        supplier_address: text(&extracted.supplier_address, 1000)?,
        bill_contract: object(&extracted.bill_contract, "billContract")?,
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
        validate_product_contract(&source.product_contract)?;
        let purchase_quantity = source.purchase_quantity.max(0);
        let conversion = source.conversion_factor.max(1);
        let mut field_evidence = source.field_evidence.clone();
        if let Some(evidence) = field_evidence.as_object_mut() {
            evidence.insert(
                "_product".into(),
                json!({
                    "category": source.category,
                    "brand": source.brand,
                    "barcode": source.barcode,
                    "unit": source.unit,
                    "packageUnit": source.package_unit,
                }),
            );
        }
        let line = repo::DraftLineData {
            raw_name: text(&source.raw_name, 240)?,
            supplier_sku: text(&source.supplier_sku, 120)?,
            inventory_item_id: None,
            hsn_sac: text(&source.hsn_sac, 40)?,
            purchase_quantity,
            pack_size: source.pack_size.max(1),
            conversion_factor: conversion,
            quantity: purchase_quantity.saturating_mul(conversion),
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
            product_contract: object(&source.product_contract, "productContract")?,
            confidence_bps: source.confidence_bps.clamp(0, 10000),
            warnings: &source.warnings,
            field_evidence: &field_evidence,
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
    validate_bill_contract(&input.bill_contract)?;
    let before = repo::get(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill correction baseline"))?
        .ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    let correction_reason = text(&input.correction_reason, 500)?;
    if before.workflow_mode == "historical_pilot" && correction_reason.is_empty() {
        return Err(AppError::validation(
            "correctionReason is required for a historical pilot correction",
        ));
    }
    if before.workflow_mode == "historical_pilot"
        && [
            "pageCount",
            "pageNumber",
            "carryForwardPaise",
            "layoutFingerprint",
            "imageQualityScoreBps",
            "qualityWarnings",
        ]
        .iter()
        .any(|key| before.bill_contract.get(key) != input.bill_contract.get(key))
    {
        return Err(AppError::validation(
            "document quality, page and grouping evidence cannot be manually overwritten",
        ));
    }
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
    if !gstin.is_empty() && !valid_gstin(gstin) {
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
        text(&input.supplier_phone, 40)?,
        text(&input.supplier_email, 254)?,
        text(&input.supplier_address, 1000)?,
        object(&input.bill_contract, "billContract")?,
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
        json!({
            "reason":correction_reason,
            "oldValue":{
                "supplierId":before.supplier_id,"supplierName":before.supplier_name,
                "supplierGstin":before.supplier_gstin,"supplierPhone":before.supplier_phone,
                "supplierEmail":before.supplier_email,"supplierAddress":before.supplier_address,
                "billContract":before.bill_contract,"billNumber":before.bill_number,
                "billDate":before.bill_date,"subtotalPaise":before.subtotal_paise,
                "discountPaise":before.discount_paise,"cgstPaise":before.cgst_paise,
                "sgstPaise":before.sgst_paise,"igstPaise":before.igst_paise,
                "totalPaise":before.total_paise
            },
            "newValue":{
                "supplierId":input.supplier_id,"supplierName":input.supplier_name,
                "supplierGstin":input.supplier_gstin,"supplierPhone":input.supplier_phone,
                "supplierEmail":input.supplier_email,"supplierAddress":input.supplier_address,
                "billContract":input.bill_contract,"billNumber":input.bill_number,
                "billDate":input.bill_date,"subtotalPaise":input.subtotal_paise,
                "discountPaise":input.discount_paise,"cgstPaise":input.cgst_paise,
                "sgstPaise":input.sgst_paise,"igstPaise":input.igst_paise,
                "totalPaise":input.total_paise
            }
        }),
    )
    .await?;
    match_draft(state, tenant, branch, actor, id).await
}

pub async fn create_supplier(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    input: SupplierInput,
) -> Result<DraftDetails, AppError> {
    let current = details(state, tenant, branch, id).await?;
    if !matches!(
        current.draft.status.as_str(),
        "review" | "extraction_failed"
    ) {
        return Err(AppError::conflict(
            "purchase bill draft cannot be edited in its current state",
        ));
    }
    let name = text(&input.name, 200)?;
    if name.is_empty() {
        return Err(AppError::validation("supplier name is required"));
    }
    let gstin = text(&input.gstin, 15)?;
    if !gstin.is_empty() && !valid_gstin(gstin) {
        return Err(AppError::validation(
            "supplierGstin must be 15 alphanumeric characters",
        ));
    }
    let saved = purchase_repository::save_supplier_from_bill(
        &state.db,
        tenant,
        branch,
        name,
        gstin,
        text(&input.phone, 40)?,
        text(&input.email, 254)?,
        text(&input.address, 1000)?,
        id,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create or link supplier"))?;
    if !saved.supplier.active {
        return Err(AppError::conflict("matching supplier is inactive"));
    }
    match_draft(state, tenant, branch, actor, id).await
}

pub async fn create_and_link_product(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    draft: &str,
    line: &str,
    input: ProductInput,
) -> Result<DraftDetails, AppError> {
    let name = text(&input.name, 240)?;
    let sku = text(&input.sku, 80)?.to_ascii_uppercase();
    let category = text(&input.category, 120)?;
    let brand = text(&input.brand, 120)?;
    let barcode = text(&input.barcode, 120)?.to_ascii_uppercase();
    let hsn = text(&input.hsn_code, 8)?;
    let unit = input.unit.trim().to_ascii_lowercase();
    let package_unit = input.package_unit.trim().to_ascii_lowercase();
    if name.is_empty() || sku.is_empty() || category.is_empty() {
        return Err(AppError::validation(
            "product name, SKU and category are required",
        ));
    }
    if !matches!(unit.as_str(), "pcs" | "bottle" | "kit" | "ml" | "g") {
        return Err(AppError::validation(
            "unit must be pcs, bottle, kit, ml, or g",
        ));
    }
    if !matches!(
        package_unit.as_str(),
        "pcs" | "box" | "bottle" | "jar" | "tube" | "pouch" | "pack"
    ) {
        return Err(AppError::validation("packageUnit is invalid"));
    }
    if input.units_per_package <= 0
        || input.unit_cost_paise < 0
        || !(0..=100).contains(&input.gst_percent)
        || (!hsn.is_empty()
            && (!hsn.chars().all(|ch| ch.is_ascii_digit()) || !(4..=8).contains(&hsn.len())))
        || !barcode
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-. $/+%".contains(ch))
    {
        return Err(AppError::validation("product values are invalid"));
    }
    repo::create_and_link_product(
        &state.db,
        tenant,
        branch,
        draft,
        line,
        actor,
        &repo::LinkedProductData {
            sku: &sku,
            name,
            category,
            brand,
            unit: &unit,
            package_unit: &package_unit,
            units_per_package: input.units_per_package,
            unit_cost_paise: input.unit_cost_paise,
            hsn_code: hsn,
            gst_percent: input.gst_percent,
            barcode: &barcode,
            batch_tracked: input.batch_tracked,
        },
    )
    .await
    .map_err(|_| {
        AppError::conflict("SKU, barcode or normalized product name already exists in this branch")
    })?
    .ok_or_else(|| {
        AppError::conflict("product duplicates an existing item or the draft line is not editable")
    })?;
    match_draft(state, tenant, branch, actor, draft).await
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
    let draft_row = repo::get(&state.db, tenant, branch, draft)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill draft"))?
        .ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    let correction_reason = text(&input.correction_reason, 500)?;
    if draft_row.workflow_mode == "historical_pilot" && correction_reason.is_empty() {
        return Err(AppError::validation(
            "correctionReason is required for a historical pilot correction",
        ));
    }
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
        &json!({"lineNumber":number,"reason":correction_reason}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write purchase bill line event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase bill line"))?;
    match_draft(state, tenant, branch, actor, draft).await
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
    let before = repo::lines(&state.db, tenant, branch, draft)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill correction baseline"))?
        .into_iter()
        .find(|line| line.id == id)
        .ok_or_else(|| AppError::not_found("editable purchase bill line was not found"))?;
    let draft_row = repo::get(&state.db, tenant, branch, draft)
        .await
        .map_err(|_| AppError::internal("failed to load purchase bill draft"))?
        .ok_or_else(|| AppError::not_found("purchase bill draft was not found"))?;
    let correction_reason = text(&input.correction_reason, 500)?;
    if draft_row.workflow_mode == "historical_pilot" && correction_reason.is_empty() {
        return Err(AppError::validation(
            "correctionReason is required for a historical pilot correction",
        ));
    }
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
        json!({
            "lineId":id,"reason":correction_reason,
            "oldValue":before,
            "newValue":{
                "rawName":input.raw_name,"supplierSku":input.supplier_sku,
                "inventoryItemId":input.inventory_item_id,"hsnSac":input.hsn_sac,
                "purchaseQuantity":input.purchase_quantity,"packSize":input.pack_size,
                "conversionFactor":input.conversion_factor,"quantity":input.quantity,
                "unitCostPaise":input.unit_cost_paise,"discountBps":input.discount_bps,
                "discountPaise":input.discount_paise,"gstPercent":input.gst_percent,
                "taxablePaise":input.taxable_paise,"cgstPaise":input.cgst_paise,
                "sgstPaise":input.sgst_paise,"igstPaise":input.igst_paise,
                "totalPaise":input.total_paise,"batchNumber":input.batch_number,
                "expiryDate":input.expiry_date,"productContract":input.product_contract
            }
        }),
    )
    .await?;
    match_draft(state, tenant, branch, actor, draft).await
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
    let mut match_lock = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to lock purchase bill matching"))?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{tenant}:{branch}:{id}"))
        .execute(&mut *match_lock)
        .await
        .map_err(|_| AppError::internal("failed to lock purchase bill matching"))?;
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
            let learned = repo::alias_inventory_item(
                &state.db,
                tenant,
                branch,
                supplier.as_deref(),
                &line.supplier_sku,
                &line.raw_name,
            )
            .await
            .map_err(|_| AppError::internal("failed to match learned item alias"))?;
            let item_match = match learned {
                Some(item) => Some((item, "learned supplier alias", 9800, "learned")),
                None => repo::exact_inventory_item(
                    &state.db,
                    tenant,
                    branch,
                    &line.supplier_sku,
                    &line.raw_name,
                )
                .await
                .map_err(|_| AppError::internal("failed to match item"))?
                .map(|item| (item, "exact sku, barcode or name", 10000, "exact")),
            };
            if let Some((item, method, score, status)) = item_match {
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
                    score,
                    status,
                    &json!({"method":method}),
                    actor,
                )
                .await
                .map_err(|_| AppError::internal("failed to save item match"))?;
            } else {
                let product = product_metadata(line);
                let patterns = normalized_tokens(&format!(
                    "{} {} {}",
                    line.raw_name,
                    product
                        .and_then(|value| value.get("brand"))
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    product
                        .and_then(|value| value.get("category"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                ))
                .into_iter()
                .filter(|token| token.len() > 1)
                .map(|token| format!("%{token}%"))
                .collect();
                let mut candidates = repo::inventory_candidates(
                    &state.db,
                    tenant,
                    branch,
                    &line.supplier_sku,
                    &line.hsn_sac,
                    patterns,
                )
                .await
                .map_err(|_| AppError::internal("failed to find item candidates"))?
                .into_iter()
                .map(|candidate| (candidate_score(line, &candidate), candidate))
                .filter(|(score, _)| *score >= 4000)
                .collect::<Vec<_>>();
                candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
                for (score, candidate) in candidates.into_iter().take(3) {
                    repo::add_match(
                        &state.db,
                        tenant,
                        branch,
                        id,
                        Some(&line.id),
                        "inventory_item",
                        &candidate.id,
                        score,
                        "fuzzy",
                        &json!({
                            "method":"weighted product similarity",
                            "reason":candidate_reason(line, &candidate),
                            "name":candidate.name,
                            "sku":candidate.sku,
                            "barcode":candidate.barcode,
                            "category":candidate.category,
                            "brand":candidate.brand,
                            "hsnCode":candidate.hsn_code,
                        }),
                        actor,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to save item candidate"))?;
                }
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
                repo::add_match(
                    &state.db,
                    tenant,
                    branch,
                    id,
                    None,
                    "purchase_order",
                    &order,
                    9000,
                    "fuzzy",
                    &json!({"method":"supplier and nearest total"}),
                    actor,
                )
                .await
                .map_err(|_| AppError::internal("failed to save order match"))?;
            }
        }
    }
    audit(state, tenant, branch, id, "matched", actor, json!({})).await?;
    match_lock
        .commit()
        .await
        .map_err(|_| AppError::internal("failed to release purchase bill matching lock"))?;
    details(state, tenant, branch, id).await
}

pub async fn confirm(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    actor_role: &str,
    id: &str,
) -> Result<DraftDetails, AppError> {
    let current = details(state, tenant, branch, id).await?;
    if current.draft.workflow_mode == "historical_pilot" {
        return Err(AppError::conflict(
            "historical pilot review cannot post a GRN, stock, accounting, GST, or payable entry",
        ));
    }
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
    if !current.blocking_issues.is_empty() {
        return Err(AppError::validation(current.blocking_issues.join("; ")));
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
    let header_expected = current
        .draft
        .subtotal_paise
        .checked_sub(current.draft.discount_paise)
        .and_then(|value| value.checked_add(current.draft.cgst_paise))
        .and_then(|value| value.checked_add(current.draft.sgst_paise))
        .and_then(|value| value.checked_add(current.draft.igst_paise))
        .and_then(|value| {
            value.checked_add(contract_i64(&current.draft.bill_contract, "freightPaise"))
        })
        .and_then(|value| {
            value.checked_add(contract_i64(&current.draft.bill_contract, "handlingPaise"))
        })
        .and_then(|value| {
            value.checked_add(contract_i64(
                &current.draft.bill_contract,
                "otherChargesPaise",
            ))
        })
        .and_then(|value| {
            value.checked_add(contract_i64(&current.draft.bill_contract, "roundOffPaise"))
        })
        .ok_or_else(|| AppError::validation("purchase bill totals are too large"))?;
    if differs(current.draft.total_paise, header_expected)
        || current.lines.iter().any(|line| {
            expected_line_total(line).map_or(true, |value| differs(line.total_paise, value))
        })
    {
        return Err(AppError::validation(
            "purchase bill calculated totals must match before confirmation",
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
        actor_role,
        matches!(
            actor_role.trim().to_ascii_lowercase().as_str(),
            "owner" | "admin" | "manager" | "inventory manager"
        ),
        ReceiptInput {
            supplier_id: Some(supplier.clone()),
            purchase_order_id: current.draft.purchase_order_id.clone(),
            supplier_name: current.draft.supplier_name.clone(),
            supplier_gstin: current.draft.supplier_gstin.clone(),
            supplier_invoice_number: current.draft.bill_number.clone(),
            supplier_invoice_date: current.draft.bill_date.map(|v| v.to_string()),
            received_date: current.draft.bill_date.map(|v| v.to_string()),
            due_date: nonempty_contract_text(&current.draft.bill_contract, "dueDate"),
            challan_number: contract_text(&current.draft.bill_contract, "challanNumber"),
            delivery_reference: contract_text(&current.draft.bill_contract, "poNumber"),
            shipping_paise: contract_i64(&current.draft.bill_contract, "freightPaise"),
            handling_paise: contract_i64(&current.draft.bill_contract, "handlingPaise")
                .saturating_add(contract_i64(
                    &current.draft.bill_contract,
                    "otherChargesPaise",
                )),
            round_off_paise: contract_i64(&current.draft.bill_contract, "roundOffPaise"),
            tax_totals: Some(ReceiptTaxTotals {
                cgst_paise: current.draft.cgst_paise,
                sgst_paise: current.draft.sgst_paise,
                igst_paise: current.draft.igst_paise,
            }),
            idempotency_key: format!("purchase-bill-draft:{id}"),
            backdated_operational_approval: false,
            accept_excess: false,
            request_master_price_updates: std::collections::HashSet::new(),
            lines: current
                .lines
                .iter()
                .map(|line| ReceiptLineInput {
                    inventory_item_id: line.inventory_item_id.clone().unwrap_or_default(),
                    quantity: line.purchase_quantity,
                    retail_quantity: None,
                    consumable_quantity: None,
                    free_quantity: contract_i32(&line.product_contract, "freeQuantity"),
                    unit_cost_paise: line.unit_cost_paise,
                    discount_bps: line.discount_bps,
                    gst_percent: Some(line.gst_percent),
                    damaged_quantity: contract_i32(&line.product_contract, "damagedQuantity"),
                    rejected_quantity: contract_i32(&line.product_contract, "rejectedQuantity"),
                    variance_reason: String::new(),
                    batch_number: Some(line.batch_number.clone()),
                    batch_barcode: None,
                    expiry_date: line.expiry_date.map(|v| v.to_string()),
                })
                .collect(),
        },
    )
    .await?;
    for line in &current.lines {
        repo::learn_item_alias(
            &state.db,
            tenant,
            branch,
            Some(&supplier),
            &line.supplier_sku,
            &line.raw_name,
            line.inventory_item_id.as_deref().unwrap_or_default(),
            actor,
        )
        .await
        .map_err(|_| AppError::internal("failed to learn reviewed purchase bill item alias"))?;
    }
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
    validate_product_contract(&input.product_contract)?;
    if input.purchase_quantity < 0
        || input.pack_size <= 0
        || input.conversion_factor <= 0
        || input.purchase_quantity.checked_mul(input.conversion_factor) != Some(input.quantity)
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
        product_contract: object(&input.product_contract, "productContract")?,
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
    let valid_signature = match input.content_type.as_str() {
        "application/pdf" => input.bytes.starts_with(b"%PDF-"),
        "image/jpeg" => input.bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/png" => input.bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => input.bytes.starts_with(b"RIFF") && input.bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !valid_signature {
        return Err(AppError::validation(
            "purchase bill content does not match its declared file type",
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
fn object<'a>(value: &'a Value, field: &str) -> Result<&'a Value, AppError> {
    value
        .is_object()
        .then_some(value)
        .ok_or_else(|| AppError::validation(format!("{field} must be an object")))
}
fn validate_bill_contract(value: &Value) -> Result<(), AppError> {
    let value = object(value, "billContract")?;
    for key in ["freightPaise", "handlingPaise", "otherChargesPaise"] {
        if value
            .get(key)
            .is_some_and(|item| item.as_i64().is_none_or(|number| number < 0))
        {
            return Err(AppError::validation(format!(
                "billContract.{key} must be a non-negative integer"
            )));
        }
    }
    if value
        .get("roundOffPaise")
        .is_some_and(|item| item.as_i64().is_none())
    {
        return Err(AppError::validation(
            "billContract.roundOffPaise must be an integer",
        ));
    }
    if value
        .get("pageCount")
        .is_some_and(|item| item.as_i64().is_none_or(|number| number <= 0))
    {
        return Err(AppError::validation(
            "billContract.pageCount must be a positive integer",
        ));
    }
    if value
        .get("pageNumber")
        .is_some_and(|item| item.as_i64().is_none_or(|number| number < 0))
    {
        return Err(AppError::validation(
            "billContract.pageNumber must be a non-negative integer",
        ));
    }
    if value
        .get("carryForwardPaise")
        .is_some_and(|item| item.as_i64().is_none_or(|number| number < 0))
    {
        return Err(AppError::validation(
            "billContract.carryForwardPaise must be a non-negative integer",
        ));
    }
    if value.get("layoutFingerprint").is_some_and(|item| {
        item.as_str().is_none_or(|fingerprint| {
            fingerprint.len() > 64
                || !fingerprint
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    }) {
        return Err(AppError::validation(
            "billContract.layoutFingerprint must be a short structural token",
        ));
    }
    if value.get("imageQualityScoreBps").is_some_and(|item| {
        item.as_i64()
            .is_none_or(|number| !(0..=10000).contains(&number))
    }) {
        return Err(AppError::validation(
            "billContract.imageQualityScoreBps must be between 0 and 10000",
        ));
    }
    if value
        .get("qualityWarnings")
        .is_some_and(|item| !item.is_array())
    {
        return Err(AppError::validation(
            "billContract.qualityWarnings must be an array",
        ));
    }
    if let Some(currency) = value
        .get("currency")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
            return Err(AppError::validation(
                "billContract.currency must be a three-letter uppercase code",
            ));
        }
    }
    if let Some(document_type) = value
        .get("documentType")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        if !matches!(
            document_type,
            "purchase_bill"
                | "credit_note"
                | "purchase_return"
                | "cancelled_bill"
                | "revised_invoice"
        ) {
            return Err(AppError::validation("billContract.documentType is invalid"));
        }
    }
    if let Some(due) = value
        .get("dueDate")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        date(due, "billContract.dueDate")?;
    }
    if let Some(received) = value
        .get("receivedDate")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        date(received, "billContract.receivedDate")?;
    }
    Ok(())
}
fn validate_product_contract(value: &Value) -> Result<(), AppError> {
    let value = object(value, "productContract")?;
    for key in [
        "mrpPaise",
        "freeQuantity",
        "acceptedQuantity",
        "damagedQuantity",
        "rejectedQuantity",
    ] {
        if value
            .get(key)
            .is_some_and(|item| item.as_i64().is_none_or(|number| number < 0))
        {
            return Err(AppError::validation(format!(
                "productContract.{key} must be a non-negative integer"
            )));
        }
    }
    if let Some(day) = value
        .get("manufactureDate")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        date(day, "productContract.manufactureDate")?;
    }
    if let Some(decision) = value
        .get("mappingDecision")
        .and_then(Value::as_str)
        .filter(|item| !item.trim().is_empty())
    {
        if !matches!(
            decision,
            "link" | "create" | "keep_historical_only" | "reject"
        ) {
            return Err(AppError::validation(
                "productContract.mappingDecision is invalid",
            ));
        }
    }
    Ok(())
}
fn expected_line_total(line: &repo::DraftLineRecord) -> Option<i64> {
    let gross = i128::from(line.purchase_quantity).checked_mul(i128::from(line.unit_cost_paise))?;
    let discount = gross
        .checked_mul(i128::from(line.discount_bps))?
        .checked_add(5000)?
        .checked_div(10000)?;
    let taxable = gross.checked_sub(discount)?;
    let tax = taxable
        .checked_mul(i128::from(line.gst_percent))?
        .checked_add(50)?
        .checked_div(100)?;
    i64::try_from(taxable.checked_add(tax)?).ok()
}
fn readiness_issues(draft: &repo::DraftRecord, lines: &[repo::DraftLineRecord]) -> Vec<String> {
    let mut issues = Vec::new();
    let historical = draft.workflow_mode == "historical_pilot";
    let supplier_mapping = contract_text(&draft.bill_contract, "supplierMappingDecision");
    if draft.supplier_id.is_none() && (!historical || supplier_mapping != "keep_historical_only") {
        issues.push("Supplier must be linked".into());
    }
    if draft.supplier_name.trim().is_empty() {
        issues.push("Supplier legal name is required".into());
    }
    if draft.bill_number.trim().is_empty() {
        issues.push("Supplier invoice number is required".into());
    }
    if draft.bill_date.is_none() {
        issues.push("Supplier invoice date is required".into());
    }
    if lines.is_empty() {
        issues.push("At least one bill line is required".into());
    }
    let mut line_identities = HashSet::new();
    for line in lines {
        if line.raw_name.trim().is_empty() {
            issues.push(format!(
                "Line {} product name is required",
                line.line_number
            ));
        }
        let product_mapping = contract_text(&line.product_contract, "mappingDecision");
        if line.inventory_item_id.is_none()
            && (!historical || product_mapping != "keep_historical_only")
        {
            issues.push(format!("Line {} product must be matched", line.line_number));
        }
        if line.purchase_quantity <= 0
            || line.quantity <= 0
            || line.conversion_factor <= 0
            || line.purchase_quantity.checked_mul(line.conversion_factor) != Some(line.quantity)
        {
            issues.push(format!(
                "Line {} quantity and conversion must be positive",
                line.line_number
            ));
        }
        if expected_line_total(line).map_or(true, |expected| differs(line.total_paise, expected)) {
            issues.push(format!(
                "Line {} calculated total does not reconcile",
                line.line_number
            ));
        }
        let damaged = contract_i32(&line.product_contract, "damagedQuantity");
        let rejected = contract_i32(&line.product_contract, "rejectedQuantity");
        let accepted = line
            .product_contract
            .get("acceptedQuantity")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok());
        if damaged < 0 || rejected < 0 || damaged.saturating_add(rejected) > line.purchase_quantity
        {
            issues.push(format!(
                "Line {} damaged/rejected quantity is invalid",
                line.line_number
            ));
        }
        if accepted.is_some_and(|accepted| {
            accepted < 0
                || accepted.saturating_add(damaged).saturating_add(rejected)
                    != line.purchase_quantity
        }) {
            issues.push(format!(
                "Line {} accepted, damaged and rejected quantities do not reconcile",
                line.line_number
            ));
        }
        if differs(
            line.cgst_paise + line.sgst_paise + line.igst_paise,
            line.total_paise - line.taxable_paise,
        ) {
            issues.push(format!(
                "Line {} tax breakup does not reconcile",
                line.line_number
            ));
        }
        if line.igst_paise > 0 && (line.cgst_paise > 0 || line.sgst_paise > 0) {
            issues.push(format!(
                "Line {} cannot mix IGST with CGST/SGST",
                line.line_number
            ));
        }
        if differs(line.cgst_paise, line.sgst_paise) && line.igst_paise == 0 {
            issues.push(format!(
                "Line {} CGST and SGST do not reconcile",
                line.line_number
            ));
        }
        if let (Some(invoice_date), Some(expiry_date)) = (draft.bill_date, line.expiry_date) {
            if expiry_date < invoice_date {
                issues.push(format!(
                    "Line {} expiry date is before the invoice date",
                    line.line_number
                ));
            }
        }
        let identity = (
            normalize_product_text(&line.raw_name),
            line.batch_number.trim().to_ascii_lowercase(),
        );
        if !identity.0.is_empty() && !line_identities.insert(identity) {
            issues.push(format!(
                "Line {} duplicates the same product and batch identity",
                line.line_number
            ));
        }
    }
    let document_type = contract_text(&draft.bill_contract, "documentType");
    if historical
        && !matches!(
            document_type.as_str(),
            "purchase_bill"
                | "credit_note"
                | "purchase_return"
                | "cancelled_bill"
                | "revised_invoice"
        )
    {
        issues.push("Historical document type must be reviewed".into());
    }
    if historical && contract_i64(&draft.bill_contract, "imageQualityScoreBps") < 6500 {
        issues.push("Document quality is Red and must be quarantined or re-scanned".into());
    }
    let header_tax = draft
        .cgst_paise
        .saturating_add(draft.sgst_paise)
        .saturating_add(draft.igst_paise);
    if draft.supplier_gstin.trim().is_empty() && header_tax > 0 {
        issues.push("GST amounts require a verified supplier GSTIN".into());
    }
    if !draft.supplier_gstin.trim().is_empty() && !valid_gstin(&draft.supplier_gstin) {
        issues.push("Supplier GSTIN format is invalid".into());
    }
    if draft.igst_paise > 0 && (draft.cgst_paise > 0 || draft.sgst_paise > 0) {
        issues.push("Bill cannot mix IGST with CGST/SGST".into());
    }
    let buyer_gstin = contract_text(&draft.bill_contract, "buyerGstin");
    if let (Some(supplier_state), Some(buyer_state)) =
        (draft.supplier_gstin.get(..2), buyer_gstin.get(..2))
    {
        let same_state = supplier_state == buyer_state;
        if same_state && draft.igst_paise > 0 {
            issues.push("Intra-state GST bill must use CGST and SGST".into());
        }
        if !same_state && (draft.cgst_paise > 0 || draft.sgst_paise > 0) {
            issues.push("Inter-state GST bill must use IGST".into());
        }
    }
    let extras = contract_i64(&draft.bill_contract, "freightPaise")
        .saturating_add(contract_i64(&draft.bill_contract, "handlingPaise"))
        .saturating_add(contract_i64(&draft.bill_contract, "otherChargesPaise"));
    if contract_i64(&draft.bill_contract, "freightPaise") < 0
        || contract_i64(&draft.bill_contract, "handlingPaise") < 0
        || contract_i64(&draft.bill_contract, "otherChargesPaise") < 0
        || extras < 0
    {
        issues.push("Freight, handling and other charges must be non-negative".into());
    }
    let header_expected = draft
        .subtotal_paise
        .checked_sub(draft.discount_paise)
        .and_then(|value| value.checked_add(draft.cgst_paise + draft.sgst_paise + draft.igst_paise))
        .and_then(|value| value.checked_add(extras))
        .and_then(|value| value.checked_add(contract_i64(&draft.bill_contract, "roundOffPaise")));
    if header_expected.map_or(true, |expected| differs(draft.total_paise, expected)) {
        issues.push("Header total does not reconcile".into());
    }
    let line_total = lines
        .iter()
        .try_fold(0_i64, |sum, line| sum.checked_add(line.total_paise));
    if line_total
        .and_then(|total| total.checked_add(extras))
        .map_or(true, |total| differs(draft.total_paise, total))
    {
        issues.push("Header total does not match bill-line totals".into());
    }
    issues
}
fn contract_i64(contract: &Value, key: &str) -> i64 {
    contract.get(key).and_then(Value::as_i64).unwrap_or(0)
}
fn contract_i32(contract: &Value, key: &str) -> i32 {
    contract_i64(contract, key).try_into().unwrap_or(i32::MAX)
}
fn contract_text(contract: &Value, key: &str) -> String {
    contract
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}
fn nonempty_contract_text(contract: &Value, key: &str) -> Option<String> {
    let value = contract_text(contract, key);
    (!value.is_empty()).then_some(value)
}
fn differs(actual: i64, expected: i64) -> bool {
    (i128::from(actual) - i128::from(expected)).abs() > 100
}
fn valid_gstin(value: &str) -> bool {
    let bytes = value.trim().as_bytes();
    bytes.len() == 15
        && bytes[0..2].iter().all(u8::is_ascii_digit)
        && bytes[2..7].iter().all(u8::is_ascii_uppercase)
        && bytes[7..11].iter().all(u8::is_ascii_digit)
        && bytes[11].is_ascii_uppercase()
        && bytes[12].is_ascii_alphanumeric()
        && bytes[13] == b'Z'
        && bytes[14].is_ascii_alphanumeric()
}
fn normalize_product_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn normalized_tokens(value: &str) -> Vec<String> {
    normalize_product_text(value)
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}
fn product_metadata(line: &repo::DraftLineRecord) -> Option<&serde_json::Map<String, Value>> {
    line.product_contract
        .as_object()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            line.field_evidence
                .get("_product")
                .and_then(Value::as_object)
        })
}
fn candidate_reason(
    line: &repo::DraftLineRecord,
    candidate: &repo::InventoryCandidateRecord,
) -> String {
    let mut reasons = Vec::new();
    if normalize_product_text(&line.raw_name) == normalize_product_text(&candidate.name) {
        reasons.push("exact normalized name");
    } else if normalized_tokens(&line.raw_name)
        .iter()
        .any(|token| normalized_tokens(&candidate.name).contains(token))
    {
        reasons.push("product-name tokens");
    }
    if !line.supplier_sku.trim().is_empty()
        && (line.supplier_sku.eq_ignore_ascii_case(&candidate.sku)
            || line.supplier_sku.eq_ignore_ascii_case(&candidate.barcode))
    {
        reasons.push("supplier SKU/barcode");
    }
    if !line.hsn_sac.trim().is_empty() && line.hsn_sac.eq_ignore_ascii_case(&candidate.hsn_code) {
        reasons.push("HSN");
    }
    let metadata = product_metadata(line);
    if metadata
        .and_then(|v| v.get("brand"))
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty() && v.eq_ignore_ascii_case(&candidate.brand))
    {
        reasons.push("brand");
    }
    if metadata
        .and_then(|v| v.get("category"))
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty() && v.eq_ignore_ascii_case(&candidate.category))
    {
        reasons.push("category");
    }
    if reasons.is_empty() {
        "weak textual similarity".into()
    } else {
        reasons.join(" + ")
    }
}
fn candidate_score(
    line: &repo::DraftLineRecord,
    candidate: &repo::InventoryCandidateRecord,
) -> i32 {
    let source_name = normalize_product_text(&line.raw_name);
    let candidate_name = normalize_product_text(&candidate.name);
    let mut score = if !source_name.is_empty() && source_name == candidate_name {
        9800
    } else if !source_name.is_empty()
        && (source_name.contains(&candidate_name) || candidate_name.contains(&source_name))
    {
        8600
    } else {
        let source_tokens = normalized_tokens(&source_name);
        let candidate_tokens = normalized_tokens(&candidate_name);
        let overlap = source_tokens
            .iter()
            .filter(|token| candidate_tokens.contains(token))
            .count();
        if source_tokens.is_empty() || candidate_tokens.is_empty() {
            0
        } else {
            (overlap * 8200 / source_tokens.len().max(candidate_tokens.len())) as i32
        }
    };
    let metadata = product_metadata(line);
    if !line.hsn_sac.trim().is_empty()
        && line
            .hsn_sac
            .trim()
            .eq_ignore_ascii_case(candidate.hsn_code.trim())
    {
        score += 700;
    }
    if metadata
        .and_then(|value| value.get("category"))
        .and_then(Value::as_str)
        .is_some_and(|value| {
            !value.trim().is_empty() && value.trim().eq_ignore_ascii_case(candidate.category.trim())
        })
    {
        score += 500;
    }
    if metadata
        .and_then(|value| value.get("brand"))
        .and_then(Value::as_str)
        .is_some_and(|value| {
            !value.trim().is_empty() && value.trim().eq_ignore_ascii_case(candidate.brand.trim())
        })
    {
        score += 300;
    }
    score.min(9700)
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
    use super::{
        candidate_score, differs, pilot_grouping_suggestions, validate_upload,
        PilotGroupingDocument, UploadInput,
    };
    use crate::repositories::purchase_bill_draft_repository::{
        DraftLineRecord, InventoryCandidateRecord,
    };
    use chrono::NaiveDate;
    use serde_json::json;
    #[test]
    fn upload_validation_accepts_pdf_and_rejects_text() {
        assert!(validate_upload(&UploadInput {
            file_name: "bill.pdf".into(),
            content_type: "application/pdf".into(),
            bytes: b"%PDF-1.7".to_vec()
        })
        .is_ok());
        assert!(validate_upload(&UploadInput {
            file_name: "bill.txt".into(),
            content_type: "text/plain".into(),
            bytes: vec![1]
        })
        .is_err());
    }
    #[test]
    fn confirmation_total_tolerance_is_one_rupee() {
        assert!(!differs(10_100, 10_000));
        assert!(differs(10_101, 10_000));
    }
    #[test]
    fn product_candidate_score_uses_name_and_supporting_evidence() {
        let line = DraftLineRecord {
            id: "line".into(),
            line_number: 1,
            raw_name: "Morfose Hair Serum".into(),
            supplier_sku: "".into(),
            inventory_item_id: None,
            hsn_sac: "3305".into(),
            purchase_quantity: 1,
            pack_size: 1,
            conversion_factor: 1,
            quantity: 1,
            unit_cost_paise: 0,
            discount_bps: 0,
            discount_paise: 0,
            gst_percent: 0,
            taxable_paise: 0,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: 0,
            total_paise: 0,
            batch_number: "".into(),
            expiry_date: None::<NaiveDate>,
            product_contract: json!({"brand":"Morfose","category":"Hair Care"}),
            confidence_bps: 0,
            warnings: json!([]),
            field_evidence: json!({"_product":{"brand":"Morfose","category":"Hair Care"}}),
        };
        let related = InventoryCandidateRecord {
            id: "one".into(),
            name: "Morfose Keratin Hair Serum".into(),
            sku: "".into(),
            category: "Hair Care".into(),
            brand: "Morfose".into(),
            hsn_code: "3305".into(),
            barcode: "".into(),
        };
        let unrelated = InventoryCandidateRecord {
            id: "two".into(),
            name: "Cotton Towels".into(),
            sku: "".into(),
            category: "Consumables".into(),
            brand: "".into(),
            hsn_code: "6302".into(),
            barcode: "".into(),
        };
        assert!(candidate_score(&line, &related) > candidate_score(&line, &unrelated));
        assert!(candidate_score(&line, &related) >= 4000);
    }

    #[test]
    fn pilot_grouping_uses_content_signals_and_blocks_missing_pages() {
        let page = |id: &str, page_number: i64| PilotGroupingDocument {
            draft_id: id.into(),
            file_name: format!("page-{page_number}.jpg"),
            supplier_batch: "Aura-Supplies".into(),
            supplier_name: "Aura Supplies".into(),
            supplier_gstin: "36ABCDE1234F1Z5".into(),
            invoice_number: "INV-42".into(),
            invoice_date: "2026-07-22".into(),
            total_paise: 123_450,
            page_number,
            page_count: 1,
            carry_forward_paise: if page_number > 1 { 50_000 } else { 0 },
            layout_fingerprint: "same-layout".into(),
        };
        let green = pilot_grouping_suggestions(&[page("one", 1), page("two", 2)]);
        assert_eq!(green.len(), 1);
        assert_eq!(green[0]["confidenceLevel"], "green");
        assert_eq!(green[0]["status"], "auto_grouped");
        let red = pilot_grouping_suggestions(&[page("one", 1), page("three", 3)]);
        assert_eq!(red.len(), 1);
        assert_eq!(red[0]["confidenceLevel"], "red");
        assert_eq!(red[0]["status"], "blocked");
    }
}
