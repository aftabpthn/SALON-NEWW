use crate::{
    models::{
        common::AppError,
        migration::{
            CreateLargeImportJobRequest, ImportJob, MigrationCutoverStatus,
            MigrationDuplicateDecision, MigrationImportChunk, MigrationMode, MigrationProvider,
            MigrationSelectiveRetryRequest, PurchaseBillPostingMode, ThreeLayerPostingContract,
            THREE_LAYER_POSTING_CONTRACT_VERSION,
        },
    },
    repositories::{migration_large_import_repository, migration_repository},
    services::{migration_adapter_service, migration_file_service, migration_service},
};
use calamine::{open_workbook_auto, Reader};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
};
use tokio::sync::mpsc;

struct RawChunk {
    source_sheet: String,
    source_row_offset: i32,
    table: Vec<Vec<String>>,
}

pub async fn create_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: CreateLargeImportJobRequest,
) -> Result<ImportJob, AppError> {
    let posting_contract_fields = migration_service::validate_three_layer_posting_mode(
        request.entity,
        request.posting_mode,
        request.mode,
        request.cutover_id.as_deref(),
        request.cutover_date,
    )?;
    if !(100..=10_000).contains(&request.chunk_size) {
        return Err(AppError::validation(
            "chunkSize must be between 100 and 10000",
        ));
    }
    if request.allow_partial_import && financial_all_or_nothing(request.entity) {
        return Err(AppError::validation(
            "financial and opening-inventory migrations are all-or-nothing and cannot enable partial import",
        ));
    }
    let owner = migration_service::resolve_owner(
        db,
        tenant,
        branch,
        actor,
        request.owner_user_id.as_deref(),
    )
    .await?;
    let (file_name, source_hash, _, _) =
        migration_file_service::worker_sources(db, tenant, branch, request.source_file_id.trim())
            .await?;
    let profile = migration_file_service::source_profile(
        db,
        tenant,
        branch,
        actor,
        request.source_file_id.trim(),
    )
    .await?;
    let source_provider = if request.source_provider == MigrationProvider::Auto {
        profile.provider
    } else {
        request.source_provider
    };
    let importable = profile
        .sheets
        .iter()
        .filter(|sheet| sheet.importable)
        .collect::<Vec<_>>();
    let source_sheet = if request.source_sheet.trim().is_empty() {
        if importable.len() != 1 {
            return Err(AppError::validation(
                "select one source sheet before creating this workbook import",
            ));
        }
        importable[0].id.clone()
    } else {
        request.source_sheet.trim().to_string()
    };
    let selected = profile
        .sheets
        .iter()
        .find(|sheet| sheet.id == source_sheet)
        .ok_or_else(|| AppError::validation("selected source sheet was not found"))?;
    let header_source_sheet = request.header_source_sheet.trim().to_string();
    if !header_source_sheet.is_empty()
        && (request.entity != crate::models::migration::MigrationEntity::PurchaseBills
            || header_source_sheet == source_sheet
            || !profile
                .sheets
                .iter()
                .any(|sheet| sheet.id == header_source_sheet))
    {
        return Err(AppError::validation(
            "headerSourceSheet must be a different sheet from the same purchase-bill source file",
        ));
    }
    if !selected.targets.is_empty() && !selected.targets.contains(&request.entity) {
        return Err(AppError::validation(
            "selected source sheet does not contain the chosen entity",
        ));
    }
    if request.mode == MigrationMode::Commit
        && migration_repository::find_active_commit_duplicate(
            db,
            tenant,
            branch,
            request.entity,
            &source_hash,
        )
        .await
        .map_err(|_| AppError::internal("failed to check import source identity"))?
        .is_some()
    {
        return Err(AppError::conflict(
            "this source file already has an active commit import job",
        ));
    }
    let mapping_id = request
        .mapping_id
        .as_deref()
        .filter(|id| !id.trim().is_empty());
    let mut mapping_columns = selected.columns.clone();
    let mut mapping_profiles = selected.column_profiles.clone();
    let mapping_source_sheet = if header_source_sheet.is_empty() {
        selected.name.clone()
    } else {
        let header = profile
            .sheets
            .iter()
            .find(|sheet| sheet.id == header_source_sheet)
            .ok_or_else(|| AppError::validation("purchase header sheet was not found"))?;
        for (column, column_profile) in header.columns.iter().zip(&header.column_profiles) {
            let normalized = migration_file_service::normalize_profile_header(column);
            if mapping_columns.iter().all(|existing| {
                migration_file_service::normalize_profile_header(existing) != normalized
            }) {
                mapping_columns.push(column.clone());
                mapping_profiles.push(column_profile.clone());
            }
        }
        format!("{} + {}", selected.name, header.name)
    };
    let mapping = migration_service::resolved_mapping(
        db,
        tenant,
        branch,
        request.entity,
        source_provider,
        &mapping_columns,
        &mapping_profiles,
        selected.row_count,
        Some(request.source_file_id.trim()),
        &mapping_source_sheet,
        Some(&source_hash),
        mapping_id,
        request.mapping,
    )
    .await?;
    let mapping_version = if let Some(id) = mapping_id {
        migration_repository::get_mapping(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to load import mapping version"))?
            .map_or(0, |profile| profile.mapping_version)
    } else {
        0
    };
    let posting_contract =
        posting_contract_fields.map(|(posting_mode, cutover_id, cutover_date)| {
            ThreeLayerPostingContract {
                contract_version: THREE_LAYER_POSTING_CONTRACT_VERSION.to_string(),
                tenant_id: tenant.to_string(),
                branch_id: branch.to_string(),
                provider: source_provider,
                source_file: file_name.clone(),
                source_file_id: Some(request.source_file_id.trim().to_string()),
                source_checksum: source_hash.clone(),
                entity: request.entity,
                import_mode: request.mode,
                posting_mode,
                cutover_id,
                cutover_date,
                mapping_version,
                transformer_version: migration_adapter_service::MIGRATION_TRANSFORMER_VERSION
                    .to_string(),
                imported_at: None,
                approved_by: None,
            }
        });
    if let Some(contract) = &posting_contract {
        if !migration_repository::ensure_cutover_contract(
            db,
            tenant,
            branch,
            &contract.cutover_id,
            contract.cutover_date,
            THREE_LAYER_POSTING_CONTRACT_VERSION,
            actor,
        )
        .await
        .map_err(|_| AppError::internal("failed to register migration cutover contract"))?
        {
            return Err(AppError::conflict(
                "cutover ID already exists with a different date",
            ));
        }
        if request.mode == MigrationMode::Commit
            && contract.posting_mode == PurchaseBillPostingMode::HistoryOnly
            && migration_repository::get_cutover(db, tenant, branch, Some(&contract.cutover_id))
                .await
                .map_err(|_| AppError::internal("failed to load migration cutover"))?
                .is_none_or(|cutover| cutover.status != MigrationCutoverStatus::HistoryImporting)
        {
            return Err(AppError::conflict(
                "historical purchase commit requires cutover status history_importing",
            ));
        }
        if request.mode == MigrationMode::Commit
            && contract.posting_mode == PurchaseBillPostingMode::OpeningPayable
            && migration_repository::get_cutover(db, tenant, branch, Some(&contract.cutover_id))
                .await
                .map_err(|_| AppError::internal("failed to load migration cutover"))?
                .is_none_or(|cutover| cutover.status != MigrationCutoverStatus::SnapshotApplied)
        {
            return Err(AppError::conflict(
                "opening payable commit requires cutover status snapshot_applied",
            ));
        }
    }
    let mapping_json = serde_json::to_value(mapping)
        .map_err(|_| AppError::internal("failed to serialize import mapping"))?;
    let decisions_json = serde_json::to_value(request.duplicate_decisions)
        .map_err(|_| AppError::internal("failed to serialize duplicate decisions"))?;
    let result = migration_large_import_repository::create_job(
        db,
        tenant,
        branch,
        request.source_file_id.trim(),
        request.entity,
        request.mode,
        &file_name,
        &source_hash,
        source_provider,
        &source_sheet,
        &header_source_sheet,
        request.chunk_size,
        request.allow_partial_import,
        mapping_id,
        &mapping_json,
        &decisions_json,
        migration_adapter_service::MIGRATION_TRANSFORMER_VERSION,
        posting_contract.as_ref(),
        actor,
    )
    .await;
    match result {
        Ok(mut job) => {
            if owner != actor {
                migration_repository::assign_job_owner(db, tenant, branch, &job.id, &owner, actor)
                    .await
                    .map_err(|_| AppError::internal("failed to assign import owner"))?;
                job.owner_user_id = owner;
            }
            Ok(job)
        }
        Err(error) if migration_repository::is_active_source_duplicate_error(&error) => Err(
            AppError::conflict("this source file already has an active commit import job"),
        ),
        Err(_) => Err(AppError::internal("failed to create large import job")),
    }
}

fn financial_all_or_nothing(entity: crate::models::migration::MigrationEntity) -> bool {
    use crate::models::migration::MigrationEntity;
    matches!(
        entity,
        MigrationEntity::Sales
            | MigrationEntity::Invoices
            | MigrationEntity::Payments
            | MigrationEntity::Refunds
            | MigrationEntity::GiftCards
            | MigrationEntity::Payroll
            | MigrationEntity::Commissions
            | MigrationEntity::Expenses
            | MigrationEntity::PurchaseBills
            | MigrationEntity::Inventory
    )
}

pub async fn selective_retry(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: MigrationSelectiveRetryRequest,
) -> Result<Value, AppError> {
    if request.rows.is_empty() || request.rows.len() > 500 {
        return Err(AppError::validation(
            "select between 1 and 500 quarantine rows",
        ));
    }
    let source_sheet = request.rows[0].source_sheet.trim();
    if source_sheet.is_empty()
        || request
            .rows
            .iter()
            .any(|row| row.source_sheet.trim() != source_sheet || row.source_row_number <= 1)
    {
        return Err(AppError::validation(
            "one retry batch must use valid rows from the same source sheet",
        ));
    }
    let mut selected = HashSet::new();
    for row in &request.rows {
        if !selected.insert(row.source_row_number)
            || row.corrections.len() > 100
            || row.corrections.iter().any(|(key, value)| {
                key.trim().is_empty() || key.len() > 200 || value.len() > 20_000
            })
        {
            return Err(AppError::validation(
                "retry corrections are invalid or duplicated",
            ));
        }
    }
    let source_rows = request
        .rows
        .iter()
        .map(|row| row.source_row_number)
        .collect::<Vec<_>>();
    let context = migration_large_import_repository::selective_retry_context(
        db,
        tenant,
        branch,
        id,
        source_sheet,
        &source_rows,
    )
    .await
    .map_err(|_| AppError::internal("failed to load quarantined migration rows"))?
    .ok_or_else(|| AppError::not_found("import job not found"))?;
    if context.get("ownerUserId").and_then(Value::as_str) != Some(actor) {
        return Err(AppError::forbidden(
            "only the assigned migration owner can retry rows",
        ));
    }
    let rows = context
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if rows.len() != request.rows.len()
        || rows
            .iter()
            .any(|row| row.get("retryCount").and_then(Value::as_i64).unwrap_or(10) >= 10)
    {
        return Err(AppError::conflict(
            "one or more rows are not retry eligible",
        ));
    }
    let entity = crate::models::migration::MigrationEntity::try_from(
        context.get("entity").and_then(Value::as_str).unwrap_or(""),
    )
    .map_err(AppError::validation)?;
    let mode = MigrationMode::try_from(context.get("mode").and_then(Value::as_str).unwrap_or(""))
        .map_err(AppError::validation)?;
    let allow_partial = context
        .get("allowPartialImport")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let pending_rows = context
        .get("pendingRows")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if mode == MigrationMode::Commit && !request.approve_partial {
        return Err(AppError::validation(
            "explicit retry approval is required for commit jobs",
        ));
    }
    let strict = financial_all_or_nothing(entity) || !allow_partial;
    if strict && pending_rows != rows.len() as i64 {
        return Err(AppError::conflict(
            "all remaining quarantined rows must be corrected together for this job",
        ));
    }
    let mut headers = std::collections::BTreeSet::new();
    let corrections = request
        .rows
        .iter()
        .map(|row| (row.source_row_number, &row.corrections))
        .collect::<HashMap<_, _>>();
    let mut source_values = Vec::new();
    for row in &rows {
        let row_number = row
            .get("sourceRowNumber")
            .and_then(Value::as_i64)
            .unwrap_or(0) as i32;
        let mut values = row
            .get("sourceValues")
            .and_then(Value::as_object)
            .cloned()
            .ok_or_else(|| AppError::conflict("original source evidence is unavailable"))?;
        for (key, value) in corrections
            .get(&row_number)
            .into_iter()
            .flat_map(|items| items.iter())
        {
            if !values.contains_key(key) {
                return Err(AppError::validation(format!(
                    "unknown source column: {key}"
                )));
            }
            values.insert(key.clone(), Value::String(value.clone()));
        }
        headers.extend(values.keys().cloned());
        source_values.push((row_number, values));
    }
    headers.remove("__sourceRowNumber");
    let headers = headers.into_iter().collect::<Vec<_>>();
    let mut table = vec![headers
        .iter()
        .cloned()
        .chain(["__sourceRowNumber".into()])
        .collect()];
    for (row_number, values) in source_values {
        let mut row = headers
            .iter()
            .map(|header| {
                values
                    .get(header)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            })
            .collect::<Vec<_>>();
        row.push(row_number.to_string());
        table.push(row);
    }
    let mapping = serde_json::from_value::<BTreeMap<String, String>>(
        context.get("mapping").cloned().unwrap_or_else(|| json!({})),
    )
    .map_err(|_| AppError::internal("saved import mapping is invalid"))?;
    let decisions = serde_json::from_value::<BTreeMap<String, MigrationDuplicateDecision>>(
        context
            .get("duplicateDecisions")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .map_err(|_| AppError::internal("saved duplicate decisions are invalid"))?;
    let provider = MigrationProvider::try_from(
        context
            .get("sourceProvider")
            .and_then(Value::as_str)
            .unwrap_or("auto"),
    )
    .map_err(AppError::validation)?;
    let version = context
        .get("transformationVersion")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(migration_adapter_service::MIGRATION_TRANSFORMER_VERSION);
    let prepared = migration_adapter_service::prepare_table_with_version(
        db, tenant, branch, entity, provider, &table, 0, &mapping, &decisions, version,
    )
    .await?;
    let all_ready = prepared.report.summary.ready_rows == rows.len() as i32;
    let mut ready_payloads = if strict && !all_ready {
        Vec::new()
    } else {
        prepared.rows.as_array().cloned().unwrap_or_default()
    };
    let ready_lines = ready_payloads
        .iter()
        .filter_map(|row| row.get("source_row_number").and_then(Value::as_i64))
        .collect::<HashSet<_>>();
    let retry_results = prepared
        .row_results
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut row| {
            let line = row
                .get("source_row_number")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if let Some(object) = row.as_object_mut() {
                object.insert("source_sheet".into(), Value::String(source_sheet.into()));
                object.insert("ready".into(), Value::Bool(ready_lines.contains(&line)));
                if strict
                    && !all_ready
                    && object.get("status").and_then(Value::as_str) != Some("error")
                {
                    object.insert("status".into(), Value::String("error".into()));
                    object.insert(
                        "error_code".into(),
                        Value::String("BATCH_RETRY_INCOMPLETE".into()),
                    );
                    object.insert(
                        "message".into(),
                        Value::String("all rows must validate before this batch can retry".into()),
                    );
                }
            }
            row
        })
        .collect::<Vec<_>>();
    let staged = ready_payloads
        .drain(..)
        .map(|payload| {
            let source_row_number = payload.get("source_row_number").cloned().unwrap_or(Value::Null);
            let source_external_id = payload.get("source_external_id").cloned().unwrap_or(Value::Null);
            json!({"source_row_number":source_row_number,"source_external_id":source_external_id,"payload":payload})
        })
        .collect::<Vec<_>>();
    let staged_payloads = Value::Array(
        staged
            .iter()
            .filter_map(|row| row.get("payload").cloned())
            .collect(),
    );
    migration_large_import_repository::stage_selective_retry(
        db,
        tenant,
        branch,
        id,
        source_sheet,
        actor,
        request.approve_partial,
        &Value::Array(retry_results),
        &Value::Array(staged),
        &checksum(&staged_payloads)?,
    )
    .await
    .map_err(|_| AppError::internal("failed to persist selective retry"))?
    .ok_or_else(|| AppError::conflict("import job is not eligible for selective retry"))
}

pub async fn process_due(db: &PgPool) -> Result<usize, AppError> {
    let worker_id = format!("migration-worker:{}", std::process::id());
    let mut processed = 0;
    if let Some(job) = migration_large_import_repository::claim_staging_job(
        db,
        &worker_id,
        migration_adapter_service::MIGRATION_TRANSFORMER_VERSION,
    )
    .await
    .map_err(|_| AppError::internal("failed to claim source staging job"))?
    {
        if let Err(error) = stage_source(db, &job, &worker_id).await {
            tracing::warn!(job_id = %job.id, error = ?error, "migration source staging failed");
            let _ =
                migration_large_import_repository::fail_staging(db, &job, "source staging failed")
                    .await;
        }
    }
    for _ in 0..5 {
        let Some(chunk) = migration_large_import_repository::claim_chunk(db, &worker_id)
            .await
            .map_err(|_| AppError::internal("failed to claim migration chunk"))?
        else {
            break;
        };
        let actual_checksum = checksum(&chunk.rows)?;
        if actual_checksum != chunk.checksum {
            migration_large_import_repository::fail_chunk(
                db,
                &chunk,
                "staging chunk checksum mismatch",
            )
            .await
            .map_err(|_| AppError::internal("failed to quarantine migration chunk"))?;
            continue;
        }
        if let Err(error) = migration_repository::apply_batch_numbered(
            db,
            &chunk.job,
            &chunk.rows,
            chunk.chunk_number,
            chunk.start,
            chunk.end,
            Some(&chunk.chunk_id),
        )
        .await
        {
            tracing::warn!(job_id = %chunk.job.id, chunk_id = %chunk.chunk_id, error = ?error, "large import chunk failed");
            let safe_error = migration_repository::migration_safety_error_code(&error)
                .unwrap_or("chunk import failed");
            migration_large_import_repository::fail_chunk(db, &chunk, safe_error)
                .await
                .map_err(|_| AppError::internal("failed to record chunk failure"))?;
            continue;
        }
        processed += chunk.rows.as_array().map_or(0, Vec::len);
    }
    Ok(processed)
}

async fn stage_source(
    db: &PgPool,
    job: &migration_large_import_repository::LargeStagingJob,
    worker_id: &str,
) -> Result<(), AppError> {
    let (_, _, _, sources) = migration_file_service::worker_sources(
        db,
        &job.tenant_id,
        &job.branch_id,
        &job.source_file_id,
    )
    .await?;
    let mapping = serde_json::from_value::<BTreeMap<String, String>>(job.mapping_json.clone())
        .map_err(|_| AppError::internal("saved import mapping is invalid"))?;
    let decisions = serde_json::from_value::<BTreeMap<String, MigrationDuplicateDecision>>(
        job.duplicate_decisions_json.clone(),
    )
    .map_err(|_| AppError::internal("saved duplicate decisions are invalid"))?;
    let (sender, mut receiver) = mpsc::channel::<Result<RawChunk, String>>(1);
    let chunk_size = job.chunk_size as usize;
    let selected_sheet = job.source_sheet.clone();
    let header_sheet = job.header_source_sheet.clone();
    let entity = job.entity;
    let producer = tokio::task::spawn_blocking(move || {
        produce_chunks(
            sources,
            chunk_size,
            &selected_sheet,
            &header_sheet,
            entity,
            sender,
        )
    });
    let mut chunk_number = 0_i32;
    let mut financial_state = HashMap::new();
    while let Some(item) = receiver.recv().await {
        let raw = item.map_err(AppError::validation)?;
        if raw
            .table
            .iter()
            .skip(1)
            .all(|row| row.iter().all(|cell| cell.trim().is_empty()))
        {
            continue;
        }
        let mut prepared = migration_adapter_service::prepare_table_with_version_and_state(
            db,
            &job.tenant_id,
            &job.branch_id,
            job.entity,
            job.source_provider,
            &raw.table,
            raw.source_row_offset,
            &mapping,
            &decisions,
            &job.transformation_version,
            Some(&job.id),
            &mut financial_state,
        )
        .await?;
        if let Some(contract) = &job.posting_contract {
            migration_service::enforce_three_layer_rows(contract, &mut prepared.rows)?;
        }
        chunk_number += 1;
        let source_keys_by_line = prepared
            .rows
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| {
                let line = row.get("source_row_number")?.as_i64()?;
                Some((line, source_identity_key(job.entity, row)))
            })
            .collect::<HashMap<_, _>>();
        let external_ids = if job.entity == crate::models::migration::MigrationEntity::PurchaseBills
        {
            Vec::new()
        } else {
            prepared
                .row_results
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|row| row.get("source_external_id").and_then(Value::as_str))
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
        };
        let source_keys = source_keys_by_line
            .values()
            .filter(|value| !value.is_empty())
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let (existing_external_ids, existing_source_keys) =
            migration_large_import_repository::existing_source_identities(
                db,
                &job.tenant_id,
                &job.branch_id,
                &job.id,
                &raw.source_sheet,
                &external_ids,
                &source_keys,
            )
            .await
            .map_err(|_| AppError::internal("failed to validate cross-chunk identities"))?;
        let mut seen_external_ids = existing_external_ids.into_iter().collect::<HashSet<_>>();
        let mut seen_source_keys = existing_source_keys.into_iter().collect::<HashSet<_>>();
        let mut cross_chunk_duplicates = HashSet::new();
        let mut cross_chunk_external_duplicates = HashSet::new();
        for result in prepared.row_results.as_array().into_iter().flatten() {
            let external_id = result
                .get("source_external_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            if job.entity != crate::models::migration::MigrationEntity::PurchaseBills
                && !external_id.is_empty()
                && !seen_external_ids.insert(external_id)
            {
                if let Some(line) = result.get("source_row_number").and_then(Value::as_i64) {
                    cross_chunk_duplicates.insert(line);
                    cross_chunk_external_duplicates.insert(line);
                }
            }
        }
        if let Some(rows) = prepared.rows.as_array_mut() {
            rows.retain_mut(|row| {
                let key = source_identity_key(job.entity, row);
                let line = row
                    .get("source_row_number")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let duplicate_external = cross_chunk_external_duplicates.contains(&line);
                let duplicate =
                    duplicate_external || (!key.is_empty() && !seen_source_keys.insert(key));
                if duplicate {
                    if let Some(payload) = row.as_object_mut() {
                        migration_adapter_service::rollback_financial_projection(
                            job.entity,
                            payload,
                            &mut financial_state,
                        );
                    }
                    if line > 0 {
                        cross_chunk_duplicates.insert(line);
                        if duplicate_external {
                            cross_chunk_external_duplicates.insert(line);
                        }
                    }
                }
                !duplicate
            });
        }
        let ready_lines = prepared
            .rows
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| row.get("source_row_number").and_then(Value::as_i64))
            .collect::<HashSet<_>>();
        let mut staging_rows = prepared.row_results.as_array().cloned().unwrap_or_default();
        for row in &mut staging_rows {
            let line = row
                .get("source_row_number")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if let Some(object) = row.as_object_mut() {
                object.insert(
                    "source_key".into(),
                    json!(source_keys_by_line.get(&line).cloned().unwrap_or_default()),
                );
                let duplicate = cross_chunk_duplicates.contains(&line);
                object.insert(
                    "ready".into(),
                    Value::Bool(ready_lines.contains(&line) && !duplicate),
                );
                if duplicate {
                    object.insert("status".into(), Value::String("error".into()));
                    object.insert(
                        "error_code".into(),
                        Value::String(
                            if cross_chunk_external_duplicates.contains(&line) {
                                "DUPLICATE_SOURCE_EXTERNAL_ID"
                            } else {
                                "DUPLICATE_SOURCE_KEY"
                            }
                            .into(),
                        ),
                    );
                    object.insert(
                        "message".into(),
                        Value::String(
                            if cross_chunk_external_duplicates.contains(&line) {
                                "oldExternalId appears more than once in the source"
                            } else {
                                "duplicate source key across chunks"
                            }
                            .into(),
                        ),
                    );
                }
            }
        }
        let ready_rows = prepared.rows.as_array().map_or(0, |rows| rows.len() as i32);
        let error_rows = staging_rows
            .iter()
            .filter(|row| row.get("status").and_then(Value::as_str) == Some("error"))
            .count() as i32;
        let summary = &prepared.report.summary;
        let duplicate_rows = staging_rows
            .iter()
            .filter(|row| {
                let line = row
                    .get("source_row_number")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                cross_chunk_duplicates.contains(&line)
                    || row
                        .get("duplicate_target_id")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
            })
            .count() as i32;
        let source_row_start = raw.source_row_offset + 2;
        let source_row_end = raw.source_row_offset + raw.table.len() as i32;
        let projection_state = serde_json::to_value(&financial_state)
            .map_err(|_| AppError::internal("failed to serialize financial projection"))?;
        if !migration_large_import_repository::stage_chunk(
            db,
            job,
            worker_id,
            chunk_number,
            &raw.source_sheet,
            source_row_start,
            source_row_end,
            &checksum(&prepared.rows)?,
            &Value::Array(staging_rows),
            &projection_state,
            ready_rows,
            error_rows,
            summary.warning_rows,
            duplicate_rows,
        )
        .await
        .map_err(|_| AppError::internal("failed to persist migration staging chunk"))?
        {
            return Ok(());
        }
        financial_state.clear();
    }
    producer
        .await
        .map_err(|_| AppError::internal("migration source parser stopped unexpectedly"))?;
    migration_large_import_repository::finish_staging(db, job)
        .await
        .map_err(|_| AppError::internal("failed to finalize migration staging"))
}

