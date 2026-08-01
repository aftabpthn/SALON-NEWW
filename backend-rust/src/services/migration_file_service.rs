use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use axum::body::Bytes;
use calamine::{open_workbook_auto, Reader as CalamineReader};
use chrono::{DateTime, NaiveDate, Utc};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader, ReadBuf},
    net::TcpStream,
    time::timeout,
};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    models::{
        common::AppError,
        migration::{MigrationEntity, MigrationProvider},
        migration_file::{
            CompleteMigrationUploadRequest, CompleteMigrationUploadResponse,
            CreateMigrationUploadRequest, HistoricalEvidenceCorrectionRequest,
            HistoricalEvidenceGroupDecisionRequest, MigrationSourceArtifact,
            MigrationSourceColumnProfile, MigrationSourceFile, MigrationSourceProfile,
            MigrationSourceSheet, MigrationUploadPartReceipt, MigrationUploadSession,
        },
    },
    repositories::{
        migration_file_repository::{self, NewSourceArtifact, NewSourceFile},
        migration_repository,
    },
    services::migration_adapter_service,
};

pub const MAX_PART_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: i64 = 500 * 1024 * 1024;
const MAX_PARTS: i32 = 1000;
const MAX_ZIP_ENTRIES: usize = 300;
const MAX_ZIP_ENTRY_BYTES: u64 = 250 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const MAX_MAPPING_PREVIEW_XLSX_BYTES: u64 = 64 * 1024 * 1024;
const PROFILE_UNIQUE_SAMPLE_LIMIT: usize = 100_000;
const PROFILE_VALUE_SAMPLE_LIMIT: usize = 5;
const EVIDENCE_ENCRYPTION_SCHEME: &str = "aes-256-gcm-chunked-v1";
const EVIDENCE_MAGIC: &[u8; 8] = b"AURAMIG1";
const EVIDENCE_CHUNK_BYTES: usize = 1024 * 1024;

struct PreparedArtifact {
    id: String,
    entry_name: String,
    format: String,
    content_type: String,
    size_bytes: i64,
    sha256: String,
    storage_key: String,
    page_count: i32,
}

struct PreparedEvidence {
    source_id: String,
    storage_key: String,
    sha256: String,
    detected_content_type: String,
    manifest: Value,
    artifacts: Vec<PreparedArtifact>,
    page_count: i32,
}

pub struct EvidenceDownload {
    pub file: TemporaryEvidenceFile,
    pub file_name: String,
    pub content_type: String,
    pub sha256: String,
    pub size_bytes: i64,
}

pub struct EvidenceDocument {
    pub file_name: String,
    pub content_type: String,
    pub sha256: String,
    pub bytes: Vec<u8>,
}

pub struct TemporaryEvidenceFile {
    file: tokio::fs::File,
    cleanup_path: Option<PathBuf>,
}

impl AsyncRead for TemporaryEvidenceFile {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().file).poll_read(context, buffer)
    }
}

