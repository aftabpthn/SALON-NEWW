use crate::{
    models::{
        common::AppError,
        migration::{
            CreateLargeImportJobRequest, ImportJob, MigrationDuplicateDecision,
            MigrationImportChunk, MigrationMode,
        },
    },
    repositories::{migration_large_import_repository, migration_repository},
    services::{migration_adapter_service, migration_file_service, migration_service},
};
use calamine::{open_workbook_auto, Reader};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{
    collections::{BTreeMap, HashSet},
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
    if !(100..=10_000).contains(&request.chunk_size) {
        return Err(AppError::validation(
            "chunkSize must be between 100 and 10000",
        ));
    }
    let (file_name, source_hash, _) =
        migration_file_service::worker_sources(db, tenant, branch, request.source_file_id.trim())
            .await?;
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
    let mapping = migration_service::effective_mapping(
        db,
        tenant,
        branch,
        request.entity,
        mapping_id,
        request.mapping,
    )
    .await?;
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
        request.chunk_size,
        request.allow_partial_import,
        mapping_id,
        &mapping_json,
        &decisions_json,
        actor,
    )
    .await;
    match result {
        Ok(job) => Ok(job),
        Err(error) if migration_repository::is_active_source_duplicate_error(&error) => Err(
            AppError::conflict("this source file already has an active commit import job"),
        ),
        Err(_) => Err(AppError::internal("failed to create large import job")),
    }
}

pub async fn process_due(db: &PgPool) -> Result<usize, AppError> {
    let worker_id = format!("migration-worker:{}", std::process::id());
    let mut processed = 0;
    if let Some(job) = migration_large_import_repository::claim_staging_job(db, &worker_id)
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
        )
        .await
        {
            tracing::warn!(job_id = %chunk.job.id, chunk_id = %chunk.chunk_id, error = ?error, "large import chunk failed");
            migration_large_import_repository::fail_chunk(db, &chunk, "chunk import failed")
                .await
                .map_err(|_| AppError::internal("failed to record chunk failure"))?;
            continue;
        }
        migration_large_import_repository::complete_chunk(db, &chunk)
            .await
            .map_err(|_| AppError::internal("failed to complete migration chunk"))?;
        processed += chunk.rows.as_array().map_or(0, Vec::len);
    }
    Ok(processed)
}

async fn stage_source(
    db: &PgPool,
    job: &migration_large_import_repository::LargeStagingJob,
    worker_id: &str,
) -> Result<(), AppError> {
    let (_, _, sources) = migration_file_service::worker_sources(
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
    let producer = tokio::task::spawn_blocking(move || produce_chunks(sources, chunk_size, sender));
    let mut chunk_number = 0_i32;
    let mut seen_source_keys = HashSet::new();
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
        let mut prepared = migration_adapter_service::prepare_table(
            db,
            &job.tenant_id,
            &job.branch_id,
            job.entity,
            &raw.table,
            raw.source_row_offset,
            &mapping,
            &decisions,
        )
        .await?;
        chunk_number += 1;
        let mut cross_chunk_duplicates = HashSet::new();
        if let Some(rows) = prepared.rows.as_array_mut() {
            rows.retain(|row| {
                let key = match job.entity {
                    crate::models::migration::MigrationEntity::Clients => row
                        .get("normalized_phone")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    crate::models::migration::MigrationEntity::Staff => row
                        .get("employee_code")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase(),
                    crate::models::migration::MigrationEntity::Services
                    | crate::models::migration::MigrationEntity::Packages => row
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase(),
                    crate::models::migration::MigrationEntity::Products => row
                        .get("sku")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase(),
                    crate::models::migration::MigrationEntity::Suppliers => row
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase(),
                    crate::models::migration::MigrationEntity::Inventory => row
                        .get("inventory_item_id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    crate::models::migration::MigrationEntity::Memberships => row
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_ascii_lowercase(),
                };
                let duplicate = !key.is_empty() && !seen_source_keys.insert(key);
                if duplicate {
                    if let Some(line) = row.get("source_row_number").and_then(Value::as_i64) {
                        cross_chunk_duplicates.insert(line);
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
                let duplicate = cross_chunk_duplicates.contains(&line);
                object.insert(
                    "ready".into(),
                    Value::Bool(ready_lines.contains(&line) && !duplicate),
                );
                if duplicate {
                    object.insert("status".into(), Value::String("error".into()));
                    object.insert(
                        "error_code".into(),
                        Value::String("DUPLICATE_SOURCE_KEY".into()),
                    );
                    object.insert(
                        "message".into(),
                        Value::String("duplicate source key across chunks".into()),
                    );
                }
            }
        }
        let ready_rows = prepared.rows.as_array().map_or(0, |rows| rows.len() as i32);
        let total_rows = staging_rows.len() as i32;
        let blocked_rows = total_rows - ready_rows;
        let summary = &prepared.report.summary;
        let source_row_start = raw.source_row_offset + 2;
        let source_row_end = raw.source_row_offset + raw.table.len() as i32;
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
            ready_rows,
            blocked_rows,
            summary.warning_rows,
            summary.duplicate_rows,
        )
        .await
        .map_err(|_| AppError::internal("failed to persist migration staging chunk"))?
        {
            return Ok(());
        }
    }
    producer
        .await
        .map_err(|_| AppError::internal("migration source parser stopped unexpectedly"))?;
    migration_large_import_repository::finish_staging(db, job)
        .await
        .map_err(|_| AppError::internal("failed to finalize migration staging"))
}

fn produce_chunks(
    sources: Vec<migration_file_service::WorkerSource>,
    chunk_size: usize,
    sender: mpsc::Sender<Result<RawChunk, String>>,
) {
    for source in sources {
        let result = match source.format.as_str() {
            "csv" => produce_csv(&source.path, &source.name, chunk_size, &sender),
            "xlsx" => produce_xlsx(&source.path, &source.name, chunk_size, &sender),
            _ => Err("unsupported staged source format".to_string()),
        };
        if let Err(error) = result {
            let _ = sender.blocking_send(Err(error));
            return;
        }
    }
}

fn produce_csv(
    path: &PathBuf,
    name: &str,
    chunk_size: usize,
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
            sender
                .blocking_send(Ok(RawChunk {
                    source_sheet: name.to_string(),
                    source_row_offset: offset,
                    table: std::mem::replace(&mut rows, vec![header.clone()]),
                }))
                .map_err(|_| "staging worker stopped".to_string())?;
            offset += count;
        }
    }
    if rows.len() > 1 {
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
    sender: &mpsc::Sender<Result<RawChunk, String>>,
) -> Result<(), String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|_| "XLSX source could not be opened".to_string())?;
    for (sheet_name, range) in workbook.worksheets() {
        let all = range
            .rows()
            .map(|row| row.iter().map(ToString::to_string).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        let Some(header) = all.first().cloned() else {
            continue;
        };
        if header.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        let source_sheet = format!("{name}:{sheet_name}");
        for (index, data) in all[1..].chunks(chunk_size).enumerate() {
            if data.is_empty() {
                continue;
            }
            let mut table = Vec::with_capacity(data.len() + 1);
            table.push(header.clone());
            table.extend_from_slice(data);
            sender
                .blocking_send(Ok(RawChunk {
                    source_sheet: source_sheet.clone(),
                    source_row_offset: (index * chunk_size) as i32,
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
    use super::checksum;
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
}