fn source_identity_key(entity: crate::models::migration::MigrationEntity, row: &Value) -> String {
    use crate::models::migration::MigrationEntity;
    let value = |field: &str| row.get(field).and_then(Value::as_str).unwrap_or("");
    match entity {
        MigrationEntity::Clients => value("normalized_phone").to_string(),
        MigrationEntity::Staff => value("employee_code").to_ascii_lowercase(),
        MigrationEntity::Services | MigrationEntity::Packages => value("name").to_ascii_lowercase(),
        MigrationEntity::Products => value("sku").to_ascii_lowercase(),
        MigrationEntity::Suppliers | MigrationEntity::Memberships | MigrationEntity::GiftCards => {
            value("code").to_ascii_lowercase()
        }
        MigrationEntity::Inventory => value("inventory_item_id").to_string(),
        MigrationEntity::Sales | MigrationEntity::Invoices => value("invoice_number")
            .is_empty()
            .then(|| value("source_external_id"))
            .unwrap_or_else(|| value("invoice_number"))
            .to_ascii_lowercase(),
        MigrationEntity::PurchaseBills => format!(
            "{}:{}:{}",
            value("source_external_id"),
            if value("source_line_id").is_empty() {
                row.get("source_row_number")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .to_string()
            } else {
                value("source_line_id").to_string()
            },
            value("batch_number")
        )
        .to_ascii_lowercase(),
        MigrationEntity::Payroll => {
            format!("{}:{}", value("period_start"), value("staff_id"))
        }
        MigrationEntity::Commissions => {
            format!("{}:{}", value("sale_line_id"), value("staff_id"))
        }
        MigrationEntity::ClientMemberships
        | MigrationEntity::Appointments
        | MigrationEntity::Payments
        | MigrationEntity::Expenses
        | MigrationEntity::Refunds
        | MigrationEntity::Loyalty
        | MigrationEntity::ClientNotes
        | MigrationEntity::Files
        | MigrationEntity::StockMovements
        | MigrationEntity::OpeningPayables => value("source_external_id").to_ascii_lowercase(),
    }
}