impl Drop for TemporaryEvidenceFile {
    fn drop(&mut self) {
        if let Some(path) = self.cleanup_path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

#[derive(Debug)]
pub struct WorkerSource {
    pub name: String,
    pub format: String,
    pub path: PathBuf,
    cleanup_on_drop: bool,
}

impl Drop for WorkerSource {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct MaterializedSource {
    path: PathBuf,
    cleanup_on_drop: bool,
}

pub async fn create_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    request: CreateMigrationUploadRequest,
) -> Result<MigrationUploadSession, AppError> {
    let (file_name, extension) = validate_file_name(&request.file_name)?;
    if !(1..=MAX_FILE_BYTES).contains(&request.size_bytes) {
        return Err(AppError::validation(
            "file size must be between 1 byte and 500 MB",
        ));
    }
    if !(1..=MAX_PARTS).contains(&request.total_parts) {
        return Err(AppError::validation(
            "totalParts must be between 1 and 1000",
        ));
    }
    if !(1..=3650).contains(&request.retention_days) {
        return Err(AppError::validation(
            "retentionDays must be between 1 and 3650",
        ));
    }
    let minimum_parts = (request.size_bytes + MAX_PART_BYTES as i64 - 1) / MAX_PART_BYTES as i64;
    if request.total_parts < minimum_parts as i32 || request.total_parts as i64 > request.size_bytes
    {
        return Err(AppError::validation(
            "totalParts does not match the file size limits",
        ));
    }
    let content_type = normalize_content_type(request.content_type.as_deref());
    validate_declared_content_type(&extension, &content_type)?;
    let expected_sha256 = normalize_sha256(request.expected_sha256.as_deref())?;
    let evidence_kind = request.evidence_kind.unwrap_or_default().trim().to_string();
    let supplier_batch = request
        .supplier_batch
        .unwrap_or_default()
        .trim()
        .to_string();
    let cutover_id = request.cutover_id.unwrap_or_default().trim().to_string();
    if !matches!(
        evidence_kind.as_str(),
        "" | "historical_bill" | "physical_inventory" | "supplier_outstanding"
    ) || (evidence_kind == "historical_bill") != !supplier_batch.is_empty()
    {
        return Err(AppError::validation(
            "historical bill evidence requires a supplier batch",
        ));
    }
    if !evidence_kind.is_empty() {
        if cutover_id.is_empty() {
            return Err(AppError::validation("Phase 1 evidence requires cutoverId"));
        }
        if !migration_file_repository::evidence_cutover_exists(
            db,
            tenant_id,
            branch_id,
            &cutover_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate migration cutover"))?
        {
            return Err(AppError::validation(
                "the Phase 1 cutover was not found for this branch",
            ));
        }
        if !expected_sha256.is_empty() {
            if let Some((_, file_name)) =
                migration_file_repository::find_historical_evidence_duplicate(
                    db,
                    tenant_id,
                    branch_id,
                    &expected_sha256,
                )
                .await
                .map_err(|_| AppError::internal("failed to check evidence duplicate"))?
            {
                return Err(AppError::conflict(format!(
                    "duplicate evidence already exists: {file_name}"
                )));
            }
        }
    }
    let row = migration_file_repository::create_session(
        db,
        tenant_id,
        branch_id,
        actor,
        &file_name,
        &extension,
        &content_type,
        request.size_bytes,
        request.total_parts,
        &expected_sha256,
        request.provider.as_str(),
        request.retention_days,
        &evidence_kind,
        &supplier_batch,
        &cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to create migration upload session"))?;
    Ok(session_model(row, Vec::new()))
}

pub async fn get_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<MigrationUploadSession, AppError> {
    let row = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .ok_or_else(|| AppError::not_found("migration upload session was not found"))?;
    let parts = migration_file_repository::list_parts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload parts"))?;
    Ok(session_model(row, parts))
}

pub async fn upload_part(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
    expected_part_sha256: Option<&str>,
    bytes: Bytes,
) -> Result<MigrationUploadPartReceipt, AppError> {
    let session = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .ok_or_else(|| AppError::not_found("migration upload session was not found"))?;
    if session.status != "open" || session.expires_at <= chrono::Utc::now() {
        return Err(AppError::conflict("migration upload session is not open"));
    }
    if part_number < 1 || part_number > session.total_parts {
        return Err(AppError::validation(
            "part number is outside the upload manifest",
        ));
    }
    if bytes.is_empty() || bytes.len() > MAX_PART_BYTES {
        return Err(AppError::validation(
            "upload part must be between 1 byte and 8 MB",
        ));
    }
    let sha256 = sha256_hex(&bytes);
    let expected = normalize_sha256(expected_part_sha256)?;
    if !expected.is_empty() && expected != sha256 {
        return Err(AppError::validation("upload part SHA-256 does not match"));
    }
    if let Some(existing) =
        migration_file_repository::get_part(db, tenant_id, branch_id, id, part_number)
            .await
            .map_err(|_| AppError::internal("failed to check migration upload part"))?
    {
        if existing.sha256 != sha256 || existing.size_bytes != bytes.len() as i64 {
            return Err(AppError::conflict(
                "this upload part already exists with different content",
            ));
        }
        let session = get_upload(db, tenant_id, branch_id, id).await?;
        return Ok(MigrationUploadPartReceipt {
            session,
            part_number,
            part_size_bytes: existing.size_bytes,
            part_sha256: existing.sha256,
            replayed: true,
        });
    }

    let key = part_storage_key(tenant_id, branch_id, id, part_number)?;
    let path = storage_path(&key, false)?;
    atomic_write(&path, &bytes).await?;
    let inserted = migration_file_repository::insert_part(
        db,
        tenant_id,
        branch_id,
        id,
        part_number,
        bytes.len() as i64,
        &sha256,
        &key,
    )
    .await
    .map_err(|_| AppError::internal("failed to record migration upload part"))?;
    if !inserted {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::conflict(
            "upload part exceeds the session manifest or the session changed",
        ));
    }
    let session = get_upload(db, tenant_id, branch_id, id).await?;
    Ok(MigrationUploadPartReceipt {
        session,
        part_number,
        part_size_bytes: bytes.len() as i64,
        part_sha256: sha256,
        replayed: false,
    })
}

pub async fn complete_upload(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    request: CompleteMigrationUploadRequest,
) -> Result<CompleteMigrationUploadResponse, AppError> {
    if let Some(done) = migration_file_repository::get_session(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload session"))?
        .filter(|row| row.status == "completed")
    {
        let source_id = done
            .source_file_id
            .ok_or_else(|| AppError::internal("completed upload has no source evidence"))?;
        return Ok(CompleteMigrationUploadResponse {
            session: get_upload(db, tenant_id, branch_id, id).await?,
            source_file: get_source_file(db, tenant_id, branch_id, &source_id).await?,
        });
    }
    let session = migration_file_repository::claim_completion(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to claim migration upload session"))?
        .ok_or_else(|| AppError::conflict("migration upload session cannot be completed"))?;
    let parts = migration_file_repository::list_parts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration upload parts"))?;
    let request_hash = normalize_sha256(request.expected_sha256.as_deref())?;
    let expected_hash = if request_hash.is_empty() {
        session.expected_sha256.clone()
    } else {
        request_hash
    };
    let root = storage_root()?;
    let encryption_key = evidence_encryption_key()?;
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let blocking_session = session.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        prepare_evidence(
            &root,
            &tenant,
            &branch,
            &blocking_session,
            &parts,
            &expected_hash,
            &encryption_key,
        )
    })
    .await
    .map_err(|_| AppError::internal("migration evidence worker stopped"))?;
    let mut prepared = match prepared {
        Ok(value) => value,
        Err(message) => {
            let _ = migration_file_repository::release_completion(
                db, tenant_id, branch_id, id, &message,
            )
            .await;
            return Err(AppError::validation(message));
        }
    };
    let malware_scan = match scan_prepared_evidence(
        &prepared,
        tenant_id,
        branch_id,
        &session.file_extension,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            cleanup_prepared(&prepared);
            let _ = migration_file_repository::release_completion(
                db,
                tenant_id,
                branch_id,
                id,
                "migration source malware scan did not pass",
            )
            .await;
            return Err(error);
        }
    };
    prepared.manifest["malwareScan"] = malware_scan;
    let file_format = if session.file_extension == "jpg" {
        "jpeg"
    } else {
        &session.file_extension
    };
    let source = NewSourceFile {
        id: &prepared.source_id,
        original_file_name: &session.original_file_name,
        file_extension: &session.file_extension,
        declared_content_type: &session.declared_content_type,
        detected_content_type: &prepared.detected_content_type,
        file_format,
        size_bytes: session.expected_size_bytes,
        sha256: &prepared.sha256,
        storage_key: &prepared.storage_key,
        encryption_scheme: EVIDENCE_ENCRYPTION_SCHEME,
        manifest_json: &prepared.manifest,
        page_count: prepared.page_count,
    };
    let artifacts = prepared
        .artifacts
        .iter()
        .map(|item| NewSourceArtifact {
            id: &item.id,
            entry_name: &item.entry_name,
            file_format: &item.format,
            detected_content_type: &item.content_type,
            size_bytes: item.size_bytes,
            sha256: &item.sha256,
            storage_key: &item.storage_key,
            page_count: item.page_count,
        })
        .collect::<Vec<_>>();
    if let Err(error) = migration_file_repository::complete_session(
        db, tenant_id, branch_id, actor, id, &source, &artifacts,
    )
    .await
    {
        cleanup_prepared(&prepared);
        let _ = migration_file_repository::release_completion(
            db,
            tenant_id,
            branch_id,
            id,
            if error
                .to_string()
                .contains("HISTORICAL_PURCHASE_EVIDENCE_DUPLICATE")
            {
                "duplicate historical purchase evidence"
            } else {
                "failed to persist source evidence"
            },
        )
        .await;
        return Err(
            if error
                .to_string()
                .contains("HISTORICAL_PURCHASE_EVIDENCE_DUPLICATE")
            {
                AppError::conflict("duplicate historical purchase evidence is blocked")
            } else {
                AppError::internal("failed to persist migration source evidence")
            },
        );
    }
    remove_session_parts(tenant_id, branch_id, id).await;
    Ok(CompleteMigrationUploadResponse {
        session: get_upload(db, tenant_id, branch_id, id).await?,
        source_file: get_source_file(db, tenant_id, branch_id, &prepared.source_id).await?,
    })
}

pub async fn list_source_files(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MigrationSourceFile>, AppError> {
    let rows = migration_file_repository::list_source_files(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list migration source evidence"))?;
    let artifacts = migration_file_repository::list_scope_artifacts(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list migration source artifacts"))?;
    let mut grouped = HashMap::<String, Vec<_>>::new();
    for artifact in artifacts {
        grouped
            .entry(artifact.source_file_id.clone())
            .or_default()
            .push(artifact);
    }
    Ok(rows
        .into_iter()
        .map(|row| {
            let row_artifacts = grouped.remove(&row.id).unwrap_or_default();
            source_model(row, row_artifacts)
        })
        .collect())
}

pub async fn historical_evidence_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<Value, AppError> {
    let cutover_id = cutover_id.trim();
    if cutover_id.is_empty() {
        return Err(AppError::validation("cutoverId is required"));
    }
    let cutover = migration_repository::get_cutover(db, tenant_id, branch_id, Some(cutover_id))
        .await
        .map_err(|_| AppError::internal("failed to load Phase 1 cutover"))?
        .ok_or_else(|| AppError::not_found("Phase 1 cutover was not found"))?;
    let sources = migration_file_repository::list_historical_evidence_sources(
        db, tenant_id, branch_id, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load historical purchase evidence"))?;
    let failures = migration_file_repository::list_historical_evidence_failures(
        db, tenant_id, branch_id, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load evidence failures"))?;
    let decisions = migration_file_repository::list_historical_evidence_group_decisions(
        db, tenant_id, branch_id, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load grouping decisions"))?;
    let cutover_approval = migration_file_repository::historical_evidence_cutover_approval(
        db, tenant_id, branch_id, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load cutover approval"))?;
    let decision_map = decisions
        .into_iter()
        .map(|item| ((item.supplier_batch.clone(), item.group_key.clone()), item))
        .collect::<HashMap<_, _>>();

    #[derive(Default)]
    struct Group {
        pages: i32,
        files: HashSet<String>,
        documents: HashSet<String>,
        signals: HashSet<&'static str>,
        confidence: i32,
    }
    let mut groups = BTreeMap::<(String, String), Group>::new();
    let mut files = Vec::new();
    let mut total_pages = 0_i32;
    let mut historical_files = 0_usize;
    let mut active_files = 0_usize;
    let mut excluded_files = 0_usize;
    let mut physical_inventory_ready = false;
    let mut supplier_outstanding_ready = false;
    let mut unidentified = HashSet::new();
    for source in sources {
        files.push(json!({"id":source.id.clone(),"sourceFileId":source.source_file_id.clone(),"kind":source.evidence_kind.clone(),"supplierBatch":source.supplier_batch.clone(),"originalSupplierBatch":source.original_supplier_batch.clone(),"evidenceState":source.evidence_state.clone(),"correctionReason":source.correction_reason.clone(),"correctedBy":source.corrected_by.clone(),"correctedAt":source.corrected_at.clone(),"downstreamUsed":source.downstream_used,"originalFileName":source.original_file_name.clone(),"format":source.file_format.clone(),"sizeBytes":source.size_bytes,"sha256":source.sha256.clone(),"pageCount":source.page_count,"uploadedBy":source.uploaded_by.clone(),"createdAt":source.created_at.clone(),"artifacts":source.artifacts_json.clone()}));
        if source.evidence_state == "excluded" {
            excluded_files += 1;
            continue;
        }
        active_files += 1;
        total_pages += source.page_count;
        match source.evidence_kind.as_str() {
            "historical_bill" => {
                historical_files += 1;
                if source
                    .supplier_batch
                    .eq_ignore_ascii_case("Unidentified-Supplier")
                {
                    unidentified.insert(source.supplier_batch.clone());
                }
                let artifacts = source
                    .artifacts_json
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                if artifacts.is_empty() {
                    let (group_key, confidence, signal) =
                        suggested_group(&source.original_file_name, source.file_format == "pdf");
                    let group = groups
                        .entry((source.supplier_batch.clone(), group_key))
                        .or_default();
                    group.pages += source.page_count;
                    group.files.insert(source.source_file_id.clone());
                    group.documents.insert(source.source_file_id.clone());
                    group.confidence = group.confidence.max(confidence);
                    group.signals.insert(signal);
                } else {
                    for artifact in &artifacts {
                        let entry = artifact
                            .get("entryName")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let format = artifact.get("format").and_then(Value::as_str).unwrap_or("");
                        let pages = artifact
                            .get("pageCount")
                            .and_then(Value::as_i64)
                            .unwrap_or(0) as i32;
                        let (group_key, confidence, signal) =
                            suggested_group(entry, format == "pdf");
                        let group = groups
                            .entry((source.supplier_batch.clone(), group_key))
                            .or_default();
                        group.pages += pages;
                        group.files.insert(source.source_file_id.clone());
                        if let Some(artifact_id) = artifact.get("id").and_then(Value::as_str) {
                            group
                                .documents
                                .insert(format!("{}:{}", source.source_file_id, artifact_id));
                        }
                        group.confidence = group.confidence.max(confidence);
                        group.signals.insert(signal);
                    }
                }
            }
            "physical_inventory" => physical_inventory_ready = true,
            "supplier_outstanding" => supplier_outstanding_ready = true,
            _ => {}
        }
    }
    let group_rows = groups.into_iter().map(|((supplier_batch, group_key), group)| {
        let decision = decision_map.get(&(supplier_batch.clone(), group_key.clone()));
        json!({"supplierBatch":supplier_batch,"groupKey":group_key,"detectedPageCount":group.pages,"approvedPageCount":decision.map(|item| item.approved_page_count),"status":decision.map(|item| item.decision.as_str()).unwrap_or("suggested"),"confidencePercentage":group.confidence / 100,"signals":group.signals.into_iter().collect::<Vec<_>>(),"sourceFileCount":group.files.len(),"documentKeys":group.documents.into_iter().collect::<Vec<_>>(),"decidedBy":decision.map(|item| item.actor_user_id.as_str()),"decidedAt":decision.map(|item| item.created_at)})
    }).collect::<Vec<_>>();
    let grouping_approved = group_rows
        .iter()
        .filter(|group| group["detectedPageCount"].as_i64().unwrap_or(0) > 1)
        .all(|group| group["status"] == "approved");
    let failure_rows = failures.into_iter().map(|row| {
        let error = row.last_error.to_ascii_lowercase();
        let classification = if error.contains("duplicate") { "duplicate" } else if error.contains("password") || error.contains("encrypt") { "password_protected" } else if error.contains("corrupt") || error.contains("truncated") || error.contains("invalid") { "corrupt" } else { "failed" };
        json!({"uploadSessionId":row.id,"fileName":row.original_file_name,"supplierBatch":row.supplier_batch,"kind":row.evidence_kind,"status":classification,"message":row.last_error,"updatedAt":row.updated_at})
    }).collect::<Vec<_>>();
    let unresolved_failures = failure_rows
        .iter()
        .filter(|row| row["status"] != "duplicate")
        .count();
    let cutover_approved = cutover_approval.is_some();
    let complete = historical_files > 0
        && unresolved_failures == 0
        && grouping_approved
        && cutover_approved
        && physical_inventory_ready
        && supplier_outstanding_ready;
    let total_files = active_files;
    let audit_file_count = files.len();
    Ok(json!({
        "cutover": cutover,
        "cutoverApproval": cutover_approval.map(|item| json!({"approvedBy":item.actor_user_id,"approvedRole":item.actor_role,"approvedAt":item.created_at})),
        "files": files,
        "failures": failure_rows,
        "groups": group_rows,
        "summary": {"totalFiles":total_files,"auditFileCount":audit_file_count,"excludedFiles":excluded_files,"totalPages":total_pages,"historicalBillFiles":historical_files,"unidentifiedSupplierBatches":unidentified.into_iter().collect::<Vec<_>>(),"physicalInventoryReady":physical_inventory_ready,"supplierOutstandingReady":supplier_outstanding_ready,"groupingApproved":grouping_approved,"cutoverApproved":cutover_approved,"checksumVerified":unresolved_failures==0,"historicalStockEffect":0,"historicalAccountingEffect":0,"historicalGstEffect":0,"liveCrmWrites":0,"complete":complete}
    }))
}

pub async fn correct_historical_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    source_file_id: &str,
    request: HistoricalEvidenceCorrectionRequest,
) -> Result<Value, AppError> {
    let source_file_id = source_file_id.trim();
    let cutover_id = request.cutover_id.trim();
    let action = request.action.trim().to_ascii_lowercase();
    let supplier_batch = request.supplier_batch.trim();
    let reason = request.reason.trim();
    if source_file_id.is_empty()
        || cutover_id.is_empty()
        || !matches!(action.as_str(), "correct_supplier" | "exclude" | "restore")
        || !(5..=500).contains(&reason.chars().count())
        || (action == "correct_supplier"
            && (supplier_batch.is_empty() || supplier_batch.chars().count() > 120))
        || (action != "correct_supplier" && !supplier_batch.is_empty())
    {
        return Err(AppError::validation(
            "valid evidence action, reason and supplier batch are required",
        ));
    }
    let report = historical_evidence_report(db, tenant_id, branch_id, cutover_id).await?;
    let source = report["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|file| file["sourceFileId"] == source_file_id)
        })
        .ok_or_else(|| AppError::not_found("historical bill evidence was not found"))?;
    if source["kind"] != "historical_bill" {
        return Err(AppError::conflict(
            "only historical bill evidence can be corrected here",
        ));
    }
    if source["downstreamUsed"] == true {
        return Err(AppError::conflict(
            "evidence already used by a pilot or archive cannot be changed",
        ));
    }
    let excluded = source["evidenceState"] == "excluded";
    if (action == "exclude" && excluded)
        || (action == "restore" && !excluded)
        || (action == "correct_supplier" && excluded)
    {
        return Err(AppError::conflict(
            "evidence action is not valid for its current state",
        ));
    }
    migration_file_repository::append_historical_evidence_correction(
        db,
        tenant_id,
        branch_id,
        actor,
        cutover_id,
        source_file_id,
        &action,
        supplier_batch,
        reason,
    )
    .await
    .map_err(|error| {
        let message = error
            .as_database_error()
            .map(|database| database.message())
            .unwrap_or_default();
        if message.contains("ALREADY_IN_USE") || message.contains("CORRECTION_NOT_ALLOWED") {
            AppError::conflict("evidence correction is no longer allowed")
        } else {
            AppError::internal("failed to save evidence correction")
        }
    })?;
    historical_evidence_report(db, tenant_id, branch_id, cutover_id).await
}

pub async fn decide_historical_evidence_group(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    request: HistoricalEvidenceGroupDecisionRequest,
) -> Result<Value, AppError> {
    let decision = request.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected")
        || request.approved_page_count <= 0
        || request.supplier_batch.trim().is_empty()
        || request.group_key.trim().is_empty()
    {
        return Err(AppError::validation(
            "group decision, supplier batch, group key and positive page count are required",
        ));
    }
    let report =
        historical_evidence_report(db, tenant_id, branch_id, request.cutover_id.trim()).await?;
    let exists = report["groups"].as_array().is_some_and(|groups| {
        groups.iter().any(|group| {
            group["supplierBatch"] == request.supplier_batch.trim()
                && group["groupKey"] == request.group_key.trim()
        })
    });
    if !exists {
        return Err(AppError::not_found(
            "document grouping suggestion was not found",
        ));
    }
    migration_file_repository::decide_historical_evidence_group(
        db,
        tenant_id,
        branch_id,
        actor,
        request.cutover_id.trim(),
        request.supplier_batch.trim(),
        request.group_key.trim(),
        &decision,
        request.approved_page_count,
    )
    .await
    .map_err(|_| AppError::internal("failed to save grouping decision"))?;
    historical_evidence_report(db, tenant_id, branch_id, request.cutover_id.trim()).await
}

pub async fn approve_historical_evidence_cutover(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    cutover_id: &str,
) -> Result<Value, AppError> {
    let cutover_id = cutover_id.trim();
    if !migration_file_repository::evidence_cutover_exists(db, tenant_id, branch_id, cutover_id)
        .await
        .map_err(|_| AppError::internal("failed to validate migration cutover"))?
    {
        return Err(AppError::not_found("Phase 1 cutover was not found"));
    }
    if migration_file_repository::historical_evidence_cutover_approval(
        db, tenant_id, branch_id, cutover_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load cutover approval"))?
    .is_none()
    {
        migration_file_repository::approve_historical_evidence_cutover(
            db, tenant_id, branch_id, actor, role, cutover_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to approve Phase 1 cutover"))?;
    }
    historical_evidence_report(db, tenant_id, branch_id, cutover_id).await
}

fn suggested_group(name: &str, intrinsic_document: bool) -> (String, i32, &'static str) {
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    if let Some(parent) = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
    {
        return (parent.to_string(), 9500, "zip_folder");
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    if intrinsic_document {
        return (stem.to_string(), 10000, "single_pdf");
    }
    let lower = stem.to_ascii_lowercase();
    for marker in ["-page-", "_page_", " page ", "-p", "_p"] {
        if let Some(index) = lower.rfind(marker).filter(|index| {
            lower[index + marker.len()..]
                .bytes()
                .all(|byte| byte.is_ascii_digit())
        }) {
            return (
                stem[..index].trim_matches(['-', '_', ' ']).to_string(),
                8000,
                "page_sequence",
            );
        }
    }
    (stem.to_string(), 6000, "filename")
}

pub async fn get_source_file(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<MigrationSourceFile, AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    if row.evidence_status != "verified" || !row.read_only {
        return Err(AppError::conflict(
            "migration source evidence is unavailable",
        ));
    }
    if row.retention_until <= Utc::now() {
        purge_expired_evidence(db, &row).await?;
        return Err(AppError::conflict(
            "migration source evidence retention period has expired",
        ));
    }
    let artifacts = migration_file_repository::list_artifacts(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source artifacts"))?;
    Ok(source_model(row, artifacts))
}

pub async fn open_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
) -> Result<EvidenceDownload, AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    if row.evidence_status != "verified" || !row.read_only {
        return Err(AppError::conflict(
            "migration source evidence is unavailable",
        ));
    }
    if row.retention_until <= Utc::now() {
        purge_expired_evidence(db, &row).await?;
        return Err(AppError::conflict(
            "migration source evidence retention period has expired",
        ));
    }
    let encrypted_path = storage_path(&row.storage_key, true)?;
    let scheme = row.encryption_scheme.clone();
    let expected_hash = row.sha256.clone();
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let extension = row.file_extension.clone();
    let materialized = tokio::task::spawn_blocking(move || {
        materialize_verified_source(
            &encrypted_path,
            &scheme,
            &tenant,
            &branch,
            &extension,
            &expected_hash,
        )
    })
    .await
    .map_err(|_| AppError::internal("migration evidence reader stopped"))??;
    let file = match tokio::fs::File::open(&materialized.path).await {
        Ok(file) => file,
        Err(_) => {
            if materialized.cleanup_on_drop {
                let _ = fs::remove_file(&materialized.path);
            }
            return Err(AppError::not_found(
                "migration source evidence file is unavailable",
            ));
        }
    };
    migration_file_repository::audit_evidence_read(db, tenant_id, branch_id, actor, id)
        .await
        .map_err(|_| AppError::internal("failed to audit migration evidence access"))?;
    Ok(EvidenceDownload {
        file: TemporaryEvidenceFile {
            file,
            cleanup_path: materialized.cleanup_on_drop.then_some(materialized.path),
        },
        file_name: row.original_file_name,
        content_type: row.detected_content_type,
        sha256: row.sha256,
        size_bytes: row.size_bytes,
    })
}

pub async fn read_evidence_document(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    source_id: &str,
    artifact_id: Option<&str>,
) -> Result<EvidenceDocument, AppError> {
    let source = migration_file_repository::get_source_file(db, tenant_id, branch_id, source_id)
        .await
        .map_err(|_| AppError::internal("failed to load migration evidence document"))?
        .ok_or_else(|| AppError::not_found("migration evidence document was not found"))?;
    if source.evidence_status != "verified" || !source.read_only {
        return Err(AppError::conflict(
            "migration evidence document is unavailable",
        ));
    }
    if source.retention_until <= Utc::now() {
        purge_expired_evidence(db, &source).await?;
        return Err(AppError::conflict(
            "migration evidence retention period has expired",
        ));
    }

    let selected = if let Some(id) = artifact_id.filter(|value| !value.trim().is_empty()) {
        let artifact =
            migration_file_repository::list_artifacts(db, tenant_id, branch_id, source_id)
                .await
                .map_err(|_| AppError::internal("failed to load migration evidence artifacts"))?
                .into_iter()
                .find(|artifact| artifact.id == id)
                .ok_or_else(|| AppError::not_found("migration evidence artifact was not found"))?;
        (
            artifact.entry_name,
            artifact.detected_content_type,
            artifact.file_format,
            artifact.storage_key,
            artifact.sha256,
            artifact.size_bytes,
        )
    } else {
        if source.file_format == "zip" {
            return Err(AppError::validation(
                "select a verified document inside the ZIP evidence",
            ));
        }
        (
            source.original_file_name.clone(),
            source.detected_content_type.clone(),
            source.file_format.clone(),
            source.storage_key.clone(),
            source.sha256.clone(),
            source.size_bytes,
        )
    };
    if selected.5 > 50 * 1024 * 1024 {
        return Err(AppError::validation(
            "evidence document exceeds the 50 MB review limit",
        ));
    }

    let encrypted_path = storage_path(&selected.3, true)?;
    let scheme = source.encryption_scheme.clone();
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let format = selected.2.clone();
    let expected_hash = selected.4.clone();
    let materialized = tokio::task::spawn_blocking(move || {
        materialize_verified_source(
            &encrypted_path,
            &scheme,
            &tenant,
            &branch,
            &format,
            &expected_hash,
        )
    })
    .await
    .map_err(|_| AppError::internal("migration evidence reader stopped"))??;
    let read_result = tokio::fs::read(&materialized.path).await;
    if materialized.cleanup_on_drop {
        let _ = fs::remove_file(&materialized.path);
    }
    let bytes =
        read_result.map_err(|_| AppError::not_found("migration evidence file is unavailable"))?;
    if bytes.len() as i64 != selected.5 {
        return Err(AppError::conflict(
            "migration evidence size verification failed",
        ));
    }
    migration_file_repository::audit_evidence_read(db, tenant_id, branch_id, actor, source_id)
        .await
        .map_err(|_| AppError::internal("failed to audit migration evidence access"))?;
    Ok(EvidenceDocument {
        file_name: selected.0,
        content_type: selected.1,
        sha256: selected.4,
        bytes,
    })
}

pub async fn worker_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<(String, String, MigrationProvider, Vec<WorkerSource>), AppError> {
    let row = migration_file_repository::get_source_file(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load migration source evidence"))?
        .ok_or_else(|| AppError::not_found("migration source evidence was not found"))?;
    if row.evidence_status != "verified" || !row.read_only {
        return Err(AppError::conflict(
            "migration source evidence is not verified",
        ));
    }
    if row.retention_until <= Utc::now() {
        purge_expired_evidence(db, &row).await?;
        return Err(AppError::conflict(
            "migration source evidence retention period has expired",
        ));
    }
    let provider = MigrationProvider::try_from(row.source_provider.as_str())
        .unwrap_or(MigrationProvider::Auto);
    let source_name = row.original_file_name.clone();
    let source_hash = row.sha256.clone();
    let scheme = row.encryption_scheme.clone();
    let inputs = if row.file_format == "zip" {
        migration_file_repository::list_artifacts(db, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to load migration source artifacts"))?
            .into_iter()
            .map(|item| {
                (
                    item.entry_name,
                    item.file_format,
                    item.storage_key,
                    item.sha256,
                )
            })
            .collect::<Vec<_>>()
    } else {
        vec![(
            row.original_file_name.clone(),
            row.file_format.clone(),
            row.storage_key.clone(),
            row.sha256.clone(),
        )]
    };
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let sources = tokio::task::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|(name, format, storage_key, expected_hash)| {
                let path = storage_path(&storage_key, true)?;
                let source = materialize_verified_source(
                    &path,
                    &scheme,
                    &tenant,
                    &branch,
                    &format,
                    &expected_hash,
                )?;
                Ok(WorkerSource {
                    name,
                    format,
                    path: source.path,
                    cleanup_on_drop: source.cleanup_on_drop,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()
    })
    .await
    .map_err(|_| AppError::internal("migration evidence verification worker stopped"))??;
    if sources.is_empty() {
        return Err(AppError::validation(
            "migration source contains no importable files",
        ));
    }
    Ok((source_name, source_hash, provider, sources))
}

async fn purge_expired_evidence(
    db: &PgPool,
    row: &migration_file_repository::SourceFileRow,
) -> Result<(), AppError> {
    let artifacts =
        migration_file_repository::list_artifacts(db, &row.tenant_id, &row.branch_id, &row.id)
            .await
            .map_err(|_| AppError::internal("failed to load expired migration artifacts"))?;
    for key in std::iter::once(row.storage_key.as_str()).chain(
        artifacts
            .iter()
            .map(|artifact| artifact.storage_key.as_str()),
    ) {
        if let Ok(path) = storage_path(key, false) {
            remove_read_only_file(&path);
        }
    }
    migration_file_repository::mark_evidence_expired(db, &row.tenant_id, &row.branch_id, &row.id)
        .await
        .map_err(|_| AppError::internal("failed to record migration evidence retention purge"))
}

pub async fn source_columns(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
) -> Result<Vec<String>, AppError> {
    let (_, _, _, sources) = worker_sources(db, tenant_id, branch_id, id).await?;
    let columns = tokio::task::spawn_blocking(move || source_columns_blocking(&sources))
        .await
        .map_err(|_| AppError::internal("migration source header reader stopped"))??;
    migration_file_repository::audit_evidence_read(db, tenant_id, branch_id, actor, id)
        .await
        .map_err(|_| AppError::internal("failed to audit migration source header access"))?;
    Ok(columns)
}

pub async fn source_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
) -> Result<MigrationSourceProfile, AppError> {
    let (_, _, declared_provider, sources) = worker_sources(db, tenant_id, branch_id, id).await?;
    let profile =
        tokio::task::spawn_blocking(move || source_profile_blocking(&sources, declared_provider))
            .await
            .map_err(|_| AppError::internal("migration source profiler stopped"))??;
    migration_file_repository::audit_evidence_read(db, tenant_id, branch_id, actor, id)
        .await
        .map_err(|_| AppError::internal("failed to audit migration source profile access"))?;
    Ok(profile)
}

pub(crate) fn profile_csv_mapping_evidence(
    csv: &str,
    entity: MigrationEntity,
) -> Result<(Vec<String>, Vec<MigrationSourceColumnProfile>, i64), AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(csv.as_bytes());
    let columns = reader
        .headers()
        .map_err(|_| AppError::validation("CSV source header is invalid"))?
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if columns.is_empty() || columns.len() > 500 {
        return Err(AppError::validation("CSV must contain 1 to 500 columns"));
    }
    let mut profilers = columns
        .iter()
        .map(|header| ColumnProfiler::new(header))
        .collect::<Vec<_>>();
    let mut row_count = 0_i64;
    for record in reader.records() {
        let record =
            record.map_err(|_| AppError::validation("CSV source contains a corrupt row"))?;
        row_count += 1;
        if row_count > 5_000 {
            return Err(AppError::validation("CSV must contain 1 to 5000 data rows"));
        }
        for (index, profiler) in profilers.iter_mut().enumerate() {
            profiler.observe(record.get(index).unwrap_or(""));
        }
    }
    if row_count == 0 {
        return Err(AppError::validation("CSV contains no data rows"));
    }
    Ok((
        columns,
        profilers
            .into_iter()
            .map(|profiler| profiler.finish(&[entity]))
            .collect(),
        row_count,
    ))
}

fn source_profile_blocking(
    sources: &[WorkerSource],
    declared_provider: MigrationProvider,
) -> Result<MigrationSourceProfile, AppError> {
    let mut sheets = Vec::new();
    for source in sources {
        match source.format.as_str() {
            "csv" => {
                let mut reader = csv::ReaderBuilder::new()
                    .flexible(true)
                    .from_path(&source.path)
                    .map_err(|_| AppError::validation("CSV source could not be profiled"))?;
                let columns = reader
                    .headers()
                    .map_err(|_| AppError::validation("CSV source header is invalid"))?
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>();
                let targets = infer_source_targets(&source.name, &columns);
                let mut profilers = columns
                    .iter()
                    .map(|header| ColumnProfiler::new(header))
                    .collect::<Vec<_>>();
                let mut row_count = 0_i64;
                for record in reader.records() {
                    let record = record
                        .map_err(|_| AppError::validation("CSV source contains a corrupt row"))?;
                    row_count += 1;
                    for (index, profiler) in profilers.iter_mut().enumerate() {
                        profiler.observe(record.get(index).unwrap_or(""));
                    }
                }
                let column_profiles = profilers
                    .into_iter()
                    .map(|profiler| profiler.finish(&targets))
                    .collect::<Vec<_>>();
                sheets.push(MigrationSourceSheet {
                    id: source.name.clone(),
                    name: source.name.clone(),
                    file_name: source.name.clone(),
                    row_count,
                    column_count: columns.len() as i32,
                    column_profiles,
                    importable: !targets.is_empty(),
                    targets,
                    columns,
                });
            }
            "xlsx" => {
                // ponytail: calamine decodes one worksheet at a time; replace it with a SAX OOXML
                // reader only if production workbook benchmarks exceed the approved memory budget.
                if fs::metadata(&source.path)
                    .map_err(|_| AppError::not_found("XLSX source is unavailable"))?
                    .len()
                    > MAX_FILE_BYTES as u64
                {
                    return Err(AppError::validation(
                        "XLSX source profiling is limited to 500 MB",
                    ));
                }
                let mut workbook = open_workbook_auto(&source.path)
                    .map_err(|_| AppError::validation("XLSX source could not be profiled"))?;
                for sheet_name in workbook.sheet_names().to_vec() {
                    let range = workbook
                        .worksheet_range(&sheet_name)
                        .map_err(|_| AppError::validation("XLSX worksheet is corrupt"))?;
                    let Some(header) = range.rows().next() else {
                        continue;
                    };
                    let columns = header.iter().map(ToString::to_string).collect::<Vec<_>>();
                    if columns.iter().all(|value| value.trim().is_empty()) {
                        continue;
                    }
                    let targets = infer_source_targets(&sheet_name, &columns);
                    let mut profilers = columns
                        .iter()
                        .map(|header| ColumnProfiler::new(header))
                        .collect::<Vec<_>>();
                    let mut row_count = 0_i64;
                    for row in range.rows().skip(1) {
                        row_count += 1;
                        for (index, profiler) in profilers.iter_mut().enumerate() {
                            profiler.observe(
                                &row.get(index).map(ToString::to_string).unwrap_or_default(),
                            );
                        }
                    }
                    let column_profiles = profilers
                        .into_iter()
                        .map(|profiler| profiler.finish(&targets))
                        .collect::<Vec<_>>();
                    sheets.push(MigrationSourceSheet {
                        id: format!("{}:{}", source.name, sheet_name),
                        name: sheet_name,
                        file_name: source.name.clone(),
                        row_count,
                        column_count: columns.len() as i32,
                        column_profiles,
                        importable: !targets.is_empty(),
                        targets,
                        columns,
                    });
                }
            }
            _ => continue,
        }
    }
    if sheets.is_empty() {
        return Err(AppError::validation(
            "migration source contains no readable sheets",
        ));
    }
    let provider = if declared_provider == MigrationProvider::Auto {
        detect_provider(sources, &sheets)
    } else {
        declared_provider
    };
    Ok(MigrationSourceProfile { provider, sheets })
}

struct ColumnProfiler {
    header: String,
    total: i64,
    empty: i64,
    sampled_non_empty: i64,
    unique_sample: HashSet<String>,
    samples: Vec<String>,
    minimum: Option<String>,
    maximum: Option<String>,
    phone: i64,
    email: i64,
    date: i64,
    date_ambiguous: i64,
    datetime: i64,
    currency: i64,
    uuid: i64,
    status: i64,
    boolean: i64,
    integer: i64,
    decimal: i64,
}

impl ColumnProfiler {
    fn new(header: &str) -> Self {
        Self {
            header: header.to_string(),
            total: 0,
            empty: 0,
            sampled_non_empty: 0,
            unique_sample: HashSet::new(),
            samples: Vec::new(),
            minimum: None,
            maximum: None,
            phone: 0,
            email: 0,
            date: 0,
            date_ambiguous: 0,
            datetime: 0,
            currency: 0,
            uuid: 0,
            status: 0,
            boolean: 0,
            integer: 0,
            decimal: 0,
        }
    }

    fn observe(&mut self, value: &str) {
        self.total += 1;
        let value = value.trim();
        if value.is_empty() {
            self.empty += 1;
            return;
        }
        if self.sampled_non_empty < PROFILE_UNIQUE_SAMPLE_LIMIT as i64 {
            self.sampled_non_empty += 1;
            self.unique_sample.insert(value.to_string());
        }
        if self.samples.len() < PROFILE_VALUE_SAMPLE_LIMIT
            && !self.samples.iter().any(|sample| sample == value)
        {
            self.samples.push(value.chars().take(128).collect());
        }
        if self
            .minimum
            .as_deref()
            .is_none_or(|current| value < current)
        {
            self.minimum = Some(value.to_string());
        }
        if self
            .maximum
            .as_deref()
            .is_none_or(|current| value > current)
        {
            self.maximum = Some(value.to_string());
        }
        self.phone += i64::from(is_phone(value));
        self.email += i64::from(is_email(value));
        self.datetime += i64::from(DateTime::parse_from_rfc3339(value).is_ok());
        self.date += i64::from(parse_profile_date(value).is_some());
        self.date_ambiguous += i64::from(profile_date_is_ambiguous(value));
        self.currency += i64::from(parse_currency(value).is_some());
        self.uuid += i64::from(Uuid::parse_str(value).is_ok());
        self.status += i64::from(is_status(value));
        self.boolean += i64::from(matches!(
            value.to_ascii_lowercase().as_str(),
            "true" | "false" | "yes" | "no" | "1" | "0" | "active" | "inactive"
        ));
        self.integer += i64::from(value.parse::<i64>().is_ok());
        self.decimal += i64::from(value.parse::<f64>().is_ok());
    }

    fn finish(self, targets: &[MigrationEntity]) -> MigrationSourceColumnProfile {
        let non_empty = self.total - self.empty;
        let normalized = normalize_profile_header(&self.header);
        let header = normalized.as_str();
        let ratio = |count: i64| {
            if non_empty == 0 {
                0.0
            } else {
                count as f64 / non_empty as f64
            }
        };
        let (detected_data_type, valid_count) = if non_empty == 0 {
            ("empty", 0)
        } else if (header.contains("phone") || header.contains("mobile"))
            && ratio(self.phone) >= 0.5
        {
            ("phone", self.phone)
        } else if header.contains("email") && ratio(self.email) >= 0.5 {
            ("email", self.email)
        } else if header.contains("uuid") && ratio(self.uuid) >= 0.8 {
            ("uuid", self.uuid)
        } else if header.contains("status") && ratio(self.status) >= 0.5 {
            ("status", self.status)
        } else if ratio(self.boolean) >= 0.95 {
            ("boolean", self.boolean)
        } else if ratio(self.uuid) >= 0.95 {
            ("uuid", self.uuid)
        } else if ratio(self.email) >= 0.95 {
            ("email", self.email)
        } else if ratio(self.phone) >= 0.95 {
            ("phone", self.phone)
        } else if ratio(self.datetime) >= 0.95 {
            ("datetime", self.datetime)
        } else if ratio(self.date) >= 0.95 {
            ("date", self.date)
        } else if (header.contains("amount")
            || header.contains("price")
            || header.contains("cost")
            || header.contains("balance"))
            && ratio(self.currency) >= 0.8
        {
            ("currency", self.currency)
        } else if ratio(self.integer) >= 0.95 {
            ("integer", self.integer)
        } else if ratio(self.decimal) >= 0.95 || ratio(self.currency) >= 0.95 {
            ("decimal", self.decimal.max(self.currency))
        } else {
            ("string", non_empty)
        };
        let statistics_exact = non_empty <= PROFILE_UNIQUE_SAMPLE_LIMIT as i64;
        let sample_unique_percentage = if self.sampled_non_empty == 0 {
            0.0
        } else {
            self.unique_sample.len() as f64 * 100.0 / self.sampled_non_empty as f64
        };
        let estimated_unique = if statistics_exact {
            self.unique_sample.len() as i64
        } else {
            (sample_unique_percentage * non_empty as f64 / 100.0).round() as i64
        }
        .min(non_empty);
        let mut patterns = Vec::new();
        for (name, count) in [
            ("phone", self.phone),
            ("email", self.email),
            ("date", self.date),
            ("currency", self.currency),
            ("uuid", self.uuid),
            ("status", self.status),
        ] {
            if ratio(count) >= 0.8 {
                patterns.push(name.to_string());
            }
        }
        if self.date_ambiguous > 0 {
            patterns.push("date_format_ambiguous".to_string());
        }
        let (possible_crm_entity, possible_crm_field) =
            possible_crm_match(&self.header, targets).unwrap_or((None, None));
        let pii = matches!(detected_data_type, "phone" | "email");
        MigrationSourceColumnProfile {
            original_header: self.header,
            normalized_header: normalized,
            sample_values: self
                .samples
                .into_iter()
                .map(|value| mask_profile_value(&value, detected_data_type))
                .collect(),
            detected_data_type: detected_data_type.to_string(),
            empty_percentage: percentage(self.empty, self.total),
            unique_percentage: round_percentage(sample_unique_percentage),
            duplicate_count: non_empty.saturating_sub(estimated_unique),
            minimum: self.minimum.map(|value| {
                if pii {
                    mask_profile_value(&value, detected_data_type)
                } else {
                    value
                }
            }),
            maximum: self.maximum.map(|value| {
                if pii {
                    mask_profile_value(&value, detected_data_type)
                } else {
                    value
                }
            }),
            patterns,
            possible_crm_entity,
            possible_crm_field,
            invalid_value_count: non_empty.saturating_sub(valid_count),
            statistics_exact,
        }
    }
}

fn percentage(value: i64, total: i64) -> f64 {
    if total == 0 {
        0.0
    } else {
        round_percentage(value as f64 * 100.0 / total as f64)
    }
}

fn round_percentage(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub(crate) fn normalize_profile_header(value: &str) -> String {
    let mut normalized = String::new();
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
        } else if !normalized.ends_with('_') && !normalized.is_empty() {
            normalized.push('_');
        }
    }
    normalized.trim_end_matches('_').to_string()
}

fn is_phone(value: &str) -> bool {
    let digits = value.chars().filter(char::is_ascii_digit).count();
    (7..=15).contains(&digits)
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || "+-() ".contains(character))
}

fn is_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !value.chars().any(char::is_whitespace)
}

fn parse_profile_date(value: &str) -> Option<NaiveDate> {
    ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"]
        .into_iter()
        .find_map(|format| NaiveDate::parse_from_str(value, format).ok())
}

fn profile_date_is_ambiguous(value: &str) -> bool {
    let dmy = NaiveDate::parse_from_str(value, "%d/%m/%Y").ok();
    let mdy = NaiveDate::parse_from_str(value, "%m/%d/%Y").ok();
    matches!((dmy, mdy), (Some(left), Some(right)) if left != right)
}

fn parse_currency(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_start_matches(['₹', '$', '€', '£'])
        .replace(',', "")
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn is_status(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "active"
            | "inactive"
            | "draft"
            | "booked"
            | "confirmed"
            | "arrived"
            | "waiting"
            | "in-service"
            | "completed"
            | "billed"
            | "paid"
            | "cancelled"
            | "no-show"
            | "rescheduled"
            | "open"
            | "voided"
            | "blocked"
            | "expired"
            | "redeemed"
            | "calculated"
            | "reviewed"
            | "finalized"
            | "partially_paid"
    )
}

fn mask_profile_value(value: &str, data_type: &str) -> String {
    match data_type {
        "phone" => {
            let digits = value
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>();
            format!(
                "***{}",
                digits
                    .chars()
                    .rev()
                    .take(4)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            )
        }
        "email" => value
            .split_once('@')
            .map(|(local, domain)| format!("{}***@{domain}", local.chars().next().unwrap_or('*')))
            .unwrap_or_else(|| "***".into()),
        _ => value.to_string(),
    }
}

fn possible_crm_match(
    header: &str,
    preferred_entities: &[MigrationEntity],
) -> Option<(Option<MigrationEntity>, Option<String>)> {
    let templates = migration_adapter_service::templates();
    preferred_entities
        .iter()
        .copied()
        .chain(templates.iter().map(|template| template.entity))
        .find_map(|entity| {
            migration_adapter_service::suggest_static_field(entity, MigrationProvider::Auto, header)
                .map(|field| (Some(entity), Some(field)))
        })
}

fn detect_provider(sources: &[WorkerSource], sheets: &[MigrationSourceSheet]) -> MigrationProvider {
    let haystack = sources
        .iter()
        .map(|source| source.name.as_str())
        .chain(sheets.iter().map(|sheet| sheet.name.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if haystack.contains("dingg")
        || ["service history", "clint unpadie", "mship type"]
            .iter()
            .any(|needle| haystack.contains(needle))
    {
        MigrationProvider::Dingg
    } else if haystack.contains("zenoti")
        || sheets.iter().any(|sheet| {
            sheet.columns.iter().any(|column| {
                matches!(
                    column.trim().to_ascii_lowercase().as_str(),
                    "guest code" | "center name"
                )
            })
        })
    {
        MigrationProvider::Zenoti
    } else if haystack.contains("salonist") {
        MigrationProvider::Salonist
    } else if haystack.contains("fresha") {
        MigrationProvider::Fresha
    } else if haystack.contains("tally") {
        MigrationProvider::Tally
    } else if haystack.contains("busy") {
        MigrationProvider::Busy
    } else if haystack.contains("marg") {
        MigrationProvider::Marg
    } else if sources.iter().all(|source| source.format == "csv") {
        MigrationProvider::Csv
    } else {
        MigrationProvider::Excel
    }
}

fn infer_source_targets(name: &str, columns: &[String]) -> Vec<MigrationEntity> {
    let name = name.trim().to_ascii_lowercase();
    let columns = columns
        .iter()
        .map(|column| column.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>();
    if name.contains("misc") || columns.len() < 2 {
        return Vec::new();
    }
    if name.contains("refund") {
        return vec![MigrationEntity::Refunds];
    }
    if name.contains("gift card") || name.contains("voucher") || name.contains("prepaid") {
        return vec![MigrationEntity::GiftCards];
    }
    if name.contains("loyalty") || name.contains("reward point") {
        return vec![MigrationEntity::Loyalty];
    }
    if name.contains("payroll") || name.contains("salary") {
        return vec![MigrationEntity::Payroll];
    }
    if name.contains("commission") {
        return vec![MigrationEntity::Commissions];
    }
    if name.contains("client note") || name.contains("customer note") || name.contains("guest note")
    {
        return vec![MigrationEntity::ClientNotes];
    }
    if name.contains("attachment")
        || name.contains("document")
        || name.contains("file manifest")
        || name.contains("photo")
    {
        return vec![MigrationEntity::Files];
    }
    if name.contains("stock movement")
        || name.contains("inventory movement")
        || name.contains("stock adjustment")
    {
        return vec![MigrationEntity::StockMovements];
    }
    if name.contains("service history") {
        return vec![MigrationEntity::Sales];
    }
    if name.contains("unpadie") || name.contains("unpaid") {
        return vec![MigrationEntity::Invoices];
    }
    if name.contains("invoice") || name.contains("receipt") || name.contains("sale") {
        return vec![MigrationEntity::Invoices, MigrationEntity::Payments];
    }
    if name.contains("customer")
        || name.contains("client")
        || name.contains("guest")
        || name == "clint"
    {
        return vec![MigrationEntity::Clients];
    }
    if name.contains("staff") || name.contains("employee") || name.contains("therapist") {
        return vec![MigrationEntity::Staff];
    }
    if name.contains("service") {
        return vec![MigrationEntity::Services];
    }
    if name.contains("product") || name.contains("item") {
        return vec![MigrationEntity::Products, MigrationEntity::Inventory];
    }
    if name.contains("membership") || name.contains("mship") {
        return if columns.contains("mobile")
            || columns.contains("client name")
            || columns.contains("guest code")
        {
            vec![MigrationEntity::ClientMemberships]
        } else {
            vec![MigrationEntity::Memberships]
        };
    }
    if name.contains("appointment") || name.contains("booking") {
        return vec![MigrationEntity::Appointments];
    }
    if columns.contains("mobile") && (columns.contains("name") || columns.contains("guest name")) {
        return vec![MigrationEntity::Clients];
    }
    Vec::new()
}

pub async fn source_columns_for_sheet(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    id: &str,
    source_sheet: &str,
) -> Result<Vec<String>, AppError> {
    if source_sheet.trim().is_empty() {
        return source_columns(db, tenant_id, branch_id, actor, id).await;
    }
    let profile = source_profile(db, tenant_id, branch_id, actor, id).await?;
    profile
        .sheets
        .into_iter()
        .find(|sheet| sheet.id == source_sheet)
        .map(|sheet| sheet.columns)
        .ok_or_else(|| AppError::validation("selected source sheet was not found"))
}

fn source_columns_blocking(sources: &[WorkerSource]) -> Result<Vec<String>, AppError> {
    let mut columns = Vec::new();
    let mut seen = HashSet::new();
    for source in sources {
        let headers = match source.format.as_str() {
            "csv" => {
                let mut reader = csv::ReaderBuilder::new()
                    .flexible(true)
                    .from_path(&source.path)
                    .map_err(|_| AppError::validation("CSV source header could not be read"))?;
                reader
                    .headers()
                    .map_err(|_| AppError::validation("CSV source header is invalid"))?
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            }
            "xlsx" => xlsx_source_columns(source)?,
            _ => continue,
        };
        let mut source_seen = HashSet::new();
        for header in headers {
            let header = header.trim().to_string();
            let key = header.to_ascii_lowercase();
            if header.is_empty() || header.chars().count() > 200 || !source_seen.insert(key.clone())
            {
                return Err(AppError::validation(
                    "migration source contains invalid or duplicate columns",
                ));
            }
            if seen.insert(key) {
                columns.push(header);
                if columns.len() > 500 {
                    return Err(AppError::validation(
                        "migration source contains more than 500 columns",
                    ));
                }
            }
        }
    }
    if columns.is_empty() {
        return Err(AppError::validation(
            "migration source contains no header columns",
        ));
    }
    Ok(columns)
}

fn xlsx_source_columns(source: &WorkerSource) -> Result<Vec<String>, AppError> {
    let size = fs::metadata(&source.path)
        .map_err(|_| AppError::not_found("XLSX source is unavailable"))?
        .len();
    if size > MAX_MAPPING_PREVIEW_XLSX_BYTES {
        return Err(AppError::validation(
            "XLSX mapping preview is limited to 64 MB; use a saved mapping or automatic worker mapping",
        ));
    }
    let mut workbook = open_workbook_auto(&source.path)
        .map_err(|_| AppError::validation("XLSX source header could not be read"))?;
    let mut headers = Vec::new();
    let mut seen = HashSet::new();
    for sheet_name in workbook.sheet_names().to_vec() {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|_| AppError::validation("XLSX worksheet header could not be read"))?;
        let Some(row) = range.rows().next() else {
            continue;
        };
        let current = row.iter().map(ToString::to_string).collect::<Vec<_>>();
        if current.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        let mut sheet_seen = HashSet::new();
        for header in current {
            let key = header.trim().to_ascii_lowercase();
            if !sheet_seen.insert(key.clone()) {
                return Err(AppError::validation(
                    "XLSX worksheet contains duplicate header columns",
                ));
            }
            if seen.insert(key) {
                headers.push(header);
            }
        }
    }
    Ok(headers)
}

fn session_model(
    row: migration_file_repository::UploadSessionRow,
    parts: Vec<migration_file_repository::UploadPartRow>,
) -> MigrationUploadSession {
    let received = parts
        .iter()
        .map(|part| part.part_number)
        .collect::<HashSet<_>>();
    let missing_parts = (1..=row.total_parts)
        .filter(|part| !received.contains(part))
        .collect::<Vec<_>>();
    let resume_available =
        row.status == "open" && !missing_parts.is_empty() && row.expires_at > chrono::Utc::now();
    MigrationUploadSession {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        provider: MigrationProvider::try_from(row.source_provider.as_str())
            .unwrap_or(MigrationProvider::Auto),
        uploaded_by: row.created_by,
        file_name: row.original_file_name,
        extension: row.file_extension,
        declared_content_type: row.declared_content_type,
        expected_size_bytes: row.expected_size_bytes,
        expected_sha256: row.expected_sha256,
        total_parts: row.total_parts,
        received_parts: row.received_parts,
        received_bytes: row.received_bytes,
        missing_parts,
        status: row.status,
        source_file_id: row.source_file_id,
        last_error: row.last_error,
        resume_available,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        retention_days: row.retention_days,
        evidence_kind: row.evidence_kind,
        supplier_batch: row.supplier_batch,
        cutover_id: row.cutover_id,
    }
}

fn source_model(
    row: migration_file_repository::SourceFileRow,
    artifacts: Vec<migration_file_repository::SourceArtifactRow>,
) -> MigrationSourceFile {
    MigrationSourceFile {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        provider: MigrationProvider::try_from(row.source_provider.as_str())
            .unwrap_or(MigrationProvider::Auto),
        uploaded_by: row.created_by,
        upload_session_id: row.upload_session_id,
        original_file_name: row.original_file_name,
        extension: row.file_extension,
        declared_content_type: row.declared_content_type,
        detected_content_type: row.detected_content_type,
        format: row.file_format,
        size_bytes: row.size_bytes,
        sha256: row.sha256,
        evidence_status: row.evidence_status,
        read_only: row.read_only,
        encrypted: row.encryption_scheme != "none",
        encryption_scheme: row.encryption_scheme,
        retention_until: row.retention_until,
        purged_at: row.purged_at,
        manifest: row.manifest_json,
        page_count: row.page_count,
        artifacts: artifacts
            .into_iter()
            .map(|item| MigrationSourceArtifact {
                id: item.id,
                entry_name: item.entry_name,
                format: item.file_format,
                detected_content_type: item.detected_content_type,
                size_bytes: item.size_bytes,
                sha256: item.sha256,
                page_count: item.page_count,
            })
            .collect(),
        created_at: row.created_at,
    }
}

fn validate_file_name(value: &str) -> Result<(String, String), AppError> {
    let name = value.trim();
    if name.is_empty()
        || !name.is_ascii()
        || name.chars().count() > 180
        || name.chars().any(char::is_control)
        || name.contains(['/', '\\', '<', '>', ':', '"', '|', '?', '*'])
        || name.starts_with(['.', ' '])
        || name.ends_with(['.', ' '])
        || Path::new(name).file_name().and_then(|part| part.to_str()) != Some(name)
    {
        return Err(AppError::validation("invalid migration source filename"));
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "csv" | "xlsx" | "zip" | "pdf" | "png" | "jpg" | "jpeg" | "webp"
    ) {
        return Err(AppError::validation(
            "only CSV, XLSX, ZIP, PDF, PNG, JPEG and WebP files are supported",
        ));
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        return Err(AppError::validation("reserved filenames are not allowed"));
    }
    Ok((name.to_string(), extension))
}

fn normalize_content_type(value: Option<&str>) -> String {
    value
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn validate_declared_content_type(extension: &str, content_type: &str) -> Result<(), AppError> {
    let valid = match extension {
        "csv" => matches!(
            content_type,
            "text/csv" | "application/csv" | "text/plain" | "application/octet-stream"
        ),
        "xlsx" => matches!(
            content_type,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                | "application/octet-stream"
        ),
        "zip" => matches!(
            content_type,
            "application/zip" | "application/x-zip-compressed" | "application/octet-stream"
        ),
        "pdf" => matches!(content_type, "application/pdf" | "application/octet-stream"),
        "png" => matches!(content_type, "image/png" | "application/octet-stream"),
        "jpg" | "jpeg" => matches!(content_type, "image/jpeg" | "application/octet-stream"),
        "webp" => matches!(content_type, "image/webp" | "application/octet-stream"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(AppError::validation(
            "declared content type does not match the file extension",
        ))
    }
}

fn normalize_sha256(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or("").trim().to_ascii_lowercase();
    if value.is_empty() || (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Ok(value)
    } else {
        Err(AppError::validation(
            "SHA-256 must be 64 hexadecimal characters",
        ))
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn scope_key(tenant_id: &str, branch_id: &str) -> String {
    sha256_hex(format!("{tenant_id}\0{branch_id}").as_bytes())[..32].to_string()
}

fn safe_id(value: &str) -> Result<&str, AppError> {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Ok(value)
    } else {
        Err(AppError::validation("invalid migration storage identifier"))
    }
}

fn part_storage_key(
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
) -> Result<String, AppError> {
    Ok(format!(
        "{}/sessions/{}/part-{part_number:06}.bin",
        scope_key(tenant_id, branch_id),
        safe_id(id)?
    ))
}

fn storage_root() -> Result<PathBuf, AppError> {
    let root = std::env::var_os("MIGRATION_FILE_STORAGE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("data")
                .join("migration-files")
        });
    fs::create_dir_all(&root)
        .map_err(|_| AppError::internal("migration file storage is unavailable"))?;
    root.canonicalize()
        .map_err(|_| AppError::internal("migration file storage path is invalid"))
}

fn storage_path(key: &str, must_exist: bool) -> Result<PathBuf, AppError> {
    if key.is_empty()
        || Path::new(key).is_absolute()
        || Path::new(key)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::validation("invalid migration storage path"));
    }
    let root = storage_root()?;
    let path = root.join(key);
    if must_exist {
        let canonical = path
            .canonicalize()
            .map_err(|_| AppError::not_found("migration evidence file is unavailable"))?;
        if !canonical.starts_with(&root) {
            return Err(AppError::forbidden(
                "migration evidence path is outside storage",
            ));
        }
        Ok(canonical)
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::validation("invalid migration storage path"))?;
        fs::create_dir_all(parent)
            .map_err(|_| AppError::internal("migration storage directory could not be created"))?;
        let parent = parent
            .canonicalize()
            .map_err(|_| AppError::internal("migration storage directory is invalid"))?;
        if !parent.starts_with(&root) {
            return Err(AppError::forbidden(
                "migration storage path is outside storage",
            ));
        }
        Ok(path)
    }
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let temp = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .await
        .map_err(|_| AppError::internal("migration upload part could not be created"))?;
    if file.write_all(bytes).await.is_err() || file.sync_all().await.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::internal(
            "migration upload part could not be stored",
        ));
    }
    drop(file);
    if tokio::fs::hard_link(&temp, path).await.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::conflict(
            "migration upload part is already being stored",
        ));
    }
    let _ = tokio::fs::remove_file(&temp).await;
    Ok(())
}

fn prepare_evidence(
    root: &Path,
    tenant_id: &str,
    branch_id: &str,
    session: &migration_file_repository::UploadSessionRow,
    parts: &[migration_file_repository::UploadPartRow],
    expected_sha256: &str,
    encryption_key: &str,
) -> Result<PreparedEvidence, String> {
    if parts.len() != session.total_parts as usize {
        return Err("migration upload is missing parts".into());
    }
    let source_id = Uuid::new_v4().to_string();
    let scope = scope_key(tenant_id, branch_id);
    let evidence_dir = root.join(&scope).join("evidence");
    let artifact_dir = root.join(&scope).join("artifacts").join(&source_id);
    fs::create_dir_all(&evidence_dir)
        .map_err(|_| "source evidence directory could not be created")?;
    let temp_path = evidence_dir.join(format!(".{source_id}.assembling"));
    let final_path = evidence_dir.join(format!("{source_id}.enc"));
    let result = (|| {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|_| "source evidence could not be assembled")?;
        let mut full_hash = Sha256::new();
        let mut total = 0_i64;
        for (index, part) in parts.iter().enumerate() {
            if part.part_number != index as i32 + 1 {
                return Err("migration upload parts must be contiguous".into());
            }
            let path = confined_existing_path(root, &part.storage_key)?;
            let mut input = File::open(path).map_err(|_| "migration upload part is unavailable")?;
            let mut part_hash = Sha256::new();
            let mut part_size = 0_i64;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = input
                    .read(&mut buffer)
                    .map_err(|_| "migration upload part could not be read")?;
                if read == 0 {
                    break;
                }
                part_size += read as i64;
                total += read as i64;
                if total > session.expected_size_bytes {
                    return Err("assembled file exceeds the upload manifest".into());
                }
                part_hash.update(&buffer[..read]);
                full_hash.update(&buffer[..read]);
                output
                    .write_all(&buffer[..read])
                    .map_err(|_| "source evidence could not be assembled")?;
            }
            if part_size != part.size_bytes || format!("{:x}", part_hash.finalize()) != part.sha256
            {
                return Err("migration upload part integrity check failed".into());
            }
        }
        output
            .sync_all()
            .map_err(|_| "source evidence could not be synced")?;
        drop(output);
        if total != session.expected_size_bytes {
            return Err("assembled file size does not match the upload manifest".into());
        }
        let sha256 = format!("{:x}", full_hash.finalize());
        if !expected_sha256.is_empty() && sha256 != expected_sha256 {
            return Err("source file SHA-256 does not match the upload manifest".into());
        }
        let (detected_content_type, mut manifest, mut artifacts, page_count) = inspect_source(
            &temp_path,
            &session.file_extension,
            &artifact_dir,
            &format!("{scope}/artifacts/{source_id}"),
        )?;
        encrypt_evidence_file(
            &temp_path,
            &final_path,
            encryption_key,
            tenant_id,
            branch_id,
        )?;
        fs::remove_file(&temp_path).map_err(|_| "plaintext evidence could not be removed")?;
        set_read_only(&final_path)?;
        for artifact in &mut artifacts {
            let plaintext = root.join(&artifact.storage_key);
            let encrypted_key = format!("{}.enc", artifact.storage_key);
            let encrypted = root.join(&encrypted_key);
            encrypt_evidence_file(&plaintext, &encrypted, encryption_key, tenant_id, branch_id)?;
            fs::remove_file(&plaintext)
                .map_err(|_| "plaintext ZIP artifact could not be removed")?;
            set_read_only(&encrypted)?;
            artifact.storage_key = encrypted_key;
        }
        manifest["encryption"] = json!({
            "scheme": EVIDENCE_ENCRYPTION_SCHEME,
            "chunkBytes": EVIDENCE_CHUNK_BYTES,
            "tenantScopedKey": true
        });
        Ok(PreparedEvidence {
            storage_key: format!("{scope}/evidence/{source_id}.enc"),
            source_id,
            sha256,
            detected_content_type,
            manifest,
            artifacts,
            page_count,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
        remove_read_only_file(&final_path);
        remove_read_only_dir(&artifact_dir);
    }
    result
}

fn inspect_source(
    path: &Path,
    extension: &str,
    artifact_dir: &Path,
    artifact_key: &str,
) -> Result<(String, Value, Vec<PreparedArtifact>, i32), String> {
    if extension == "zip" {
        validate_zip_magic(path)?;
    }
    match extension {
        "csv" => {
            validate_csv(path)?;
            Ok((
                "text/csv".into(),
                json!({"format":"csv","zipEntryCount":0,"extractedBytes":0}),
                Vec::new(),
                0,
            ))
        }
        "xlsx" => {
            let summary = validate_xlsx(path)?;
            Ok((
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
                json!({"format":"xlsx","workbookEntries":summary.0,"workbookUncompressedBytes":summary.1}),
                Vec::new(),
                0,
            ))
        }
        "zip" => {
            let artifacts = extract_zip(path, artifact_dir, artifact_key)?;
            let extracted_bytes: i64 = artifacts.iter().map(|item| item.size_bytes).sum();
            let page_count = artifacts.iter().map(|item| item.page_count).sum();
            Ok((
                "application/zip".into(),
                json!({"format":"zip","zipEntryCount":artifacts.len(),"extractedBytes":extracted_bytes,"pageCount":page_count,"limits":{"maxEntries":MAX_ZIP_ENTRIES,"maxEntryBytes":MAX_ZIP_ENTRY_BYTES,"maxTotalBytes":MAX_ZIP_TOTAL_BYTES,"maxCompressionRatio":MAX_COMPRESSION_RATIO}}),
                artifacts,
                page_count,
            ))
        }
        "pdf" => {
            let page_count = validate_pdf(path)?;
            Ok((
                "application/pdf".into(),
                json!({"format":"pdf","pageCount":page_count}),
                Vec::new(),
                page_count,
            ))
        }
        "png" => {
            validate_png(path)?;
            Ok((
                "image/png".into(),
                json!({"format":"png","pageCount":1}),
                Vec::new(),
                1,
            ))
        }
        "jpg" | "jpeg" => {
            validate_jpeg(path)?;
            Ok((
                "image/jpeg".into(),
                json!({"format":"jpeg","pageCount":1}),
                Vec::new(),
                1,
            ))
        }
        "webp" => {
            validate_webp(path)?;
            Ok((
                "image/webp".into(),
                json!({"format":"webp","pageCount":1}),
                Vec::new(),
                1,
            ))
        }
        _ => Err("unsupported migration source format".into()),
    }
}

fn validate_csv(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "CSV source could not be opened")?;
    let mut carry = Vec::new();
    let mut saw_content = false;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "CSV source could not be read")?;
        if read == 0 {
            break;
        }
        if !saw_content && has_binary_magic(&buffer[..read]) {
            return Err("CSV content has a binary file signature".into());
        }
        if buffer[..read].contains(&0) {
            return Err("CSV content contains binary NUL bytes".into());
        }
        saw_content |= buffer[..read]
            .iter()
            .any(|byte| !byte.is_ascii_whitespace());
        carry.extend_from_slice(&buffer[..read]);
        match std::str::from_utf8(&carry) {
            Ok(_) => carry.clear(),
            Err(error) if error.error_len().is_none() => {
                let suffix = carry.split_off(error.valid_up_to());
                carry = suffix;
                if carry.len() > 3 {
                    return Err("CSV content is not valid UTF-8".into());
                }
            }
            Err(_) => return Err("CSV content is not valid UTF-8".into()),
        }
    }
    if !carry.is_empty() || !saw_content {
        return Err("CSV content is empty or not valid UTF-8".into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|_| "CSV content could not be parsed")?;
    let headers = reader.headers().map_err(|_| "CSV header is invalid")?;
    if headers.is_empty() || headers.iter().all(|value| value.trim().is_empty()) {
        return Err("CSV source has no header columns".into());
    }
    let mut has_row = false;
    for record in reader.records() {
        let record = record.map_err(|_| "CSV contains a corrupt row")?;
        has_row |= record.iter().any(|value| !value.trim().is_empty());
    }
    if !has_row {
        return Err("CSV source contains no data rows".into());
    }
    Ok(())
}

fn validate_zip_magic(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "archive source could not be opened")?;
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic)
        .map_err(|_| "archive source is missing its ZIP signature")?;
    if matches!(
        magic,
        [0x50, 0x4b, 0x03, 0x04] | [0x50, 0x4b, 0x05, 0x06] | [0x50, 0x4b, 0x07, 0x08]
    ) {
        Ok(())
    } else {
        Err("archive content does not have a ZIP magic signature".into())
    }
}

fn has_binary_magic(bytes: &[u8]) -> bool {
    [
        &[0x50, 0x4b][..],
        &[0x25, 0x50, 0x44, 0x46],
        &[0x89, 0x50, 0x4e, 0x47],
        &[0xff, 0xd8, 0xff],
        &[0x47, 0x49, 0x46, 0x38],
        &[0x1f, 0x8b],
        &[0x52, 0x61, 0x72, 0x21],
        &[0x42, 0x4d],
    ]
    .iter()
    .any(|magic| bytes.starts_with(magic))
}

fn validate_xlsx(path: &Path) -> Result<(usize, u64), String> {
    validate_zip_magic(path)?;
    let file = File::open(path).map_err(|_| "XLSX source could not be opened")?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "XLSX content is not a valid OOXML ZIP archive")?;
    if archive.len() > 10_000 {
        return Err("XLSX archive has too many entries".into());
    }
    let mut names = HashSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "XLSX archive entry could not be read")?;
        let name = entry
            .enclosed_name()
            .ok_or("XLSX archive contains an unsafe path")?
            .to_string_lossy()
            .replace('\\', "/");
        total = total
            .checked_add(entry.size())
            .ok_or("XLSX archive size overflow")?;
        if total > MAX_ZIP_TOTAL_BYTES {
            return Err("XLSX uncompressed size exceeds the limit".into());
        }
        assert_safe_ratio(entry.size(), entry.compressed_size())?;
        names.insert(name);
    }
    if names.iter().any(|name| {
        matches!(
            name.to_ascii_lowercase().as_str(),
            "encryptioninfo" | "encryptedpackage"
        )
    }) {
        return Err("password-protected XLSX files are not supported".into());
    }
    if !names.contains("[Content_Types].xml")
        || !names.contains("_rels/.rels")
        || !names.contains("xl/workbook.xml")
    {
        return Err("XLSX content is missing required workbook records".into());
    }
    let entry_count = archive.len();
    drop(archive);
    let mut workbook =
        open_workbook_auto(path).map_err(|_| "XLSX workbook is corrupt or password-protected")?;
    let mut has_data = false;
    for sheet_name in workbook.sheet_names().to_vec() {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|_| "XLSX worksheet is corrupt or password-protected")?;
        if range.height() > 1
            && range
                .rows()
                .next()
                .is_some_and(|row| row.iter().any(|value| !value.to_string().trim().is_empty()))
        {
            has_data = true;
            break;
        }
    }
    if !has_data {
        return Err("XLSX source contains no data rows".into());
    }
    Ok((entry_count, total))
}

