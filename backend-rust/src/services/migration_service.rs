use crate::{
    config::Settings,
    models::{
        common::AppError,
        migration::{
            AnalyzeMigrationRequest, ApproveMigrationMappingRequest, CreateImportJobRequest,
            CreateMigrationCutoverRequest, HistoricalPurchaseMappingDecision,
            HistoricalPurchaseMappingDecisionRequest, HistoricalPurchaseMappingKind, ImportJob,
            MigrationAlias, MigrationAnalysisReport, MigrationApprovalRequest, MigrationCutover,
            MigrationCutoverStatus, MigrationEntity, MigrationJobStatus, MigrationMapping,
            MigrationMappingApproval, MigrationMappingSuggestionRequest, MigrationMappingVersion,
            MigrationMode, MigrationProvider, MigrationRecoveryReport, MigrationTemplate,
            OpeningPayableControlsApprovalRequest, PurchaseBillPostingMode,
            SaveMigrationAliasRequest, SaveMigrationMappingRequest, ThreeLayerPostingContract,
            TransitionMigrationCutoverRequest, THREE_LAYER_POSTING_CONTRACT_VERSION,
        },
        migration_file::MigrationSourceColumnProfile,
    },
    repositories::{auth_repository, migration_repository},
    services::{migration_adapter_service, migration_file_service, migration_large_import_service},
};
use chrono::{NaiveDate, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashSet};

pub fn templates() -> Vec<MigrationTemplate> {
    migration_adapter_service::templates()
}

pub async fn active_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Option<MigrationCutover>, AppError> {
    migration_repository::get_cutover(db, tenant, branch, None)
        .await
        .map_err(|_| AppError::internal("failed to load migration cutover"))
}

pub async fn save_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    actor_role: &str,
    request: CreateMigrationCutoverRequest,
) -> Result<MigrationCutover, AppError> {
    let id = request.id.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(AppError::validation(
            "id must be 1-80 letters, numbers, dashes or underscores",
        ));
    }
    let timezone = request.business_timezone.trim();
    if timezone.is_empty() || timezone.len() > 80 {
        return Err(AppError::validation("businessTimezone is invalid"));
    }
    if request.historical_period_end > request.cutover_at {
        return Err(AppError::validation(
            "historicalPeriodEnd must be on or before cutoverAt",
        ));
    }
    if !migration_repository::cutover_timezone_matches_date(
        db,
        timezone,
        request.cutover_at,
        request.cutover_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cutover timezone"))?
    {
        return Err(AppError::validation(
            "businessTimezone is unknown or cutoverDate does not match cutoverAt in that timezone",
        ));
    }
    let saved = migration_repository::save_cutover(
        db,
        tenant,
        branch,
        actor,
        actor_role,
        id,
        timezone,
        request.cutover_date,
        request.cutover_at,
        request.historical_period_end,
        THREE_LAYER_POSTING_CONTRACT_VERSION,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database| database.is_unique_violation())
        {
            AppError::conflict("this branch already has an active migration cutover")
        } else {
            AppError::internal("failed to save migration cutover")
        }
    })?;
    if !saved {
        return Err(AppError::conflict(
            "only a draft cutover with the same date can be reconfigured",
        ));
    }
    migration_repository::get_cutover(db, tenant, branch, Some(id))
        .await
        .map_err(|_| AppError::internal("failed to reload migration cutover"))?
        .ok_or_else(|| AppError::internal("saved migration cutover was not found"))
}