fn produce_chunks(
    sources: Vec<migration_file_service::WorkerSource>,
    chunk_size: usize,
    selected_sheet: &str,
    header_sheet: &str,
    entity: crate::models::migration::MigrationEntity,
    sender: mpsc::Sender<Result<RawChunk, String>>,
) {
    let header_join = if entity == crate::models::migration::MigrationEntity::PurchaseBills
        && !header_sheet.is_empty()
    {
        match load_purchase_header_join(&sources, header_sheet) {
            Ok(join) => Some(join),
            Err(error) => {
                let _ = sender.blocking_send(Err(error));
                return;
            }
        }
    } else {
        None
    };
    for source in sources {
        let result = match source.format.as_str() {
            "csv" if selected_sheet == source.name => produce_csv(
                &source.path,
                &source.name,
                chunk_size,
                header_join.as_ref(),
                &sender,
            ),
            "xlsx" => produce_xlsx(
                &source.path,
                &source.name,
                chunk_size,
                selected_sheet,
                header_join.as_ref(),
                &sender,
            ),
            "csv" => Ok(()),
            _ => Ok(()),
        };
        if let Err(error) = result {
            let _ = sender.blocking_send(Err(error));
            return;
        }
    }
}

struct PurchaseHeaderJoin {
    headers: Vec<String>,
    rows: HashMap<String, Vec<String>>,
    single: Option<Vec<String>>,
}