fn extract_zip(
    path: &Path,
    artifact_dir: &Path,
    artifact_key: &str,
) -> Result<Vec<PreparedArtifact>, String> {
    let file = File::open(path).map_err(|_| "ZIP source could not be opened")?;
    let mut archive = ZipArchive::new(file).map_err(|_| "ZIP content is not a valid archive")?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("ZIP archive exceeds the 300-entry limit".into());
    }
    fs::create_dir_all(artifact_dir)
        .map_err(|_| "ZIP extraction directory could not be created")?;
    let mut total = 0_u64;
    let mut names = HashSet::new();
    let mut artifacts = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "ZIP entry could not be read")?;
        if entry.encrypted() {
            return Err(format!(
                "password-protected ZIP entry is not supported: {}",
                entry.name()
            ));
        }
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or("ZIP archive contains an unsafe path")?;
        let entry_name = enclosed.to_string_lossy().replace('\\', "/");
        if !names.insert(entry_name.clone()) {
            return Err("ZIP archive contains duplicate entry names".into());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP symbolic links are not allowed".into());
        }
        let extension = enclosed
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "csv" | "xlsx" | "pdf" | "png" | "jpg" | "jpeg" | "webp"
        ) {
            return Err(format!("unsupported ZIP entry: {entry_name}"));
        }
        let declared_size = entry.size();
        if declared_size == 0 || declared_size > MAX_ZIP_ENTRY_BYTES {
            return Err(format!("ZIP entry exceeds the size limit: {entry_name}"));
        }
        assert_safe_ratio(declared_size, entry.compressed_size())?;
        total = total
            .checked_add(declared_size)
            .ok_or("ZIP extracted size overflow")?;
        if total > MAX_ZIP_TOTAL_BYTES {
            return Err("ZIP extracted size exceeds the 1 GB limit".into());
        }
        let id = Uuid::new_v4().to_string();
        let output_path = artifact_dir.join(format!("{id}.{extension}"));
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output_path)
            .map_err(|_| "ZIP entry could not be extracted")?;
        let copied = io::copy(
            &mut entry.by_ref().take(MAX_ZIP_ENTRY_BYTES + 1),
            &mut output,
        )
        .map_err(|_| "ZIP entry extraction failed")?;
        output
            .sync_all()
            .map_err(|_| "ZIP entry could not be synced")?;
        drop(output);
        if copied != declared_size {
            return Err("ZIP entry size does not match its manifest".into());
        }
        let (content_type, format, page_count) = match extension.as_str() {
            "csv" => {
                validate_csv(&output_path)?;
                ("text/csv", "csv", 0)
            }
            "xlsx" => {
                validate_xlsx(&output_path)?;
                (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "xlsx",
                    0,
                )
            }
            "pdf" => ("application/pdf", "pdf", validate_pdf(&output_path)?),
            "png" => {
                validate_png(&output_path)?;
                ("image/png", "png", 1)
            }
            "jpg" | "jpeg" => {
                validate_jpeg(&output_path)?;
                ("image/jpeg", "jpeg", 1)
            }
            "webp" => {
                validate_webp(&output_path)?;
                ("image/webp", "webp", 1)
            }
            _ => return Err(format!("ZIP attachment MIME does not match: {entry_name}")),
        };
        let sha256 = hash_file(&output_path)?;
        artifacts.push(PreparedArtifact {
            id: id.clone(),
            entry_name,
            format: format.into(),
            content_type: content_type.into(),
            size_bytes: copied as i64,
            sha256,
            storage_key: format!("{artifact_key}/{id}.{extension}"),
            page_count,
        });
    }
    if artifacts.is_empty() {
        return Err("ZIP archive contains no supported evidence files".into());
    }
    Ok(artifacts)
}