pub async fn transition_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    actor_role: &str,
    request: TransitionMigrationCutoverRequest,
) -> Result<MigrationCutover, AppError> {
    if request.note.chars().count() > 500 {
        return Err(AppError::validation("note must be 500 characters or fewer"));
    }
    let note = request.note.trim();
    let observation_period_hours = if request.target_status == MigrationCutoverStatus::Live {
        if note.is_empty() {
            return Err(AppError::validation_code(
                "GO_LIVE_APPROVAL_NOTE_REQUIRED",
                "Owner go-live approval requires a final reconciliation note",
            ));
        }
        Some(
            request
                .observation_period_hours
                .filter(|hours| (24..=72).contains(hours))
                .ok_or_else(|| {
                    AppError::validation_code(
                        "ROLLBACK_OBSERVATION_WINDOW_REQUIRED",
                        "Go-live requires a rollback observation window between 24 and 72 hours",
                    )
                })?,
        )
    } else {
        None
    };
    let expected = previous_cutover_status(request.target_status)
        .ok_or_else(|| AppError::validation("draft is not a transition target"))?;
    let checksum = request.snapshot_checksum.as_deref().map(str::trim);
    if request.target_status == MigrationCutoverStatus::SnapshotApproved
        && !checksum.is_some_and(|value| {
            value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(AppError::validation_code(
            "SNAPSHOT_CHECKSUM_REQUIRED",
            "snapshot approval requires a 64-character SHA-256 checksum",
        ));
    }
    let transitioned = migration_repository::transition_cutover(
        db,
        tenant,
        branch,
        id,
        expected,
        request.target_status,
        checksum,
        observation_period_hours,
        actor,
        actor_role,
        note,
    )
    .await
    .map_err(|error| {
        let message = error
            .as_database_error()
            .map(|database| database.message())
            .unwrap_or_default();
        match message {
            "MIGRATION_CUTOVER_OWNER_APPROVAL_REQUIRED" => AppError::forbidden(
                "Owner approval is required for freeze, snapshot approval and go-live",
            ),
            "MIGRATION_CUTOVER_TRANSITION_INVALID" => {
                AppError::conflict("cutover status changed; reload and try again")
            }
            "MIGRATION_CUTOVER_RECONCILIATION_BLOCKED" => AppError::validation_code(
                "MIGRATION_CUTOVER_RECONCILIATION_BLOCKED",
                "Go-live is blocked until every migration reconciliation issue is resolved",
            ),
            "MIGRATION_GO_LIVE_APPROVAL_PACK_REQUIRED" => AppError::validation_code(
                "MIGRATION_GO_LIVE_APPROVAL_PACK_REQUIRED",
                "Go-live requires the Owner approval note, matched reconciliation checksum and rollback policy",
            ),
            _ => AppError::internal("failed to transition migration cutover"),
        }
    })?;
    if !transitioned {
        return Err(AppError::conflict(
            "transition prerequisites are incomplete or the cutover status changed",
        ));
    }
    migration_repository::get_cutover(db, tenant, branch, Some(id))
        .await
        .map_err(|_| AppError::internal("failed to reload migration cutover"))?
        .ok_or_else(|| AppError::not_found("migration cutover not found"))
}

fn previous_cutover_status(target: MigrationCutoverStatus) -> Option<MigrationCutoverStatus> {
    Some(match target {
        MigrationCutoverStatus::Draft => return None,
        MigrationCutoverStatus::HistoryImporting => MigrationCutoverStatus::Draft,
        MigrationCutoverStatus::InventoryFrozen => MigrationCutoverStatus::HistoryImporting,
        MigrationCutoverStatus::SnapshotApproved => MigrationCutoverStatus::InventoryFrozen,
        MigrationCutoverStatus::SnapshotApplied => MigrationCutoverStatus::SnapshotApproved,
        MigrationCutoverStatus::Reconciled => MigrationCutoverStatus::SnapshotApplied,
        MigrationCutoverStatus::Live => MigrationCutoverStatus::Reconciled,
    })
}

struct MappingEvaluation {
    columns: Vec<String>,
    profiles: Vec<MigrationSourceColumnProfile>,
    source_provider: MigrationProvider,
    template: MigrationTemplate,
    resolution: migration_adapter_service::MappingResolution,
    fingerprint: String,
    normalized_headers: Vec<String>,
    header_fingerprint: String,
    source_sheet: String,
    saved_profile: Option<MigrationMapping>,
    profile_match: &'static str,
    added_headers: Vec<String>,
    removed_headers: Vec<String>,
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
    if request.entity != request.evaluation.entity {
        return Err(AppError::validation(
            "mapping entity does not match its evaluation",
        ));
    }
    let fingerprint = request.fingerprint.trim().to_ascii_lowercase();
    let mut evaluation = evaluate_mapping(db, tenant, branch, actor, &request.evaluation).await?;
    if evaluation.fingerprint != fingerprint {
        return Err(AppError::conflict(
            "mapping evidence changed; refresh suggestions before saving",
        ));
    }
    if !request.source_columns.is_empty() && request.source_columns != evaluation.columns {
        return Err(AppError::conflict(
            "source column evidence changed; refresh the mapping review",
        ));
    }
    apply_mapping_approvals(db, tenant, branch, &fingerprint, &mut evaluation.resolution).await?;
    if !evaluation.resolution.blocking_reasons.is_empty() {
        return Err(AppError::validation(
            "only fully validated and approved mappings can be saved",
        ));
    }
    let mut approved_mapping = evaluation.resolution.mapping.clone();
    approved_mapping.extend(
        request
            .evaluation
            .mapping
            .iter()
            .filter(|(_, target)| target.as_str() == "__ignore")
            .map(|(source, target)| (source.clone(), target.clone())),
    );
    if request.mapping != approved_mapping {
        return Err(AppError::conflict(
            "mapping changed after approval; run dry-run and review it again",
        ));
    }
    migration_adapter_service::validate_mapping_contract(request.entity, &approved_mapping)?;
    let source_columns = serde_json::to_value(&evaluation.columns)
        .map_err(|_| AppError::internal("failed to serialize source columns"))?;
    let normalized_headers = serde_json::to_value(&evaluation.normalized_headers)
        .map_err(|_| AppError::internal("failed to serialize normalized headers"))?;
    let transformer_versions = json!({
        "mappingRule": migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "rowTransformer": migration_adapter_service::MIGRATION_TRANSFORMER_VERSION
    });
    migration_repository::save_mapping(
        db,
        tenant,
        branch,
        request.entity,
        name,
        &serde_json::to_value(approved_mapping)
            .map_err(|_| AppError::internal("failed to serialize mapping"))?,
        &source_columns,
        evaluation.source_provider,
        &evaluation.source_sheet,
        &normalized_headers,
        &evaluation.header_fingerprint,
        &transformer_versions,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save import mapping"))
}

pub async fn list_mapping_versions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    mapping_id: &str,
) -> Result<Vec<MigrationMappingVersion>, AppError> {
    migration_repository::list_mapping_versions(db, tenant, branch, mapping_id)
        .await
        .map_err(|_| AppError::internal("failed to list mapping versions"))
}

pub async fn rollback_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    mapping_id: &str,
    version: i32,
    actor: &str,
) -> Result<MigrationMapping, AppError> {
    if version < 1 {
        return Err(AppError::validation("mapping version is invalid"));
    }
    migration_repository::rollback_mapping(db, tenant, branch, mapping_id, version, actor)
        .await
        .map_err(|_| AppError::internal("failed to rollback mapping profile"))?
        .ok_or_else(|| AppError::not_found("mapping profile version not found"))
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
    let posting_contract_fields = validate_three_layer_posting_mode(
        request.entity,
        request.posting_mode,
        request.mode,
        request.cutover_id.as_deref(),
        request.cutover_date,
    )?;
    if request.mode == MigrationMode::Commit
        && request.posting_mode == Some(PurchaseBillPostingMode::HistoryOnly)
    {
        return Err(AppError::validation_code(
            "HISTORICAL_PURCHASE_SOURCE_EVIDENCE_REQUIRED",
            "historical purchase commit requires an immutable CSV, XLSX or ZIP source upload",
        ));
    }
    if request.mode == MigrationMode::Commit
        && request.posting_mode == Some(PurchaseBillPostingMode::OpeningPayable)
    {
        return Err(AppError::validation_code(
            "OPENING_PAYABLE_SOURCE_EVIDENCE_REQUIRED",
            "opening payable commit requires an immutable CSV, XLSX or ZIP source upload",
        ));
    }
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
    let source_provider = if request.source_provider == MigrationProvider::Auto {
        MigrationProvider::Csv
    } else {
        request.source_provider
    };
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
        source_provider,
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
    let mapping_version = if let Some(id) = mapping_id {
        migration_repository::get_mapping(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to load import mapping version"))?
            .map_or(0, |profile| profile.mapping_version)
    } else {
        0
    };
    let mut prepared = migration_adapter_service::prepare(
        db,
        tenant,
        branch,
        request.entity,
        source_provider,
        &request.csv,
        &mapping,
        &request.duplicate_decisions,
    )
    .await?;
    let posting_contract =
        posting_contract_fields.map(|(posting_mode, cutover_id, cutover_date)| {
            ThreeLayerPostingContract {
                contract_version: THREE_LAYER_POSTING_CONTRACT_VERSION.to_string(),
                tenant_id: tenant.to_string(),
                branch_id: branch.to_string(),
                provider: source_provider,
                source_file: request.file_name.trim().to_string(),
                source_file_id: None,
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
        enforce_three_layer_rows(contract, &mut prepared.rows)?;
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
    }
    let summary = &prepared.report.summary;
    let ready = summary.error_rows == 0 && summary.ready_rows == summary.source_rows;
    let status = if request.mode == MigrationMode::Commit && summary.dependency_pending_rows > 0 {
        MigrationJobStatus::DependencyPending
    } else if ready {
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
    let mut analysis_json = serde_json::to_value(&prepared.report)
        .map_err(|_| AppError::internal("failed to serialize dry-run report"))?;
    if let Some(contract) = posting_contract {
        let analysis = analysis_json
            .as_object_mut()
            .ok_or_else(|| AppError::internal("failed to preserve posting contract"))?;
        analysis.insert(
            "postingContract".to_string(),
            serde_json::to_value(contract)
                .map_err(|_| AppError::internal("failed to serialize posting contract"))?,
        );
    }
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

pub(crate) fn validate_three_layer_posting_mode(
    entity: MigrationEntity,
    posting_mode: Option<PurchaseBillPostingMode>,
    mode: MigrationMode,
    cutover_id: Option<&str>,
    cutover_date: Option<NaiveDate>,
) -> Result<Option<(PurchaseBillPostingMode, String, NaiveDate)>, AppError> {
    let supported = matches!(
        entity,
        MigrationEntity::PurchaseBills
            | MigrationEntity::Inventory
            | MigrationEntity::OpeningPayables
    );
    if !supported {
        return if posting_mode.is_some() || cutover_id.is_some() || cutover_date.is_some() {
            Err(AppError::validation_code(
                "POSTING_CONTRACT_ENTITY_MISMATCH",
                "three-layer posting contract is only valid for purchase-bills, inventory or opening-payables",
            ))
        } else {
            Ok(None)
        };
    }
    let posting_mode = posting_mode.ok_or_else(|| {
        AppError::validation_code(
            "POSTING_MODE_REQUIRED",
            "purchase-bills, inventory and opening-payables migrations require explicit postingMode",
        )
    })?;
    let cutover_id = cutover_id
        .map(str::trim)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 80
                && id.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
                })
        })
        .ok_or_else(|| {
            AppError::validation_code(
                "CUTOVER_ID_INVALID",
                "cutoverId must be 1-80 letters, numbers, dashes or underscores",
            )
        })?;
    let cutover_date = cutover_date.ok_or_else(|| {
        AppError::validation_code(
            "CUTOVER_DATE_REQUIRED",
            "cutoverDate is required for three-layer inventory migration",
        )
    })?;
    match (entity, posting_mode, mode) {
        (MigrationEntity::PurchaseBills, PurchaseBillPostingMode::HistoryOnly, _)
        | (
            MigrationEntity::PurchaseBills,
            PurchaseBillPostingMode::LiveReceipt,
            MigrationMode::DryRun,
        )
        | (MigrationEntity::Inventory, PurchaseBillPostingMode::OpeningSnapshot, _)
        | (MigrationEntity::OpeningPayables, PurchaseBillPostingMode::OpeningPayable, _) => {
            Ok(Some((posting_mode, cutover_id.to_string(), cutover_date)))
        }
        (MigrationEntity::PurchaseBills, PurchaseBillPostingMode::LiveReceipt, _) => {
            Err(AppError::validation_code(
                "LIVE_RECEIPT_EXECUTION_NOT_READY",
                "live receipt commit remains blocked until approval revalidation and posting are enabled",
            ))
        }
        _ => Err(AppError::validation_code(
            "POSTING_MODE_ENTITY_MISMATCH",
            "history_only and live_receipt require purchase-bills; opening_snapshot requires inventory; opening_payable requires opening-payables",
        )),
    }
}

pub(crate) fn enforce_three_layer_rows(
    contract: &ThreeLayerPostingContract,
    rows: &mut Value,
) -> Result<(), AppError> {
    let rows = rows
        .as_array_mut()
        .ok_or_else(|| AppError::internal("prepared migration rows are invalid"))?;
    for row in rows {
        let line = row
            .get("source_row_number")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let source_date = if contract.entity == MigrationEntity::PurchaseBills {
            row.get("received_date")
                .and_then(Value::as_str)
                .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
                .ok_or_else(|| {
                    AppError::validation_code(
                        "SOURCE_TRANSACTION_DATE_INVALID",
                        format!("row {line} has no valid purchase transaction date"),
                    )
                })?
        } else {
            contract.cutover_date
        };
        if contract.posting_mode == PurchaseBillPostingMode::LiveReceipt
            && source_date <= contract.cutover_date
        {
            return Err(AppError::validation_code(
                "HISTORICAL_ROW_LIVE_RECEIPT_FORBIDDEN",
                format!(
                    "row {line} dated {source_date} is on or before cutover {} and cannot become a live receipt",
                    contract.cutover_date
                ),
            ));
        }
        let (stock_effect, accounting_effect, approval_required) = match contract.posting_mode {
            PurchaseBillPostingMode::HistoryOnly => ("none", "none", false),
            PurchaseBillPostingMode::OpeningSnapshot => {
                ("exact_target", "opening_valuation", false)
            }
            PurchaseBillPostingMode::OpeningPayable => ("none", "opening_accounts_payable", true),
            PurchaseBillPostingMode::LiveReceipt => ("add_quantity", "normal_posting", true),
        };
        let decision_hash = format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
                    contract.contract_version,
                    contract.tenant_id,
                    contract.branch_id,
                    contract.provider.as_str(),
                    contract.source_file,
                    contract.source_file_id.as_deref().unwrap_or(""),
                    contract.source_checksum,
                    contract.entity.as_str(),
                    contract.import_mode.as_str(),
                    contract.posting_mode.as_str(),
                    contract.cutover_id,
                    contract.cutover_date,
                    contract.mapping_version,
                    contract.transformer_version,
                    line,
                    source_date
                )
                .as_bytes()
            )
        );
        row.as_object_mut()
            .ok_or_else(|| AppError::internal("prepared migration row is invalid"))?
            .insert(
                "posting_contract_decision".into(),
                json!({
                    "contractVersion": contract.contract_version,
                    "postingMode": contract.posting_mode,
                    "sourceTransactionDate": source_date,
                    "stockEffect": stock_effect,
                    "accountingEffect": accounting_effect,
                    "approvalRequired": approval_required,
                    "decisionHash": decision_hash
                }),
            );
    }
    Ok(())
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