fn load_purchase_header_join(
    sources: &[migration_file_service::WorkerSource],
    selected: &str,
) -> Result<PurchaseHeaderJoin, String> {
    for source in sources {
        let table = match source.format.as_str() {
            "csv" if source.name == selected => Some(read_csv_table(&source.path)?),
            "xlsx" => {
                let Some(sheet) = selected.strip_prefix(&format!("{}:", source.name)) else {
                    continue;
                };
                let mut workbook = open_workbook_auto(&source.path)
                    .map_err(|_| "purchase header workbook could not be opened".to_string())?;
                let range = workbook
                    .worksheet_range(sheet)
                    .map_err(|_| "purchase header sheet is corrupt".to_string())?;
                Some(
                    range
                        .rows()
                        .map(|row| row.iter().map(ToString::to_string).collect())
                        .collect(),
                )
            }
            _ => None,
        };
        if let Some(table) = table {
            return build_purchase_header_join(table);
        }
    }
    Err("purchase header sheet was not found".into())
}

fn read_csv_table(path: &PathBuf) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(false)
        .from_path(path)
        .map_err(|_| "purchase header CSV could not be opened".to_string())?;
    let mut table = vec![reader
        .headers()
        .map_err(|_| "purchase header CSV is invalid".to_string())?
        .iter()
        .map(str::to_string)
        .collect()];
    for record in reader.records().take(1_000_001) {
        table.push(
            record
                .map_err(|_| "purchase header CSV contains a corrupt row".to_string())?
                .iter()
                .map(str::to_string)
                .collect(),
        );
    }
    if table.len() > 1_000_001 {
        return Err("purchase header sheet exceeds one million bills".into());
    }
    Ok(table)
}