async fn scan_prepared_evidence(
    prepared: &PreparedEvidence,
    tenant_id: &str,
    branch_id: &str,
    extension: &str,
) -> Result<Value, AppError> {
    scan_stored_evidence(
        &prepared.storage_key,
        &prepared.sha256,
        extension,
        tenant_id,
        branch_id,
    )
    .await?;
    for artifact in &prepared.artifacts {
        scan_stored_evidence(
            &artifact.storage_key,
            &artifact.sha256,
            &artifact.format,
            tenant_id,
            branch_id,
        )
        .await?;
    }
    Ok(json!({
        "engine": "clamd",
        "status": "clean",
        "scannedObjects": prepared.artifacts.len() + 1,
        "scannedAt": Utc::now()
    }))
}

async fn scan_stored_evidence(
    storage_key: &str,
    expected_hash: &str,
    extension: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), AppError> {
    let encrypted_path = storage_path(storage_key, true)?;
    let tenant = tenant_id.to_string();
    let branch = branch_id.to_string();
    let extension = extension.to_string();
    let expected_hash = expected_hash.to_string();
    let materialized = tokio::task::spawn_blocking(move || {
        materialize_verified_source(
            &encrypted_path,
            EVIDENCE_ENCRYPTION_SCHEME,
            &tenant,
            &branch,
            &extension,
            &expected_hash,
        )
    })
    .await
    .map_err(|_| AppError::internal("migration malware scan worker stopped"))??;
    let result = scan_file_with_clamd(&materialized.path).await;
    if materialized.cleanup_on_drop {
        let _ = tokio::fs::remove_file(&materialized.path).await;
    }
    result
}