pub async fn historical_purchase_bills(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, AppError> {
    migration_repository::list_historical_purchase_bills(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list historical purchase bills"))
}

pub async fn historical_purchase_bill(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, AppError> {
    if id.trim().is_empty() || id.chars().count() > 120 {
        return Err(AppError::validation(
            "historical purchase bill id is invalid",
        ));
    }
    migration_repository::historical_purchase_bill(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to load historical purchase bill"))?
        .ok_or_else(|| AppError::not_found("historical purchase bill not found"))
}

pub async fn historical_purchase_mapping_sources(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
) -> Result<Vec<Value>, AppError> {
    if provider.chars().count() > 60 {
        return Err(AppError::validation("provider filter is invalid"));
    }
    migration_repository::list_historical_purchase_mapping_sources(
        db,
        tenant,
        branch,
        kind,
        provider.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to list historical purchase mappings"))
}

pub async fn historical_purchase_mapping_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, AppError> {
    migration_repository::historical_purchase_mapping_report(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load historical mapping reconciliation"))
}

pub async fn decide_historical_purchase_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
    source_key: &str,
    request: HistoricalPurchaseMappingDecisionRequest,
    actor: &str,
) -> Result<Value, AppError> {
    validate_historical_mapping_identity(provider, source_key)?;
    if request.expected_version < 0
        || request.reason.trim().is_empty()
        || request.reason.chars().count() > 500
        || request.target_id.chars().count() > 120
    {
        return Err(AppError::validation("mapping decision is invalid"));
    }
    if request.approve_variant_mismatch {
        return Err(AppError::validation_code(
            "HISTORICAL_MAPPING_VARIANT_CONFLICT",
            "size, shade and color conflicts cannot be overridden",
        ));
    }
    if request.bulk_approval && !matches!(request.decision, HistoricalPurchaseMappingDecision::Link)
    {
        return Err(AppError::validation(
            "bulk approval supports Green Link decisions only",
        ));
    }
    match request.decision {
        HistoricalPurchaseMappingDecision::Link => {
            if request.target_id.trim().is_empty() || request.create.is_some() {
                return Err(AppError::validation(
                    "Link requires one existing target and no create payload",
                ));
            }
        }
        HistoricalPurchaseMappingDecision::Create => {
            if !request.target_id.trim().is_empty() {
                return Err(AppError::validation(
                    "Create cannot include an existing target",
                ));
            }
            let create = request
                .create
                .as_ref()
                .ok_or_else(|| AppError::validation("Create payload is required"))?;
            if create.name.trim().is_empty()
                || create.name.chars().count() > 200
                || create.code.chars().count() > 120
                || create.sku.chars().count() > 120
                || create.barcode.chars().count() > 120
                || create.brand.chars().count() > 120
                || create.category.chars().count() > 120
                || create.unit.chars().count() > 40
                || create.package_unit.chars().count() > 40
                || create.gstin.chars().count() > 30
                || create.phone.chars().count() > 30
                || create.email.chars().count() > 254
                || create.address.chars().count() > 500
            {
                return Err(AppError::validation("Create fields are invalid"));
            }
            match kind {
                HistoricalPurchaseMappingKind::Product
                    if create.unit.trim().is_empty()
                        || create.package_unit.trim().is_empty()
                        || create.units_per_package.is_none_or(|value| value <= 0) =>
                {
                    return Err(AppError::validation(
                        "Product creation requires unit, packageUnit and positive unitsPerPackage",
                    ));
                }
                HistoricalPurchaseMappingKind::Vendor if create.code.trim().is_empty() => {
                    return Err(AppError::validation(
                        "Vendor creation requires an explicit vendor code",
                    ));
                }
                _ => {}
            }
        }
        HistoricalPurchaseMappingDecision::KeepHistoricalOnly
        | HistoricalPurchaseMappingDecision::Reject => {
            if !request.target_id.trim().is_empty() || request.create.is_some() {
                return Err(AppError::validation(
                    "Historical-only and Reject decisions cannot include a CRM target",
                ));
            }
        }
    }
    migration_repository::decide_historical_purchase_mapping(
        db, tenant, branch, kind, provider, source_key, &request, actor,
    )
    .await
    .map_err(historical_mapping_error)
}

pub async fn rollback_historical_purchase_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
    source_key: &str,
    version: i32,
    actor: &str,
) -> Result<Value, AppError> {
    validate_historical_mapping_identity(provider, source_key)?;
    if version < 1 {
        return Err(AppError::validation("mapping version is invalid"));
    }
    migration_repository::rollback_historical_purchase_mapping(
        db, tenant, branch, kind, provider, source_key, version, actor,
    )
    .await
    .map_err(historical_mapping_error)?
    .ok_or_else(|| AppError::not_found("historical mapping version not found"))
}

pub async fn historical_purchase_mapping_versions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
    source_key: &str,
) -> Result<Vec<Value>, AppError> {
    validate_historical_mapping_identity(provider, source_key)?;
    migration_repository::list_historical_purchase_mapping_versions(
        db, tenant, branch, kind, provider, source_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to list historical mapping versions"))
}

fn validate_historical_mapping_identity(provider: &str, source_key: &str) -> Result<(), AppError> {
    if provider.trim().is_empty()
        || provider.chars().count() > 60
        || source_key.len() != 64
        || !source_key.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return Err(AppError::validation(
            "historical mapping identity is invalid",
        ));
    }
    Ok(())
}

fn historical_mapping_error(error: sqlx::Error) -> AppError {
    let message = match &error {
        sqlx::Error::Protocol(message) => message.as_ref(),
        sqlx::Error::Database(database) => database.message(),
        _ => "",
    };
    match message {
        "HISTORICAL_MAPPING_VERSION_CONFLICT" => {
            AppError::conflict("mapping changed; reload before deciding")
        }
        "HISTORICAL_MAPPING_UNIT_APPROVAL_REQUIRED" => AppError::validation_code(
            "HISTORICAL_MAPPING_UNIT_APPROVAL_REQUIRED",
            "different unit conversion requires explicit approval",
        ),
        "HISTORICAL_MAPPING_UNIT_CONVERSION_UNDEFINED" => AppError::validation_code(
            "HISTORICAL_MAPPING_UNIT_CONVERSION_UNDEFINED",
            "package conversion requires positive unitsPerPackage",
        ),
        "HISTORICAL_MAPPING_VARIANT_CONFLICT"
        | "HISTORICAL_MAPPING_SKU_CONFLICT"
        | "HISTORICAL_MAPPING_BARCODE_CONFLICT"
        | "HISTORICAL_MAPPING_BRAND_CONFLICT"
        | "HISTORICAL_MAPPING_VENDOR_IDENTITY_CONFLICT" => AppError::validation_code(
            "HISTORICAL_MAPPING_HARD_CONFLICT",
            "product SKU, barcode, brand, size, shade or color conflicts cannot be mapped",
        ),
        "HISTORICAL_MAPPING_SOURCE_DRIFT_APPROVAL_REQUIRED" => AppError::validation_code(
            "HISTORICAL_MAPPING_SOURCE_DRIFT_APPROVAL_REQUIRED",
            "source format changed; review and explicitly approve the new evidence",
        ),
        "HISTORICAL_MAPPING_BULK_GREEN_REQUIRED" => AppError::validation_code(
            "HISTORICAL_MAPPING_BULK_GREEN_REQUIRED",
            "bulk approval accepts only current Green mappings without conversion or drift",
        ),
        "HISTORICAL_MAPPING_CREATE_PAYLOAD_REQUIRED" => {
            AppError::validation("Create payload is required")
        }
        _ if matches!(error, sqlx::Error::RowNotFound) => {
            AppError::not_found("historical source identity or CRM target not found")
        }
        _ => AppError::internal("historical mapping decision failed"),
    }
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
        .get("safeToRollback")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Err(AppError::conflict(
            "import rollback is blocked; review the calculated recovery report for dependent stock movements or payable settlements",
        ));
    }
    migration_repository::rollback_job(db, tenant, branch, id, actor)
        .await
        .map_err(|error| {
            if error
                .to_string()
                .contains("ROLLBACK_DATABASE_VERIFICATION_FAILED")
            {
                AppError::internal(
                    "rollback database verification failed; no changes were committed",
                )
            } else {
                AppError::conflict("import rollback is blocked by dependent records")
            }
        })?
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
            "commit approval is blocked by ownership, job state, Red rows, unresolved Yellow warnings, duplicates, or dependencies",
        ));
    }
    Ok(())
}