fn build_purchase_header_join(table: Vec<Vec<String>>) -> Result<PurchaseHeaderJoin, String> {
    let mut rows = table.into_iter();
    let headers = rows
        .next()
        .filter(|header| !header.is_empty())
        .ok_or_else(|| "purchase header sheet is empty".to_string())?;
    let key_index = purchase_join_key_index(&headers);
    let data = rows
        .filter(|row| row.iter().any(|value| !value.trim().is_empty()))
        .collect::<Vec<_>>();
    if data.is_empty() {
        return Err("purchase header sheet has no bill rows".into());
    }
    if data.len() > 1 && key_index.is_none() {
        return Err("purchase header sheet requires provider bill ID or invoice number".into());
    }
    let mut keyed = HashMap::new();
    if let Some(index) = key_index {
        for row in &data {
            let key = row
                .get(index)
                .map(|value| value.trim().to_ascii_lowercase())
                .unwrap_or_default();
            if key.is_empty() || keyed.insert(key, row.clone()).is_some() {
                return Err(
                    "purchase header sheet contains a missing or duplicate bill key".into(),
                );
            }
        }
    }
    Ok(PurchaseHeaderJoin {
        headers,
        single: (data.len() == 1).then(|| data[0].clone()),
        rows: keyed,
    })
}