async fn scan_file_with_clamd(path: &Path) -> Result<(), AppError> {
    let address = std::env::var("MIGRATION_CLAMD_ADDRESS")
        .map_err(|_| AppError::internal("migration malware scanner is not configured"))?;
    let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(address.trim()))
        .await
        .map_err(|_| AppError::internal("migration malware scanner connection timed out"))?
        .map_err(|_| AppError::internal("migration malware scanner is unavailable"))?;
    stream
        .write_all(b"zINSTREAM\0")
        .await
        .map_err(|_| AppError::internal("migration malware scan could not start"))?;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| AppError::internal("migration source could not be scanned"))?;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| AppError::internal("migration source could not be scanned"))?;
        if read == 0 {
            break;
        }
        stream
            .write_all(&(read as u32).to_be_bytes())
            .await
            .map_err(|_| AppError::internal("migration malware scanner disconnected"))?;
        stream
            .write_all(&buffer[..read])
            .await
            .map_err(|_| AppError::internal("migration malware scanner disconnected"))?;
    }
    stream
        .write_all(&0_u32.to_be_bytes())
        .await
        .map_err(|_| AppError::internal("migration malware scan could not finish"))?;
    let mut response = Vec::new();
    let mut reader = BufReader::new(stream.take(4096));
    timeout(
        Duration::from_secs(120),
        reader.read_until(0, &mut response),
    )
    .await
    .map_err(|_| AppError::internal("migration malware scan timed out"))?
    .map_err(|_| AppError::internal("migration malware scan result is unavailable"))?;
    if !response.ends_with(&[0]) {
        return Err(AppError::internal(
            "migration malware scanner returned an incomplete result",
        ));
    }
    parse_clamd_verdict(&response)
}

