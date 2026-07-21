use crate::{
    config::Settings,
    models::{
        common::AppError,
        migration::{
            AnalyzeMigrationRequest, CreateImportJobRequest, ImportJob, MigrationAnalysisReport,
            MigrationApprovalRequest, MigrationEntity, MigrationJobStatus, MigrationMapping,
            MigrationMappingSuggestionRequest, MigrationMode, MigrationRecoveryReport,
            MigrationTemplate, SaveMigrationMappingRequest,
        },
    },
    repositories::{auth_repository, migration_repository},
    services::{migration_adapter_service, migration_file_service, migration_large_import_service},
};
use chrono::Utc;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashSet};

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

    let owner = resolve_owner(db, tenant, branch, actor, request.owner_user_id.as_deref()).await?;
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
            MigrationJobStatus::Validated
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
    let impact = rollback_impact(db, tenant, branch, id).await?;
    if impact
        .pointer("/dependencies/blockingRecords")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        return Err(AppError::conflict(
            "import rollback is blocked by dependent records",
        ));
    }
    migration_repository::rollback_job(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::conflict("import rollback is blocked by dependent records"))?
        .ok_or_else(|| AppError::conflict("only completed import jobs can be rolled back"))
}

pub async fn decide_approval(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: MigrationApprovalRequest,
) -> Result<(), AppError> {
    let note = request.note.trim();
    if note.chars().count() > 500 {
        return Err(AppError::validation("approval note is too long"));
    }
    if !migration_repository::decide_approval(db, tenant, branch, id, actor, request.approved, note)
        .await
        .map_err(|_| AppError::internal("failed to record import approval"))?
    {
        return Err(AppError::conflict(
            "only the assigned owner can decide a pending import approval",
        ));
    }
    Ok(())
}