fn purchase_join_key_index(headers: &[String]) -> Option<usize> {
    [
        "providerbillid",
        "externalbillid",
        "purchasebillid",
        "oldexternalid",
        "invoiceid",
        "invoicenumber",
        "invoiceno",
        "billno",
    ]
    .iter()
    .find_map(|alias| {
        headers
            .iter()
            .position(|header| normalized_header(header) == *alias)
    })
}

fn normalized_header(value: &str) -> String {
    value
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn join_purchase_headers(
    table: &mut [Vec<String>],
    join: Option<&PurchaseHeaderJoin>,
) -> Result<(), String> {
    let Some(join) = join else { return Ok(()) };
    let Some(line_headers) = table.first().cloned() else {
        return Ok(());
    };
    let key_index = purchase_join_key_index(&line_headers);
    let existing = line_headers
        .iter()
        .map(|header| normalized_header(header))
        .collect::<HashSet<_>>();
    let append = join
        .headers
        .iter()
        .enumerate()
        .filter(|(_, header)| !existing.contains(&normalized_header(header)))
        .map(|(index, header)| (index, header.clone()))
        .collect::<Vec<_>>();
    table[0].extend(append.iter().map(|(_, header)| header.clone()));
    for row in table.iter_mut().skip(1) {
        let header = key_index
            .and_then(|index| row.get(index))
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .and_then(|key| join.rows.get(&key))
            .or(join.single.as_ref());
        row.extend(append.iter().map(|(index, _)| {
            header
                .and_then(|values| values.get(*index))
                .cloned()
                .unwrap_or_default()
        }));
    }
    Ok(())
}

fn produce_csv(
    path: &PathBuf,
    name: &str,
    chunk_size: usize,
    header_join: Option<&PurchaseHeaderJoin>,
    sender: &mpsc::Sender<Result<RawChunk, String>>,
) -> Result<(), String> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(false)
        .from_path(path)
        .map_err(|_| "CSV source could not be opened".to_string())?;
    let header = reader
        .headers()
        .map_err(|_| "CSV header is invalid".to_string())?
        .iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if header.is_empty() {
        return Err("CSV header is empty".into());
    }
    let mut offset = 0_i32;
    let mut rows = Vec::with_capacity(chunk_size + 1);
    rows.push(header.clone());
    for record in reader.records() {
        let record = record.map_err(|_| "CSV contains an invalid record".to_string())?;
        rows.push(record.iter().map(str::to_string).collect());
        if rows.len() == chunk_size + 1 {
            let count = (rows.len() - 1) as i32;
            let mut table = std::mem::replace(&mut rows, vec![header.clone()]);
            join_purchase_headers(&mut table, header_join)?;
            sender
                .blocking_send(Ok(RawChunk {
                    source_sheet: name.to_string(),
                    source_row_offset: offset,
                    table,
                }))
                .map_err(|_| "staging worker stopped".to_string())?;
            offset += count;
        }
    }
    if rows.len() > 1 {
        join_purchase_headers(&mut rows, header_join)?;
        sender
            .blocking_send(Ok(RawChunk {
                source_sheet: name.to_string(),
                source_row_offset: offset,
                table: rows,
            }))
            .map_err(|_| "staging worker stopped".to_string())?;
    }
    Ok(())
}