fn parse_clamd_verdict(response: &[u8]) -> Result<(), AppError> {
    let verdict = String::from_utf8_lossy(&response);
    if verdict.trim_end_matches(['\0', '\r', '\n']).ends_with("OK") {
        Ok(())
    } else if verdict.contains("FOUND") {
        Err(AppError::validation(
            "migration source was rejected by malware scanning",
        ))
    } else {
        Err(AppError::internal(
            "migration malware scanner returned an invalid result",
        ))
    }
}

fn validate_pdf(path: &Path) -> Result<i32, String> {
    let mut file = File::open(path).map_err(|_| "PDF evidence could not be opened")?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut carry = Vec::new();
    let mut pages = 0_i32;
    let mut encrypted = false;
    let mut eof = false;
    let mut first = true;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "PDF evidence could not be read")?;
        if read == 0 {
            break;
        }
        if first {
            first = false;
            if !buffer[..read].starts_with(b"%PDF-") {
                return Err("PDF signature does not match the file extension".into());
            }
        }
        let overlap = carry.len();
        carry.extend_from_slice(&buffer[..read]);
        let start = overlap.saturating_sub(16);
        for index in start..carry.len() {
            if carry[index..].starts_with(b"/Encrypt") {
                encrypted = true;
            }
            if carry[index..].starts_with(b"%%EOF") {
                eof = true;
            }
            if carry[index..].starts_with(b"/Type") {
                let mut cursor = index + 5;
                while carry.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                    cursor += 1;
                }
                if cursor + 5 > overlap
                    && carry.get(cursor..).is_some_and(|tail| {
                        tail.starts_with(b"/Page") && tail.get(5) != Some(&b's')
                    })
                {
                    pages += 1;
                }
            }
        }
        if carry.len() > 32 {
            carry.drain(..carry.len() - 32);
        }
    }
    if encrypted {
        return Err("password-protected PDF files are not supported".into());
    }
    if !eof {
        return Err("PDF evidence is corrupt or truncated".into());
    }
    Ok(pages)
}