pub async fn governance_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<serde_json::Value, AppError> {
    migration_repository::governance_report(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to build import governance report"))?
        .ok_or_else(|| AppError::not_found("import job not found"))
}

pub async fn proof_pack(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<serde_json::Value, AppError> {
    migration_repository::proof_pack(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to build import proof pack"))?
        .ok_or_else(|| AppError::not_found("import job not found"))
}

pub async fn failed_rows_csv(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<String, AppError> {
    migration_repository::failed_rows_csv(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to export import errors"))?
        .ok_or_else(|| AppError::not_found("import job not found"))
}

pub async fn rollback_impact(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<serde_json::Value, AppError> {
    migration_repository::rollback_impact(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to calculate rollback impact"))?
        .ok_or_else(|| AppError::not_found("import job not found"))
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

pub async fn mapping_suggestions(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: MigrationMappingSuggestionRequest,
) -> Result<Value, AppError> {
    let source_file_id = request
        .source_file_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    if source_file_id.is_some() && !request.source_columns.is_empty() {
        return Err(AppError::validation(
            "provide sourceColumns or sourceFileId, not both",
        ));
    }
    let source_columns = if let Some(id) = source_file_id {
        migration_file_service::source_columns(db, tenant, branch, actor, id).await?
    } else {
        request.source_columns
    };
    if source_columns.is_empty() || source_columns.len() > 500 {
        return Err(AppError::validation(
            "source columns must contain 1 to 500 values",
        ));
    }
    let mut seen = HashSet::new();
    let columns = source_columns
        .into_iter()
        .map(|column| column.trim().to_string())
        .collect::<Vec<_>>();
    if columns.iter().any(|column| {
        column.is_empty()
            || column.chars().count() > 200
            || !seen.insert(column.to_ascii_lowercase())
    }) {
        return Err(AppError::validation(
            "source columns contain invalid or duplicate values",
        ));
    }
    let fallback = mapping_suggestion_result(
        request.entity,
        &columns,
        &BTreeMap::new(),
        "rust_deterministic",
        "local-mapping-policy-v1",
    )?;
    let Some(template) = templates()
        .into_iter()
        .find(|item| item.entity == request.entity)
    else {
        return Ok(fallback);
    };
    let payload = json!({
        "tenant_id":tenant,"branch_id":branch,"entity":request.entity.as_str(),"source_columns":columns,
        "targets":template.columns.into_iter().map(|column|json!({"field":column.field,"aliases":column.aliases})).collect::<Vec<_>>()
    });
    let Some(ai) =
        call_migration_ai(settings, "/api/v1/migrations/mapping-suggestions", payload).await
    else {
        return Ok(fallback);
    };
    let source = ai.get("source").and_then(Value::as_str).unwrap_or_default();
    if !matches!(source, "python_deterministic" | "openai_responses") {
        return Ok(fallback);
    }
    let Ok(provided) = serde_json::from_value::<BTreeMap<String, String>>(
        ai.get("suggestions").cloned().unwrap_or_default(),
    ) else {
        return Ok(fallback);
    };
    if provided.keys().any(|source| !columns.contains(source)) {
        return Ok(fallback);
    }
    mapping_suggestion_result(
        request.entity,
        &columns,
        &provided,
        source,
        ai.get("model")
            .and_then(Value::as_str)
            .unwrap_or("local-mapping-policy-v1"),
    )
    .or(Ok(fallback))
}

pub async fn failure_assistant(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, AppError> {
    let report = governance_report(db, tenant, branch, id).await?;
    let job = report.get("job").cloned().unwrap_or_default();
    let recommendations = report
        .get("recoveryRecommendations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let payload = json!({
        "tenant_id":tenant,"branch_id":branch,"job_id":id,
        "entity":job.get("entity").and_then(Value::as_str).unwrap_or("unknown"),
        "status":job.get("status").and_then(Value::as_str).unwrap_or("unknown"),
        "last_error":job.get("lastError").and_then(Value::as_str).unwrap_or(""),
        "error_rows":job.pointer("/expected/errorRows").and_then(Value::as_i64).unwrap_or(0),
        "failed_chunks":job.get("failedChunks").and_then(Value::as_i64).unwrap_or(0),
        "approval_status":job.get("approvalStatus").and_then(Value::as_str).unwrap_or("not_required"),
        "recovery_recommendations":recommendations
    });
    if let Some(ai) =
        call_migration_ai(settings, "/api/v1/migrations/failure-assistant", payload).await
    {
        let valid = ai
            .get("recommendations")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                !items.is_empty()
                    && items.len() <= 8
                    && items.iter().all(|item| {
                        item.as_str().is_some_and(|text| {
                            !text.trim().is_empty() && text.chars().count() <= 500
                        })
                    })
            });
        if valid
            && matches!(
                ai.get("source").and_then(Value::as_str),
                Some("python_deterministic" | "openai_responses")
            )
        {
            return Ok(ai);
        }
    }
    let mut local = recommendations;
    if local.is_empty() {
        local.push(json!(
            "Review the governance proof pack and rollback impact before changing the job"
        ));
    }
    Ok(json!({
        "jobId":id,"source":"rust_deterministic","model":"local-migration-recovery-v1",
        "summary":job.get("lastError").and_then(Value::as_str).filter(|value| !value.is_empty()).unwrap_or("Migration requires review"),
        "recommendations":local
    }))
}

pub async fn monitoring(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    let counts = migration_repository::monitoring_counts(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load migration monitoring"))?;
    let now = Utc::now();
    let mut alerts = Vec::new();
    if counts.stale_workers > 0 {
        alerts.push(json!({"code":"MIGRATION_WORKER_STALE","severity":"critical","count":counts.stale_workers,"runbook":"docs/DATA_MIGRATION_RUNBOOK.md#stale-worker"}));
    }
    if counts.failed_24h > 0 {
        alerts.push(json!({"code":"MIGRATION_FAILURES","severity":"warning","count":counts.failed_24h,"runbook":"docs/DATA_MIGRATION_RUNBOOK.md#failed-job"}));
    }
    if counts.overdue_approvals > 0 {
        alerts.push(json!({"code":"MIGRATION_APPROVAL_OVERDUE","severity":"warning","count":counts.overdue_approvals,"runbook":"docs/DATA_MIGRATION_RUNBOOK.md#approval-overdue"}));
    }
    if counts.queue_depth > 20 {
        alerts.push(json!({"code":"MIGRATION_QUEUE_DEPTH","severity":"warning","count":counts.queue_depth,"runbook":"docs/DATA_MIGRATION_RUNBOOK.md#queue-backlog"}));
    }
    Ok(json!({
        "generatedAt":now,"tenantId":tenant,"branchId":branch,"statusCounts":counts.status_counts,
        "queueDepth":counts.queue_depth,"staleWorkers":counts.stale_workers,"failedJobs24h":counts.failed_24h,
        "overdueApprovals":counts.overdue_approvals,"alerts":alerts
    }))
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

pub(crate) async fn resolve_owner(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    requested: Option<&str>,
) -> Result<String, AppError> {
    let owner = requested.unwrap_or(actor).trim();
    if owner.is_empty() || owner.chars().count() > 128 {
        return Err(AppError::validation("import owner is invalid"));
    }
    if owner == actor {
        return Ok(owner.to_string());
    }
    let user = auth_repository::find_user_by_id(db, tenant, owner)
        .await
        .map_err(|_| AppError::internal("failed to validate import owner"))?
        .ok_or_else(|| AppError::validation("import owner is not active"))?;
    if auth_repository::find_branch_access(db, &user, branch)
        .await
        .map_err(|_| AppError::internal("failed to validate import owner branch access"))?
        .is_none()
    {
        return Err(AppError::validation(
            "import owner does not have access to this branch",
        ));
    }
    Ok(owner.to_string())
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

fn mapping_suggestion_result(
    entity: MigrationEntity,
    columns: &[String],
    provided: &BTreeMap<String, String>,
    source: &str,
    model: &str,
) -> Result<Value, AppError> {
    let (suggestions, unmatched) =
        migration_adapter_service::suggest_mapping(entity, columns, provided)?;
    Ok(
        json!({"entity":entity.as_str(),"source":source,"model":model,"suggestions":suggestions,"unmatchedColumns":unmatched}),
    )
}

async fn call_migration_ai(settings: &Settings, path: &str, payload: Value) -> Option<Value> {
    let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) else {
        return None;
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(14))
        .build()
        .ok()?;
    let response = client
        .post(format!("{url}{path}"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let envelope = response.json::<Value>().await.ok()?;
    if envelope.get("success").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    envelope.get("data").cloned()
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