fn produce_xlsx(
    path: &PathBuf,
    name: &str,
    chunk_size: usize,
    selected_sheet: &str,
    header_join: Option<&PurchaseHeaderJoin>,
    sender: &mpsc::Sender<Result<RawChunk, String>>,
) -> Result<(), String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|_| "XLSX source could not be opened".to_string())?;
    for (sheet_name, range) in workbook.worksheets() {
        if format!("{name}:{sheet_name}") != selected_sheet {
            continue;
        }
        let mut rows = range.rows();
        let Some(header) = rows
            .next()
            .map(|row| row.iter().map(ToString::to_string).collect::<Vec<_>>())
        else {
            continue;
        };
        if header.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        let source_sheet = format!("{name}:{sheet_name}");
        let mut data = Vec::with_capacity(chunk_size);
        let mut source_row_offset = 0_i32;
        for row in rows {
            data.push(row.iter().map(ToString::to_string).collect::<Vec<_>>());
            if data.len() < chunk_size {
                continue;
            }
            let mut table = Vec::with_capacity(data.len() + 1);
            table.push(header.clone());
            table.append(&mut data);
            join_purchase_headers(&mut table, header_join)?;
            sender
                .blocking_send(Ok(RawChunk {
                    source_sheet: source_sheet.clone(),
                    source_row_offset,
                    table,
                }))
                .map_err(|_| "staging worker stopped".to_string())?;
            source_row_offset += chunk_size as i32;
        }
        if !data.is_empty() {
            let mut table = Vec::with_capacity(data.len() + 1);
            table.push(header);
            table.append(&mut data);
            join_purchase_headers(&mut table, header_join)?;
            sender
                .blocking_send(Ok(RawChunk {
                    source_sheet,
                    source_row_offset,
                    table,
                }))
                .map_err(|_| "staging worker stopped".to_string())?;
        }
    }
    Ok(())
}