fn validate_png(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "PNG evidence could not be opened")?;
    let mut header = [0_u8; 24];
    file.read_exact(&mut header)
        .map_err(|_| "PNG evidence is corrupt or truncated")?;
    if &header[..8] != b"\x89PNG\r\n\x1a\n"
        || &header[12..16] != b"IHDR"
        || header[16..24].iter().all(|byte| *byte == 0)
    {
        return Err("PNG signature or dimensions are invalid".into());
    }
    Ok(())
}

fn validate_jpeg(path: &Path) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "JPEG evidence could not be opened")?;
    let mut start = [0_u8; 3];
    file.read_exact(&mut start)
        .map_err(|_| "JPEG evidence is corrupt or truncated")?;
    file.seek(SeekFrom::End(-2))
        .map_err(|_| "JPEG evidence is corrupt or truncated")?;
    let mut end = [0_u8; 2];
    file.read_exact(&mut end)
        .map_err(|_| "JPEG evidence is corrupt or truncated")?;
    if start != [0xff, 0xd8, 0xff] || end != [0xff, 0xd9] {
        return Err("JPEG signature is invalid".into());
    }
    Ok(())
}

fn validate_webp(path: &Path) -> Result<(), String> {
    let size = fs::metadata(path)
        .map_err(|_| "WebP evidence metadata is unavailable")?
        .len();
    let mut file = File::open(path).map_err(|_| "WebP evidence could not be opened")?;
    let mut header = [0_u8; 12];
    file.read_exact(&mut header)
        .map_err(|_| "WebP evidence is corrupt or truncated")?;
    let declared = u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64 + 8;
    if &header[..4] != b"RIFF" || &header[8..] != b"WEBP" || declared != size {
        return Err("WebP signature or size is invalid".into());
    }
    Ok(())
}

fn assert_safe_ratio(size: u64, compressed: u64) -> Result<(), String> {
    if size > 0 && (compressed == 0 || size / compressed.max(1) > MAX_COMPRESSION_RATIO) {
        Err("archive compression ratio exceeds the safety limit".into())
    } else {
        Ok(())
    }
}

fn evidence_encryption_key() -> Result<String, AppError> {
    std::env::var("MIGRATION_EVIDENCE_ENCRYPTION_KEY")
        .or_else(|_| std::env::var("SECURITY_ENCRYPTION_KEY"))
        .ok()
        .filter(|value| value.trim().len() >= 32)
        .ok_or_else(|| {
            AppError::service_unavailable(
                "MIGRATION_EVIDENCE_ENCRYPTION_NOT_CONFIGURED",
                "migration evidence encryption key is not configured",
            )
        })
}

fn evidence_cipher(key: &str, tenant_id: &str, branch_id: &str) -> Result<Aes256Gcm, String> {
    let digest = Sha256::digest(format!("{key}\0{tenant_id}\0{branch_id}").as_bytes());
    Aes256Gcm::new_from_slice(&digest).map_err(|_| "evidence encryption key is invalid".into())
}

fn evidence_nonce(prefix: &[u8; 8], counter: u32) -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    nonce[..8].copy_from_slice(prefix);
    nonce[8..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

fn evidence_aad(tenant_id: &str, branch_id: &str, counter: u32) -> Vec<u8> {
    format!("{tenant_id}\0{branch_id}\0{counter}").into_bytes()
}

fn encrypt_evidence_file(
    input_path: &Path,
    output_path: &Path,
    key: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), String> {
    let cipher = evidence_cipher(key, tenant_id, branch_id)?;
    let mut input = File::open(input_path).map_err(|_| "plaintext evidence could not be opened")?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output_path)
        .map_err(|_| "encrypted evidence could not be created")?;
    let result = (|| -> Result<(), String> {
        let mut prefix = [0_u8; 8];
        OsRng.fill_bytes(&mut prefix);
        output
            .write_all(EVIDENCE_MAGIC)
            .map_err(|_| "encrypted evidence header could not be written")?;
        output
            .write_all(&prefix)
            .map_err(|_| "encrypted evidence nonce could not be written")?;
        let mut buffer = vec![0_u8; EVIDENCE_CHUNK_BYTES];
        let mut counter = 0_u32;
        loop {
            let read = input
                .read(&mut buffer)
                .map_err(|_| "plaintext evidence could not be read")?;
            if read == 0 {
                break;
            }
            let nonce = Nonce::from(evidence_nonce(&prefix, counter));
            let aad = evidence_aad(tenant_id, branch_id, counter);
            let encrypted = cipher
                .encrypt(
                    &nonce,
                    Payload {
                        msg: &buffer[..read],
                        aad: &aad,
                    },
                )
                .map_err(|_| "evidence encryption failed")?;
            output
                .write_all(&(read as u32).to_be_bytes())
                .map_err(|_| "encrypted evidence length could not be written")?;
            output
                .write_all(&encrypted)
                .map_err(|_| "encrypted evidence chunk could not be written")?;
            counter = counter
                .checked_add(1)
                .ok_or("evidence has too many encryption chunks")?;
        }
        output
            .write_all(&0_u32.to_be_bytes())
            .map_err(|_| "encrypted evidence terminator could not be written")?;
        output
            .sync_all()
            .map_err(|_| "encrypted evidence could not be synced".to_string())
    })();
    if result.is_err() {
        drop(output);
        let _ = fs::remove_file(output_path);
    }
    result
}

