use crate::{
    config::Settings,
    models::{
        common::AppError,
        migration::{
            AnalyzeMigrationRequest, ApproveMigrationMappingRequest, CreateImportJobRequest,
            ImportJob, MigrationAlias, MigrationAnalysisReport, MigrationApprovalRequest,
            MigrationEntity, MigrationJobStatus, MigrationMapping, MigrationMappingApproval,
            MigrationMappingSuggestionRequest, MigrationMode, MigrationProvider,
            MigrationRecoveryReport, MigrationTemplate, SaveMigrationAliasRequest,
            SaveMigrationMappingRequest,
        },
        migration_file::MigrationSourceColumnProfile,
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

struct MappingEvaluation {
    columns: Vec<String>,
    profiles: Vec<MigrationSourceColumnProfile>,
    source_provider: MigrationProvider,
    template: MigrationTemplate,
    resolution: migration_adapter_service::MappingResolution,
    fingerprint: String,
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

pub async fn save_alias(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: SaveMigrationAliasRequest,
) -> Result<MigrationAlias, AppError> {
    let target = migration_adapter_service::validate_tenant_alias(
        request.entity,
        &request.alias,
        &request.target_field,
    )?;
    migration_repository::save_alias(
        db,
        tenant,
        branch,
        request.entity,
        request.source_provider,
        request.alias.trim(),
        &target,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save tenant migration alias"))
}

pub async fn list_aliases(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<MigrationAlias>, AppError> {
    migration_repository::list_aliases(db, tenant, branch, None)
        .await
        .map_err(|_| AppError::internal("failed to list tenant migration aliases"))
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
    let (headers, profiles, row_count) =
        migration_file_service::profile_csv_mapping_evidence(&request.csv, request.entity)?;
    let mapping = resolved_mapping(
        db,
        tenant,
        branch,
        request.entity,
        request.source_provider,
        &headers,
        &profiles,
        row_count,
        None,
        "",
        None,
        mapping_id,
        request.mapping,
    )
    .await?;
    Ok(migration_adapter_service::prepare(
        db,
        tenant,
        branch,
        request.entity,
        request.source_provider,
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
    let (headers, profiles, row_count) =
        migration_file_service::profile_csv_mapping_evidence(&request.csv, request.entity)?;
    let mapping = resolved_mapping(
        db,
        tenant,
        branch,
        request.entity,
        request.source_provider,
        &headers,
        &profiles,
        row_count,
        None,
        "",
        None,
        mapping_id,
        request.mapping,
    )
    .await?;
    let prepared = migration_adapter_service::prepare(
        db,
        tenant,
        branch,
        request.entity,
        request.source_provider,
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
    settings: &Settings,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<serde_json::Value, AppError> {
    let mut pack = migration_repository::proof_pack(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to build import proof pack"))?
        .ok_or_else(|| AppError::not_found("import job not found"))?;
    let signing_key = settings
        .migration_proof_signing_key
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "MIGRATION_SIGNING_NOT_CONFIGURED",
                "migration proof-pack signing is not configured",
            )
        })?;
    crate::services::migration_proof_service::sign(&mut pack, signing_key)?;
    Ok(pack)
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
    let mut evaluation = evaluate_mapping(db, tenant, branch, actor, &request).await?;
    apply_mapping_approvals(
        db,
        tenant,
        branch,
        &evaluation.fingerprint,
        &mut evaluation.resolution,
    )
    .await?;
    let mut suggestions = evaluation.resolution.mapping.clone();
    suggestions.extend(
        request
            .mapping
            .iter()
            .filter(|(_, target)| target.as_str() == "__ignore")
            .map(|(source, target)| (source.clone(), target.clone())),
    );
    let supported_targets = evaluation
        .template
        .columns
        .iter()
        .map(|column| column.field.clone())
        .collect::<HashSet<_>>();
    let semantic_targets = evaluation
        .template
        .columns
        .iter()
        .map(|column| json!({"field":&column.field,"aliases":&column.aliases}))
        .collect::<Vec<_>>();
    let semantic = call_migration_ai(
        settings,
        "/api/v1/migrations/mapping-suggestions",
        json!({
            "tenant_id":tenant,
            "branch_id":branch,
            "entity":request.entity.as_str(),
            "source_provider":evaluation.source_provider.as_str(),
            "source_columns":&evaluation.columns,
            "targets":semantic_targets,
            "profile":&evaluation.profiles
        }),
    )
    .await;
    let semantic_source = semantic
        .as_ref()
        .and_then(|value| value.get("source"))
        .and_then(Value::as_str)
        .filter(|source| matches!(*source, "python_deterministic" | "openai_responses"))
        .unwrap_or("unavailable");
    let semantic_advisory = semantic
        .as_ref()
        .and_then(|value| value.get("suggestions"))
        .cloned()
        .and_then(|value| serde_json::from_value::<BTreeMap<String, String>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|(source, target)| {
            evaluation.columns.contains(source) && supported_targets.contains(target)
        })
        .collect::<BTreeMap<_, _>>();
    Ok(json!({
        "entity":request.entity.as_str(),
        "sourceProvider":evaluation.source_provider.as_str(),
        "source":"rust_deterministic_confidence",
        "model":migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "contractVersion":evaluation.template.contract_version,
        "ruleVersion":migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "fingerprint":evaluation.fingerprint,
        "semanticSource":semantic_source,
        "semanticAdvisory":semantic_advisory,
        "suggestions":suggestions,
        "unmatchedColumns":evaluation.resolution.unmatched,
        "decisions":evaluation.resolution.decisions,
        "approvalRequiredIssues":evaluation.resolution.approval_required_reasons.values().collect::<Vec<_>>(),
        "hardBlockingIssues":evaluation.resolution.hard_blocking_reasons,
        "blockingIssues":evaluation.resolution.blocking_reasons
    }))
}

pub async fn approve_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: ApproveMigrationMappingRequest,
) -> Result<MigrationMappingApproval, AppError> {
    let source_column = request.source_column.trim();
    let target_field = request.target_field.trim();
    let fingerprint = request.fingerprint.trim().to_ascii_lowercase();
    if source_column.is_empty()
        || source_column.chars().count() > 200
        || target_field.is_empty()
        || target_field.chars().count() > 120
        || fingerprint.len() != 64
        || !fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AppError::validation("mapping approval payload is invalid"));
    }
    let baseline = evaluate_mapping(db, tenant, branch, actor, &request.evaluation).await?;
    if baseline.fingerprint != fingerprint {
        return Err(AppError::conflict(
            "mapping evidence changed; refresh suggestions before approval",
        ));
    }
    if !baseline
        .resolution
        .decisions
        .iter()
        .any(|decision| decision.source_column == source_column)
    {
        return Err(AppError::validation(
            "source column is not part of this mapping evaluation",
        ));
    }
    let mut selected_request = request.evaluation;
    selected_request
        .mapping
        .insert(source_column.to_string(), target_field.to_string());
    let selected = evaluate_mapping(db, tenant, branch, actor, &selected_request).await?;
    let decision = selected
        .resolution
        .decisions
        .iter()
        .find(|decision| decision.source_column == source_column)
        .filter(|decision| decision.target_field.as_deref() == Some(target_field))
        .ok_or_else(|| AppError::validation("selected CRM target is not supported"))?;
    if decision.confidence == "red" {
        return Err(AppError::validation(
            "Red mapping is a hard failure and cannot be approved or overridden",
        ));
    }
    if decision.confidence != "yellow" {
        return Err(AppError::conflict(
            "only Yellow mappings require governance approval",
        ));
    }
    let decision_json = serde_json::to_value(decision)
        .map_err(|_| AppError::internal("failed to serialize mapping approval evidence"))?;
    migration_repository::approve_mapping(
        db,
        tenant,
        branch,
        selected_request.entity,
        selected.source_provider,
        migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        &selected.fingerprint,
        selected_request.source_file_id.as_deref(),
        selected_request.source_sheet.trim(),
        source_column,
        target_field,
        decision.confidence_percentage,
        &decision_json,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to record Yellow mapping approval"))
}

async fn evaluate_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    request: &MigrationMappingSuggestionRequest,
) -> Result<MappingEvaluation, AppError> {
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
    let source_evidence_sha256 = if let Some(id) = source_file_id {
        Some(
            migration_file_service::get_source_file(db, tenant, branch, id)
                .await?
                .sha256,
        )
    } else {
        None
    };
    let (source_columns, profiles, row_count, source_provider) = if let Some(id) = source_file_id {
        let profile = migration_file_service::source_profile(db, tenant, branch, actor, id).await?;
        let importable = profile
            .sheets
            .iter()
            .filter(|sheet| sheet.importable)
            .collect::<Vec<_>>();
        let sheet = if request.source_sheet.trim().is_empty() {
            if importable.len() != 1 {
                return Err(AppError::validation(
                    "select one source sheet before requesting mapping suggestions",
                ));
            }
            importable[0]
        } else {
            profile
                .sheets
                .iter()
                .find(|sheet| sheet.id == request.source_sheet.trim())
                .ok_or_else(|| AppError::validation("selected source sheet was not found"))?
        };
        if !sheet.targets.is_empty() && !sheet.targets.contains(&request.entity) {
            return Err(AppError::validation(
                "selected source sheet does not contain the chosen entity",
            ));
        }
        (
            sheet.columns.clone(),
            sheet.column_profiles.clone(),
            sheet.row_count,
            if request.source_provider == crate::models::migration::MigrationProvider::Auto {
                profile.provider
            } else {
                request.source_provider
            },
        )
    } else {
        (
            request.source_columns.clone(),
            Vec::new(),
            0,
            request.source_provider,
        )
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
    let template = templates()
        .into_iter()
        .find(|item| item.entity == request.entity)
        .ok_or_else(|| AppError::validation("migration entity is not supported"))?;
    let aliases = migration_repository::list_aliases(db, tenant, branch, Some(request.entity))
        .await
        .map_err(|_| AppError::internal("failed to load tenant migration aliases"))?;
    let resolution = migration_adapter_service::resolve_mapping_with_confidence(
        request.entity,
        source_provider,
        &columns,
        &request.mapping,
        &aliases,
        &profiles,
        row_count,
    )?;
    let fingerprint = mapping_fingerprint(
        request.entity,
        source_provider,
        source_file_id,
        request.source_sheet.trim(),
        source_evidence_sha256.as_deref(),
        &columns,
        &resolution,
    )?;
    Ok(MappingEvaluation {
        columns,
        profiles,
        source_provider,
        template,
        resolution,
        fingerprint,
    })
}

async fn apply_mapping_approvals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    fingerprint: &str,
    resolution: &mut migration_adapter_service::MappingResolution,
) -> Result<(), AppError> {
    let approvals = migration_repository::list_mapping_approvals(db, tenant, branch, fingerprint)
        .await
        .map_err(|_| AppError::internal("failed to load mapping approvals"))?;
    for approval in approvals {
        let Some(decision) = resolution.decisions.iter_mut().find(|decision| {
            decision.confidence == "yellow"
                && decision.source_column == approval.source_column
                && decision.target_field.as_deref() == Some(approval.target_field.as_str())
                && decision.confidence_percentage == approval.confidence_percentage
        }) else {
            continue;
        };
        decision.approved = true;
        decision.approval_id = Some(approval.id);
        decision.approved_by = Some(approval.approved_by);
        decision.approved_at = Some(approval.approved_at);
        resolution.mapping.insert(
            decision.source_column.clone(),
            approval.target_field.clone(),
        );
        resolution
            .approval_required_reasons
            .remove(&decision.source_column);
    }
    resolution.blocking_reasons = resolution.hard_blocking_reasons.clone();
    resolution
        .blocking_reasons
        .extend(resolution.approval_required_reasons.values().cloned());
    resolution.blocking_reasons.sort();
    resolution.blocking_reasons.dedup();
    let matched = resolution
        .mapping
        .keys()
        .map(|source| source.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    resolution.unmatched = resolution
        .decisions
        .iter()
        .filter(|decision| {
            decision.reason != "explicitly_ignored"
                && !matched.contains(&decision.source_column.to_ascii_lowercase())
        })
        .map(|decision| decision.source_column.clone())
        .collect();
    Ok(())
}

fn mapping_fingerprint(
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    source_file_id: Option<&str>,
    source_sheet: &str,
    source_evidence_sha256: Option<&str>,
    columns: &[String],
    resolution: &migration_adapter_service::MappingResolution,
) -> Result<String, AppError> {
    let payload = json!({
        "ruleVersion":migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "entity":entity.as_str(),
        "sourceProvider":source_provider.as_str(),
        "sourceFileId":source_file_id,
        "sourceSheet":source_sheet,
        "sourceEvidenceSha256":source_evidence_sha256,
        "columns":columns,
        "decisions":&resolution.decisions
    });
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&payload)
                .map_err(|_| AppError::internal("failed to fingerprint mapping suggestions"))?
        )
    ))
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

pub(crate) async fn resolved_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: crate::models::migration::MigrationProvider,
    source_columns: &[String],
    profiles: &[crate::models::migration_file::MigrationSourceColumnProfile],
    row_count: i64,
    source_file_id: Option<&str>,
    source_sheet: &str,
    source_evidence_sha256: Option<&str>,
    mapping_id: Option<&str>,
    overrides: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, AppError> {
    let explicit = effective_mapping(db, tenant, branch, entity, mapping_id, overrides).await?;
    let aliases = migration_repository::list_aliases(db, tenant, branch, Some(entity))
        .await
        .map_err(|_| AppError::internal("failed to load tenant migration aliases"))?;
    let mut resolution = migration_adapter_service::resolve_mapping_with_confidence(
        entity,
        source_provider,
        source_columns,
        &explicit,
        &aliases,
        profiles,
        row_count,
    )?;
    let fingerprint = mapping_fingerprint(
        entity,
        source_provider,
        source_file_id,
        source_sheet,
        source_evidence_sha256,
        source_columns,
        &resolution,
    )?;
    apply_mapping_approvals(db, tenant, branch, &fingerprint, &mut resolution).await?;
    if !resolution.blocking_reasons.is_empty() {
        return Err(AppError::validation(resolution.blocking_reasons.join("; ")));
    }
    resolution.mapping.extend(
        explicit
            .into_iter()
            .filter(|(_, target)| target == "__ignore"),
    );
    Ok(resolution.mapping)
}

fn source_hash(csv: &str) -> String {
    format!("{:x}", Sha256::digest(csv.as_bytes()))
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