fn checksum(rows: &Value) -> Result<String, AppError> {
    let bytes = serde_json::to_vec(rows)
        .map_err(|_| AppError::internal("failed to checksum migration chunk"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub async fn pause(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    control(db, tenant, branch, id, actor, "pause").await
}
pub async fn resume(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    control(db, tenant, branch, id, actor, "resume").await
}
pub async fn retry_failed(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    control(db, tenant, branch, id, actor, "retry").await
}
pub async fn cancel(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    control(db, tenant, branch, id, actor, "cancel").await
}
async fn control(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    action: &str,
) -> Result<(), AppError> {
    if !migration_large_import_repository::control_job(db, tenant, branch, id, actor, action)
        .await
        .map_err(|_| AppError::internal("failed to update large import job"))?
    {
        return Err(AppError::conflict(
            "import job is not in a compatible state",
        ));
    }
    if action == "cancel" {
        sqlx::query(
            "UPDATE historical_purchase_archive_items item
             SET status='cancelled',retry_eligible=FALSE,worker_id='',
                 lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
             FROM historical_purchase_archive_batches batch
             WHERE batch.job_id=item.job_id AND item.job_id=$3
               AND item.tenant_id=$1 AND item.branch_id=$2
               AND item.status NOT IN ('archived','duplicate','quarantined','rejected','cancelled')",
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .execute(db)
        .await
        .map_err(|_| AppError::internal("failed to cancel historical archive documents"))?;
    }
    Ok(())
}
pub async fn list_chunks(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Vec<MigrationImportChunk>, AppError> {
    migration_large_import_repository::list_chunks(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to list migration chunks"))
}
pub async fn is_large_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<bool, AppError> {
    migration_large_import_repository::is_large_job(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load import job type"))
}

#[cfg(test)]
mod tests {
    use super::{build_purchase_header_join, checksum, join_purchase_headers, source_identity_key};
    use crate::models::migration::MigrationEntity;
    use serde_json::json;

    #[test]
    fn chunk_checksum_is_stable_and_sensitive() {
        assert_eq!(
            checksum(&json!([{"a":1}])).unwrap(),
            checksum(&json!([{"a":1}])).unwrap()
        );
        assert_ne!(
            checksum(&json!([{"a":1}])).unwrap(),
            checksum(&json!([{"a":2}])).unwrap()
        );
    }

    #[test]
    fn source_identity_keys_are_normalized_per_entity() {
        assert_eq!(
            source_identity_key(MigrationEntity::Products, &json!({"sku":"HAIR-001"})),
            "hair-001"
        );
        assert_eq!(
            source_identity_key(
                MigrationEntity::Invoices,
                &json!({"invoice_number":"", "source_external_id":"ZEN-10"})
            ),
            "zen-10"
        );
        assert_ne!(
            source_identity_key(
                MigrationEntity::PurchaseBills,
                &json!({"source_external_id":"BILL-1","source_line_id":"LINE-1","batch_number":"A","source_row_number":2})
            ),
            source_identity_key(
                MigrationEntity::PurchaseBills,
                &json!({"source_external_id":"BILL-1","source_line_id":"LINE-1","batch_number":"B","source_row_number":3})
            )
        );
    }

    #[test]
    fn purchase_header_sheet_joins_each_bill_without_collapsing_batches() {
        let join = build_purchase_header_join(vec![
            vec!["Invoice Number".into(), "Supplier GSTIN".into()],
            vec!["INV-1".into(), "27ABCDE1234F1Z5".into()],
        ])
        .unwrap();
        let mut lines = vec![
            vec!["Invoice Number".into(), "Product".into(), "Batch".into()],
            vec!["INV-1".into(), "Color 4".into(), "A".into()],
            vec!["INV-1".into(), "Color 4".into(), "B".into()],
        ];

        join_purchase_headers(&mut lines, Some(&join)).unwrap();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].last().map(String::as_str), Some("Supplier GSTIN"));
        assert_eq!(lines[1].last().map(String::as_str), Some("27ABCDE1234F1Z5"));
        assert_eq!(lines[2].last().map(String::as_str), Some("27ABCDE1234F1Z5"));
    }
}