fn decrypt_evidence_file(
    input_path: &Path,
    output_path: &Path,
    key: &str,
    tenant_id: &str,
    branch_id: &str,
    expected_sha256: &str,
) -> Result<(), String> {
    let cipher = evidence_cipher(key, tenant_id, branch_id)?;
    let mut input = File::open(input_path).map_err(|_| "encrypted evidence could not be opened")?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output_path)
        .map_err(|_| "temporary evidence could not be created")?;
    let result = (|| -> Result<(), String> {
        let mut magic = [0_u8; 8];
        let mut prefix = [0_u8; 8];
        input
            .read_exact(&mut magic)
            .map_err(|_| "encrypted evidence header is missing")?;
        input
            .read_exact(&mut prefix)
            .map_err(|_| "encrypted evidence nonce is missing")?;
        if &magic != EVIDENCE_MAGIC {
            return Err("encrypted evidence header is invalid".into());
        }
        let mut hasher = Sha256::new();
        let mut counter = 0_u32;
        loop {
            let mut length = [0_u8; 4];
            input
                .read_exact(&mut length)
                .map_err(|_| "encrypted evidence chunk length is missing")?;
            let plaintext_len = u32::from_be_bytes(length) as usize;
            if plaintext_len == 0 {
                break;
            }
            if plaintext_len > EVIDENCE_CHUNK_BYTES {
                return Err("encrypted evidence chunk exceeds its limit".into());
            }
            let mut encrypted = vec![0_u8; plaintext_len + 16];
            input
                .read_exact(&mut encrypted)
                .map_err(|_| "encrypted evidence chunk is truncated")?;
            let nonce = Nonce::from(evidence_nonce(&prefix, counter));
            let aad = evidence_aad(tenant_id, branch_id, counter);
            let plaintext = cipher
                .decrypt(
                    &nonce,
                    Payload {
                        msg: &encrypted,
                        aad: &aad,
                    },
                )
                .map_err(|_| "encrypted evidence authentication failed")?;
            if plaintext.len() != plaintext_len {
                return Err("encrypted evidence chunk length does not match".into());
            }
            hasher.update(&plaintext);
            output
                .write_all(&plaintext)
                .map_err(|_| "temporary evidence could not be written")?;
            counter = counter
                .checked_add(1)
                .ok_or("evidence has too many encrypted chunks")?;
        }
        let actual_hash = format!("{:x}", hasher.finalize());
        if actual_hash != expected_sha256 {
            return Err("source evidence SHA-256 recheck failed".into());
        }
        output
            .sync_all()
            .map_err(|_| "temporary evidence could not be synced".to_string())
    })();
    if result.is_err() {
        drop(output);
        let _ = fs::remove_file(output_path);
    }
    result
}

fn materialize_verified_source(
    stored_path: &Path,
    encryption_scheme: &str,
    tenant_id: &str,
    branch_id: &str,
    extension: &str,
    expected_sha256: &str,
) -> Result<MaterializedSource, AppError> {
    if encryption_scheme == "none" {
        if hash_file(stored_path).map_err(AppError::validation)? != expected_sha256 {
            return Err(AppError::conflict("source evidence SHA-256 recheck failed"));
        }
        return Ok(MaterializedSource {
            path: stored_path.to_path_buf(),
            cleanup_on_drop: false,
        });
    }
    if encryption_scheme != EVIDENCE_ENCRYPTION_SCHEME {
        return Err(AppError::conflict(
            "source evidence encryption scheme is unsupported",
        ));
    }
    let key = evidence_encryption_key()?;
    let runtime_dir = storage_root()?
        .join(scope_key(tenant_id, branch_id))
        .join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|_| AppError::internal("migration runtime directory could not be created"))?;
    cleanup_stale_runtime_files(&runtime_dir);
    let path = runtime_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    decrypt_evidence_file(
        stored_path,
        &path,
        &key,
        tenant_id,
        branch_id,
        expected_sha256,
    )
    .map_err(AppError::conflict)?;
    Ok(MaterializedSource {
        path,
        cleanup_on_drop: true,
    })
}

fn cleanup_stale_runtime_files(runtime_dir: &Path) {
    let Ok(entries) = fs::read_dir(runtime_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_secs() > 60 * 60);
        if stale && path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "evidence artifact could not be opened")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "evidence artifact could not be read")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn set_read_only(path: &Path) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|_| "evidence permissions could not be read".to_string())?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
        .map_err(|_| "evidence could not be made read-only".to_string())
}

fn confined_existing_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty()
        || Path::new(key).is_absolute()
        || Path::new(key)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("invalid stored upload path".into());
    }
    let path = root
        .join(key)
        .canonicalize()
        .map_err(|_| "stored upload part is unavailable")?;
    if !path.starts_with(root) {
        return Err("stored upload path escaped the migration root".into());
    }
    Ok(path)
}

fn cleanup_prepared(prepared: &PreparedEvidence) {
    if let Ok(path) = storage_path(&prepared.storage_key, true) {
        remove_read_only_file(&path);
    }
    for artifact in &prepared.artifacts {
        if let Ok(path) = storage_path(&artifact.storage_key, true) {
            remove_read_only_file(&path);
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}

fn remove_read_only_file(path: &Path) {
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_readonly(false);
        let _ = fs::set_permissions(path, permissions);
    }
    let _ = fs::remove_file(path);
}

fn remove_read_only_dir(path: &Path) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            remove_read_only_file(&entry.path());
        }
    }
    let _ = fs::remove_dir(path);
}

async fn remove_session_parts(tenant_id: &str, branch_id: &str, id: &str) {
    let key = format!("{}/sessions/{}", scope_key(tenant_id, branch_id), id);
    if let Ok(path) = storage_path(&key, false) {
        let _ = tokio::fs::remove_dir_all(path).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assert_safe_ratio, decrypt_evidence_file, encrypt_evidence_file, extract_zip,
        has_binary_magic, normalize_sha256, parse_clamd_verdict, sha256_hex,
        source_columns_blocking, source_profile_blocking, suggested_group, validate_csv,
        validate_file_name, validate_pdf, validate_xlsx, WorkerSource,
    };
    use crate::models::migration::{MigrationEntity, MigrationProvider};
    use std::{fs, io::Write, path::PathBuf};
    use uuid::Uuid;
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn malware_verdict_is_fail_closed() {
        assert!(parse_clamd_verdict(b"stream: OK\0").is_ok());
        assert!(parse_clamd_verdict(b"stream: Eicar-Test-Signature FOUND\0").is_err());
        assert!(parse_clamd_verdict(b"stream: UNKNOWN\0").is_err());
    }

    #[test]
    fn file_intake_rejects_traversal_reserved_names_bad_hashes_and_zip_bombs() {
        assert!(validate_file_name("clients.csv").is_ok());
        assert!(validate_file_name("../clients.csv").is_err());
        assert!(validate_file_name("CON.csv").is_err());
        assert!(validate_file_name("clients.exe").is_err());
        assert!(normalize_sha256(Some(&"a".repeat(64))).is_ok());
        assert!(normalize_sha256(Some("not-a-hash")).is_err());
        assert!(assert_safe_ratio(200, 1).is_ok());
        assert!(assert_safe_ratio(201, 1).is_err());
        assert!(has_binary_magic(b"%PDF-1.7"));
        assert!(!has_binary_magic(b"name,email\r\n"));
    }

    #[test]
    fn historical_evidence_groups_pages_without_extracting_bill_data() {
        assert_eq!(
            suggested_group("TW-517/page-2.jpg", false),
            ("TW-517".into(), 9500, "zip_folder")
        );
        assert_eq!(
            suggested_group("TW-517-page-1.png", false),
            ("TW-517".into(), 8000, "page_sequence")
        );
        let root = test_dir();
        let pdf = root.join("bill.pdf");
        fs::write(&pdf, b"%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF").unwrap();
        assert_eq!(validate_pdf(&pdf).unwrap(), 1);
        fs::write(&pdf, b"%PDF-1.7\n/Encrypt\n%%EOF").unwrap();
        assert!(validate_pdf(&pdf).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_intake_rejects_malicious_csv_xlsx_and_zip_content() {
        let root = test_dir();
        let csv = root.join("malicious.csv");
        fs::write(&csv, b"%PDF-1.7\0not-csv").unwrap();
        assert!(validate_csv(&csv).is_err());

        let xlsx = root.join("malicious.xlsx");
        write_zip(
            &xlsx,
            &[
                ("[Content_Types].xml", b"content"),
                ("_rels/.rels", b"rels"),
                ("xl/workbook.xml", b"workbook"),
                ("../escape.xml", b"escape"),
            ],
        );
        assert!(validate_xlsx(&xlsx).is_err());

        let zip = root.join("malicious.zip");
        write_zip(&zip, &[("../escape.csv", b"name,email\r\nA,B\r\n")]);
        assert!(extract_zip(&zip, &root.join("artifacts"), "test/artifacts").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn csv_validation_streams_a_large_source_without_loading_it_whole() {
        let root = test_dir();
        let path = root.join("large.csv");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"externalId,firstName,phone\r\n").unwrap();
        let row = b"legacy-000001,Customer,+919999999999\r\n";
        for _ in 0..750_000 {
            file.write_all(row).unwrap();
        }
        file.sync_all().unwrap();
        assert!(fs::metadata(&path).unwrap().len() > 25 * 1024 * 1024);
        assert!(validate_csv(&path).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mapping_preview_reads_verified_csv_headers_and_rejects_ambiguity() {
        let root = test_dir();
        let path = root.join("headers.csv");
        fs::write(
            &path,
            b"External ID,First Name,Phone\r\n1,A,+919999999999\r\n",
        )
        .unwrap();
        let source = WorkerSource {
            name: "headers.csv".into(),
            format: "csv".into(),
            path: path.clone(),
            cleanup_on_drop: false,
        };
        assert_eq!(
            source_columns_blocking(&[source]).unwrap(),
            vec!["External ID", "First Name", "Phone"]
        );
        fs::write(&path, b"Phone,phone\r\n1,2\r\n").unwrap();
        let duplicate = WorkerSource {
            name: "headers.csv".into(),
            format: "csv".into(),
            path,
            cleanup_on_drop: false,
        };
        assert!(source_columns_blocking(&[duplicate]).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase_one_profiler_streams_stats_masks_pii_and_suggests_fixed_fields() {
        let root = test_dir();
        let path = root.join("clients.csv");
        fs::write(
            &path,
            b"Mobile No,Email,Amount,Status\r\n9876543210,a@example.com,1250.50,active\r\n9876543210,b@example.com,500,inactive\r\n9999999999,,250,active\r\n",
        )
        .unwrap();
        let profile = source_profile_blocking(
            &[WorkerSource {
                name: "clients.csv".into(),
                format: "csv".into(),
                path: path.clone(),
                cleanup_on_drop: false,
            }],
            MigrationProvider::Auto,
        )
        .unwrap();
        let sheet = &profile.sheets[0];
        assert_eq!(sheet.row_count, 3);
        assert_eq!(sheet.column_count, 4);
        let phone = &sheet.column_profiles[0];
        assert_eq!(phone.detected_data_type, "phone");
        assert_eq!(phone.possible_crm_entity, Some(MigrationEntity::Clients));
        assert_eq!(phone.possible_crm_field.as_deref(), Some("phone"));
        assert_eq!(phone.duplicate_count, 1);
        assert!(phone
            .sample_values
            .iter()
            .all(|value| value.starts_with("***")));
        assert!(phone.statistics_exact);
        let email = &sheet.column_profiles[1];
        assert_eq!(email.empty_percentage, 33.33);
        assert!(email
            .sample_values
            .iter()
            .all(|value| value.contains("***@")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase_four_profiler_marks_day_month_ambiguity() {
        let root = test_dir();
        let path = root.join("dates.csv");
        fs::write(&path, b"DOB\r\n01/02/2026\r\n02/03/2026\r\n").unwrap();
        let profile = source_profile_blocking(
            &[WorkerSource {
                name: "dates.csv".into(),
                format: "csv".into(),
                path,
                cleanup_on_drop: false,
            }],
            MigrationProvider::Auto,
        )
        .unwrap();
        assert!(profile.sheets[0].column_profiles[0]
            .patterns
            .iter()
            .any(|pattern| pattern == "date_format_ambiguous"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn phase_one_evidence_encryption_round_trips_and_binds_tenant_scope() {
        let root = test_dir();
        let plaintext = root.join("source.csv");
        let encrypted = root.join("source.enc");
        let decrypted = root.join("decrypted.csv");
        let wrong_scope = root.join("wrong.csv");
        let content = b"name,phone\r\nA,9876543210\r\n";
        fs::write(&plaintext, content).unwrap();
        encrypt_evidence_file(
            &plaintext,
            &encrypted,
            "01234567890123456789012345678901",
            "tenant-a",
            "branch-a",
        )
        .unwrap();
        assert!(!fs::read(&encrypted)
            .unwrap()
            .windows(content.len())
            .any(|window| window == content));
        decrypt_evidence_file(
            &encrypted,
            &decrypted,
            "01234567890123456789012345678901",
            "tenant-a",
            "branch-a",
            &sha256_hex(content),
        )
        .unwrap();
        assert_eq!(fs::read(&decrypted).unwrap(), content);
        assert!(decrypt_evidence_file(
            &encrypted,
            &wrong_scope,
            "01234567890123456789012345678901",
            "tenant-b",
            "branch-a",
            &sha256_hex(content),
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    fn test_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("aurashine-migration-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_zip(path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        for (name, content) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
    }
}
