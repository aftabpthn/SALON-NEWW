use crate::{
    models::{
        common::AppError,
        migration::{
            AnalyzeMigrationRequest, CreateImportJobRequest, ImportJob, MigrationAnalysisReport,
            MigrationEntity, MigrationJobStatus, MigrationMapping, MigrationMode,
            MigrationRecoveryReport, MigrationTemplate, SaveMigrationMappingRequest,
        },
    },
    repositories::migration_repository,
    services::{migration_adapter_service, migration_large_import_service},
};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::BTreeMap;

pub fn templates() -> Vec<MigrationTemplate> {
    migration_adapter_service::templates()
}

pub async fn save_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: SaveMigrationMappingRequest,
) -> Result<MigrationMapping, AppError> {
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(AppError::validation("mapping name is invalid"));
    }
    migration_adapter_service::validate_mapping_contract(request.entity, &request.mapping)?;
    migration_repository::save_mapping(
        db,
        tenant,
        branch,
        request.entity,
        name,
        &serde_json::to_value(request.mapping)
            .map_err(|_| AppError::internal("failed to serialize mapping"))?,
        &serde_json::to_value(request.source_columns)
            .map_err(|_| AppError::internal("failed to serialize source columns"))?,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save import mapping"))
}

pub async fn list_mappings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<MigrationMapping>, AppError> {
    migration_repository::list_mappings(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list import mappings"))
}

pub async fn analyze(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    request: AnalyzeMigrationRequest,
) -> Result<MigrationAnalysisReport, AppError> {
    let mapping_id = request
        .mapping_id
        .as_deref()
        .filter(|id| !id.trim().is_empty());
    let mapping = effective_mapping(
        db,
        tenant,
        branch,
        request.entity,
        mapping_id,
        request.mapping,
    )
    .await?;
    Ok(migration_adapter_service::prepare(
        db,
        tenant,
        branch,
        request.entity,
        &request.csv,
        &mapping,
        &request.duplicate_decisions,
    )
    .await?
    .report)
}

pub async fn create_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: CreateImportJobRequest,
) -> Result<ImportJob, AppError> {
    if request.file_name.trim().is_empty()
        || request.file_name.len() > 255
        || request.csv.len() > 5_000_000
    {
        return Err(AppError::validation(
            "CSV file is invalid or larger than 5 MB",
        ));
    }

    let source_hash = source_hash(&request.csv);
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
    let mapping = effective_mapping(
        db,
        tenant,
        branch,
        request.entity,
        mapping_id,
        request.mapping,
    )
    .await?;
    let prepared = migration_adapter_service::prepare(
        db,
        tenant,
        branch,
        request.entity,
        &request.csv,
        &mapping,
        &request.duplicate_decisions,
    )
    .await?;
    let summary = &prepared.report.summary;
    let ready = summary.error_rows == 0 && summary.ready_rows == summary.source_rows;
    let status = if ready {
        if request.mode == MigrationMode::Commit {
            MigrationJobStatus::Queued
        } else {
            MigrationJobStatus::Validated
        }
    } else {
        MigrationJobStatus::Failed
    };
    let mapping_json = serde_json::to_value(&prepared.report.mapping)
        .map_err(|_| AppError::internal("failed to serialize import mapping"))?;
    let analysis_json = serde_json::to_value(&prepared.report)
        .map_err(|_| AppError::internal("failed to serialize dry-run report"))?;
    let result = migration_repository::create_job(
        db,
        tenant,
        branch,
        request.entity,
        request.file_name.trim(),
        request.mode,
        status,
        &source_hash,
        summary.source_rows,
        &prepared.rows,
        &prepared.errors,
        &prepared.row_results,
        mapping_id,
        &mapping_json,
        &analysis_json,
        summary.warning_rows,
        summary.duplicate_rows,
        actor,
    )
    .await;
    match result {
        Ok(job) => Ok(job),
        Err(error) if migration_repository::is_active_source_duplicate_error(&error) => Err(
            AppError::conflict("this source file already has an active commit import job"),
        ),
        Err(_) => Err(AppError::internal("failed to create import job")),
    }
}

pub async fn list_jobs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ImportJob>, AppError> {
    migration_repository::list_jobs(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list import jobs"))
}

pub async fn resume(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    if !migration_repository::resume_job(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to resume import job"))?
    {
        return Err(AppError::conflict(
            "only retryable commit jobs can be resumed",
        ));
    }
    Ok(())
}

pub async fn rollback(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<MigrationRecoveryReport, AppError> {
    migration_repository::rollback_job(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::conflict("import rollback is blocked by dependent records"))?
        .ok_or_else(|| AppError::conflict("only completed import jobs can be rolled back"))
}

pub async fn recovery_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<MigrationRecoveryReport, AppError> {
    migration_repository::recovery_report(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load import recovery report"))?
        .ok_or_else(|| AppError::not_found("import job not found"))
}

pub async fn process_due(db: &PgPool) -> Result<usize, AppError> {
    let mut processed = migration_large_import_service::process_due(db).await?;
    for _ in 0..10 {
        let Some(job) = migration_repository::claim_job(db)
            .await
            .map_err(|_| AppError::internal("failed to claim import job"))?
        else {
            break;
        };
        let rows = job.rows_json.as_array().cloned().unwrap_or_default();
        let start = job.next_row.max(0) as usize;
        let end = (start + 100).min(rows.len());
        let batch = serde_json::Value::Array(rows[start..end].to_vec());
        if let Err(error) = migration_repository::apply_batch(db, &job, &batch, start, end).await {
            tracing::warn!(job_id = %job.id, error = %error, "data import batch failed");
            let _ =
                migration_repository::fail_job_batch(db, &job, start, end, "batch import failed")
                    .await;
            continue;
        }
        processed += end - start;
    }
    Ok(processed)
}

pub(crate) async fn effective_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    mapping_id: Option<&str>,
    overrides: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, AppError> {
    let mut mapping = if let Some(id) = mapping_id.filter(|id| !id.trim().is_empty()) {
        let saved = migration_repository::get_mapping(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to load import mapping"))?
            .ok_or_else(|| AppError::not_found("import mapping not found"))?;
        if saved.entity != entity {
            return Err(AppError::validation(
                "saved mapping does not match import entity",
            ));
        }
        saved.mapping
    } else {
        BTreeMap::new()
    };
    mapping.extend(overrides);
    Ok(mapping)
}

fn source_hash(csv: &str) -> String {
    format!("{:x}", Sha256::digest(csv.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::source_hash;

    #[test]
    fn source_hash_is_stable_and_content_sensitive() {
        assert_eq!(source_hash("same"), source_hash("same"));
        assert_ne!(source_hash("same"), source_hash("different"));
        assert_eq!(source_hash("same").len(), 64);
    }
}