pub async fn approve_yellow_warnings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<(), AppError> {
    if !migration_repository::approve_yellow_warnings(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to record Yellow approval"))?
    {
        return Err(AppError::conflict(
            "only the assigned owner can approve current Yellow warnings",
        ));
    }
    Ok(())
}

pub async fn approve_opening_payable_controls(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: OpeningPayableControlsApprovalRequest,
) -> Result<(), AppError> {
    let opening_balance_account = request.opening_balance_account.trim().to_ascii_uppercase();
    let payable_account = request.payable_account.trim().to_ascii_uppercase();
    let supplier_advance_account = request.supplier_advance_account.trim().to_ascii_uppercase();
    let note = request.note.trim();
    if note.chars().count() > 500 {
        return Err(AppError::validation("approval note is too long"));
    }
    if !migration_repository::approve_opening_payable_controls(
        db,
        tenant,
        branch,
        id,
        actor,
        &opening_balance_account,
        &payable_account,
        &supplier_advance_account,
        note,
    )
    .await
    .map_err(|_| AppError::internal("failed to record opening payable finance approval"))?
    {
        return Err(AppError::conflict(
            "finance approval is blocked by source totals, currency, allocations, GST, account policy, job state, or source revision",
        ));
    }
    Ok(())
}

pub async fn confirm_opening_payable_branch(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    request: MigrationApprovalRequest,
) -> Result<(), AppError> {
    let note = request.note.trim();
    if note.chars().count() > 500 {
        return Err(AppError::validation("confirmation note is too long"));
    }
    if !migration_repository::confirm_opening_payable_branch(
        db,
        tenant,
        branch,
        id,
        actor,
        request.approved,
        note,
    )
    .await
    .map_err(|_| AppError::internal("failed to record Branch Manager confirmation"))?
    {
        return Err(AppError::conflict(
            "Branch Manager confirmation requires a current Finance-approved opening payable preview",
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
    let mut report = migration_repository::governance_report(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to build import governance report"))?
        .ok_or_else(|| AppError::not_found("import job not found"))?;
    let quarantine = crate::repositories::migration_large_import_repository::quarantine_records(
        db, tenant, branch, id, 200,
    )
    .await
    .map_err(|_| AppError::internal("failed to load migration quarantine"))?
    .unwrap_or_else(|| json!({"records":[],"total":0,"limit":200,"truncated":false}));
    report
        .as_object_mut()
        .expect("governance report is an object")
        .insert("quarantine".into(), quarantine);
    Ok(report)
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

pub async fn cutover_proof_pack(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<serde_json::Value, AppError> {
    let mut pack = migration_repository::cutover_proof_pack(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to build cutover proof pack"))?
        .ok_or_else(|| AppError::not_found("migration cutover not found"))?;
    let monitoring = monitoring(db, tenant, branch).await?;
    pack.as_object_mut()
        .ok_or_else(|| AppError::internal("cutover proof pack is invalid"))?
        .insert("monitoring".into(), monitoring);
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

pub async fn error_export_csv(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    kind: &str,
) -> Result<String, AppError> {
    migration_repository::error_export_csv(db, tenant, branch, id, kind)
        .await
        .map_err(|_| AppError::internal("failed to export migration errors"))?
        .ok_or_else(|| AppError::validation("unsupported migration error export or job not found"))
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
    let semantic_profiles = evaluation
        .profiles
        .iter()
        .map(|profile| {
            json!({
                "normalizedHeader":&profile.normalized_header,
                "detectedDataType":&profile.detected_data_type,
                "emptyPercentage":profile.empty_percentage,
                "uniquePercentage":profile.unique_percentage,
                "patterns":&profile.patterns,
                "invalidValueCount":profile.invalid_value_count
            })
        })
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
            "profile":semantic_profiles
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
        "source":if evaluation.profile_match == "exact" { "saved_mapping_exact" } else { "rust_deterministic_confidence" },
        "model":migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "contractVersion":evaluation.template.contract_version,
        "ruleVersion":migration_adapter_service::MIGRATION_CONFIDENCE_RULE_VERSION,
        "fingerprint":evaluation.fingerprint,
        "headerFingerprint":evaluation.header_fingerprint,
        "profileMatch":evaluation.profile_match,
        "savedProfile":evaluation.saved_profile.as_ref().map(|profile| json!({
            "id":&profile.id,"name":&profile.name,"mappingVersion":profile.mapping_version,
            "approvedBy":&profile.approved_by,"approvedAt":profile.approved_at,
            "headerFingerprint":&profile.header_fingerprint,"columnCount":profile.column_count
        })),
        "headerDiff":{"added":&evaluation.added_headers,"removed":&evaluation.removed_headers},
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
    let (source_columns, profiles, row_count, source_provider, source_sheet) = if let Some(id) =
        source_file_id
    {
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
        let mut columns = sheet.columns.clone();
        let mut profiles = sheet.column_profiles.clone();
        let mut sheet_name = sheet.name.clone();
        let header_sheet = request.header_source_sheet.trim();
        if !header_sheet.is_empty() {
            if request.entity != MigrationEntity::PurchaseBills || header_sheet == sheet.id {
                return Err(AppError::validation(
                    "headerSourceSheet must be a different purchase-bill sheet",
                ));
            }
            let header = profile
                .sheets
                .iter()
                .find(|candidate| candidate.id == header_sheet && candidate.importable)
                .ok_or_else(|| AppError::validation("purchase header sheet was not found"))?;
            for (column, column_profile) in header.columns.iter().zip(&header.column_profiles) {
                let normalized = migration_file_service::normalize_profile_header(column);
                if columns.iter().all(|existing| {
                    migration_file_service::normalize_profile_header(existing) != normalized
                }) {
                    columns.push(column.clone());
                    profiles.push(column_profile.clone());
                }
            }
            sheet_name = format!("{} + {}", sheet.name, header.name);
        }
        (
            columns,
            profiles,
            sheet.row_count,
            if request.source_provider == crate::models::migration::MigrationProvider::Auto {
                profile.provider
            } else {
                request.source_provider
            },
            sheet_name,
        )
    } else {
        (
            request.source_columns.clone(),
            Vec::new(),
            0,
            request.source_provider,
            request.source_sheet.trim().to_string(),
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
    let normalized_headers = columns
        .iter()
        .map(|column| migration_file_service::normalize_profile_header(column))
        .collect::<Vec<_>>();
    let header_fingerprint = normalized_header_fingerprint(&normalized_headers)?;
    let saved_profile = migration_repository::closest_mapping_profile(
        db,
        tenant,
        branch,
        request.entity,
        source_provider,
        &source_sheet,
        &header_fingerprint,
    )
    .await
    .map_err(|_| AppError::internal("failed to match saved mapping profile"))?;
    let exact_profile = saved_profile.as_ref().is_some_and(|profile| {
        !profile.header_fingerprint.is_empty()
            && profile.header_fingerprint == header_fingerprint
            && profile.column_count == normalized_headers.len() as i32
    });
    let mut explicit = if exact_profile {
        saved_profile
            .as_ref()
            .map(|profile| profile.mapping.clone())
            .unwrap_or_default()
    } else {
        BTreeMap::new()
    };
    explicit.extend(request.mapping.clone());
    let mut resolution = migration_adapter_service::resolve_mapping_with_confidence(
        request.entity,
        source_provider,
        &columns,
        &explicit,
        &aliases,
        &profiles,
        row_count,
    )?;
    let (profile_match, added_headers, removed_headers) = if let Some(profile) = &saved_profile {
        if exact_profile {
            ("exact", Vec::new(), Vec::new())
        } else {
            let previous = profile
                .normalized_headers
                .iter()
                .cloned()
                .collect::<HashSet<_>>();
            let current = normalized_headers.iter().cloned().collect::<HashSet<_>>();
            let mut added = current.difference(&previous).cloned().collect::<Vec<_>>();
            let mut removed = previous.difference(&current).cloned().collect::<Vec<_>>();
            added.sort();
            removed.sort();
            require_schema_drift_approval(&mut resolution, &added);
            ("drift", added, removed)
        }
    } else {
        ("none", Vec::new(), Vec::new())
    };
    let fingerprint = mapping_fingerprint(
        request.entity,
        source_provider,
        source_file_id,
        &source_sheet,
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
        normalized_headers,
        header_fingerprint,
        source_sheet,
        saved_profile,
        profile_match,
        added_headers,
        removed_headers,
    })
}

fn normalized_header_fingerprint(normalized_headers: &[String]) -> Result<String, AppError> {
    let mut headers = normalized_headers.to_vec();
    headers.sort();
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&headers)
                .map_err(|_| AppError::internal("failed to fingerprint normalized headers"))?
        )
    ))
}

fn require_schema_drift_approval(
    resolution: &mut migration_adapter_service::MappingResolution,
    added_headers: &[String],
) {
    let added = added_headers.iter().cloned().collect::<HashSet<_>>();
    let selected = resolution
        .decisions
        .iter()
        .position(|decision| {
            added.contains(&migration_file_service::normalize_profile_header(
                &decision.source_column,
            )) && decision.confidence != "red"
        })
        .or_else(|| {
            resolution
                .decisions
                .iter()
                .position(|decision| decision.confidence == "green")
        });
    let Some(index) = selected else { return };
    let decision = &mut resolution.decisions[index];
    if decision.confidence == "green" {
        decision.confidence = "yellow".to_string();
        decision.confidence_percentage = 89;
        decision.alias_level = "saved_profile_schema_drift".to_string();
        decision.reason = "saved_profile_schema_drift".to_string();
        decision
            .rejection_reasons
            .push("Provider format changed since the approved profile".to_string());
        resolution.mapping.remove(&decision.source_column);
    }
    let reason = format!(
        "{} changed from the approved provider format",
        decision.source_column
    );
    resolution
        .approval_required_reasons
        .insert(decision.source_column.clone(), reason.clone());
    resolution.blocking_reasons.push(reason);
    resolution.blocking_reasons.sort();
    resolution.blocking_reasons.dedup();
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
    if counts.dependency_deadlocks > 0 {
        alerts.push(json!({"code":"MIGRATION_DEPENDENCY_DEADLOCK","severity":"critical","count":counts.dependency_deadlocks,"runbook":"docs/DATA_MIGRATION_PHASE_8_DEPENDENCY_EXECUTION.md#deadlock-reporting"}));
    }
    Ok(json!({
        "generatedAt":now,"tenantId":tenant,"branchId":branch,"statusCounts":counts.status_counts,
        "queueDepth":counts.queue_depth,"staleWorkers":counts.stale_workers,"failedJobs24h":counts.failed_24h,
        "overdueApprovals":counts.overdue_approvals,"dependencyDeadlocks":counts.dependency_deadlocks,"alerts":alerts
    }))
}

pub async fn process_due(db: &PgPool) -> Result<usize, AppError> {
    migration_repository::refresh_dependency_jobs(db)
        .await
        .map_err(|_| AppError::internal("failed to refresh migration dependencies"))?;
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
            let safe_error = migration_repository::migration_safety_error_code(&error)
                .unwrap_or("batch import failed");
            let _ = migration_repository::fail_job_batch(db, &job, start, end, safe_error).await;
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
    let normalized_headers = source_columns
        .iter()
        .map(|column| migration_file_service::normalize_profile_header(column))
        .collect::<Vec<_>>();
    let header_fingerprint = normalized_header_fingerprint(&normalized_headers)?;
    if let Some(id) = mapping_id.filter(|id| !id.trim().is_empty()) {
        let selected = migration_repository::get_mapping(db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to load import mapping"))?
            .ok_or_else(|| AppError::not_found("import mapping not found"))?;
        if selected.entity != entity
            || selected.source_provider != source_provider
            || selected.source_sheet != source_sheet
            || selected.header_fingerprint != header_fingerprint
            || selected.column_count != normalized_headers.len() as i32
        {
            return Err(AppError::conflict(
                "saved mapping schema drift detected; run Smart mapping and approve the changed format",
            ));
        }
    }
    let mut explicit = effective_mapping(db, tenant, branch, entity, mapping_id, overrides).await?;
    let profile = migration_repository::closest_mapping_profile(
        db,
        tenant,
        branch,
        entity,
        source_provider,
        source_sheet,
        &header_fingerprint,
    )
    .await
    .map_err(|_| AppError::internal("failed to match saved mapping profile"))?;
    let exact_profile = profile.as_ref().is_some_and(|saved| {
        !saved.header_fingerprint.is_empty()
            && saved.header_fingerprint == header_fingerprint
            && saved.column_count == normalized_headers.len() as i32
    });
    if mapping_id.is_none() && exact_profile {
        let mut saved = profile
            .as_ref()
            .map(|item| item.mapping.clone())
            .unwrap_or_default();
        saved.extend(explicit);
        explicit = saved;
    }
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
    if mapping_id.is_none() && profile.is_some() && !exact_profile {
        let previous = profile
            .as_ref()
            .map(|item| {
                item.normalized_headers
                    .iter()
                    .cloned()
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();
        let current = normalized_headers.iter().cloned().collect::<HashSet<_>>();
        let added = current.difference(&previous).cloned().collect::<Vec<_>>();
        require_schema_drift_approval(&mut resolution, &added);
    }
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
    use super::{
        enforce_three_layer_rows, previous_cutover_status, source_hash,
        validate_three_layer_posting_mode,
    };
    use crate::models::migration::{
        MigrationCutoverStatus, MigrationEntity, MigrationMode, MigrationProvider,
        PurchaseBillPostingMode, ThreeLayerPostingContract, THREE_LAYER_POSTING_CONTRACT_VERSION,
    };
    use chrono::NaiveDate;
    use serde_json::json;

    #[test]
    fn source_hash_is_stable_and_content_sensitive() {
        assert_eq!(source_hash("same"), source_hash("same"));
        assert_ne!(source_hash("same"), source_hash("different"));
        assert_eq!(source_hash("same").len(), 64);
    }

    #[test]
    fn cutover_lifecycle_has_no_skip_or_reverse_transition() {
        assert_eq!(previous_cutover_status(MigrationCutoverStatus::Draft), None);
        assert_eq!(
            previous_cutover_status(MigrationCutoverStatus::InventoryFrozen),
            Some(MigrationCutoverStatus::HistoryImporting)
        );
        assert_eq!(
            previous_cutover_status(MigrationCutoverStatus::Live),
            Some(MigrationCutoverStatus::Reconciled)
        );
    }

    #[test]
    fn three_layer_posting_contract_is_deterministic_and_fail_closed() {
        let cutover = NaiveDate::from_ymd_opt(2026, 7, 29).unwrap();
        let missing = validate_three_layer_posting_mode(
            MigrationEntity::PurchaseBills,
            None,
            MigrationMode::DryRun,
            Some("go-live-2026"),
            Some(cutover),
        )
        .unwrap_err();
        assert_eq!(missing.code(), "POSTING_MODE_REQUIRED");
        assert_eq!(
            validate_three_layer_posting_mode(
                MigrationEntity::PurchaseBills,
                Some(PurchaseBillPostingMode::HistoryOnly),
                MigrationMode::DryRun,
                Some("go-live-2026"),
                Some(cutover),
            )
            .unwrap()
            .unwrap()
            .0,
            PurchaseBillPostingMode::HistoryOnly
        );
        let commit = validate_three_layer_posting_mode(
            MigrationEntity::PurchaseBills,
            Some(PurchaseBillPostingMode::HistoryOnly),
            MigrationMode::Commit,
            Some("go-live-2026"),
            Some(cutover),
        )
        .unwrap()
        .unwrap();
        assert_eq!(commit.0, PurchaseBillPostingMode::HistoryOnly);
        assert_eq!(
            validate_three_layer_posting_mode(
                MigrationEntity::Inventory,
                Some(PurchaseBillPostingMode::OpeningSnapshot),
                MigrationMode::Commit,
                Some("go-live-2026"),
                Some(cutover),
            )
            .unwrap()
            .unwrap()
            .0,
            PurchaseBillPostingMode::OpeningSnapshot
        );
        assert_eq!(
            validate_three_layer_posting_mode(
                MigrationEntity::OpeningPayables,
                Some(PurchaseBillPostingMode::OpeningPayable),
                MigrationMode::Commit,
                Some("go-live-2026"),
                Some(cutover),
            )
            .unwrap()
            .unwrap()
            .0,
            PurchaseBillPostingMode::OpeningPayable
        );
        let contract = ThreeLayerPostingContract {
            contract_version: THREE_LAYER_POSTING_CONTRACT_VERSION.into(),
            tenant_id: "tenant-1".into(),
            branch_id: "branch-1".into(),
            provider: MigrationProvider::Csv,
            source_file: "purchases.csv".into(),
            source_file_id: None,
            source_checksum: source_hash("same"),
            entity: MigrationEntity::PurchaseBills,
            import_mode: MigrationMode::DryRun,
            posting_mode: PurchaseBillPostingMode::LiveReceipt,
            cutover_id: "go-live-2026".into(),
            cutover_date: cutover,
            mapping_version: 0,
            transformer_version: "v1".into(),
            imported_at: None,
            approved_by: None,
        };
        let mut historical = json!([{"source_row_number":2,"received_date":"2026-07-29"}]);
        assert_eq!(
            enforce_three_layer_rows(&contract, &mut historical)
                .unwrap_err()
                .code(),
            "HISTORICAL_ROW_LIVE_RECEIPT_FORBIDDEN"
        );
        let mut first = json!([{"source_row_number":2,"received_date":"2026-07-30"}]);
        let mut second = first.clone();
        enforce_three_layer_rows(&contract, &mut first).unwrap();
        enforce_three_layer_rows(&contract, &mut second).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            first[0]["posting_contract_decision"]["approvalRequired"],
            true
        );
        assert!(PurchaseBillPostingMode::try_from("unknown").is_err());
    }
}
