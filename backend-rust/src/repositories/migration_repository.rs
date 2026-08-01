use crate::{
    models::migration::{
        ClaimedImportJob, HistoricalPurchaseMappingDecision,
        HistoricalPurchaseMappingDecisionRequest, HistoricalPurchaseMappingKind, ImportJob,
        MigrationAlias, MigrationCutover, MigrationCutoverStatus, MigrationEntity,
        MigrationJobStatus, MigrationMapping, MigrationMappingApproval, MigrationMappingVersion,
        MigrationMode, MigrationProvider, MigrationRecoveryReport,
    },
    repositories::{clients_repository, staff_hr_repository},
    services::{
        accounting_service::{self, ManualJournalLine, RefundSettlement},
        membership_service,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::{collections::BTreeMap, io};

#[derive(Debug, FromRow)]
pub(crate) struct ImportJobRow {
    pub(crate) id: String,
    entity: String,
    file_name: String,
    mode: String,
    status: String,
    source_hash: Option<String>,
    source_row_count: i32,
    valid_row_count: i32,
    error_row_count: i32,
    warning_row_count: i32,
    duplicate_row_count: i32,
    errors_json: Value,
    mapping_json: Value,
    mapping_id: Option<String>,
    mapping_version: Option<i32>,
    mapping_header_fingerprint: String,
    transformer_versions_json: Value,
    analysis_json: Value,
    recovery_json: Value,
    total_rows: i32,
    processed_rows: i32,
    next_row: i32,
    last_error: String,
    source_file_id: Option<String>,
    chunk_size: i32,
    allow_partial_import: bool,
    worker_phase: String,
    worker_id: String,
    heartbeat_at: Option<DateTime<Utc>>,
    total_chunks: i32,
    completed_chunks: i32,
    failed_chunks: i32,
    owner_user_id: String,
    approval_status: String,
    approval_requested_at: Option<DateTime<Utc>>,
    approval_decided_at: Option<DateTime<Utc>>,
    approval_decided_by: Option<String>,
    approval_note: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    rolled_back_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct MigrationMappingRow {
    id: String,
    name: String,
    entity: String,
    mapping_json: Value,
    source_columns_json: Value,
    source_provider: String,
    source_sheet: String,
    normalized_headers_json: Value,
    header_fingerprint: String,
    column_count: i32,
    current_version: i32,
    transformer_versions_json: Value,
    approved_by: String,
    approved_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct MigrationMappingVersionRow {
    mapping_id: String,
    version: i32,
    entity: String,
    source_provider: String,
    source_sheet: String,
    source_columns_json: Value,
    normalized_headers_json: Value,
    header_fingerprint: String,
    column_count: i32,
    mapping_json: Value,
    transformer_versions_json: Value,
    approved_by: String,
    approved_at: DateTime<Utc>,
    change_kind: String,
    rolled_back_from_version: Option<i32>,
}

#[derive(Debug, FromRow)]
struct MigrationAliasRow {
    id: String,
    entity: String,
    source_provider: String,
    alias: String,
    target_field: String,
    created_by: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct MigrationMappingApprovalRow {
    id: String,
    entity: String,
    source_provider: String,
    rule_version: String,
    fingerprint: String,
    source_file_id: Option<String>,
    source_sheet: String,
    source_column: String,
    target_field: String,
    confidence_percentage: i16,
    decision_json: Value,
    approved_by: String,
    approved_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ClaimedImportJobRow {
    id: String,
    tenant_id: String,
    branch_id: String,
    entity: String,
    rows_json: Value,
    total_rows: i32,
    next_row: i32,
    created_by: String,
}

pub(crate) const COLUMNS: &str = "id,entity,file_name,mode,status,source_hash,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,errors_json,mapping_json,mapping_id,mapping_version,mapping_header_fingerprint,transformer_versions_json,analysis_json,recovery_json,total_rows,processed_rows,next_row,last_error,source_file_id,chunk_size,allow_partial_import,worker_phase,worker_id,heartbeat_at,total_chunks,completed_chunks,failed_chunks,owner_user_id,approval_status,approval_requested_at,approval_decided_at,approval_decided_by,approval_note,created_at,updated_at,completed_at,rolled_back_at";

#[derive(Debug, PartialEq, Eq)]
pub struct MigrationMonitoringCounts {
    pub status_counts: BTreeMap<String, i64>,
    pub queue_depth: i64,
    pub stale_workers: i64,
    pub failed_24h: i64,
    pub overdue_approvals: i64,
    pub dependency_deadlocks: i64,
}

pub async fn ensure_cutover_contract(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    cutover_id: &str,
    cutover_date: NaiveDate,
    contract_version: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        r#"INSERT INTO integration_migration_cutovers(
             tenant_id,branch_id,id,cutover_date,contract_version,created_by,
             business_timezone,cutover_at,historical_period_end,configured_by
           )
           SELECT $1::TEXT::UUID,$2::TEXT::UUID,$3,$4,$5,$6,'UTC',
                  $4::DATE::TIMESTAMP AT TIME ZONE 'UTC',
                  $4::DATE::TIMESTAMP AT TIME ZONE 'UTC',$6
           WHERE EXISTS(SELECT 1 FROM branches WHERE id::TEXT=$2 AND tenant_id::TEXT=$1)
           ON CONFLICT (tenant_id,branch_id,id) DO NOTHING"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .bind(cutover_date)
    .bind(contract_version)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    let matches = sqlx::query_scalar::<_, bool>(
        "SELECT cutover_date=$4 FROM integration_migration_cutovers WHERE tenant_id::TEXT=$1 AND branch_id::TEXT=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(cutover_id)
    .bind(cutover_date)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    tx.commit().await?;
    Ok(matches)
}

pub async fn cutover_timezone_matches_date(
    db: &PgPool,
    timezone: &str,
    cutover_at: DateTime<Utc>,
    cutover_date: NaiveDate,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)
           AND ($2::TIMESTAMPTZ AT TIME ZONE $1)::DATE=$3"#,
    )
    .bind(timezone)
    .bind(cutover_at)
    .bind(cutover_date)
    .fetch_one(db)
    .await
}

pub async fn save_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    actor_role: &str,
    id: &str,
    timezone: &str,
    cutover_date: NaiveDate,
    cutover_at: DateTime<Utc>,
    historical_period_end: DateTime<Utc>,
    contract_version: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT SET_CONFIG('aurashine.cutover_actor_id',$1,TRUE)")
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    sqlx::query("SELECT SET_CONFIG('aurashine.cutover_actor_role',$1,TRUE)")
        .bind(actor_role)
        .execute(&mut *tx)
        .await?;
    let saved = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO integration_migration_cutovers(
             tenant_id,branch_id,id,cutover_date,contract_version,created_by,
             business_timezone,cutover_at,historical_period_end,configured_by
           )
           SELECT $1::TEXT::UUID,$2::TEXT::UUID,$3,$4,$5,$6,$7,$8,$9,$6
           WHERE EXISTS(SELECT 1 FROM branches WHERE id::TEXT=$2 AND tenant_id::TEXT=$1)
           ON CONFLICT (tenant_id,branch_id,id) DO UPDATE SET
             business_timezone=EXCLUDED.business_timezone,
             cutover_at=EXCLUDED.cutover_at,
             historical_period_end=EXCLUDED.historical_period_end,
             configured_by=EXCLUDED.configured_by
           WHERE integration_migration_cutovers.status='draft'
             AND integration_migration_cutovers.cutover_date=EXCLUDED.cutover_date
           RETURNING id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(cutover_date)
    .bind(contract_version)
    .bind(actor)
    .bind(timezone)
    .bind(cutover_at)
    .bind(historical_period_end)
    .fetch_optional(&mut *tx)
    .await?
    .is_some();
    tx.commit().await?;
    Ok(saved)
}

pub async fn get_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: Option<&str>,
) -> Result<Option<MigrationCutover>, sqlx::Error> {
    let value = sqlx::query_scalar::<_, Value>(
        r#"SELECT JSONB_BUILD_OBJECT(
             'id',cutover.id,'tenantId',cutover.tenant_id::TEXT,'branchId',cutover.branch_id::TEXT,
             'businessTimezone',cutover.business_timezone,'cutoverDate',cutover.cutover_date,
             'cutoverAt',cutover.cutover_at,'historicalPeriodEnd',cutover.historical_period_end,
             'inventoryFreezeStart',cutover.inventory_freeze_start,'inventoryFreezeEnd',cutover.inventory_freeze_end,
             'snapshotChecksum',cutover.snapshot_checksum,'status',cutover.status,
             'approvedUsers',cutover.approved_users,'ownerApprovedBy',cutover.owner_approved_by,
             'ownerApprovedAt',cutover.owner_approved_at,'goLiveAt',cutover.go_live_at,
             'goLiveApprovedRole',cutover.go_live_approved_role,
             'goLiveApprovalNote',cutover.go_live_approval_note,
             'goLiveReconciliationVersion',cutover.go_live_reconciliation_version,
             'goLiveReconciliationChecksum',cutover.go_live_reconciliation_checksum,
             'goLiveReconciliation',cutover.go_live_reconciliation,
             'rollbackPolicy',cutover.rollback_policy_json,
             'rollbackState',cutover.rollback_state,'configuredBy',cutover.configured_by,
             'contractVersion',cutover.contract_version,'createdAt',cutover.created_at,'updatedAt',cutover.updated_at,
             'reconciliation',migration_cutover_full_reconciliation($1,$2,cutover.id),
             'transitions',COALESCE((
               SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                 'id',transition.id,'fromStatus',transition.from_status,'toStatus',transition.to_status,
                 'actorId',transition.actor_id,'actorRole',transition.actor_role,'note',transition.note,
                 'createdAt',transition.created_at
               ) ORDER BY transition.created_at,transition.id)
               FROM integration_migration_cutover_transitions transition
               WHERE transition.tenant_id=cutover.tenant_id AND transition.branch_id=cutover.branch_id
                 AND transition.cutover_id=cutover.id
             ),'[]'::JSONB)
           )
           FROM integration_migration_cutovers cutover
           WHERE cutover.tenant_id::TEXT=$1 AND cutover.branch_id::TEXT=$2
             AND ($3::TEXT IS NULL OR cutover.id=$3)
           ORDER BY (cutover.status<>'live' AND cutover.rollback_state<>'completed') DESC,
                    cutover.created_at DESC
           LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await?;
    value
        .map(|record| {
            serde_json::from_value(record).map_err(|error| sqlx::Error::Decode(Box::new(error)))
        })
        .transpose()
}

pub async fn transition_cutover(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    expected_status: MigrationCutoverStatus,
    target_status: MigrationCutoverStatus,
    snapshot_checksum: Option<&str>,
    observation_period_hours: Option<u16>,
    actor: &str,
    actor_role: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    for (key, value) in [
        ("aurashine.cutover_actor_id", actor),
        ("aurashine.cutover_actor_role", actor_role),
        ("aurashine.cutover_note", note),
    ] {
        sqlx::query("SELECT SET_CONFIG($1,$2,TRUE)")
            .bind(key)
            .bind(value)
            .execute(&mut *tx)
            .await?;
    }
    let transitioned = sqlx::query_scalar::<_, String>(
        r#"UPDATE integration_migration_cutovers cutover SET
             status=$5,
             snapshot_checksum=CASE WHEN $5='snapshot_approved' THEN COALESCE($6,'') ELSE snapshot_checksum END,
             inventory_freeze_start=CASE WHEN $5='inventory_frozen' THEN NOW() ELSE inventory_freeze_start END,
             inventory_freeze_end=CASE WHEN $5='live' THEN NOW() ELSE inventory_freeze_end END,
             go_live_at=CASE WHEN $5='live' THEN NOW() ELSE go_live_at END,
             owner_approved_by=CASE WHEN $5 IN ('inventory_frozen','snapshot_approved','live') THEN $7 ELSE owner_approved_by END,
             owner_approved_at=CASE WHEN $5 IN ('inventory_frozen','snapshot_approved','live') THEN NOW() ELSE owner_approved_at END,
             go_live_approved_role=CASE WHEN $5='live' THEN LOWER($9) ELSE go_live_approved_role END,
             go_live_approval_note=CASE WHEN $5='live' THEN $10 ELSE go_live_approval_note END,
             go_live_reconciliation_version=CASE WHEN $5='live' THEN '2026-07-phase7-v1' ELSE go_live_reconciliation_version END,
             go_live_reconciliation_checksum=CASE WHEN $5='live' THEN ENCODE(DIGEST(migration_cutover_full_reconciliation($1,$2,$3)::TEXT,'sha256'),'hex') ELSE go_live_reconciliation_checksum END,
             go_live_reconciliation=CASE WHEN $5='live' THEN migration_cutover_full_reconciliation($1,$2,$3) ELSE go_live_reconciliation END,
             rollback_policy_json=CASE WHEN $5='live' THEN JSONB_BUILD_OBJECT(
               'observationPeriodHours',$8,
               'decisionAuthorityUserId',$7,
               'decisionAuthorityRole',LOWER($9),
               'maximumAcceptableVariancePaise',0,
               'financialPeriodLockRequired',TRUE,
               'alertRoles',JSONB_BUILD_ARRAY('owner','inventory_manager','finance'),
               'recoverySequence',JSONB_BUILD_ARRAY(
                 'stop_live_grn_and_pos','reverse_opening_payables','compensate_opening_stock',
                 'preserve_post_cutover_transactions','retain_historical_evidence','generate_recovery_report'
               ),
               'approvedAt',NOW()
             ) ELSE rollback_policy_json END,
             approved_users=CASE WHEN approved_users ? $7 THEN approved_users ELSE approved_users || TO_JSONB($7::TEXT) END
           WHERE cutover.tenant_id::TEXT=$1 AND cutover.branch_id::TEXT=$2 AND cutover.id=$3
             AND cutover.status=$4
             AND ($5 NOT IN ('snapshot_applied','reconciled') OR EXISTS(
               SELECT 1 FROM integration_import_jobs job
               WHERE job.tenant_id=$1::TEXT AND job.branch_id=$2::TEXT AND job.status='completed'
                 AND job.rolled_back_at IS NULL AND job.error_row_count=0
                 AND job.processed_rows=job.valid_row_count
                 AND job.analysis_json->'postingContract'->>'cutoverId'=$3
                 AND job.analysis_json->'postingContract'->>'postingMode'='opening_snapshot'
             ))
           RETURNING cutover.id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(expected_status.as_str())
    .bind(target_status.as_str())
    .bind(snapshot_checksum)
    .bind(actor)
    .bind(observation_period_hours.map(i32::from))
    .bind(actor_role)
    .bind(note)
    .fetch_optional(&mut *tx)
    .await?
    .is_some();
    tx.commit().await?;
    Ok(transitioned)
}

pub async fn create_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    file: &str,
    mode: MigrationMode,
    status: MigrationJobStatus,
    source_hash: &str,
    source_row_count: i32,
    rows: &Value,
    errors: &Value,
    row_results: &Value,
    mapping_id: Option<&str>,
    mapping: &Value,
    analysis: &Value,
    warning_row_count: i32,
    duplicate_row_count: i32,
    actor: &str,
) -> Result<ImportJob, sqlx::Error> {
    let valid_row_count = rows.as_array().map_or(0, |items| items.len() as i32);
    let error_row_count = errors.as_array().map_or(0, |items| items.len() as i32);
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ImportJobRow>(&format!(
        "INSERT INTO integration_import_jobs(tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,rows_json,errors_json,total_rows,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,mapping_id,mapping_json,analysis_json,created_by,owner_user_id,approval_status,approval_requested_at,approval_decided_at,approval_decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,'csv',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,CASE WHEN $5='commit' AND $6 IN ('validated','dependency_pending') THEN 'pending' WHEN $5='commit' THEN 'approved' ELSE 'not_required' END,CASE WHEN $5='commit' THEN NOW() ELSE NULL END,CASE WHEN $5='commit' AND $6 NOT IN ('validated','dependency_pending') THEN NOW() ELSE NULL END,CASE WHEN $5='commit' AND $6 NOT IN ('validated','dependency_pending') THEN $19 ELSE NULL END) RETURNING {COLUMNS}"
    ))
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(file)
    .bind(mode.as_str())
    .bind(status.as_str())
    .bind(source_hash)
    .bind(rows)
    .bind(errors)
    .bind(valid_row_count)
    .bind(source_row_count)
    .bind(valid_row_count)
    .bind(error_row_count)
    .bind(warning_row_count)
    .bind(duplicate_row_count)
    .bind(mapping_id)
    .bind(mapping)
    .bind(analysis)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;

    if mapping_id.is_some() {
        sqlx::query(
            r#"UPDATE integration_import_jobs job SET
                 mapping_version=profile.current_version,
                 mapping_header_fingerprint=profile.header_fingerprint,
                 transformer_versions_json=profile.transformer_versions_json
               FROM integration_import_mappings profile
               WHERE job.id=$1 AND profile.id=job.mapping_id
                 AND profile.tenant_id=job.tenant_id AND profile.branch_id=job.branch_id"#,
        )
        .bind(&row.id)
        .execute(&mut *tx)
        .await?;
    }

    if !row_results.as_array().is_none_or(Vec::is_empty) {
        sqlx::query(
            r#"
            INSERT INTO integration_import_row_results(
              tenant_id,branch_id,job_id,entity,source_sheet,source_row_number,
              source_external_id,status,error_code,message,warnings_json,
              duplicate_target_id,duplicate_decision,source_payload,retry_eligible,quarantined_at
            )
            SELECT $1,$2,$3,$4,'csv',result.source_row_number,
                   NULLIF(result.source_external_id,''),CASE WHEN result.status='error' THEN 'quarantined' WHEN result.status='warning' THEN 'approval_required' ELSE result.status END,
                   result.error_code,result.message,result.warnings,
                   NULLIF(result.duplicate_target_id,''),result.duplicate_decision,
                   result.source_payload,result.status='error',CASE WHEN result.status='error' THEN NOW() ELSE NULL END
            FROM jsonb_to_recordset($5::JSONB) AS result(
              source_row_number INTEGER,
              source_external_id TEXT,
              status TEXT,
              error_code TEXT,
              message TEXT,
              warnings JSONB,
              duplicate_target_id TEXT,
              duplicate_decision TEXT,
              source_payload JSONB
            )
            "#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(&row.id)
        .bind(entity.as_str())
        .bind(row_results)
        .execute(&mut *tx)
        .await?;
    }

    if mode == MigrationMode::Commit {
        sync_job_dependencies(&mut tx, tenant, branch, &row.id, entity, source_hash).await?;
    }

    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(&row.id),
        None,
        "migration.job.created",
        "success",
        actor,
        json!({
            "entity": entity,
            "mode": mode,
            "sourceHash": source_hash,
            "sourceRows": source_row_count,
            "validRows": valid_row_count,
            "errorRows": error_row_count
            ,"warningRows": warning_row_count
            ,"duplicateRows": duplicate_row_count
        }),
    )
    .await?;
    tx.commit().await?;
    into_import_job(row)
}

pub async fn save_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    name: &str,
    mapping: &Value,
    source_columns: &Value,
    source_provider: MigrationProvider,
    source_sheet: &str,
    normalized_headers: &Value,
    header_fingerprint: &str,
    transformer_versions: &Value,
    actor: &str,
) -> Result<MigrationMapping, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, MigrationMappingRow>(
        r#"INSERT INTO integration_import_mappings(
             tenant_id,branch_id,entity,name,mapping_json,source_columns_json,created_by,
             source_provider,source_sheet,normalized_headers_json,header_fingerprint,column_count,
             transformer_versions_json,approved_by,approved_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$7,NOW())
           ON CONFLICT(tenant_id,branch_id,entity,(LOWER(name))) DO UPDATE SET
             mapping_json=EXCLUDED.mapping_json,source_columns_json=EXCLUDED.source_columns_json,
             source_provider=EXCLUDED.source_provider,source_sheet=EXCLUDED.source_sheet,
             normalized_headers_json=EXCLUDED.normalized_headers_json,
             header_fingerprint=EXCLUDED.header_fingerprint,column_count=EXCLUDED.column_count,
             transformer_versions_json=EXCLUDED.transformer_versions_json,
             current_version=integration_import_mappings.current_version+1,
             created_by=EXCLUDED.created_by,approved_by=EXCLUDED.approved_by,
             approved_at=NOW(),updated_at=NOW()
           RETURNING id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,
             normalized_headers_json,header_fingerprint,column_count,current_version,
             transformer_versions_json,approved_by,approved_at,created_at,updated_at"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(name)
    .bind(mapping)
    .bind(source_columns)
    .bind(actor)
    .bind(source_provider.as_str())
    .bind(source_sheet)
    .bind(normalized_headers)
    .bind(header_fingerprint)
    .bind(
        normalized_headers
            .as_array()
            .map_or(0, |headers| headers.len() as i32),
    )
    .bind(transformer_versions)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO integration_import_mapping_versions(
             tenant_id,branch_id,mapping_id,version,entity,source_provider,source_sheet,
             source_columns_json,normalized_headers_json,header_fingerprint,column_count,
             mapping_json,transformer_versions_json,approved_by,approved_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(&row.id)
    .bind(row.current_version)
    .bind(&row.entity)
    .bind(&row.source_provider)
    .bind(&row.source_sheet)
    .bind(&row.source_columns_json)
    .bind(&row.normalized_headers_json)
    .bind(&row.header_fingerprint)
    .bind(row.column_count)
    .bind(&row.mapping_json)
    .bind(&row.transformer_versions_json)
    .bind(&row.approved_by)
    .bind(row.approved_at)
    .execute(&mut *tx)
    .await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        None,
        None,
        "migration.mapping.profile_approved",
        "success",
        actor,
        json!({"mappingId":row.id,"version":row.current_version,"headerFingerprint":row.header_fingerprint,"sourceProvider":row.source_provider,"sourceSheet":row.source_sheet}),
    )
    .await?;
    tx.commit().await?;
    into_mapping(row)
}

pub async fn list_mappings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<MigrationMapping>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MigrationMappingRow>(
        "SELECT id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,normalized_headers_json,header_fingerprint,column_count,current_version,transformer_versions_json,approved_by,COALESCE(approved_at,updated_at) AS approved_at,created_at,updated_at FROM integration_import_mappings WHERE tenant_id=$1 AND branch_id=$2 ORDER BY updated_at DESC LIMIT 200",
    )
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await?;
    rows.into_iter().map(into_mapping).collect()
}

pub async fn get_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<MigrationMapping>, sqlx::Error> {
    let row = sqlx::query_as::<_, MigrationMappingRow>(
        "SELECT id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,normalized_headers_json,header_fingerprint,column_count,current_version,transformer_versions_json,approved_by,COALESCE(approved_at,updated_at) AS approved_at,created_at,updated_at FROM integration_import_mappings WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await?;
    row.map(into_mapping).transpose()
}

pub async fn closest_mapping_profile(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    source_sheet: &str,
    header_fingerprint: &str,
) -> Result<Option<MigrationMapping>, sqlx::Error> {
    let row = sqlx::query_as::<_, MigrationMappingRow>(
        r#"SELECT id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,
                  normalized_headers_json,header_fingerprint,column_count,current_version,
                  transformer_versions_json,approved_by,COALESCE(approved_at,updated_at) AS approved_at,
                  created_at,updated_at
           FROM integration_import_mappings
           WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3 AND source_provider=$4 AND source_sheet=$5
           ORDER BY (header_fingerprint=$6) DESC, updated_at DESC LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(source_provider.as_str())
    .bind(source_sheet)
    .bind(header_fingerprint)
    .fetch_optional(db)
    .await?;
    row.map(into_mapping).transpose()
}

pub async fn list_mapping_versions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    mapping_id: &str,
) -> Result<Vec<MigrationMappingVersion>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MigrationMappingVersionRow>(
        r#"SELECT mapping_id,version,entity,source_provider,source_sheet,source_columns_json,
                  normalized_headers_json,header_fingerprint,column_count,mapping_json,
                  transformer_versions_json,approved_by,approved_at,change_kind,rolled_back_from_version
           FROM integration_import_mapping_versions
           WHERE tenant_id=$1 AND branch_id=$2 AND mapping_id=$3 ORDER BY version DESC"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(mapping_id)
    .fetch_all(db)
    .await?;
    rows.into_iter().map(into_mapping_version).collect()
}

pub async fn rollback_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    mapping_id: &str,
    target_version: i32,
    actor: &str,
) -> Result<Option<MigrationMapping>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current = sqlx::query_as::<_, MigrationMappingRow>(
        "SELECT id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,normalized_headers_json,header_fingerprint,column_count,current_version,transformer_versions_json,approved_by,COALESCE(approved_at,updated_at) AS approved_at,created_at,updated_at FROM integration_import_mappings WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(mapping_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(current) = current else {
        return Ok(None);
    };
    let target = sqlx::query_as::<_, MigrationMappingVersionRow>(
        "SELECT mapping_id,version,entity,source_provider,source_sheet,source_columns_json,normalized_headers_json,header_fingerprint,column_count,mapping_json,transformer_versions_json,approved_by,approved_at,change_kind,rolled_back_from_version FROM integration_import_mapping_versions WHERE tenant_id=$1 AND branch_id=$2 AND mapping_id=$3 AND version=$4",
    )
    .bind(tenant)
    .bind(branch)
    .bind(mapping_id)
    .bind(target_version)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(target) = target else {
        return Ok(None);
    };
    let next_version = current.current_version + 1;
    let row = sqlx::query_as::<_, MigrationMappingRow>(
        r#"UPDATE integration_import_mappings SET mapping_json=$4,source_columns_json=$5,
                  source_provider=$6,source_sheet=$7,normalized_headers_json=$8,header_fingerprint=$9,
                  column_count=$10,current_version=$11,transformer_versions_json=$12,
                  approved_by=$13,approved_at=NOW(),updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           RETURNING id,name,entity,mapping_json,source_columns_json,source_provider,source_sheet,
             normalized_headers_json,header_fingerprint,column_count,current_version,
             transformer_versions_json,approved_by,approved_at,created_at,updated_at"#,
    )
    .bind(tenant).bind(branch).bind(mapping_id).bind(&target.mapping_json)
    .bind(&target.source_columns_json).bind(&target.source_provider).bind(&target.source_sheet)
    .bind(&target.normalized_headers_json).bind(&target.header_fingerprint).bind(target.column_count)
    .bind(next_version).bind(&target.transformer_versions_json).bind(actor)
    .fetch_one(&mut *tx).await?;
    sqlx::query(
        r#"INSERT INTO integration_import_mapping_versions(
             tenant_id,branch_id,mapping_id,version,entity,source_provider,source_sheet,
             source_columns_json,normalized_headers_json,header_fingerprint,column_count,mapping_json,
             transformer_versions_json,approved_by,approved_at,change_kind,rolled_back_from_version
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),'rollback',$15)"#,
    )
    .bind(tenant).bind(branch).bind(mapping_id).bind(next_version).bind(&target.entity)
    .bind(&target.source_provider).bind(&target.source_sheet).bind(&target.source_columns_json)
    .bind(&target.normalized_headers_json).bind(&target.header_fingerprint).bind(target.column_count)
    .bind(&target.mapping_json).bind(&target.transformer_versions_json).bind(actor)
    .bind(current.current_version).execute(&mut *tx).await?;
    insert_audit(&mut tx,tenant,branch,None,None,"migration.mapping.profile_rolled_back","success",actor,
        json!({"mappingId":mapping_id,"targetVersion":target_version,"newVersion":next_version,"rolledBackFromVersion":current.current_version})).await?;
    tx.commit().await?;
    into_mapping(row).map(Some)
}

pub async fn save_alias(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    alias: &str,
    target_field: &str,
    actor: &str,
) -> Result<MigrationAlias, sqlx::Error> {
    let row = sqlx::query_as::<_, MigrationAliasRow>(
        r#"INSERT INTO integration_import_aliases(
             tenant_id,branch_id,entity,source_provider,alias,target_field,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(tenant_id,branch_id,entity,source_provider,(LOWER(alias))) DO UPDATE SET
             target_field=EXCLUDED.target_field,created_by=EXCLUDED.created_by,updated_at=NOW()
           RETURNING id,entity,source_provider,alias,target_field,created_by,created_at,updated_at"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(source_provider.as_str())
    .bind(alias)
    .bind(target_field)
    .bind(actor)
    .fetch_one(db)
    .await?;
    into_alias(row)
}

pub async fn list_aliases(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: Option<MigrationEntity>,
) -> Result<Vec<MigrationAlias>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MigrationAliasRow>(
        "SELECT id,entity,source_provider,alias,target_field,created_by,created_at,updated_at FROM integration_import_aliases WHERE tenant_id=$1 AND branch_id=$2 AND ($3::TEXT IS NULL OR entity=$3) ORDER BY entity,LOWER(alias),source_provider",
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.map(MigrationEntity::as_str))
    .fetch_all(db)
    .await?;
    rows.into_iter().map(into_alias).collect()
}

#[allow(clippy::too_many_arguments)]
pub async fn approve_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    rule_version: &str,
    fingerprint: &str,
    source_file_id: Option<&str>,
    source_sheet: &str,
    source_column: &str,
    target_field: &str,
    confidence_percentage: u8,
    decision: &Value,
    actor: &str,
) -> Result<MigrationMappingApproval, sqlx::Error> {
    let mut tx = db.begin().await?;
    let inserted = sqlx::query_as::<_, MigrationMappingApprovalRow>(
        r#"INSERT INTO integration_import_mapping_approvals(
             tenant_id,branch_id,entity,source_provider,rule_version,fingerprint,
             source_file_id,source_sheet,source_column,target_field,
             confidence_percentage,decision_json,approved_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT(tenant_id,branch_id,fingerprint,source_column,target_field) DO NOTHING
           RETURNING id,entity,source_provider,rule_version,fingerprint,source_file_id,
             source_sheet,source_column,target_field,confidence_percentage,decision_json,
             approved_by,approved_at"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(source_provider.as_str())
    .bind(rule_version)
    .bind(fingerprint)
    .bind(source_file_id)
    .bind(source_sheet)
    .bind(source_column)
    .bind(target_field)
    .bind(i16::from(confidence_percentage))
    .bind(decision)
    .bind(actor)
    .fetch_optional(&mut *tx)
    .await?;
    let created = inserted.is_some();
    let row = if let Some(row) = inserted {
        row
    } else {
        sqlx::query_as::<_, MigrationMappingApprovalRow>(
            "SELECT id,entity,source_provider,rule_version,fingerprint,source_file_id,source_sheet,source_column,target_field,confidence_percentage,decision_json,approved_by,approved_at FROM integration_import_mapping_approvals WHERE tenant_id=$1 AND branch_id=$2 AND fingerprint=$3 AND source_column=$4 AND target_field=$5",
        )
        .bind(tenant)
        .bind(branch)
        .bind(fingerprint)
        .bind(source_column)
        .bind(target_field)
        .fetch_one(&mut *tx)
        .await?
    };
    if created {
        insert_audit(
            &mut tx,
            tenant,
            branch,
            None,
            None,
            "migration.mapping.yellow_approved",
            "success",
            actor,
            json!({
                "approvalId":row.id,
                "entity":entity.as_str(),
                "sourceProvider":source_provider.as_str(),
                "ruleVersion":rule_version,
                "fingerprint":fingerprint,
                "sourceFileId":source_file_id,
                "sourceSheet":source_sheet,
                "sourceColumn":source_column,
                "targetField":target_field,
                "confidencePercentage":confidence_percentage
            }),
        )
        .await?;
    }
    tx.commit().await?;
    into_mapping_approval(row)
}

pub async fn list_mapping_approvals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    fingerprint: &str,
) -> Result<Vec<MigrationMappingApproval>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MigrationMappingApprovalRow>(
        "SELECT id,entity,source_provider,rule_version,fingerprint,source_file_id,source_sheet,source_column,target_field,confidence_percentage,decision_json,approved_by,approved_at FROM integration_import_mapping_approvals WHERE tenant_id=$1 AND branch_id=$2 AND fingerprint=$3 ORDER BY source_column,target_field,approved_at",
    )
    .bind(tenant)
    .bind(branch)
    .bind(fingerprint)
    .fetch_all(db)
    .await?;
    rows.into_iter().map(into_mapping_approval).collect()
}

pub async fn find_client_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    normalized_phone: &str,
    email: &str,
    external_id: &str,
) -> Result<Option<(String, Value)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,TO_JSONB(client) FROM clients client
            WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id IS NULL AND (
              (NULLIF($3,'') IS NOT NULL AND normalized_phone=$3) OR
              (NULLIF($4,'') IS NOT NULL AND LOWER(BTRIM(email))=LOWER(BTRIM($4))) OR
              id=(SELECT result.target_id FROM integration_import_row_results result
                   WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.entity='clients'
                     AND result.source_external_id=$5 AND result.target_id IS NOT NULL
                     AND result.status IN ('created','merged','linked','kept')
                   ORDER BY result.updated_at DESC LIMIT 1)
            ) ORDER BY created_at,id LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(normalized_phone)
    .bind(email)
    .bind(external_id)
    .fetch_optional(db)
    .await
}

pub async fn find_product_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sku: &str,
    barcode: &str,
) -> Result<Option<(String, Value)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,TO_JSONB(record) FROM inventory_items record
            WHERE tenant_id=$1 AND branch_id=$2 AND (
              (NULLIF($3,'') IS NOT NULL AND LOWER(BTRIM(sku))=LOWER(BTRIM($3))) OR
              (NULLIF($4,'') IS NOT NULL AND LOWER(BTRIM(barcode))=LOWER(BTRIM($4)))
            ) ORDER BY created_at,id LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(sku)
    .bind(barcode)
    .fetch_optional(db)
    .await
}

pub async fn find_imported_external_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    external_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    if external_id.trim().is_empty() {
        return Ok(None);
    }
    sqlx::query_scalar(
        "SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3 AND source_external_id=$4 AND target_id IS NOT NULL AND status IN ('created','merged','linked','kept') ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(external_id)
    .fetch_optional(db)
    .await
}

pub async fn find_staff_duplicate(
    db: &PgPool,
    tenant: &str,
    employee_code: &str,
) -> Result<Option<(String, String, Value)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,branch_id,TO_JSONB(staff) FROM staff staff WHERE tenant_id=$1 AND LOWER(employee_code)=LOWER($2) ORDER BY created_at,id LIMIT 1",
    )
    .bind(tenant)
    .bind(employee_code)
    .fetch_optional(db)
    .await
}

pub async fn find_master_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    key: &str,
) -> Result<Option<(String, Value)>, sqlx::Error> {
    let sql = match entity {
        MigrationEntity::Services => {
            "SELECT id,TO_JSONB(record) FROM services record WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(name))=LOWER(BTRIM($3)) ORDER BY created_at,id LIMIT 1"
        }
        MigrationEntity::Products => {
            "SELECT id,TO_JSONB(record) FROM inventory_items record WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(sku))=LOWER(BTRIM($3)) ORDER BY created_at,id LIMIT 1"
        }
        MigrationEntity::Suppliers => {
            "SELECT id,TO_JSONB(record) FROM suppliers record WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(code))=LOWER(BTRIM($3)) ORDER BY created_at,id LIMIT 1"
        }
        MigrationEntity::Memberships => {
            "SELECT id,TO_JSONB(record) FROM memberships record WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(code))=LOWER(BTRIM($3)) ORDER BY created_at,id LIMIT 1"
        }
        MigrationEntity::Packages => {
            "SELECT id,TO_JSONB(record) FROM packages record WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(name))=LOWER(BTRIM($3)) ORDER BY created_at,id LIMIT 1"
        }
        _ => return Ok(None),
    };
    sqlx::query_as(sql)
        .bind(tenant)
        .bind(branch)
        .bind(key)
        .fetch_optional(db)
        .await
}

pub async fn resolve_inventory_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    reference: &str,
) -> Result<Option<(String, i64)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT item.id,item.unit_cost_paise
             FROM inventory_items item
            WHERE item.tenant_id=$1 AND item.branch_id=$2 AND (
              item.id=$3 OR LOWER(BTRIM(item.sku))=LOWER(BTRIM($3)) OR
              LOWER(BTRIM(item.name))=LOWER(BTRIM($3)) OR item.id=(
                SELECT result.target_id FROM integration_import_row_results result
                 WHERE result.tenant_id=$1 AND result.branch_id=$2
                   AND result.entity='products' AND result.source_external_id=$3
                   AND result.target_id IS NOT NULL AND result.status IN ('created','merged','linked','kept')
                 ORDER BY result.updated_at DESC LIMIT 1
              )
            ) ORDER BY item.created_at,item.id LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(reference)
    .fetch_optional(db)
    .await
}

pub async fn resolve_inventory_snapshot_product(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    reference: &str,
) -> Result<Option<(String, i64, String, String, i32, bool)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT item.id,item.unit_cost_paise,item.unit,item.package_unit,item.units_per_package,item.batch_tracked
             FROM inventory_items item
            WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active=TRUE AND (
              item.id=$3 OR LOWER(BTRIM(item.sku))=LOWER(BTRIM($3)) OR
              LOWER(BTRIM(item.barcode))=LOWER(BTRIM($3)) OR
              LOWER(BTRIM(item.name))=LOWER(BTRIM($3)) OR item.id=(
                SELECT result.target_id FROM integration_import_row_results result
                 WHERE result.tenant_id=$1 AND result.branch_id=$2
                   AND result.entity='products' AND result.source_external_id=$3
                   AND result.target_id IS NOT NULL AND result.status IN ('created','merged','linked','kept')
                 ORDER BY result.updated_at DESC LIMIT 1
              )
            ) ORDER BY item.created_at,item.id LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(reference)
    .fetch_optional(db)
    .await
}

pub async fn opening_stock_location_exists(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    location: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM inventory_location_stock
              WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(location_code))=LOWER(BTRIM($3))
             UNION ALL
             SELECT 1 FROM inventory_barcode_aliases
              WHERE tenant_id=$1 AND branch_id=$2 AND alias_type='location' AND active=TRUE
                AND (LOWER(BTRIM(code))=LOWER(BTRIM($3))
                  OR LOWER(BTRIM(target_id))=LOWER(BTRIM($3)))
           )"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(location)
    .fetch_one(db)
    .await
}

pub async fn opening_stock_counter_exists(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND id=$3 AND active=TRUE AND (branch_id IS NULL OR branch_id=$2))",
    )
    .bind(tenant)
    .bind(branch)
    .bind(user_id)
    .fetch_one(db)
    .await
}

pub async fn historical_inventory_cost_suggestions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    inventory_item_id: &str,
    stock_unit: &str,
) -> Result<(Option<i64>, Option<i64>), sqlx::Error> {
    sqlx::query_as(
        r#"WITH evidence AS (
             SELECT line.unit_cost_paise,line.purchased_quantity,bill.invoice_date,
                    line.source_row_number,line.id
               FROM historical_purchase_bill_lines line
               JOIN historical_purchase_bills bill ON bill.id=line.historical_bill_id
              WHERE line.tenant_id=$1 AND line.branch_id=$2
                AND line.mapped_inventory_item_id=$3
                AND REGEXP_REPLACE(LOWER(BTRIM(line.stock_unit)),'[^a-z0-9]+','','g')
                    =REGEXP_REPLACE(LOWER(BTRIM($4)),'[^a-z0-9]+','','g')
                AND line.purchased_quantity>0 AND line.unit_cost_paise>=0
                AND bill.document_type='invoice'
           )
           SELECT
             (SELECT unit_cost_paise FROM evidence
               ORDER BY invoice_date DESC,source_row_number DESC,id DESC LIMIT 1),
             (SELECT ROUND(SUM(unit_cost_paise::NUMERIC*purchased_quantity::NUMERIC)
                    /NULLIF(SUM(purchased_quantity::NUMERIC),0))::BIGINT FROM evidence)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(inventory_item_id)
    .bind(stock_unit)
    .fetch_one(db)
    .await
}

pub async fn resolve_service(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    reference: &str,
) -> Result<Option<(String, i64)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT service.id,service.price_paise::BIGINT
             FROM services service
            WHERE service.tenant_id=$1 AND service.branch_id=$2 AND (
              service.id=$3 OR LOWER(BTRIM(service.name))=LOWER(BTRIM($3)) OR service.id=(
                SELECT result.target_id FROM integration_import_row_results result
                 WHERE result.tenant_id=$1 AND result.branch_id=$2
                   AND result.entity='services' AND result.source_external_id=$3
                   AND result.target_id IS NOT NULL AND result.status IN ('created','merged','linked','kept')
                 ORDER BY result.updated_at DESC LIMIT 1
              )
            ) ORDER BY service.created_at,service.id LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(reference)
    .fetch_optional(db)
    .await
}

pub async fn resolve_migration_reference(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    reference: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mapped: Option<String> = sqlx::query_scalar(
        r#"SELECT target_id FROM integration_import_row_results
            WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3
              AND source_external_id=$4 AND target_id IS NOT NULL
              AND status IN ('created','merged','linked','kept')
            ORDER BY updated_at DESC LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(reference)
    .fetch_optional(db)
    .await?;
    if mapped.is_some() {
        return Ok(mapped);
    }
    match entity {
        MigrationEntity::Clients => sqlx::query_scalar(
            "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR LOWER(BTRIM(code))=LOWER(BTRIM($3)) OR normalized_phone=$3) AND merged_into_client_id IS NULL ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(reference).fetch_optional(db).await,
        MigrationEntity::Staff => sqlx::query_scalar(
            "SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR LOWER(BTRIM(employee_code))=LOWER(BTRIM($3)) OR LOWER(BTRIM(CONCAT_WS(' ',first_name,last_name)))=LOWER(BTRIM($3))) ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(reference).fetch_optional(db).await,
        MigrationEntity::Services => Ok(resolve_service(db, tenant, branch, reference).await?.map(|row| row.0)),
        MigrationEntity::Products => Ok(resolve_inventory_item(db, tenant, branch, reference).await?.map(|row| row.0)),
        MigrationEntity::Sales | MigrationEntity::Invoices => sqlx::query_scalar(
            "SELECT id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR invoice_number=$3 OR (source='migration' AND reference_id=$3)) ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(reference).fetch_optional(db).await,
        MigrationEntity::Appointments => sqlx::query_scalar(
            "SELECT id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR (source='migration' AND booking_group_id=$3)) ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(reference).fetch_optional(db).await,
        _ => Ok(None),
    }
}

pub async fn resolve_sale_line(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sale_id: &str,
    reference: &str,
) -> Result<Option<(String, String, String)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,line_type,item_id FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND (id=$4 OR item_id=$4 OR LOWER(BTRIM(item_name))=LOWER(BTRIM($4))) ORDER BY created_at,id LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_id)
    .bind(reference)
    .fetch_optional(db)
    .await
}

pub async fn refundable_payment_balance(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sale_id: &str,
    method: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT SUM(payment.amount_paise-COALESCE((
               SELECT SUM(allocation.amount_paise)
               FROM pos_refund_payment_allocations allocation
               WHERE allocation.tenant_id=$1 AND allocation.branch_id=$2
                 AND allocation.pos_payment_id=payment.id
             ),0))::BIGINT
           FROM pos_payments payment
           WHERE payment.tenant_id=$1 AND payment.branch_id=$2
             AND payment.sale_id=$3 AND LOWER(payment.method)=LOWER($4)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_id)
    .bind(method)
    .fetch_one(db)
    .await
}

pub async fn commission_split_total(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sale_line_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(split_bps),0)::BIGINT FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND sale_line_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_line_id)
    .fetch_one(db)
    .await
}

pub async fn inventory_stock_quantity(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    inventory_item_id: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT stock_quantity::BIGINT FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(inventory_item_id)
    .fetch_optional(db)
    .await
}

pub async fn find_extended_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    key: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mapped: Option<String> = sqlx::query_scalar(
        "SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3 AND source_external_id=$4 AND target_id IS NOT NULL AND status IN ('created','merged','linked','kept') ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(key)
    .fetch_optional(db)
    .await?;
    if mapped.is_some() {
        return Ok(mapped);
    }
    match entity {
        MigrationEntity::Refunds => sqlx::query_scalar(
            "SELECT id FROM pos_invoice_refunds WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 LIMIT 1",
        ).bind(tenant).bind(branch).bind(format!("migration:{key}")).fetch_optional(db).await,
        MigrationEntity::GiftCards => sqlx::query_scalar(
            "SELECT id FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(code)=LOWER($3) LIMIT 1",
        ).bind(tenant).bind(branch).bind(key).fetch_optional(db).await,
        MigrationEntity::Loyalty => sqlx::query_scalar(
            "SELECT id FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 LIMIT 1",
        ).bind(tenant).bind(branch).bind(format!("migration:{key}")).fetch_optional(db).await,
        MigrationEntity::Payroll => {
            let (period, staff) = key.split_once(':').unwrap_or(("", ""));
            sqlx::query_scalar("SELECT item.id FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND run.period_start=$3::DATE AND item.staff_id=$4 LIMIT 1")
                .bind(tenant).bind(branch).bind(period).bind(staff).fetch_optional(db).await
        }
        MigrationEntity::StockMovements => sqlx::query_scalar(
            "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND adjustment_idempotency_key=$3 LIMIT 1",
        ).bind(tenant).bind(branch).bind(format!("migration:{key}")).fetch_optional(db).await,
        MigrationEntity::OpeningPayables => sqlx::query_scalar(
            "SELECT line.id FROM supplier_opening_payables line JOIN supplier_opening_payable_imports import ON import.id=line.opening_import_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND LOWER(line.external_id)=LOWER($3) AND import.rolled_back_at IS NULL LIMIT 1",
        ).bind(tenant).bind(branch).bind(key).fetch_optional(db).await,
        _ => Ok(None),
    }
}

pub async fn find_client_membership_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    external_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND migration_source_id=$3 ORDER BY assigned_at LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(external_id)
    .fetch_optional(db)
    .await
}

pub async fn resolve_membership(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    reference: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR LOWER(BTRIM(code))=LOWER(BTRIM($3)) OR LOWER(BTRIM(name))=LOWER(BTRIM($3))) ORDER BY created_at,id LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(reference)
    .fetch_optional(db)
    .await
}

pub async fn find_transaction_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    external_id: &str,
    business_key: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mapped: Option<String> = sqlx::query_scalar(
        "SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3 AND source_external_id=$4 AND target_id IS NOT NULL AND status IN ('created','merged','linked','kept') ORDER BY updated_at DESC LIMIT 1",
    ).bind(tenant).bind(branch).bind(entity.as_str()).bind(external_id).fetch_optional(db).await?;
    if mapped.is_some() {
        return Ok(mapped);
    }
    match entity {
        MigrationEntity::Sales | MigrationEntity::Invoices => sqlx::query_scalar(
            "SELECT id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND (invoice_number=$3 OR (source='migration' AND reference_id=$4)) ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(business_key).bind(external_id).fetch_optional(db).await,
        MigrationEntity::Payments => sqlx::query_scalar(
            "SELECT id FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND method_reference=$3 ORDER BY created_at LIMIT 1",
        ).bind(tenant).bind(branch).bind(business_key).fetch_optional(db).await,
        MigrationEntity::Expenses => sqlx::query_scalar(
            "SELECT id FROM outgoing_fund_vouchers WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3 LIMIT 1",
        ).bind(tenant).bind(branch).bind(format!("migration:{external_id}")).fetch_optional(db).await,
        MigrationEntity::PurchaseBills => {
            let (gstin, invoice) = business_key.split_once(':').unwrap_or(("", business_key));
            sqlx::query_scalar(
                "SELECT id FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND supplier_gstin=$3 AND supplier_invoice_number=$4 AND rolled_back_at IS NULL LIMIT 1",
            ).bind(tenant).bind(branch).bind(gstin).bind(invoice).fetch_optional(db).await
        }
        MigrationEntity::Appointments => sqlx::query_scalar(
            "SELECT id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND source='migration' AND booking_group_id=$3 LIMIT 1",
        ).bind(tenant).bind(branch).bind(external_id).fetch_optional(db).await,
        _ => Ok(None),
    }
}

pub async fn find_historical_purchase_bill_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    provider: MigrationProvider,
    payload: &serde_json::Map<String, Value>,
) -> Result<Option<String>, sqlx::Error> {
    let value = |field: &str| payload.get(field).and_then(Value::as_str).unwrap_or("");
    sqlx::query_scalar(
        r#"SELECT bill.id FROM historical_purchase_bills bill
           JOIN integration_import_jobs job ON job.id=bill.import_job_id AND job.status='completed'
           WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND (
             ($3<>'' AND LOWER(bill.provider)=LOWER($4) AND LOWER(bill.supplier_external_id)=LOWER($3) AND LOWER(bill.invoice_number)=LOWER($5)) OR
             ($6<>'' AND UPPER(bill.supplier_gstin)=UPPER($6) AND LOWER(bill.invoice_number)=LOWER($5)) OR
             (LOWER(bill.supplier_name)=LOWER($7) AND LOWER(bill.invoice_number)=LOWER($5) AND bill.invoice_date=$8::DATE) OR
             (LOWER(bill.provider)=LOWER($4) AND LOWER(bill.external_bill_id)=LOWER($9)))
           ORDER BY CASE
             WHEN $3<>'' AND LOWER(bill.provider)=LOWER($4) AND LOWER(bill.supplier_external_id)=LOWER($3) AND LOWER(bill.invoice_number)=LOWER($5) THEN 1
             WHEN $6<>'' AND UPPER(bill.supplier_gstin)=UPPER($6) AND LOWER(bill.invoice_number)=LOWER($5) THEN 2
             WHEN LOWER(bill.supplier_name)=LOWER($7) AND LOWER(bill.invoice_number)=LOWER($5) AND bill.invoice_date=$8::DATE THEN 3
             ELSE 4 END LIMIT 1"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(value("supplier_external_id"))
    .bind(provider.as_str())
    .bind(value("invoice_number"))
    .bind(value("supplier_gstin"))
    .bind(value("supplier_name"))
    .bind(value("invoice_date"))
    .bind(value("source_external_id"))
    .fetch_optional(db)
    .await
}

pub async fn list_historical_purchase_bills(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'id',bill.id,'provider',bill.provider,'cutoverId',bill.cutover_id,
             'externalBillId',bill.external_bill_id,'supplierName',bill.supplier_name,
             'supplierGstin',bill.supplier_gstin,'invoiceNumber',bill.invoice_number,
             'invoiceDate',bill.invoice_date,'receivedDate',bill.received_date,
             'currency',bill.currency,'documentType',bill.document_type,'sourceStatus',bill.source_status,
             'paymentStatus',bill.payment_status,'taxablePaise',bill.taxable_paise,
             'taxPaise',bill.cgst_paise+bill.sgst_paise+bill.igst_paise,
             'lineTotalPaise',bill.line_total_paise,'totalPaise',bill.total_paise,
             'lineCount',(SELECT COUNT(*) FROM historical_purchase_bill_lines line WHERE line.historical_bill_id=bill.id),
             'unmappedProductCount',(SELECT COUNT(*)
               FROM historical_purchase_bill_lines line
               LEFT JOIN historical_purchase_mapping_sources source
                 ON source.tenant_id=line.tenant_id AND source.branch_id=line.branch_id
                AND source.identity_type='product' AND source.provider=bill.provider
                AND source.source_snapshot->>'providerProductId'=line.source_product_id
                AND source.source_snapshot->>'sku'=line.sku AND source.source_snapshot->>'barcode'=line.barcode
                AND source.source_snapshot->>'name'=line.original_product_name
                AND source.source_snapshot->>'brand'=line.brand AND source.source_snapshot->>'unit'=line.stock_unit
                AND source.source_snapshot->>'packageUnit'=line.package_unit
                AND (source.source_snapshot->>'unitsPerPackage')::BIGINT=line.units_per_package
                AND source.source_snapshot->>'size'=line.size AND source.source_snapshot->>'shade'=line.shade
                AND source.source_snapshot->>'color'=line.color
                AND source.source_snapshot->>'vendorCatalogCode'=line.vendor_catalog_code
               LEFT JOIN historical_purchase_identity_mappings identity_mapping
                 ON identity_mapping.tenant_id=line.tenant_id AND identity_mapping.branch_id=line.branch_id
                AND identity_mapping.identity_type='product' AND identity_mapping.provider=bill.provider
                AND identity_mapping.source_key=source.source_key
               WHERE line.historical_bill_id=bill.id AND line.mapped_inventory_item_id IS NULL
                 AND NOT(COALESCE(identity_mapping.current_decision,'') IN ('link','create')
                         AND identity_mapping.target_inventory_item_id IS NOT NULL)),
             'sourceFileId',bill.source_file_id,
             'sourceFileName',(SELECT file.original_file_name FROM historical_purchase_bill_files file WHERE file.historical_bill_id=bill.id ORDER BY file.created_at LIMIT 1),
             'sourceChecksum',bill.source_checksum,'stockEffect','none','accountingEffect','none',
             'liveRegisterCollision',EXISTS(
               SELECT 1 FROM purchase_receipts receipt
               WHERE receipt.tenant_id=bill.tenant_id AND receipt.branch_id=bill.branch_id
                 AND receipt.rolled_back_at IS NULL
                 AND LOWER(BTRIM(receipt.supplier_invoice_number))=LOWER(BTRIM(bill.invoice_number))
                 AND ((BTRIM(bill.supplier_gstin)<>'' AND UPPER(BTRIM(receipt.supplier_gstin))=UPPER(BTRIM(bill.supplier_gstin)))
                      OR (BTRIM(bill.supplier_gstin)='' AND LOWER(BTRIM(receipt.supplier_name))=LOWER(BTRIM(bill.supplier_name))))
             ),'createdAt',bill.created_at)
           FROM historical_purchase_bills bill
           WHERE bill.tenant_id=$1 AND bill.branch_id=$2
           ORDER BY bill.invoice_date DESC,bill.created_at DESC LIMIT 5000"#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await
}

pub async fn historical_purchase_bill(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'id',bill.id,'provider',bill.provider,'cutoverId',bill.cutover_id,
             'externalBillId',bill.external_bill_id,'supplierName',bill.supplier_name,
             'supplierGstin',bill.supplier_gstin,'supplierExternalId',bill.supplier_external_id,
             'supplierCode',bill.supplier_code,'supplierPhone',bill.supplier_phone,'supplierEmail',bill.supplier_email,
             'invoiceNumber',bill.invoice_number,'invoiceDate',bill.invoice_date,'receivedDate',bill.received_date,
             'currency',bill.currency,'documentType',bill.document_type,'sourceStatus',bill.source_status,
             'paymentStatus',bill.payment_status,'taxablePaise',bill.taxable_paise,
             'cgstPaise',bill.cgst_paise,'sgstPaise',bill.sgst_paise,'igstPaise',bill.igst_paise,
             'taxPaise',bill.cgst_paise+bill.sgst_paise+bill.igst_paise,
             'discountPaise',bill.discount_paise,'shippingPaise',bill.shipping_paise,
             'handlingPaise',bill.handling_paise,'lineTotalPaise',bill.line_total_paise,
             'totalPaise',bill.total_paise,'sourceFileId',bill.source_file_id,
             'sourceChecksum',bill.source_checksum,'importJobId',bill.import_job_id,
             'stockEffect','none','accountingEffect','none','createdAt',bill.created_at,
             'files',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
               'id',file.id,'sourceFileId',file.source_file_id,'sourceArtifactId',file.source_artifact_id,
               'originalFileName',file.original_file_name,'mediaType',file.media_type,
               'sha256',file.sha256,'createdAt',file.created_at) ORDER BY file.created_at)
               FROM historical_purchase_bill_files file WHERE file.historical_bill_id=bill.id),'[]'::JSONB),
             'lines',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
               'id',line.id,'originalProductName',line.original_product_name,'sku',line.sku,
               'barcode',line.barcode,'sourceProductId',line.source_product_id,
               'mappedInventoryItemId',COALESCE(identity_mapping.target_inventory_item_id,line.mapped_inventory_item_id),
               'mappedProductName',item.name,'mappingDecision',identity_mapping.current_decision,
               'mappingVersion',identity_mapping.current_version,'mappingSourceKey',source.source_key,
               'packageUnit',line.package_unit,'stockUnit',line.stock_unit,
               'unitsPerPackage',line.units_per_package,'purchasedQuantity',line.purchased_quantity,
               'acceptedQuantity',line.accepted_quantity,'damagedQuantity',line.damaged_quantity,
               'rejectedQuantity',line.rejected_quantity,'unitCostPaise',line.unit_cost_paise,
               'gstPercentBps',line.gst_percent_bps,'taxablePaise',line.taxable_paise,
               'taxPaise',line.cgst_paise+line.sgst_paise+line.igst_paise,
               'totalPaise',line.total_paise,'batchNumber',line.batch_number,'expiryDate',line.expiry_date,
               'sourceSheet',line.source_sheet,'sourceRowNumber',line.source_row_number)
               ORDER BY line.source_sheet,line.source_row_number)
               FROM historical_purchase_bill_lines line
               LEFT JOIN historical_purchase_mapping_sources source
                 ON source.tenant_id=line.tenant_id AND source.branch_id=line.branch_id
                AND source.identity_type='product' AND source.provider=bill.provider
                AND source.source_snapshot->>'providerProductId'=line.source_product_id
                AND source.source_snapshot->>'sku'=line.sku AND source.source_snapshot->>'barcode'=line.barcode
                AND source.source_snapshot->>'name'=line.original_product_name
                AND source.source_snapshot->>'brand'=line.brand AND source.source_snapshot->>'unit'=line.stock_unit
                AND source.source_snapshot->>'packageUnit'=line.package_unit
                AND (source.source_snapshot->>'unitsPerPackage')::BIGINT=line.units_per_package
                AND source.source_snapshot->>'size'=line.size AND source.source_snapshot->>'shade'=line.shade
                AND source.source_snapshot->>'color'=line.color
                AND source.source_snapshot->>'vendorCatalogCode'=line.vendor_catalog_code
               LEFT JOIN historical_purchase_identity_mappings identity_mapping
                 ON identity_mapping.tenant_id=line.tenant_id AND identity_mapping.branch_id=line.branch_id
                AND identity_mapping.identity_type='product' AND identity_mapping.provider=bill.provider
                AND identity_mapping.source_key=source.source_key
               LEFT JOIN inventory_items item ON item.id=COALESCE(identity_mapping.target_inventory_item_id,line.mapped_inventory_item_id)
               WHERE line.historical_bill_id=bill.id),'[]'::JSONB))
           FROM historical_purchase_bills bill
           WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND bill.id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list_historical_purchase_mapping_sources(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    let sql = match kind {
        HistoricalPurchaseMappingKind::Product => {
            r#"SELECT JSONB_BUILD_OBJECT(
                 'identityType','product','provider',source.provider,'sourceKey',source.source_key,
                 'source',source.source_snapshot||COALESCE(metrics.payload,'{}'::JSONB),
                 'currentMapping',CASE WHEN mapping.id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
                   'id',mapping.id,'version',mapping.current_version,'decision',mapping.current_decision,
                   'targetId',mapping.target_inventory_item_id,'updatedAt',mapping.updated_at,
                   'sourceDrift',(mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                     (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity')) END,
                 'sourceDrift',mapping.id IS NOT NULL AND
                   (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                   (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity'),
                 'candidates',COALESCE(candidates.items,'[]'::JSONB))
               FROM historical_purchase_mapping_sources source
               LEFT JOIN historical_purchase_identity_mappings mapping
                 ON mapping.tenant_id=source.tenant_id AND mapping.branch_id=source.branch_id
                AND mapping.identity_type='product' AND mapping.provider=source.provider
                AND mapping.source_key=source.source_key
               LEFT JOIN LATERAL (
                 SELECT JSONB_BUILD_OBJECT(
                   'latestCostPaise',(ARRAY_AGG(line.unit_cost_paise ORDER BY bill.invoice_date DESC,bill.created_at DESC))[1],
                   'minimumCostPaise',MIN(line.unit_cost_paise),'maximumCostPaise',MAX(line.unit_cost_paise),
                   'averageCostPaise',ROUND(SUM(line.unit_cost_paise::NUMERIC*line.purchased_quantity::NUMERIC)/NULLIF(SUM(line.purchased_quantity),0))::BIGINT,
                   'firstPurchaseDate',MIN(bill.invoice_date),'lastPurchaseDate',MAX(bill.invoice_date),
                   'billIds',COALESCE(JSONB_AGG(DISTINCT bill.id),'[]'::JSONB),
                   'billLineIds',COALESCE(JSONB_AGG(DISTINCT line.id),'[]'::JSONB)) payload
                 FROM historical_purchase_bill_lines line
                 JOIN historical_purchase_bills bill ON bill.id=line.historical_bill_id
                 WHERE line.tenant_id=source.tenant_id AND line.branch_id=source.branch_id
                   AND bill.provider=source.provider
                   AND line.source_product_id=source.source_snapshot->>'providerProductId'
                   AND line.sku=source.source_snapshot->>'sku' AND line.barcode=source.source_snapshot->>'barcode'
                   AND line.original_product_name=source.source_snapshot->>'name'
                   AND line.brand=source.source_snapshot->>'brand' AND line.stock_unit=source.source_snapshot->>'unit'
                   AND line.package_unit=source.source_snapshot->>'packageUnit'
                   AND line.units_per_package=(source.source_snapshot->>'unitsPerPackage')::BIGINT
                   AND line.size=source.source_snapshot->>'size' AND line.shade=source.source_snapshot->>'shade'
                   AND line.color=source.source_snapshot->>'color'
                   AND line.vendor_catalog_code=source.source_snapshot->>'vendorCatalogCode'
               ) metrics ON TRUE
               LEFT JOIN LATERAL (
                 SELECT JSONB_AGG(candidate.payload ORDER BY candidate.rank DESC,candidate.name) items
                 FROM (
                   SELECT item.name,
                     CASE
                       WHEN mismatch.variant_mismatch OR mismatch.identifier_conflict THEN 0
                       WHEN mapping.target_inventory_item_id=item.id AND
                         (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                         (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') THEN 75
                       WHEN mapping.target_inventory_item_id=item.id THEN 100
                       WHEN BTRIM(source.source_snapshot->>'barcode')<>'' AND
                            LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode') THEN 98
                       WHEN BTRIM(source.source_snapshot->>'sku')<>'' AND
                            LOWER(item.sku)=LOWER(source.source_snapshot->>'sku') THEN 95
                       WHEN LOWER(BTRIM(item.name))=LOWER(BTRIM(source.source_snapshot->>'name')) THEN 75
                       WHEN SIMILARITY(item.name,source.source_snapshot->>'name')>=0.65 THEN
                         GREATEST(65,LEAST(74,ROUND(SIMILARITY(item.name,source.source_snapshot->>'name')*100)::INTEGER))
                       ELSE 0
                     END rank,
                     JSONB_BUILD_OBJECT(
                       'targetId',item.id,'name',item.name,'sku',item.sku,'barcode',item.barcode,
                       'brand',item.brand,'unit',item.unit,'packageUnit',item.package_unit,
                       'unitsPerPackage',item.units_per_package,
                       'confidencePercentage',CASE
                         WHEN mismatch.variant_mismatch OR mismatch.identifier_conflict THEN 0
                         WHEN mapping.target_inventory_item_id=item.id AND
                           (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                           (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') THEN 75
                         WHEN mapping.target_inventory_item_id=item.id THEN 100
                         WHEN BTRIM(source.source_snapshot->>'barcode')<>'' AND
                              LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode') THEN 98
                         WHEN BTRIM(source.source_snapshot->>'sku')<>'' AND
                              LOWER(item.sku)=LOWER(source.source_snapshot->>'sku') THEN 95
                         WHEN LOWER(BTRIM(item.name))=LOWER(BTRIM(source.source_snapshot->>'name')) THEN 75
                         WHEN SIMILARITY(item.name,source.source_snapshot->>'name')>=0.65 THEN
                           GREATEST(65,LEAST(74,ROUND(SIMILARITY(item.name,source.source_snapshot->>'name')*100)::INTEGER))
                         ELSE 0 END,
                       'governance',CASE
                         WHEN mismatch.variant_mismatch OR mismatch.identifier_conflict THEN 'red'
                         WHEN mismatch.unit_mismatch OR (mapping.target_inventory_item_id=item.id AND
                           (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                           (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity')) THEN 'yellow'
                         WHEN mapping.target_inventory_item_id=item.id OR
                              (BTRIM(source.source_snapshot->>'barcode')<>'' AND LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode')) OR
                              (BTRIM(source.source_snapshot->>'sku')<>'' AND LOWER(item.sku)=LOWER(source.source_snapshot->>'sku'))
                           THEN 'green' ELSE 'yellow' END,
                       'signals',JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
                         'savedMapping',CASE WHEN mapping.target_inventory_item_id=item.id THEN TRUE END,
                         'sku',CASE WHEN BTRIM(source.source_snapshot->>'sku')<>'' AND LOWER(item.sku)=LOWER(source.source_snapshot->>'sku') THEN TRUE END,
                         'barcode',CASE WHEN BTRIM(source.source_snapshot->>'barcode')<>'' AND LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode') THEN TRUE END,
                         'name',CASE WHEN LOWER(BTRIM(item.name))=LOWER(BTRIM(source.source_snapshot->>'name')) THEN TRUE END,
                         'brand',CASE WHEN BTRIM(source.source_snapshot->>'brand')<>'' AND LOWER(item.brand)=LOWER(source.source_snapshot->>'brand') THEN TRUE END)),
                       'warnings',JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
                         'unitMismatch',CASE WHEN mismatch.unit_mismatch THEN 'Different unit conversion requires explicit approval' END,
                         'variantMismatch',CASE WHEN mismatch.variant_mismatch THEN 'SKU, barcode, brand, shade or color conflicts cannot be overridden' END,
                         'sizeReview',CASE WHEN BTRIM(source.source_snapshot->>'size')<>'' AND
                           REGEXP_REPLACE(LOWER(item.name),'[^a-z0-9]+','','g') NOT LIKE '%'||REGEXP_REPLACE(LOWER(source.source_snapshot->>'size'),'[^a-z0-9]+','','g')||'%'
                           THEN 'Size equivalence requires review' END,
                         'sourceFormatDrift',CASE WHEN mapping.target_inventory_item_id=item.id AND
                           (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
                           (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity')
                           THEN 'Source identity fields changed since approval' END,
                         'nameOnly',CASE WHEN NOT mismatch.variant_mismatch AND NOT mismatch.unit_mismatch AND
                           LOWER(BTRIM(item.name))=LOWER(BTRIM(source.source_snapshot->>'name')) AND
                           NOT(BTRIM(source.source_snapshot->>'sku')<>'' AND LOWER(item.sku)=LOWER(source.source_snapshot->>'sku')) AND
                           NOT(BTRIM(source.source_snapshot->>'barcode')<>'' AND LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode'))
                           THEN 'Similar product name alone cannot be Green' END)))
                     payload
                   FROM inventory_items item
                   CROSS JOIN LATERAL (
                     SELECT
                       (BTRIM(source.source_snapshot->>'unit')<>'' AND LOWER(item.unit)<>LOWER(source.source_snapshot->>'unit')) OR
                       (BTRIM(source.source_snapshot->>'packageUnit')<>'' AND LOWER(item.package_unit)<>LOWER(source.source_snapshot->>'packageUnit')) OR
                       (source.source_snapshot ? 'unitsPerPackage' AND item.units_per_package<>(source.source_snapshot->>'unitsPerPackage')::INTEGER)
                         unit_mismatch,
                       (BTRIM(source.source_snapshot->>'sku')<>'' AND BTRIM(item.sku)<>'' AND LOWER(item.sku)<>LOWER(source.source_snapshot->>'sku')) OR
                       (BTRIM(source.source_snapshot->>'barcode')<>'' AND BTRIM(item.barcode)<>'' AND LOWER(item.barcode)<>LOWER(source.source_snapshot->>'barcode'))
                         identifier_conflict,
                       (BTRIM(source.source_snapshot->>'brand')<>'' AND BTRIM(item.brand)<>'' AND LOWER(item.brand)<>LOWER(source.source_snapshot->>'brand')) OR
                       EXISTS(SELECT 1 FROM JSONB_EACH_TEXT(JSONB_BUILD_OBJECT(
                         'shade',source.source_snapshot->>'shade','color',source.source_snapshot->>'color')) dimension(field,value)
                         WHERE BTRIM(dimension.value)<>'' AND CASE
                           WHEN dimension.value ~ '^[0-9]+(?:\.[0-9]+)*$' THEN
                             NOT(REGEXP_SPLIT_TO_ARRAY(LOWER(item.name),'[^0-9.]+') @> ARRAY[LOWER(dimension.value)])
                           ELSE LOWER(item.name) NOT LIKE '%'||LOWER(dimension.value)||'%' END)
                         variant_mismatch
                   ) mismatch
                   WHERE item.tenant_id=source.tenant_id AND item.branch_id=source.branch_id AND item.active
                     AND (mapping.target_inventory_item_id=item.id OR
                          (BTRIM(source.source_snapshot->>'sku')<>'' AND LOWER(item.sku)=LOWER(source.source_snapshot->>'sku')) OR
                         (BTRIM(source.source_snapshot->>'barcode')<>'' AND LOWER(item.barcode)=LOWER(source.source_snapshot->>'barcode')) OR
                         LOWER(BTRIM(item.name))=LOWER(BTRIM(source.source_snapshot->>'name')) OR
                         SIMILARITY(item.name,source.source_snapshot->>'name')>=0.65)
                   ORDER BY rank DESC,item.name LIMIT 10
                 ) candidate
               ) candidates ON TRUE
               WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.identity_type='product'
                 AND ($3='' OR LOWER(source.provider)=LOWER($3))
               ORDER BY source.provider,source.source_snapshot->>'name'"#
        }
        HistoricalPurchaseMappingKind::Vendor => {
            r#"SELECT JSONB_BUILD_OBJECT(
                 'identityType','vendor','provider',source.provider,'sourceKey',source.source_key,
                 'source',source.source_snapshot||COALESCE(metrics.payload,'{}'::JSONB),
                 'currentMapping',CASE WHEN mapping.id IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
                   'id',mapping.id,'version',mapping.current_version,'decision',mapping.current_decision,
                   'targetId',mapping.target_supplier_id,'updatedAt',mapping.updated_at,
                   'sourceDrift',(mapping.source_snapshot-'billCount') IS DISTINCT FROM
                     (source.source_snapshot-'billCount')) END,
                 'sourceDrift',mapping.id IS NOT NULL AND
                   (mapping.source_snapshot-'billCount') IS DISTINCT FROM
                   (source.source_snapshot-'billCount'),
                 'candidates',COALESCE(candidates.items,'[]'::JSONB))
               FROM historical_purchase_mapping_sources source
               LEFT JOIN historical_purchase_identity_mappings mapping
                 ON mapping.tenant_id=source.tenant_id AND mapping.branch_id=source.branch_id
                AND mapping.identity_type='vendor' AND mapping.provider=source.provider
                AND mapping.source_key=source.source_key
               LEFT JOIN LATERAL (
                 SELECT JSONB_BUILD_OBJECT(
                   'firstPurchaseDate',MIN(bill.invoice_date),'lastPurchaseDate',MAX(bill.invoice_date),
                   'billIds',COALESCE(JSONB_AGG(bill.id ORDER BY bill.invoice_date,bill.id),'[]'::JSONB),
                   'address',COALESCE(MAX(NULLIF(bill.original_json->>'supplierAddress','')),MAX(NULLIF(bill.original_json->>'supplier_address','')),'')
                 ) payload
                 FROM historical_purchase_bills bill
                 WHERE bill.tenant_id=source.tenant_id AND bill.branch_id=source.branch_id
                   AND bill.provider=source.provider
                   AND bill.supplier_external_id=source.source_snapshot->>'providerVendorId'
                   AND bill.supplier_gstin=source.source_snapshot->>'gstin'
                   AND bill.supplier_code=source.source_snapshot->>'vendorCode'
                   AND bill.supplier_name=source.source_snapshot->>'name'
                   AND bill.supplier_phone=source.source_snapshot->>'phone'
                   AND bill.supplier_email=source.source_snapshot->>'email'
               ) metrics ON TRUE
               LEFT JOIN LATERAL (
                 SELECT JSONB_AGG(payload ORDER BY rank DESC,name) items FROM (
                   SELECT supplier.name,
                     CASE
                       WHEN (BTRIM(source.source_snapshot->>'gstin')<>'' AND BTRIM(supplier.gstin)<>'' AND UPPER(supplier.gstin)<>UPPER(source.source_snapshot->>'gstin')) OR
                            (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND BTRIM(supplier.code)<>'' AND LOWER(supplier.code)<>LOWER(source.source_snapshot->>'vendorCode')) THEN 0
                       WHEN mapping.target_supplier_id=supplier.id AND
                         (mapping.source_snapshot-'billCount') IS DISTINCT FROM (source.source_snapshot-'billCount') THEN 75
                       WHEN mapping.target_supplier_id=supplier.id THEN 100
                       WHEN BTRIM(source.source_snapshot->>'gstin')<>'' AND
                            UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin') THEN 98
                       WHEN BTRIM(source.source_snapshot->>'vendorCode')<>'' AND
                            LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode') THEN 95
                       WHEN BTRIM(source.source_snapshot->>'phone')<>'' AND
                            supplier.phone=source.source_snapshot->>'phone' THEN 80
                       WHEN BTRIM(source.source_snapshot->>'email')<>'' AND
                            LOWER(supplier.email)=LOWER(source.source_snapshot->>'email') THEN 80
                       WHEN SIMILARITY(supplier.name,source.source_snapshot->>'name')>=0.65 THEN
                         GREATEST(65,LEAST(79,ROUND(SIMILARITY(supplier.name,source.source_snapshot->>'name')*100)::INTEGER))
                       ELSE 0 END rank,
                     JSONB_BUILD_OBJECT(
                       'targetId',supplier.id,'name',supplier.name,'code',supplier.code,
                       'gstin',supplier.gstin,'phone',supplier.phone,'email',supplier.email,
                       'confidencePercentage',CASE
                         WHEN (BTRIM(source.source_snapshot->>'gstin')<>'' AND BTRIM(supplier.gstin)<>'' AND UPPER(supplier.gstin)<>UPPER(source.source_snapshot->>'gstin')) OR
                              (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND BTRIM(supplier.code)<>'' AND LOWER(supplier.code)<>LOWER(source.source_snapshot->>'vendorCode')) THEN 0
                         WHEN mapping.target_supplier_id=supplier.id AND
                           (mapping.source_snapshot-'billCount') IS DISTINCT FROM (source.source_snapshot-'billCount') THEN 75
                         WHEN mapping.target_supplier_id=supplier.id THEN 100
                         WHEN BTRIM(source.source_snapshot->>'gstin')<>'' AND UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin') THEN 98
                         WHEN BTRIM(source.source_snapshot->>'vendorCode')<>'' AND LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode') THEN 95
                         WHEN BTRIM(source.source_snapshot->>'phone')<>'' AND supplier.phone=source.source_snapshot->>'phone' THEN 80
                         WHEN BTRIM(source.source_snapshot->>'email')<>'' AND LOWER(supplier.email)=LOWER(source.source_snapshot->>'email') THEN 80
                         WHEN SIMILARITY(supplier.name,source.source_snapshot->>'name')>=0.65 THEN
                           GREATEST(65,LEAST(79,ROUND(SIMILARITY(supplier.name,source.source_snapshot->>'name')*100)::INTEGER))
                         ELSE 0 END,
                       'governance',CASE
                         WHEN (BTRIM(source.source_snapshot->>'gstin')<>'' AND BTRIM(supplier.gstin)<>'' AND UPPER(supplier.gstin)<>UPPER(source.source_snapshot->>'gstin')) OR
                              (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND BTRIM(supplier.code)<>'' AND LOWER(supplier.code)<>LOWER(source.source_snapshot->>'vendorCode')) THEN 'red'
                         WHEN mapping.target_supplier_id=supplier.id AND
                           (mapping.source_snapshot-'billCount') IS DISTINCT FROM (source.source_snapshot-'billCount') THEN 'yellow'
                         WHEN mapping.target_supplier_id=supplier.id OR
                         (BTRIM(source.source_snapshot->>'gstin')<>'' AND UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin')) OR
                         (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode'))
                         THEN 'green'
                         WHEN SIMILARITY(supplier.name,source.source_snapshot->>'name')>=0.65 THEN 'yellow'
                         ELSE 'red' END,
                       'signals',JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
                         'savedMapping',CASE WHEN mapping.target_supplier_id=supplier.id THEN TRUE END,
                         'gstin',CASE WHEN BTRIM(source.source_snapshot->>'gstin')<>'' AND UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin') THEN TRUE END,
                         'vendorCode',CASE WHEN BTRIM(source.source_snapshot->>'vendorCode')<>'' AND LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode') THEN TRUE END,
                         'name',CASE WHEN LOWER(BTRIM(supplier.name))=LOWER(BTRIM(source.source_snapshot->>'name')) THEN TRUE END,
                         'phone',CASE WHEN BTRIM(source.source_snapshot->>'phone')<>'' AND supplier.phone=source.source_snapshot->>'phone' THEN TRUE END,
                         'email',CASE WHEN BTRIM(source.source_snapshot->>'email')<>'' AND LOWER(supplier.email)=LOWER(source.source_snapshot->>'email') THEN TRUE END,
                         'address',CASE WHEN BTRIM(metrics.payload->>'address')<>'' AND LOWER(BTRIM(supplier.address))=LOWER(BTRIM(metrics.payload->>'address')) THEN TRUE END)),
                       'warnings',JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
                         'identityConflict',CASE WHEN
                           (BTRIM(source.source_snapshot->>'gstin')<>'' AND BTRIM(supplier.gstin)<>'' AND UPPER(supplier.gstin)<>UPPER(source.source_snapshot->>'gstin')) OR
                           (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND BTRIM(supplier.code)<>'' AND LOWER(supplier.code)<>LOWER(source.source_snapshot->>'vendorCode'))
                           THEN 'Supplier GSTIN or vendor code conflicts' END,
                         'sourceFormatDrift',CASE WHEN mapping.target_supplier_id=supplier.id AND
                           (mapping.source_snapshot-'billCount') IS DISTINCT FROM (source.source_snapshot-'billCount')
                           THEN 'Source identity fields changed since approval' END,
                         'nameOnly',CASE WHEN SIMILARITY(supplier.name,source.source_snapshot->>'name')>=0.65 AND
                           NOT(BTRIM(source.source_snapshot->>'gstin')<>'' AND UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin')) AND
                           NOT(BTRIM(source.source_snapshot->>'vendorCode')<>'' AND LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode'))
                           THEN 'Name similarity alone requires authorized review' END)))
                     payload
                   FROM suppliers supplier
                   WHERE supplier.tenant_id=source.tenant_id AND supplier.branch_id=source.branch_id AND supplier.active
                     AND (mapping.target_supplier_id=supplier.id OR
                          (BTRIM(source.source_snapshot->>'gstin')<>'' AND UPPER(supplier.gstin)=UPPER(source.source_snapshot->>'gstin')) OR
                          (BTRIM(source.source_snapshot->>'vendorCode')<>'' AND LOWER(supplier.code)=LOWER(source.source_snapshot->>'vendorCode')) OR
                          (BTRIM(source.source_snapshot->>'phone')<>'' AND supplier.phone=source.source_snapshot->>'phone') OR
                          (BTRIM(source.source_snapshot->>'email')<>'' AND LOWER(supplier.email)=LOWER(source.source_snapshot->>'email')) OR
                          LOWER(BTRIM(supplier.name))=LOWER(BTRIM(source.source_snapshot->>'name')) OR
                          SIMILARITY(supplier.name,source.source_snapshot->>'name')>=0.65)
                   ORDER BY rank DESC,supplier.name LIMIT 10
                 ) candidate
               ) candidates ON TRUE
               WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.identity_type='vendor'
                 AND ($3='' OR LOWER(source.provider)=LOWER($3))
               ORDER BY source.provider,source.source_snapshot->>'name'"#
        }
    };
    sqlx::query_scalar(sql)
        .bind(tenant)
        .bind(branch)
        .bind(provider)
        .fetch_all(db)
        .await
}

pub async fn historical_purchase_mapping_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH scoped AS (
             SELECT source.identity_type,source.source_snapshot,mapping.current_decision,
               mapping.id IS NOT NULL AND
               (mapping.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') IS DISTINCT FROM
               (source.source_snapshot-'billCount'-'lineCount'-'historicalQuantity') AS source_drift
             FROM historical_purchase_mapping_sources source
             LEFT JOIN historical_purchase_identity_mappings mapping
               ON mapping.tenant_id=source.tenant_id AND mapping.branch_id=source.branch_id
              AND mapping.identity_type=source.identity_type AND mapping.provider=source.provider
              AND mapping.source_key=source.source_key
             WHERE source.tenant_id=$1 AND source.branch_id=$2
           )
           SELECT JSONB_BUILD_OBJECT(
             'status',CASE WHEN COUNT(*)=0 THEN 'empty'
                           WHEN COUNT(*) FILTER(WHERE current_decision IS NULL OR source_drift)>0 THEN 'review_required'
                           ELSE 'ready' END,
             'historicalProducts',COUNT(*) FILTER(WHERE identity_type='product'),
             'linkedProducts',COUNT(*) FILTER(WHERE identity_type='product' AND current_decision='link'),
             'createdProducts',COUNT(*) FILTER(WHERE identity_type='product' AND current_decision='create'),
             'historicalOnlyProducts',COUNT(*) FILTER(WHERE identity_type='product' AND current_decision='keep_historical_only'),
             'rejectedProducts',COUNT(*) FILTER(WHERE identity_type='product' AND current_decision='reject'),
             'pendingProducts',COUNT(*) FILTER(WHERE identity_type='product' AND current_decision IS NULL),
             'historicalVendors',COUNT(*) FILTER(WHERE identity_type='vendor'),
             'linkedVendors',COUNT(*) FILTER(WHERE identity_type='vendor' AND current_decision='link'),
             'createdVendors',COUNT(*) FILTER(WHERE identity_type='vendor' AND current_decision='create'),
             'historicalOnlyVendors',COUNT(*) FILTER(WHERE identity_type='vendor' AND current_decision='keep_historical_only'),
             'rejectedVendors',COUNT(*) FILTER(WHERE identity_type='vendor' AND current_decision='reject'),
             'pendingVendors',COUNT(*) FILTER(WHERE identity_type='vendor' AND current_decision IS NULL),
             'driftedMappings',COUNT(*) FILTER(WHERE source_drift),
             'traceableSources',COUNT(*) FILTER(WHERE COALESCE((source_snapshot->>'billCount')::BIGINT,0)>0),
             'stockEffectPaise',0,'accountingEffectPaise',0,'gstEffectPaise',0,'payableEffectPaise',0)
           FROM scoped"#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_one(db)
    .await
}

pub async fn decide_historical_purchase_mapping(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
    source_key: &str,
    request: &HistoricalPurchaseMappingDecisionRequest,
    actor: &str,
) -> Result<Value, sqlx::Error> {
    let review_snapshot =
        list_historical_purchase_mapping_sources(db, tenant, branch, kind, provider)
            .await?
            .into_iter()
            .find(|source| source.get("sourceKey").and_then(Value::as_str) == Some(source_key))
            .ok_or(sqlx::Error::RowNotFound)?;
    let suggested_candidates = review_snapshot
        .get("candidates")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let selected_candidate = suggested_candidates
        .as_array()
        .and_then(|candidates| {
            candidates.iter().find(|candidate| {
                candidate.get("targetId").and_then(Value::as_str)
                    == Some(request.target_id.as_str())
            })
        })
        .cloned();
    let mut tx = db.begin().await?;
    let source_snapshot: Value = sqlx::query_scalar(
        "SELECT source_snapshot FROM historical_purchase_mapping_sources WHERE tenant_id=$1 AND branch_id=$2 AND identity_type=$3 AND LOWER(provider)=LOWER($4) AND source_key=$5 LIMIT 1",
    )
    .bind(tenant).bind(branch).bind(kind.as_str()).bind(provider).bind(source_key)
    .fetch_optional(&mut *tx).await?
    .ok_or(sqlx::Error::RowNotFound)?;
    sqlx::query(
        r#"INSERT INTO historical_purchase_identity_mappings(
             tenant_id,branch_id,identity_type,provider,source_key,source_snapshot)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(tenant_id,branch_id,identity_type,provider,source_key) DO NOTHING"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(kind.as_str())
    .bind(provider)
    .bind(source_key)
    .bind(&source_snapshot)
    .execute(&mut *tx)
    .await?;
    let (mapping_id, current_version, previous_source, previous_product, previous_vendor): (
        String,
        i32,
        Value,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT id,current_version,source_snapshot,target_inventory_item_id,target_supplier_id FROM historical_purchase_identity_mappings WHERE tenant_id=$1 AND branch_id=$2 AND identity_type=$3 AND LOWER(provider)=LOWER($4) AND source_key=$5 FOR UPDATE",
    )
    .bind(tenant).bind(branch).bind(kind.as_str()).bind(provider).bind(source_key)
    .fetch_one(&mut *tx).await?;
    if current_version != request.expected_version {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_MAPPING_VERSION_CONFLICT".into(),
        ));
    }

    let mut target_product = None;
    let mut target_vendor = None;
    let mut selected_target_snapshot = Value::Null;
    let mut warnings = Vec::<Value>::new();
    let source_drift = historical_mapping_material_snapshot(&previous_source)
        != historical_mapping_material_snapshot(&source_snapshot);
    if source_drift
        && matches!(request.decision, HistoricalPurchaseMappingDecision::Link)
        && !request.approve_source_drift
    {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_MAPPING_SOURCE_DRIFT_APPROVAL_REQUIRED".into(),
        ));
    }
    if request.bulk_approval && source_drift {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_MAPPING_BULK_GREEN_REQUIRED".into(),
        ));
    }
    if source_drift {
        warnings.push(json!({"code":"SOURCE_FORMAT_DRIFT_APPROVED"}));
    }
    let mut unit_conversion = None;
    match request.decision {
        HistoricalPurchaseMappingDecision::Link => match kind {
            HistoricalPurchaseMappingKind::Product => {
                let target: Value = sqlx::query_scalar(
                    "SELECT JSONB_BUILD_OBJECT('id',id,'name',name,'sku',sku,'barcode',barcode,'brand',brand,'unit',unit,'packageUnit',package_unit,'unitsPerPackage',units_per_package) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active FOR UPDATE",
                ).bind(tenant).bind(branch).bind(&request.target_id).fetch_optional(&mut *tx).await?.ok_or(sqlx::Error::RowNotFound)?;
                selected_target_snapshot = target.clone();
                unit_conversion = validate_historical_product_link(
                    &source_snapshot,
                    &target,
                    previous_product.as_deref(),
                    source_drift,
                    request,
                    &mut warnings,
                )?;
                target_product = Some(request.target_id.clone());
            }
            HistoricalPurchaseMappingKind::Vendor => {
                let target: Value = sqlx::query_scalar(
                    "SELECT JSONB_BUILD_OBJECT('id',id,'name',name,'code',code,'gstin',gstin,'phone',phone,'email',email,'address',address) FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active FOR UPDATE",
                ).bind(tenant).bind(branch).bind(&request.target_id).fetch_optional(&mut *tx).await?.ok_or(sqlx::Error::RowNotFound)?;
                selected_target_snapshot = target.clone();
                validate_historical_vendor_link(
                    &source_snapshot,
                    &target,
                    previous_vendor.as_deref(),
                    source_drift,
                    request,
                )?;
                target_vendor = Some(request.target_id.clone());
            }
        },
        HistoricalPurchaseMappingDecision::Create => {
            let create = request.create.as_ref().ok_or_else(|| {
                sqlx::Error::Protocol("HISTORICAL_MAPPING_CREATE_PAYLOAD_REQUIRED".into())
            })?;
            match kind {
                HistoricalPurchaseMappingKind::Product => {
                    let id: String = sqlx::query_scalar(
                        r#"INSERT INTO inventory_items(
                             tenant_id,branch_id,sku,name,category,brand,unit,package_unit,units_per_package,
                             barcode,stock_quantity,reorder_point,unit_cost_paise,active)
                           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,0,TRUE) RETURNING id"#,
                    )
                    .bind(tenant)
                    .bind(branch)
                    .bind(create.sku.trim())
                    .bind(create.name.trim())
                    .bind(create.category.trim())
                    .bind(create.brand.trim())
                    .bind(create.unit.trim())
                    .bind(create.package_unit.trim())
                    .bind(create.units_per_package.unwrap_or(1))
                    .bind(create.barcode.trim())
                    .fetch_one(&mut *tx)
                    .await?;
                    let created_target = json!({
                        "id":&id,"name":create.name,"sku":create.sku,
                        "barcode":create.barcode,"brand":create.brand,
                        "unit":create.unit,"packageUnit":create.package_unit,
                        "unitsPerPackage":create.units_per_package.unwrap_or(1)
                    });
                    unit_conversion = validate_historical_product_link(
                        &source_snapshot,
                        &created_target,
                        None,
                        false,
                        request,
                        &mut warnings,
                    )?;
                    selected_target_snapshot = created_target;
                    target_product = Some(id);
                }
                HistoricalPurchaseMappingKind::Vendor => {
                    let id: String = sqlx::query_scalar(
                        r#"INSERT INTO suppliers(
                             tenant_id,branch_id,code,name,gstin,phone,email,address,active)
                           VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id"#,
                    )
                    .bind(tenant)
                    .bind(branch)
                    .bind(create.code.trim())
                    .bind(create.name.trim())
                    .bind(create.gstin.trim())
                    .bind(create.phone.trim())
                    .bind(create.email.trim())
                    .bind(create.address.trim())
                    .fetch_one(&mut *tx)
                    .await?;
                    let created_target = json!({
                        "id":&id,"name":create.name,"code":create.code,
                        "gstin":create.gstin,"phone":create.phone,"email":create.email,
                        "address":create.address
                    });
                    validate_historical_vendor_link(
                        &source_snapshot,
                        &created_target,
                        None,
                        false,
                        request,
                    )?;
                    selected_target_snapshot = created_target;
                    target_vendor = Some(id);
                }
            }
        }
        HistoricalPurchaseMappingDecision::KeepHistoricalOnly
        | HistoricalPurchaseMappingDecision::Reject => {}
    }
    let next_version = current_version + 1;
    let evidence = json!({
        "approveUnitConversion":request.approve_unit_conversion,
        "approveSourceDrift":request.approve_source_drift,
        "bulkApproval":request.bulk_approval,
        "suggestedCandidates":suggested_candidates,
        "selectedCandidate":selected_candidate,
        "selectedTarget":selected_target_snapshot,
        "unitConversion":unit_conversion,
        "stockEffect":"none",
        "accountingEffect":"none",
        "gstEffect":"none",
        "payableEffect":"none"
    });
    sqlx::query(
        r#"INSERT INTO historical_purchase_identity_mapping_versions(
             tenant_id,branch_id,identity_mapping_id,mapping_version,decision,
             target_inventory_item_id,target_supplier_id,source_snapshot,decision_evidence,
             warnings,reason,approved_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(&mapping_id)
    .bind(next_version)
    .bind(request.decision.as_str())
    .bind(&target_product)
    .bind(&target_vendor)
    .bind(&source_snapshot)
    .bind(&evidence)
    .bind(json!(&warnings))
    .bind(request.reason.trim())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE historical_purchase_identity_mappings SET
             source_snapshot=$6,current_version=$7,current_decision=$8,
             target_inventory_item_id=$9,target_supplier_id=$10,updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND identity_type=$3
             AND LOWER(provider)=LOWER($4) AND source_key=$5"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(kind.as_str())
    .bind(provider)
    .bind(source_key)
    .bind(&source_snapshot)
    .bind(next_version)
    .bind(request.decision.as_str())
    .bind(&target_product)
    .bind(&target_vendor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({
        "sourceKey":source_key,"provider":provider,"identityType":kind.as_str(),
        "version":next_version,"decision":request.decision.as_str(),
        "targetId":target_product.or(target_vendor),"warnings":warnings,
        "stockEffect":"none","accountingEffect":"none"
    }))
}

fn validate_historical_product_link(
    source: &Value,
    target: &Value,
    previous_target: Option<&str>,
    source_drift: bool,
    request: &HistoricalPurchaseMappingDecisionRequest,
    warnings: &mut Vec<Value>,
) -> Result<Option<Value>, sqlx::Error> {
    let conflict = |code: &'static str| Err(sqlx::Error::Protocol(code.into()));
    for (field, code) in [
        ("sku", "HISTORICAL_MAPPING_SKU_CONFLICT"),
        ("barcode", "HISTORICAL_MAPPING_BARCODE_CONFLICT"),
        ("brand", "HISTORICAL_MAPPING_BRAND_CONFLICT"),
    ] {
        let source_value = mapping_text(source, field);
        let target_value = mapping_text(target, field);
        if !source_value.is_empty()
            && !target_value.is_empty()
            && !source_value.eq_ignore_ascii_case(target_value)
        {
            return conflict(code);
        }
    }
    if !historical_size_matches(mapping_text(source, "size"), mapping_text(target, "name"))
        || !historical_variant_matches(mapping_text(source, "shade"), mapping_text(target, "name"))
        || !historical_variant_matches(mapping_text(source, "color"), mapping_text(target, "name"))
    {
        return conflict("HISTORICAL_MAPPING_VARIANT_CONFLICT");
    }
    let source_units = (
        mapping_text(source, "unit"),
        mapping_text(source, "packageUnit"),
        source
            .get("unitsPerPackage")
            .and_then(Value::as_i64)
            .unwrap_or(1),
    );
    let target_units = (
        mapping_text(target, "unit"),
        mapping_text(target, "packageUnit"),
        target
            .get("unitsPerPackage")
            .and_then(Value::as_i64)
            .unwrap_or(1),
    );
    let unit_mismatch = (!source_units.0.is_empty()
        && !source_units.0.eq_ignore_ascii_case(target_units.0))
        || (!source_units.1.is_empty() && !source_units.1.eq_ignore_ascii_case(target_units.1))
        || source_units.2 != target_units.2;
    if unit_mismatch && (source_units.2 <= 0 || target_units.2 <= 0) {
        return conflict("HISTORICAL_MAPPING_UNIT_CONVERSION_UNDEFINED");
    }
    if unit_mismatch && !request.approve_unit_conversion {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_MAPPING_UNIT_APPROVAL_REQUIRED".into(),
        ));
    }
    let unit_conversion = if unit_mismatch {
        let original_quantity = source
            .get("historicalQuantity")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        warnings.push(
            json!({"code":"UNIT_CONVERSION_APPROVED","source":source_units,"target":target_units}),
        );
        Some(json!({
            "originalQuantity":original_quantity,
            "originalUnit":source_units.0,
            "sourceUnitsPerPackage":source_units.2,
            "targetUnit":target_units.0,
            "targetUnitsPerPackage":target_units.2,
            "convertedQuantityNumerator":original_quantity.saturating_mul(source_units.2),
            "convertedQuantityDenominator":target_units.2
        }))
    } else {
        None
    };
    let target_id = mapping_text(target, "id");
    let strong_match = (!mapping_text(source, "barcode").is_empty()
        && mapping_text(source, "barcode").eq_ignore_ascii_case(mapping_text(target, "barcode")))
        || (!mapping_text(source, "sku").is_empty()
            && mapping_text(source, "sku").eq_ignore_ascii_case(mapping_text(target, "sku")))
        || (previous_target == Some(target_id) && !source_drift);
    if request.bulk_approval && (!strong_match || unit_mismatch) {
        return conflict("HISTORICAL_MAPPING_BULK_GREEN_REQUIRED");
    }
    Ok(unit_conversion)
}

fn validate_historical_vendor_link(
    source: &Value,
    target: &Value,
    previous_target: Option<&str>,
    source_drift: bool,
    request: &HistoricalPurchaseMappingDecisionRequest,
) -> Result<(), sqlx::Error> {
    for field in ["gstin", "vendorCode"] {
        let target_field = if field == "vendorCode" { "code" } else { field };
        let source_value = mapping_text(source, field);
        let target_value = mapping_text(target, target_field);
        if !source_value.is_empty()
            && !target_value.is_empty()
            && !source_value.eq_ignore_ascii_case(target_value)
        {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_MAPPING_VENDOR_IDENTITY_CONFLICT".into(),
            ));
        }
    }
    let target_id = mapping_text(target, "id");
    let strong_match = (!mapping_text(source, "gstin").is_empty()
        && mapping_text(source, "gstin").eq_ignore_ascii_case(mapping_text(target, "gstin")))
        || (!mapping_text(source, "vendorCode").is_empty()
            && mapping_text(source, "vendorCode")
                .eq_ignore_ascii_case(mapping_text(target, "code")))
        || (previous_target == Some(target_id) && !source_drift);
    if request.bulk_approval && !strong_match {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_MAPPING_BULK_GREEN_REQUIRED".into(),
        ));
    }
    Ok(())
}

fn historical_mapping_material_snapshot(value: &Value) -> Value {
    let mut material = value.clone();
    if let Some(object) = material.as_object_mut() {
        for key in [
            "billCount",
            "lineCount",
            "historicalQuantity",
            "latestCostPaise",
            "minimumCostPaise",
            "maximumCostPaise",
            "averageCostPaise",
            "firstPurchaseDate",
            "lastPurchaseDate",
            "billIds",
            "billLineIds",
        ] {
            object.remove(key);
        }
    }
    material
}

fn mapping_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

fn historical_size_matches(source: &str, target: &str) -> bool {
    if source.is_empty() {
        return true;
    }
    match (historical_measure(source), historical_measure(target)) {
        (Some(source), Some(target)) => source == target,
        (Some(_), None) => false,
        _ => normalized_mapping_text(target).contains(&normalized_mapping_text(source)),
    }
}

fn historical_variant_matches(source: &str, target: &str) -> bool {
    if source.is_empty() {
        return true;
    }
    let normalized = source.trim().to_ascii_lowercase();
    if normalized
        .chars()
        .all(|value| value.is_ascii_digit() || value == '.')
    {
        return target
            .to_ascii_lowercase()
            .split(|value: char| !(value.is_ascii_digit() || value == '.'))
            .any(|value| value == normalized);
    }
    normalized_mapping_text(target).contains(&normalized_mapping_text(source))
}

fn historical_measure(value: &str) -> Option<(&'static str, i64)> {
    let tokens = value
        .to_ascii_lowercase()
        .split(|value: char| !(value.is_ascii_alphanumeric() || value == '.'))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        for (suffix, kind, multiplier) in [
            ("millilitres", "volume", 1.0),
            ("milliliters", "volume", 1.0),
            ("litres", "volume", 1000.0),
            ("liters", "volume", 1000.0),
            ("ml", "volume", 1.0),
            ("litre", "volume", 1000.0),
            ("liter", "volume", 1000.0),
            ("kg", "weight", 1000.0),
            ("grams", "weight", 1.0),
            ("gram", "weight", 1.0),
            ("g", "weight", 1.0),
            ("l", "volume", 1000.0),
        ] {
            let number = token
                .strip_suffix(suffix)
                .filter(|value| !value.is_empty())
                .or_else(|| (token == suffix && index > 0).then(|| tokens[index - 1].as_str()));
            if let Some(amount) = number.and_then(|value| value.parse::<f64>().ok()) {
                return Some((kind, (amount * multiplier).round() as i64));
            }
        }
    }
    None
}

fn normalized_mapping_text(value: &str) -> String {
    value
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
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
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current: Option<(String, i32)> = sqlx::query_as(
        "SELECT id,current_version FROM historical_purchase_identity_mappings WHERE tenant_id=$1 AND branch_id=$2 AND identity_type=$3 AND LOWER(provider)=LOWER($4) AND source_key=$5 FOR UPDATE",
    ).bind(tenant).bind(branch).bind(kind.as_str()).bind(provider).bind(source_key)
      .fetch_optional(&mut *tx).await?;
    let Some((mapping_id, current_version)) = current else {
        return Ok(None);
    };
    let previous: Option<(String, Option<String>, Option<String>, Value, Value, Value, String)> =
        sqlx::query_as(
            "SELECT decision,target_inventory_item_id,target_supplier_id,source_snapshot,decision_evidence,warnings,reason FROM historical_purchase_identity_mapping_versions WHERE tenant_id=$1 AND branch_id=$2 AND identity_mapping_id=$3 AND mapping_version=$4",
        ).bind(tenant).bind(branch).bind(&mapping_id).bind(version).fetch_optional(&mut *tx).await?;
    let Some((decision, target_product, target_vendor, source, evidence, warnings, reason)) =
        previous
    else {
        return Ok(None);
    };
    let next_version = current_version + 1;
    sqlx::query(
        r#"INSERT INTO historical_purchase_identity_mapping_versions(
             tenant_id,branch_id,identity_mapping_id,mapping_version,decision,
             target_inventory_item_id,target_supplier_id,source_snapshot,decision_evidence,
             warnings,reason,approved_by,rollback_of_version)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(&mapping_id)
    .bind(next_version)
    .bind(&decision)
    .bind(&target_product)
    .bind(&target_vendor)
    .bind(&source)
    .bind(&evidence)
    .bind(&warnings)
    .bind(format!("Rollback to v{version}: {reason}"))
    .bind(actor)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE historical_purchase_identity_mappings SET source_snapshot=$4,current_version=$5,current_decision=$6,target_inventory_item_id=$7,target_supplier_id=$8,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    ).bind(tenant).bind(branch).bind(&mapping_id).bind(&source).bind(next_version)
      .bind(&decision).bind(&target_product).bind(&target_vendor).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(json!({
        "sourceKey":source_key,"provider":provider,"identityType":kind.as_str(),
        "version":next_version,"decision":decision,
        "targetId":target_product.or(target_vendor),"rollbackOfVersion":version,
        "stockEffect":"none","accountingEffect":"none"
    })))
}

pub async fn list_historical_purchase_mapping_versions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: HistoricalPurchaseMappingKind,
    provider: &str,
    source_key: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'version',version.mapping_version,'decision',version.decision,
             'targetId',COALESCE(version.target_inventory_item_id,version.target_supplier_id),
             'source',version.source_snapshot,'evidence',version.decision_evidence,
             'warnings',version.warnings,'reason',version.reason,
             'approvedBy',version.approved_by,'approvedAt',version.approved_at,
             'rollbackOfVersion',version.rollback_of_version)
           FROM historical_purchase_identity_mapping_versions version
           JOIN historical_purchase_identity_mappings mapping
             ON mapping.id=version.identity_mapping_id
            AND mapping.tenant_id=version.tenant_id AND mapping.branch_id=version.branch_id
           WHERE version.tenant_id=$1 AND version.branch_id=$2
             AND mapping.identity_type=$3 AND LOWER(mapping.provider)=LOWER($4)
             AND mapping.source_key=$5
           ORDER BY version.mapping_version DESC"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(kind.as_str())
    .bind(provider)
    .bind(source_key)
    .fetch_all(db)
    .await
}

pub async fn duplicate_resolution_context(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    target_id: &str,
) -> Result<Option<(Value, Value)>, sqlx::Error> {
    let record_sql = match entity {
        MigrationEntity::Clients => {
            "SELECT TO_JSONB(record) FROM clients record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Staff => {
            "SELECT TO_JSONB(record) FROM staff record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Services => {
            "SELECT TO_JSONB(record) FROM services record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Products | MigrationEntity::Inventory => {
            "SELECT TO_JSONB(record) FROM inventory_items record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Suppliers => {
            "SELECT TO_JSONB(record) FROM suppliers record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Memberships => {
            "SELECT TO_JSONB(record) FROM memberships record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::ClientMemberships => {
            "SELECT TO_JSONB(record) FROM client_memberships record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Packages => {
            "SELECT TO_JSONB(record) FROM packages record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Appointments => {
            "SELECT TO_JSONB(record) FROM appointments record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Sales | MigrationEntity::Invoices => {
            "SELECT TO_JSONB(record) FROM pos_sales record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Payments => {
            "SELECT TO_JSONB(record) FROM pos_payments record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Expenses => {
            "SELECT TO_JSONB(record) FROM outgoing_fund_vouchers record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::PurchaseBills => {
            "SELECT TO_JSONB(record) FROM purchase_receipts record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Refunds => {
            "SELECT TO_JSONB(record) FROM pos_invoice_refunds record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::GiftCards => {
            "SELECT TO_JSONB(record) FROM gift_cards record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Loyalty => {
            "SELECT TO_JSONB(record) FROM membership_reward_ledger record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Payroll => {
            "SELECT TO_JSONB(record) FROM staff_payroll_items record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Commissions => {
            "SELECT TO_JSONB(record) FROM pos_staff_commission_snapshots record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::ClientNotes => {
            "SELECT TO_JSONB(record) FROM client_notes record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::StockMovements => {
            "SELECT TO_JSONB(record) FROM inventory_stock_ledger record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::OpeningPayables => {
            "SELECT TO_JSONB(record) FROM supplier_opening_payables record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
        }
        MigrationEntity::Files => return Ok(None),
    };
    let Some(record) = sqlx::query_scalar(record_sql)
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .fetch_optional(db)
        .await?
    else {
        return Ok(None);
    };
    let dependency_sql = match entity {
        MigrationEntity::Clients => Some(
            "SELECT JSONB_BUILD_OBJECT('appointments',(SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3),'sales',(SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3),'memberships',(SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3),'notes',(SELECT COUNT(*) FROM client_notes WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3))",
        ),
        MigrationEntity::Staff => Some(
            "SELECT JSONB_BUILD_OBJECT('appointments',(SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3),'sales',(SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3),'payrollItems',(SELECT COUNT(*) FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3),'commissions',(SELECT COUNT(*) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3))",
        ),
        MigrationEntity::Services => Some(
            "SELECT JSONB_BUILD_OBJECT('staffAssignments',(SELECT COUNT(*) FROM staff_service_assignments WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3),'variants',(SELECT COUNT(*) FROM service_variants WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3),'addons',(SELECT COUNT(*) FROM service_addons WHERE tenant_id=$1 AND branch_id=$2 AND service_id=$3))",
        ),
        MigrationEntity::Products => Some(
            "SELECT JSONB_BUILD_OBJECT('stockMovements',(SELECT COUNT(*) FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3),'saleLines',(SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND item_id=$3))",
        ),
        MigrationEntity::Suppliers => Some(
            "SELECT JSONB_BUILD_OBJECT('purchaseReceipts',(SELECT COUNT(*) FROM purchase_receipts WHERE tenant_id=$1 AND branch_id=$2 AND supplier_id=$3))",
        ),
        MigrationEntity::Memberships => Some(
            "SELECT JSONB_BUILD_OBJECT('clientMemberships',(SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND membership_id=$3))",
        ),
        MigrationEntity::Packages => Some(
            "SELECT JSONB_BUILD_OBJECT('clientPackageCredits',(SELECT COUNT(*) FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND package_id=$3))",
        ),
        _ => None,
    };
    let dependencies = if let Some(sql) = dependency_sql {
        sqlx::query_scalar(sql)
            .bind(tenant)
            .bind(branch)
            .bind(target_id)
            .fetch_one(db)
            .await?
    } else {
        json!({})
    };
    Ok(Some((record, dependencies)))
}

pub async fn list_jobs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ImportJob>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ImportJobRow>(&format!(
        "SELECT {COLUMNS} FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200"
    ))
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await?;
    rows.into_iter().map(into_import_job).collect()
}

fn dependency_rank(entity: MigrationEntity) -> i32 {
    match entity {
        MigrationEntity::Clients => 0,
        MigrationEntity::Staff
        | MigrationEntity::Services
        | MigrationEntity::Products
        | MigrationEntity::Suppliers => 1,
        MigrationEntity::Memberships
        | MigrationEntity::Packages
        | MigrationEntity::Inventory
        | MigrationEntity::PurchaseBills
        | MigrationEntity::Payroll => 2,
        MigrationEntity::ClientMemberships
        | MigrationEntity::Appointments
        | MigrationEntity::ClientNotes => 3,
        MigrationEntity::Sales | MigrationEntity::Invoices | MigrationEntity::Expenses => 4,
        MigrationEntity::Payments | MigrationEntity::Refunds | MigrationEntity::GiftCards => 5,
        MigrationEntity::Loyalty
        | MigrationEntity::Commissions
        | MigrationEntity::StockMovements
        | MigrationEntity::OpeningPayables
        | MigrationEntity::Files => 6,
    }
}

pub(crate) async fn sync_job_dependencies(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    job_id: &str,
    entity: MigrationEntity,
    source_hash: &str,
) -> Result<(), sqlx::Error> {
    if source_hash.is_empty() {
        return Ok(());
    }
    let related: Vec<(String, String)> = sqlx::query_as(
        "SELECT id,entity FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND source_hash=$3 AND mode='commit' AND id<>$4 AND status NOT IN ('cancelled','rolled_back')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(source_hash)
    .bind(job_id)
    .fetch_all(&mut **tx)
    .await?;
    let phase = dependency_rank(entity);
    for (related_id, related_entity) in related {
        let related_entity = decode_enum::<MigrationEntity>(&related_entity, "entity")?;
        let related_phase = dependency_rank(related_entity);
        let (dependent, prerequisite) = if phase > related_phase {
            (job_id, related_id.as_str())
        } else if related_phase > phase {
            (related_id.as_str(), job_id)
        } else {
            continue;
        };
        let inserted = sqlx::query_scalar::<_, i32>(
            "INSERT INTO integration_import_job_dependencies(tenant_id,branch_id,job_id,depends_on_job_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1",
        )
        .bind(tenant)
        .bind(branch)
        .bind(dependent)
        .bind(prerequisite)
        .fetch_optional(&mut **tx)
        .await?;
        if inserted.is_some() {
            sqlx::query(
                r#"UPDATE integration_import_jobs dependent
                   SET status=CASE
                         WHEN dependent.status='queued'
                          AND EXISTS(SELECT 1 FROM integration_import_jobs required
                                     WHERE required.id=$4 AND required.tenant_id=$1
                                       AND required.branch_id=$2 AND required.status<>'completed')
                         THEN 'dependency_pending' ELSE dependent.status END,
                       analysis_json=(COALESCE(dependent.analysis_json,'{}'::JSONB)
                         - 'dependencyDeadlock' - 'dependencyRetryCount')
                         || JSONB_BUILD_OBJECT('dependencyRuleVersion','2026-07-phase8-v1'),
                       last_error=CASE WHEN dependent.last_error LIKE 'DEPENDENCY_%' THEN '' ELSE dependent.last_error END,
                       updated_at=NOW()
                   WHERE dependent.id=$3 AND dependent.tenant_id=$1 AND dependent.branch_id=$2
                     AND dependent.status NOT IN ('completed','cancelled','rolled_back')"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(dependent)
            .bind(prerequisite)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

pub async fn refresh_dependency_jobs(db: &PgPool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    let jobs = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            Option<String>,
            String,
            String,
            Value,
        ),
    >(
        r#"SELECT id,tenant_id,branch_id,source_file_id,worker_phase,approval_status,analysis_json
           FROM integration_import_jobs
           WHERE status='dependency_pending'
           ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 25"#,
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut transitioned = 0_u64;
    for (id, tenant, branch, source_file_id, worker_phase, approval_status, analysis) in jobs {
        let dependencies = sqlx::query_as::<_, (String, String, String, bool)>(
            r#"SELECT required.id,required.entity,required.status,
                      required.tenant_id=$2 AND required.branch_id=$3
               FROM integration_import_job_dependencies dependency
               JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id
               WHERE dependency.job_id=$1 AND dependency.tenant_id=$2 AND dependency.branch_id=$3
               ORDER BY required.created_at"#,
        )
        .bind(&id)
        .bind(&tenant)
        .bind(&branch)
        .fetch_all(&mut *tx)
        .await?;
        let blockers = dependencies
            .iter()
            .filter(|(_, _, status, scoped)| !*scoped || status != "completed")
            .map(|(job_id, entity, status, scoped)| {
                json!({"jobId":job_id,"entity":entity,"status":status,"scopeValid":scoped})
            })
            .collect::<Vec<_>>();
        let terminal_blocker = dependencies.iter().any(|(_, _, status, scoped)| {
            !*scoped || matches!(status.as_str(), "failed" | "cancelled" | "rolled_back")
        });
        if dependencies.is_empty() || terminal_blocker {
            let code = if dependencies.is_empty() {
                "DEPENDENCY_UPSTREAM_JOB_MISSING"
            } else {
                "DEPENDENCY_UPSTREAM_TERMINAL"
            };
            if analysis
                .pointer("/dependencyDeadlock/code")
                .and_then(Value::as_str)
                == Some(code)
            {
                continue;
            }
            let deadlock = json!({
                "code": code,
                "blockers": blockers,
                "detectedAt": Utc::now(),
            });
            sqlx::query(
                "UPDATE integration_import_jobs SET analysis_json=(COALESCE(analysis_json,'{}'::JSONB)-'dependencyDeadlock')||JSONB_BUILD_OBJECT('dependencyDeadlock',$4::JSONB,'dependencyRuleVersion','2026-07-phase8-v1'),last_error=$5,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='dependency_pending'",
            )
            .bind(&id)
            .bind(&tenant)
            .bind(&branch)
            .bind(&deadlock)
            .bind(code)
            .execute(&mut *tx)
            .await?;
            insert_audit(
                &mut tx,
                &tenant,
                &branch,
                Some(&id),
                None,
                "migration.dependencies.deadlock",
                "failure",
                "migration-worker",
                deadlock,
            )
            .await?;
            continue;
        }
        if !blockers.is_empty() {
            continue;
        }

        let pending_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='dependency_pending'",
        )
        .bind(&tenant)
        .bind(&branch)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        let retry_count = analysis
            .get("dependencyRetryCount")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if pending_rows > 0 {
            if source_file_id.is_some() && retry_count < 1 {
                sqlx::query(
                    "UPDATE integration_import_jobs SET status='staging',worker_phase='staging',worker_id='',lease_expires_at=NULL,last_error='',analysis_json=(COALESCE(analysis_json,'{}'::JSONB)-'dependencyDeadlock')||JSONB_BUILD_OBJECT('dependencyRetryCount',$4,'dependencyRuleVersion','2026-07-phase8-v1'),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='dependency_pending'",
                )
                .bind(&id)
                .bind(&tenant)
                .bind(&branch)
                .bind(retry_count + 1)
                .execute(&mut *tx)
                .await?;
                insert_audit(
                    &mut tx,
                    &tenant,
                    &branch,
                    Some(&id),
                    None,
                    "migration.dependencies.retry_queued",
                    "success",
                    "migration-worker",
                    json!({"pendingRows":pending_rows,"retryCount":retry_count + 1}),
                )
                .await?;
                transitioned += 1;
            } else {
                let code = if source_file_id.is_some() {
                    "DEPENDENCY_DEADLOCK"
                } else {
                    "DEPENDENCY_RETRY_REQUIRES_IMMUTABLE_SOURCE"
                };
                if analysis
                    .pointer("/dependencyDeadlock/code")
                    .and_then(Value::as_str)
                    == Some(code)
                {
                    continue;
                }
                let deadlock = json!({
                    "code": code,
                    "pendingRows": pending_rows,
                    "retryCount": retry_count,
                    "detectedAt": Utc::now(),
                });
                sqlx::query(
                    "UPDATE integration_import_jobs SET analysis_json=(COALESCE(analysis_json,'{}'::JSONB)-'dependencyDeadlock')||JSONB_BUILD_OBJECT('dependencyDeadlock',$4::JSONB,'dependencyRuleVersion','2026-07-phase8-v1'),last_error=$5,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='dependency_pending'",
                )
                .bind(&id)
                .bind(&tenant)
                .bind(&branch)
                .bind(&deadlock)
                .bind(code)
                .execute(&mut *tx)
                .await?;
                insert_audit(
                    &mut tx,
                    &tenant,
                    &branch,
                    Some(&id),
                    None,
                    "migration.dependencies.deadlock",
                    "failure",
                    "migration-worker",
                    deadlock,
                )
                .await?;
            }
            continue;
        }

        let next_status = if matches!(approval_status.as_str(), "approved" | "not_required") {
            "queued"
        } else {
            "validated"
        };
        if source_file_id.is_some() && next_status == "queued" {
            sqlx::query("UPDATE integration_import_chunks SET status=CASE WHEN ready_rows>0 THEN 'pending' ELSE 'completed' END,completed_at=CASE WHEN ready_rows=0 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='staged'")
                .bind(&tenant).bind(&branch).bind(&id).execute(&mut *tx).await?;
        }
        let next_phase = if source_file_id.is_some() && next_status == "queued" {
            "import"
        } else {
            &worker_phase
        };
        sqlx::query(
            "UPDATE integration_import_jobs SET status=$4,worker_phase=$5,worker_id='',lease_expires_at=NULL,last_error='',analysis_json=COALESCE(analysis_json,'{}'::JSONB)-'dependencyDeadlock',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='dependency_pending'",
        )
        .bind(&id)
        .bind(&tenant)
        .bind(&branch)
        .bind(next_status)
        .bind(next_phase)
        .execute(&mut *tx)
        .await?;
        insert_audit(
            &mut tx,
            &tenant,
            &branch,
            Some(&id),
            None,
            "migration.dependencies.released",
            "success",
            "migration-worker",
            json!({"status":next_status}),
        )
        .await?;
        transitioned += 1;
    }
    tx.commit().await?;
    Ok(transitioned)
}

pub async fn monitoring_counts(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<MigrationMonitoringCounts, sqlx::Error> {
    let status_rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT status,COUNT(*) FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 GROUP BY status",
    )
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await?;
    let (queue_depth, stale_workers, failed_24h, overdue_approvals, dependency_deadlocks) =
        sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
            "SELECT
                COUNT(*) FILTER (WHERE status IN ('staging','dependency_pending','queued')),
                COUNT(*) FILTER (WHERE status IN ('staging','processing') AND COALESCE(heartbeat_at,updated_at) < NOW() - INTERVAL '5 minutes'),
                COUNT(*) FILTER (WHERE status='failed' AND updated_at >= NOW() - INTERVAL '24 hours'),
                COUNT(*) FILTER (WHERE approval_status='pending' AND approval_requested_at < NOW() - INTERVAL '30 minutes'),
                COUNT(*) FILTER (WHERE status='dependency_pending' AND analysis_json ? 'dependencyDeadlock')
             FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2",
        )
        .bind(tenant)
        .bind(branch)
        .fetch_one(db)
        .await?;
    Ok(MigrationMonitoringCounts {
        status_counts: status_rows.into_iter().collect(),
        queue_depth,
        stale_workers,
        failed_24h,
        overdue_approvals,
        dependency_deadlocks,
    })
}

pub async fn assign_job_owner(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    owner: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let affected = sqlx::query(
        "UPDATE integration_import_jobs SET owner_user_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status IN ('pending','not_required')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(owner)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected > 0 {
        insert_audit(
            &mut tx,
            tenant,
            branch,
            Some(id),
            None,
            "migration.governance.owner_assigned",
            "success",
            actor,
            json!({"ownerUserId":owner}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(affected > 0)
}

pub async fn approve_yellow_warnings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let job = sqlx::query_as::<_, (String, i32, String)>(
        "SELECT owner_user_id,warning_row_count,approval_status FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((owner, warning_rows, approval_status)) = job else {
        tx.rollback().await?;
        return Ok(false);
    };
    if owner != actor || approval_status != "pending" || warning_rows <= 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        "UPDATE integration_import_jobs SET analysis_json=COALESCE(analysis_json,'{}'::JSONB)||JSONB_BUILD_OBJECT('yellowApproval',JSONB_BUILD_OBJECT('approved',TRUE,'approvedBy',$4,'approvedAt',NOW(),'warningRows',$5)),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(actor)
    .bind(warning_rows)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE integration_import_row_results SET status='warning',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='approval_required'")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(id),
        None,
        "migration.governance.yellow_approved",
        "success",
        actor,
        json!({"warningRows":warning_rows}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn approve_opening_payable_controls(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    opening_balance_account: &str,
    payable_account: &str,
    supplier_advance_account: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    if !matches!(
        opening_balance_account,
        "OWNER_EQUITY" | "RETAINED_EARNINGS"
    ) || payable_account != "ACCOUNTS_PAYABLE"
        || supplier_advance_account != "SUPPLIER_ADVANCE_ASSET"
    {
        return Ok(false);
    }
    let preview = opening_payable_preview(db, tenant, branch, id).await?;
    if preview.get("status").and_then(Value::as_str) != Some("ready") {
        return Ok(false);
    }
    let summary = preview.get("summary").and_then(Value::as_object);
    let data_hash = summary
        .and_then(|value| value.get("dataHash"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if data_hash.is_empty()
        || summary
            .and_then(|value| value.get("openingBalanceAccount"))
            .and_then(Value::as_str)
            != Some(opening_balance_account)
    {
        return Ok(false);
    }
    let mut tx = db.begin().await?;
    let job = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT entity,status,approval_status,source_hash FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((entity, status, approval_status, source_hash)) = job else {
        tx.rollback().await?;
        return Ok(false);
    };
    let current_data_hash: String = sqlx::query_scalar(
        "SELECT ENCODE(DIGEST(COALESCE(STRING_AGG(source_payload::TEXT,'|' ORDER BY source_sheet,source_row_number),''),'sha256'),'hex') FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if entity != MigrationEntity::OpeningPayables.as_str()
        || status != "validated"
        || approval_status != "pending"
        || current_data_hash != data_hash
    {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        r#"UPDATE integration_import_jobs
              SET analysis_json=COALESCE(analysis_json,'{}'::JSONB)||JSONB_BUILD_OBJECT(
                'openingPayableControls',JSONB_BUILD_OBJECT(
                  'financeApproved',TRUE,'approvedBy',$4,'approvedAt',NOW(),
                  'sourceHash',$5,'dataHash',$6,'openingBalanceAccount',$7,
                  'payableAccount',$8,'supplierAdvanceAccount',$9,'note',$10)),updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(actor)
    .bind(&source_hash)
    .bind(&data_hash)
    .bind(opening_balance_account)
    .bind(payable_account)
    .bind(supplier_advance_account)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(id),
        None,
        "migration.opening_payable.finance_approved",
        "success",
        actor,
        json!({
            "sourceHash":source_hash,
            "dataHash":data_hash,
            "openingBalanceAccount":opening_balance_account,
            "payableAccount":payable_account,
            "supplierAdvanceAccount":supplier_advance_account,
            "note":note
        }),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn confirm_opening_payable_branch(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    confirmed: bool,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let preview = opening_payable_preview(db, tenant, branch, id).await?;
    if preview.get("status").and_then(Value::as_str) != Some("ready") {
        return Ok(false);
    }
    let mut tx = db.begin().await?;
    let job = sqlx::query_as::<_, (String, String, String, String, Value)>(
        "SELECT entity,status,approval_status,source_hash,analysis_json FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((entity, status, approval_status, source_hash, analysis)) = job else {
        tx.rollback().await?;
        return Ok(false);
    };
    let data_hash: String = sqlx::query_scalar(
        "SELECT ENCODE(DIGEST(COALESCE(STRING_AGG(source_payload::TEXT,'|' ORDER BY source_sheet,source_row_number),''),'sha256'),'hex') FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let finance_approved_at = analysis
        .pointer("/openingPayableControls/approvedAt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if entity != MigrationEntity::OpeningPayables.as_str()
        || status != "validated"
        || approval_status != "pending"
        || finance_approved_at.is_empty()
        || analysis
            .pointer("/openingPayableControls/financeApproved")
            .and_then(Value::as_bool)
            != Some(true)
        || analysis
            .pointer("/openingPayableControls/sourceHash")
            .and_then(Value::as_str)
            != Some(source_hash.as_str())
        || analysis
            .pointer("/openingPayableControls/dataHash")
            .and_then(Value::as_str)
            != Some(data_hash.as_str())
    {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        r#"UPDATE integration_import_jobs
              SET analysis_json=COALESCE(analysis_json,'{}'::JSONB)||JSONB_BUILD_OBJECT(
                'openingPayableBranchConfirmation',JSONB_BUILD_OBJECT(
                  'confirmed',$4,'approvedBy',$5,'approvedAt',NOW(),'sourceHash',$6,
                  'dataHash',$7,'financeApprovedAt',$8,'note',$9)),updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(confirmed)
    .bind(actor)
    .bind(&source_hash)
    .bind(&data_hash)
    .bind(finance_approved_at)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(id),
        None,
        if confirmed {
            "migration.opening_payable.branch_confirmed"
        } else {
            "migration.opening_payable.branch_rejected"
        },
        "success",
        actor,
        json!({"confirmed":confirmed,"sourceHash":source_hash,"dataHash":data_hash,"financeApprovedAt":finance_approved_at,"note":note}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn decide_approval(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    approved: bool,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let job = sqlx::query_as::<_, (String, String, Option<String>, String, i32, Value, bool, String, String)>(
        "SELECT status,worker_phase,source_file_id,owner_user_id,warning_row_count,analysis_json,allow_partial_import,entity,source_hash FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status='pending' FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((
        status,
        worker_phase,
        source_file_id,
        owner,
        warning_rows,
        analysis,
        allow_partial_import,
        entity,
        source_hash,
    )) = job
    else {
        tx.rollback().await?;
        return Ok(false);
    };
    if owner != actor && entity != MigrationEntity::OpeningPayables.as_str() {
        tx.rollback().await?;
        return Ok(false);
    }

    if approved {
        let (red_rows, dependency_rows, unresolved_duplicates): (i64, i64, i64) = sqlx::query_as(
            "SELECT COUNT(*) FILTER(WHERE status IN ('error','quarantined','failed')),COUNT(*) FILTER(WHERE status='dependency_pending'),COUNT(*) FILTER(WHERE status='duplicate' AND COALESCE(duplicate_decision,'') NOT IN ('merge','keep','link')) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        let yellow_approved = warning_rows == 0
            || (analysis
                .pointer("/yellowApproval/approved")
                .and_then(Value::as_bool)
                == Some(true)
                && analysis
                    .pointer("/yellowApproval/warningRows")
                    .and_then(Value::as_i64)
                    == Some(i64::from(warning_rows)));
        let opening_controls_approved = if entity == MigrationEntity::OpeningPayables.as_str() {
            let current_data_hash: String = sqlx::query_scalar(
                "SELECT ENCODE(DIGEST(COALESCE(STRING_AGG(source_payload::TEXT,'|' ORDER BY source_sheet,source_row_number),''),'sha256'),'hex') FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
            )
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
            analysis
                .pointer("/openingPayableControls/financeApproved")
                .and_then(Value::as_bool)
                == Some(true)
                && analysis
                    .pointer("/openingPayableControls/sourceHash")
                    .and_then(Value::as_str)
                    == Some(source_hash.as_str())
                && analysis
                    .pointer("/openingPayableControls/dataHash")
                    .and_then(Value::as_str)
                    == Some(current_data_hash.as_str())
                && matches!(
                    analysis
                        .pointer("/openingPayableControls/openingBalanceAccount")
                        .and_then(Value::as_str),
                    Some("OWNER_EQUITY" | "RETAINED_EARNINGS")
                )
                && analysis
                    .pointer("/openingPayableControls/payableAccount")
                    .and_then(Value::as_str)
                    == Some("ACCOUNTS_PAYABLE")
                && analysis
                    .pointer("/openingPayableControls/supplierAdvanceAccount")
                    .and_then(Value::as_str)
                    == Some("SUPPLIER_ADVANCE_ASSET")
                && analysis
                    .pointer("/openingPayableBranchConfirmation/confirmed")
                    .and_then(Value::as_bool)
                    == Some(true)
                && analysis
                    .pointer("/openingPayableBranchConfirmation/sourceHash")
                    .and_then(Value::as_str)
                    == Some(source_hash.as_str())
                && analysis
                    .pointer("/openingPayableBranchConfirmation/dataHash")
                    .and_then(Value::as_str)
                    == Some(current_data_hash.as_str())
                && analysis
                    .pointer("/openingPayableBranchConfirmation/financeApprovedAt")
                    .and_then(Value::as_str)
                    == analysis
                        .pointer("/openingPayableControls/approvedAt")
                        .and_then(Value::as_str)
        } else {
            true
        };
        if status != "validated"
            || red_rows > 0 && !allow_partial_import
            || dependency_rows > 0
            || unresolved_duplicates > 0
            || !yellow_approved
            || !opening_controls_approved
        {
            tx.rollback().await?;
            return Ok(false);
        }
        let unmet_dependencies: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1 FROM integration_import_job_dependencies dependency
                 JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id
                 WHERE dependency.job_id=$1 AND dependency.tenant_id=$2 AND dependency.branch_id=$3
                   AND (required.tenant_id<>$2 OR required.branch_id<>$3 OR required.status<>'completed'))"#,
        )
        .bind(id)
        .bind(tenant)
        .bind(branch)
        .fetch_one(&mut *tx)
        .await?;
        if source_file_id.is_some()
            && status == "validated"
            && worker_phase == "staging"
            && !unmet_dependencies
        {
            sqlx::query("UPDATE integration_import_chunks SET status=CASE WHEN ready_rows>0 THEN 'pending' ELSE 'completed' END,completed_at=CASE WHEN ready_rows=0 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='staged'")
                .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        }
        let next_status = if status == "validated" && unmet_dependencies {
            "dependency_pending"
        } else if status == "validated" {
            "queued"
        } else {
            &status
        };
        let next_phase = if source_file_id.is_some() && status == "validated" && !unmet_dependencies
        {
            "import"
        } else {
            &worker_phase
        };
        sqlx::query(
            "UPDATE integration_import_jobs SET approval_status='approved',approval_decided_at=NOW(),approval_decided_by=$4,approval_note=$5,status=$6,worker_phase=$7,last_error=CASE WHEN $6='dependency_pending' THEN 'DEPENDENCY_PENDING' ELSE last_error END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(note)
        .bind(next_status).bind(next_phase)
        .execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE integration_import_chunks SET status='cancelled',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status IN ('staged','pending','processing','failed')")
            .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        sqlx::query(
            "UPDATE integration_import_jobs SET approval_status='rejected',approval_decided_at=NOW(),approval_decided_by=$4,approval_note=$5,status='cancelled',worker_id='',lease_expires_at=NULL,cancelled_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(note)
        .execute(&mut *tx).await?;
    }
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(id),
        None,
        if approved {
            "migration.governance.approved"
        } else {
            "migration.governance.rejected"
        },
        "success",
        actor,
        json!({"approved":approved,"note":note}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn rollback_impact(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let job = sqlx::query_as::<_, (String, String)>(
        "SELECT entity,status FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant).bind(branch).bind(id).fetch_optional(db).await?;
    let Some((entity, status)) = job else {
        return Ok(None);
    };
    let (created, merged, linked, kept): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*) FILTER(WHERE action='created')::BIGINT,COUNT(*) FILTER(WHERE action='merged')::BIGINT,COUNT(*) FILTER(WHERE action='linked')::BIGINT,COUNT(*) FILTER(WHERE action='kept')::BIGINT FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let dependencies: Value =
        sqlx::query_scalar("SELECT migration_import_dependency_impact($1,$2,$3)")
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .fetch_one(db)
            .await?;
    let blocking = dependencies
        .get("blockingRecords")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let snapshot_live_movements: i64 = if entity == MigrationEntity::Inventory.as_str() {
        sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT
                 FROM integration_opening_inventory_snapshots snapshot
                 JOIN integration_opening_inventory_snapshot_lines line ON line.snapshot_id=snapshot.id
                 JOIN inventory_stock_ledger movement
                   ON movement.tenant_id=line.tenant_id AND movement.branch_id=line.branch_id
                  AND movement.inventory_item_id=line.inventory_item_id
                  AND movement.created_at>line.applied_at
                  AND movement.movement_type<>'opening_snapshot'
                  AND movement.reversal_of_ledger_id IS NULL
                  AND (movement.inventory_location_code=line.location_code OR movement.inventory_location_code IS NULL)
                WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_one(db)
        .await?
    } else {
        0
    };
    let opening_payable_settlements: i64 = if entity == MigrationEntity::OpeningPayables.as_str() {
        sqlx::query_scalar(
            r#"SELECT
                 (SELECT COUNT(*) FROM supplier_payments payment
                   WHERE payment.tenant_id=opening.tenant_id AND payment.branch_id=opening.branch_id
                     AND payment.supplier_id IN (SELECT line.supplier_id FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
                     AND payment.paid_at>=opening.applied_at)
                 +(SELECT COUNT(*) FROM supplier_advances advance
                   WHERE advance.tenant_id=opening.tenant_id AND advance.branch_id=opening.branch_id
                     AND advance.supplier_id IN (SELECT line.supplier_id FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
                     AND advance.paid_at>=opening.applied_at)
                 FROM supplier_opening_payable_imports opening
                WHERE opening.tenant_id=$1 AND opening.branch_id=$2 AND opening.import_job_id=$3
                  AND opening.rolled_back_at IS NULL"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_optional(db)
        .await?
        .unwrap_or(0)
    } else {
        0
    };
    Ok(Some(json!({
        "jobId": id,
        "entity": entity,
        "jobStatus": status,
        "safeToRollback": status == "completed" && blocking == 0 && snapshot_live_movements == 0 && opening_payable_settlements == 0,
        "actions": {"wouldDelete":created+kept,"wouldRestore":merged,"wouldUnlink":linked,"noChange":0},
        "dependencies": dependencies,
        "calculatedRecovery": {
            "snapshotLiveMovements": snapshot_live_movements,
            "openingPayableSettlementEvents": opening_payable_settlements,
            "preserveLiveMovements": snapshot_live_movements > 0,
            "requiresManualRecovery": snapshot_live_movements > 0 || opening_payable_settlements > 0
        }
    })))
}

async fn opening_payable_preview(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH scoped AS (
             SELECT result.source_sheet,result.source_row_number,result.status,result.error_code,
                    result.message,result.source_payload payload,job.entity,job.source_hash,
                    job.approval_status,job.approval_decided_by,job.analysis_json,
                    job.analysis_json->'postingContract'->>'cutoverId' cutover_id
               FROM integration_import_row_results result
               JOIN integration_import_jobs job ON job.id=result.job_id
                AND job.tenant_id=result.tenant_id AND job.branch_id=result.branch_id
              WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
           ), allocation_checks AS (
             SELECT scoped.source_sheet,scoped.source_row_number,
                    CASE WHEN allocation.item->>'amountPaise' ~ '^[0-9]+$'
                      THEN (allocation.item->>'amountPaise')::BIGINT ELSE 0 END amount_paise,
                    (COUNT(*) OVER(PARTITION BY allocation.item->>'historicalBillId')>1 OR NOT EXISTS(
                      SELECT 1 FROM historical_purchase_bills bill
                      JOIN historical_purchase_identity_mappings mapping
                        ON mapping.tenant_id=bill.tenant_id AND mapping.branch_id=bill.branch_id
                       AND mapping.identity_type='vendor' AND mapping.provider=bill.provider
                       AND mapping.source_key=ENCODE(DIGEST(CONCAT_WS('|',bill.provider,CASE
                         WHEN BTRIM(bill.supplier_external_id)<>'' THEN 'provider:'||LOWER(BTRIM(bill.supplier_external_id))
                         WHEN BTRIM(bill.supplier_gstin)<>'' THEN 'gstin:'||UPPER(BTRIM(bill.supplier_gstin))
                         WHEN BTRIM(bill.supplier_code)<>'' THEN 'code:'||LOWER(BTRIM(bill.supplier_code))
                         ELSE CONCAT_WS(':','attributes',REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_name)),'[^a-z0-9]+','','g'),REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_phone)),'[^0-9]+','','g'),LOWER(BTRIM(bill.supplier_email))) END),'sha256'),'hex')
                       AND mapping.current_decision IN ('link','create')
                       AND mapping.target_supplier_id=scoped.payload->>'supplier_id'
                     WHERE bill.tenant_id=$1 AND bill.branch_id=$2
                       AND bill.id=allocation.item->>'historicalBillId'
                       AND bill.cutover_id=scoped.cutover_id
                       AND LOWER(BTRIM(bill.payment_status)) NOT IN ('paid','settled')
                       AND LOWER(BTRIM(bill.source_status)) NOT IN ('cancelled','canceled','void','voided','rejected')
                       AND LOWER(BTRIM(bill.document_type)) NOT IN ('cancelled','canceled','void','voided')
                       AND CASE WHEN allocation.item->>'amountPaise' ~ '^[0-9]+$'
                         THEN (allocation.item->>'amountPaise')::BIGINT ELSE 0 END
                           BETWEEN 1 AND GREATEST(bill.total_paise,0)
                       AND NOT EXISTS(
                         SELECT 1 FROM supplier_opening_payable_allocations existing
                         JOIN supplier_opening_payables existing_line ON existing_line.id=existing.opening_payable_id
                         JOIN supplier_opening_payable_imports existing_import ON existing_import.id=existing_line.opening_import_id
                        WHERE existing.historical_bill_id=bill.id AND existing.rolled_back_at IS NULL
                          AND existing_import.import_job_id<>$3)
                    )) invalid
               FROM scoped
               CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(CASE
                 WHEN JSONB_TYPEOF(scoped.payload->'allocations')='array' THEN scoped.payload->'allocations'
                 ELSE '[]'::JSONB END) allocation(item)
           ), allocation_totals AS (
             SELECT source_sheet,source_row_number,COALESCE(SUM(amount_paise),0)::BIGINT allocated_paise,
                    COALESCE(BOOL_OR(invalid),FALSE) invalid
               FROM allocation_checks GROUP BY source_sheet,source_row_number
           ), normalized AS (
             SELECT scoped.*,
                    COALESCE((payload->>'amount_paise')::BIGINT,0) amount_paise,
                    COALESCE((payload->>'source_outstanding_total_paise')::BIGINT,0) source_total_paise,
                    COALESCE((payload->>'gst_paise')::BIGINT,0) gst_paise,
                    COALESCE(allocation.allocated_paise,0) allocated_paise,
                    COALESCE((payload->>'unallocated_paise')::BIGINT,0) unallocated_paise,
                    COALESCE((payload->>'unallocated_approved')::BOOLEAN,FALSE) unallocated_approved,
                    COALESCE(allocation.invalid,FALSE) invalid_allocation
               FROM scoped LEFT JOIN allocation_totals allocation USING(source_sheet,source_row_number)
           ), totals AS (
             SELECT COUNT(*) rows,
                    COALESCE(SUM(amount_paise) FILTER(WHERE payload->>'balance_side'='credit'),0)::BIGINT credit_paise,
                    COALESCE(SUM(amount_paise) FILTER(WHERE payload->>'balance_side'='debit'),0)::BIGINT debit_paise,
                    COALESCE(SUM(allocated_paise),0)::BIGINT allocated_paise,
                    COALESCE(SUM(unallocated_paise),0)::BIGINT unallocated_paise,
                    COALESCE(SUM(gst_paise),0)::BIGINT gst_paise,
                    COALESCE(MAX(source_total_paise),0)::BIGINT source_total_paise,
                    COUNT(DISTINCT source_total_paise) source_total_versions,
                    COUNT(DISTINCT payload->>'currency') currency_versions,
                    COUNT(DISTINCT payload->>'opening_balance_account') account_versions,
                    MAX(payload->>'currency') currency,
                    MAX(payload->>'opening_balance_account') opening_balance_account,
                    COUNT(*) FILTER(WHERE status IN ('error','quarantined','failed')) blocking_rows,
                    COUNT(*) FILTER(WHERE invalid_allocation OR allocated_paise>amount_paise
                      OR unallocated_paise<>amount_paise-allocated_paise
                      OR (unallocated_paise>0 AND NOT unallocated_approved)) allocation_blockers,
                    ENCODE(DIGEST(COALESCE(STRING_AGG(payload::TEXT,'|' ORDER BY source_sheet,source_row_number),''),'sha256'),'hex') data_hash
               FROM normalized
           )
           SELECT CASE WHEN COALESCE((SELECT entity FROM scoped LIMIT 1),'')<>'opening-payables'
             THEN JSONB_BUILD_OBJECT('status','not_applicable','rows','[]'::JSONB,'summary','{}'::JSONB,'controls','{}'::JSONB)
             ELSE JSONB_BUILD_OBJECT(
               'status',CASE WHEN totals.rows>0 AND totals.blocking_rows=0 AND totals.allocation_blockers=0
                  AND totals.gst_paise=0 AND totals.currency_versions=1 AND totals.currency='INR'
                  AND totals.account_versions=1 AND totals.source_total_versions=1
                  AND totals.credit_paise-totals.debit_paise=totals.source_total_paise
                 THEN 'ready' ELSE 'blocked' END,
               'rows',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                 'sourceRowNumber',source_row_number,'supplierId',payload->>'supplier_id',
                 'balanceSide',payload->>'balance_side','amountPaise',amount_paise,
                 'currency',payload->>'currency','dueDate',NULLIF(payload->>'due_date',''),
                 'allocatedPaise',allocated_paise,'unallocatedPaise',unallocated_paise,
                 'unallocatedApproved',unallocated_approved,'gstPaise',gst_paise,
                 'status',CASE WHEN status IN ('error','quarantined','failed') OR invalid_allocation
                   OR allocated_paise>amount_paise OR unallocated_paise<>amount_paise-allocated_paise
                   OR (unallocated_paise>0 AND NOT unallocated_approved) THEN 'blocked' ELSE 'ready' END,
                 'errorCode',NULLIF(error_code,''),'message',CASE WHEN invalid_allocation
                   THEN 'Historical bill allocation is invalid' ELSE NULLIF(message,'') END
               ) ORDER BY source_row_number) FROM normalized),'[]'::JSONB),
               'summary',JSONB_BUILD_OBJECT(
                 'rows',totals.rows,'creditPaise',totals.credit_paise,'debitPaise',totals.debit_paise,
                 'allocatedPaise',totals.allocated_paise,'unallocatedPaise',totals.unallocated_paise,
                 'sourcePaise',totals.source_total_paise,
                 'expectedPaise',totals.credit_paise-totals.debit_paise,
                 'differencePaise',totals.credit_paise-totals.debit_paise-totals.source_total_paise,
                 'gstPaise',totals.gst_paise,'currency',totals.currency,
                 'openingBalanceAccount',totals.opening_balance_account,
                 'blockingRows',totals.blocking_rows+totals.allocation_blockers,
                 'sourceHash',(SELECT source_hash FROM scoped LIMIT 1),'dataHash',totals.data_hash),
               'controls',COALESCE((SELECT JSONB_BUILD_OBJECT(
                 'financeApproved',COALESCE((analysis_json->'openingPayableControls'->>'financeApproved')::BOOLEAN,FALSE),
                 'financeApprovedBy',analysis_json->'openingPayableControls'->>'approvedBy',
                 'financeApprovedAt',analysis_json->'openingPayableControls'->>'approvedAt',
                 'branchConfirmed',COALESCE((analysis_json->'openingPayableBranchConfirmation'->>'confirmed')::BOOLEAN,FALSE),
                 'branchConfirmedBy',analysis_json->'openingPayableBranchConfirmation'->>'approvedBy',
                 'branchConfirmedAt',analysis_json->'openingPayableBranchConfirmation'->>'approvedAt',
                 'ownerApproved',approval_status='approved','ownerApprovedBy',approval_decided_by,
                 'openingBalanceAccount',analysis_json->'openingPayableControls'->>'openingBalanceAccount',
                 'payableAccount',analysis_json->'openingPayableControls'->>'payableAccount',
                 'supplierAdvanceAccount',analysis_json->'openingPayableControls'->>'supplierAdvanceAccount'
               ) FROM scoped LIMIT 1),'{}'::JSONB)
             ) END FROM totals"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await
}

pub async fn governance_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let job: Option<Value> = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'jobId',id,'branchId',branch_id,'entity',entity,'fileName',file_name,'mode',mode,'status',status,
             'sourceHash',source_hash,'sourceProvider',SPLIT_PART(source_type,'|',1),'sourceFileId',source_file_id,'ownerUserId',owner_user_id,
             'mappingId',mapping_id,'mappingVersion',mapping_version,
             'mappingHeaderFingerprint',mapping_header_fingerprint,
             'transformerVersions',transformer_versions_json,'mappingSnapshot',mapping_json,
             'approvalStatus',approval_status,'approvalRequestedAt',approval_requested_at,
             'approvalDecidedAt',approval_decided_at,'approvalDecidedBy',approval_decided_by,'approvalNote',approval_note,
             'lastError',last_error,'failedChunks',failed_chunks,'heartbeatAt',heartbeat_at,
             'commitRevalidation',analysis_json->'commitRevalidation','recovery',recovery_json,
             'expected',JSONB_BUILD_OBJECT('sourceRows',source_row_count,'validRows',valid_row_count,'errorRows',error_row_count,'warningRows',warning_row_count,'duplicateRows',duplicate_row_count),
             'processedRows',processed_rows,'totalRows',total_rows,'createdAt',created_at,'completedAt',completed_at,'rolledBackAt',rolled_back_at)
           FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    ).bind(tenant).bind(branch).bind(id).fetch_optional(db).await?;
    let Some(job) = job else {
        return Ok(None);
    };
    let dry_run_summary: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'totalRows',COUNT(result.id),
             'readyRows',COUNT(*) FILTER(WHERE result.status IN ('validated','warning') OR (result.status='duplicate' AND result.duplicate_decision IN ('merge','keep','link'))),
             'warningRows',COUNT(*) FILTER(WHERE JSONB_ARRAY_LENGTH(COALESCE(result.warnings_json,'[]'::JSONB))>0),
             'yellowApprovals',job.warning_row_count,
             'yellowApproved',job.warning_row_count=0 OR (job.analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((job.analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=job.warning_row_count,
             'redRows',COUNT(*) FILTER(WHERE result.status IN ('error','quarantined','failed')),
             'duplicates',COUNT(*) FILTER(WHERE result.status='duplicate'),
             'unresolvedDuplicates',COUNT(*) FILTER(WHERE result.status='duplicate' AND COALESCE(result.duplicate_decision,'') NOT IN ('merge','keep','link')),
             'missingDependencies',COUNT(*) FILTER(WHERE result.status='dependency_pending'),
             'expectedCreates',COUNT(*) FILTER(WHERE result.status IN ('validated','warning')),
             'expectedUpdates',COUNT(*) FILTER(WHERE result.status='duplicate' AND result.duplicate_decision='merge'),
             'expectedLinks',COUNT(*) FILTER(WHERE result.status='duplicate' AND result.duplicate_decision='link'),
             'expectedKeeps',COUNT(*) FILTER(WHERE result.status='duplicate' AND result.duplicate_decision='keep'),
             'commitBlocked',job.status<>'validated'
                 OR (NOT job.allow_partial_import AND COUNT(*) FILTER(WHERE result.status IN ('error','quarantined','failed'))>0)
                 OR COUNT(*) FILTER(WHERE result.status='dependency_pending')>0
                 OR COUNT(*) FILTER(WHERE result.status='duplicate' AND COALESCE(result.duplicate_decision,'') NOT IN ('merge','keep','link'))>0
                 OR (job.warning_row_count>0 AND NOT ((job.analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((job.analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=job.warning_row_count))
           )
           FROM integration_import_jobs job
           LEFT JOIN integration_import_row_results result ON result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id AND result.job_id=job.id
           WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
           GROUP BY job.status,job.warning_row_count,job.analysis_json,job.allow_partial_import"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let preview: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'fields',COALESCE(JSONB_AGG(item ORDER BY source_row_number,source_column),'[]'::JSONB),
             'limit',200,
             'truncated',COALESCE(MAX(total_fields),0)>200
           ) FROM (
             SELECT result.source_row_number,
                    field->>'sourceField' source_column,
                    COUNT(*) OVER() total_fields,
                    JSONB_BUILD_OBJECT(
                      'sourceRowNumber',result.source_row_number,
                      'originalSourceValue',field->'originalValue',
                      'sourceColumn',field->>'sourceField',
                      'selectedCrmField',field->>'targetField',
                      'transformation',CONCAT_WS(' @ ',field->>'transformer',field->>'transformerVersion'),
                      'crmValue',field->'transformedValue',
                      'confidence',CASE
                        WHEN result.status IN ('error','quarantined','failed') OR JSONB_ARRAY_LENGTH(COALESCE(field->'errors','[]'::JSONB))>0 THEN 'red'
                        WHEN result.status IN ('warning','approval_required','duplicate','dependency_pending') OR JSONB_ARRAY_LENGTH(COALESCE(field->'warnings','[]'::JSONB))>0 THEN 'yellow'
                        ELSE 'green' END,
                      'validationResult',COALESCE(field->'errors'->0->>'message',field->'warnings'->0->>'message',NULLIF(result.message,''),'Ready'),
                      'existingMatch',result.duplicate_target_id,
                      'decision',CASE
                        WHEN result.status IN ('error','quarantined','failed','dependency_pending') THEN 'blocked'
                        WHEN result.status='duplicate' AND COALESCE(result.duplicate_decision,'')='' THEN 'change_required'
                        WHEN result.status IN ('warning','approval_required') AND (job.analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((job.analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=job.warning_row_count THEN 'approved'
                        WHEN result.status IN ('warning','approval_required') THEN 'approval_required'
                        ELSE COALESCE(NULLIF(result.duplicate_decision,''),'approved') END
                    ) item
             FROM integration_import_row_results result
             JOIN integration_import_jobs job ON job.id=result.job_id AND job.tenant_id=result.tenant_id AND job.branch_id=result.branch_id
             CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
               CASE WHEN JSONB_TYPEOF(result.source_payload#>'{__migration_evidence,fields}')='array'
                    THEN result.source_payload#>'{__migration_evidence,fields}' ELSE '[]'::JSONB END
             ) field
             WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
             ORDER BY result.source_row_number,field->>'sourceField'
             LIMIT 200
           ) preview_rows"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let opening_stock_preview: Value = sqlx::query_scalar(
        r#"WITH scoped AS (
             SELECT result.source_row_number,result.status,result.error_code,result.message,
                    result.source_payload payload,cutover.cutover_at,
                    COALESCE(stock.quantity,0)::BIGINT current_quantity,
                    CASE WHEN result.source_payload->>'inventory_item_id'='' THEN 0 ELSE
                      COALESCE((SELECT SUM(movement.quantity_delta)::BIGINT
                        FROM inventory_stock_ledger movement
                       WHERE movement.tenant_id=result.tenant_id
                         AND movement.branch_id=result.branch_id
                         AND movement.inventory_item_id=result.source_payload->>'inventory_item_id'
                         AND movement.created_at>cutover.cutover_at
                         AND movement.movement_type<>'opening_snapshot'
                         AND (movement.inventory_location_code=result.source_payload->>'location_code'
                           OR (movement.inventory_location_code IS NULL AND 1=(
                             SELECT COUNT(DISTINCT sibling.source_payload->>'location_code')
                               FROM integration_import_row_results sibling
                              WHERE sibling.tenant_id=result.tenant_id
                                AND sibling.branch_id=result.branch_id
                                AND sibling.job_id=result.job_id
                                AND sibling.source_payload->>'inventory_item_id'
                                  =result.source_payload->>'inventory_item_id'
                           )))),0) END post_cutover_delta
               FROM integration_import_row_results result
               JOIN integration_import_jobs job
                 ON job.id=result.job_id AND job.tenant_id=result.tenant_id
                AND job.branch_id=result.branch_id
               LEFT JOIN integration_migration_cutovers cutover
                 ON cutover.tenant_id::TEXT=result.tenant_id
                AND cutover.branch_id::TEXT=result.branch_id
                AND cutover.id=job.analysis_json->'postingContract'->>'cutoverId'
               LEFT JOIN inventory_location_stock stock
                 ON stock.tenant_id=result.tenant_id AND stock.branch_id=result.branch_id
                AND stock.inventory_item_id=result.source_payload->>'inventory_item_id'
                AND stock.location_code=result.source_payload->>'location_code'
              WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
           ), normalized AS (
             SELECT *,COALESCE((payload->>'opening_stock')::BIGINT,0) declared_quantity,
                    COALESCE((payload->>'valuation_paise')::BIGINT,0) valuation_paise
               FROM scoped
           )
           SELECT CASE WHEN $4<>'inventory' THEN JSONB_BUILD_OBJECT(
             'status','not_applicable','rows','[]'::JSONB,'summary','{}'::JSONB)
           ELSE JSONB_BUILD_OBJECT(
             'status',CASE WHEN COUNT(*) FILTER(WHERE status IN ('error','quarantined','failed'))=0
                           THEN 'ready' ELSE 'blocked' END,
             'rows',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'sourceRowNumber',source_row_number,
               'inventoryItemId',payload->>'inventory_item_id',
               'locationCode',payload->>'location_code',
               'sourceQuantity',payload->>'source_quantity',
               'sourceUnit',payload->>'source_unit',
               'unitMultiplier',COALESCE((payload->>'unit_multiplier')::INTEGER,1),
               'beforeQuantity',current_quantity,
               'declaredQuantity',declared_quantity,
               'setToDelta',declared_quantity-current_quantity,
               'postCutoverDelta',post_cutover_delta,
               'expectedCurrentQuantity',declared_quantity+post_cutover_delta,
               'correctionDelta',declared_quantity+post_cutover_delta-current_quantity,
               'approvedUnitCostPaise',COALESCE((payload->>'unit_cost_paise')::BIGINT,0),
               'valuationPaise',valuation_paise,
               'classifications',COALESCE(payload->'classifications_json','{}'::JSONB),
               'countedBy',payload->>'counted_by',
               'status',status,'errorCode',NULLIF(error_code,''),'message',NULLIF(message,'')
             ) ORDER BY source_row_number),'[]'::JSONB),
             'summary',JSONB_BUILD_OBJECT(
               'rows',COUNT(*),
               'declaredQuantity',COALESCE(SUM(declared_quantity),0),
               'beforeQuantity',COALESCE(SUM(current_quantity),0),
               'setToDelta',COALESCE(SUM(declared_quantity-current_quantity),0),
               'postCutoverDelta',COALESCE(SUM(post_cutover_delta),0),
               'expectedCurrentQuantity',COALESCE(SUM(declared_quantity+post_cutover_delta),0),
               'correctionDelta',COALESCE(SUM(declared_quantity+post_cutover_delta-current_quantity),0),
               'valuationPaise',COALESCE(SUM(valuation_paise),0),
               'blockingRows',COUNT(*) FILTER(WHERE status IN ('error','quarantined','failed'))
             )
           ) END FROM normalized"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(
        job.get("entity")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
    .fetch_one(db)
    .await?;
    let opening_payable_preview = opening_payable_preview(db, tenant, branch, id).await?;
    let duplicate_resolution: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'rows',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'sourceRowNumber',source_row_number,
               'targetId',duplicate_target_id,
               'decision',NULLIF(duplicate_decision,''),
               'status',status,
               'signals',COALESCE(source_payload#>'{__migration_evidence,duplicateResolution,signals}','[]'::JSONB),
               'allowedDecisions',COALESCE(source_payload#>'{__migration_evidence,duplicateResolution,allowedDecisions}','[]'::JSONB),
               'preview',COALESCE(source_payload#>'{__migration_evidence,duplicateResolution,preview}',
                 JSONB_BUILD_OBJECT('existingValue','{}'::JSONB,'incomingValue','{}'::JSONB,'finalValue','{}'::JSONB,'fieldsThatWillChange','[]'::JSONB,'dependentRecords','{}'::JSONB))
             ) ORDER BY source_row_number),'[]'::JSONB)
           ) FROM integration_import_row_results
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND duplicate_target_id IS NOT NULL"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let actual: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'created',COUNT(*) FILTER(WHERE action='created'),'merged',COUNT(*) FILTER(WHERE action='merged'),
             'linked',COUNT(*) FILTER(WHERE action='linked'),'kept',COUNT(*) FILTER(WHERE action='kept'),
             'failed',COUNT(*) FILTER(WHERE status IN ('error','quarantined','failed')),
             'rolledBack',COUNT(*) FILTER(WHERE status='rolled_back'))
           FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3"#,
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let entity = job
        .get("entity")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let branch_totals: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT('branchId',$2,'entity',$3,'jobs',COUNT(*),'completedJobs',COUNT(*) FILTER(WHERE status='completed'),'sourceRows',COALESCE(SUM(source_row_count),0),'processedRows',COALESCE(SUM(processed_rows),0),'errorRows',COALESCE(SUM(error_row_count),0)) FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3"#,
    ).bind(tenant).bind(branch).bind(entity).fetch_one(db).await?;
    let opening_inventory_reconciliation: Value = sqlx::query_scalar(
        r#"WITH scoped AS (
             SELECT line.*,stock.quantity AS target_quantity,
                    stock.unit_cost_paise AS target_unit_cost_paise
               FROM integration_opening_inventory_snapshot_lines line
               JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
               LEFT JOIN inventory_location_stock stock
                 ON stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
                AND stock.inventory_item_id=line.inventory_item_id
                AND stock.location_code=line.location_code
              WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3
           ), methods AS (
             SELECT cost_method,cost_approved_by,COUNT(*) AS line_count,
                    SUM(valuation_paise::NUMERIC) AS valuation_paise,
                    MIN(cost_approved_at) AS first_approved_at,
                    MAX(cost_approved_at) AS last_approved_at
               FROM scoped GROUP BY cost_method,cost_approved_by
           )
           SELECT CASE WHEN $4<>'inventory' THEN
             JSONB_BUILD_OBJECT('status','not_applicable')
           WHEN NOT EXISTS(SELECT 1 FROM scoped) THEN
             JSONB_BUILD_OBJECT('status','pending')
           ELSE JSONB_BUILD_OBJECT(
             'status',CASE WHEN
               (SELECT BOOL_AND(expected_quantity=target_quantity) FROM scoped)
               AND (SELECT BOOL_AND(
                 valuation_paise::NUMERIC=quantity::NUMERIC*unit_cost_paise::NUMERIC
                 AND unit_cost_paise=target_unit_cost_paise
               ) FROM scoped) THEN 'matched' ELSE 'mismatch' END,
             'quantity',JSONB_BUILD_OBJECT(
               'declaredCutoverQuantity',(SELECT SUM(quantity::BIGINT) FROM scoped),
               'expectedCurrentQuantity',(SELECT SUM(expected_quantity::BIGINT) FROM scoped),
               'targetCurrentQuantity',(SELECT SUM(target_quantity::BIGINT) FROM scoped),
               'matched',(SELECT BOOL_AND(expected_quantity=target_quantity) FROM scoped)
             ),
             'valuation',JSONB_BUILD_OBJECT(
               'sourceSystemValuationPaise',(SELECT SUM(source_valuation_paise::NUMERIC) FROM scoped),
               'approvedOpeningValuationPaise',(SELECT SUM(valuation_paise::NUMERIC) FROM scoped),
               'sourceDifferencePaise',(SELECT
                 SUM(valuation_paise::NUMERIC)-SUM(source_valuation_paise::NUMERIC) FROM scoped),
               'recalculatedOpeningValuationPaise',
                 (SELECT SUM(quantity::NUMERIC*unit_cost_paise::NUMERIC) FROM scoped),
               'matched',(SELECT BOOL_AND(
                 valuation_paise::NUMERIC=quantity::NUMERIC*unit_cost_paise::NUMERIC
                 AND unit_cost_paise=target_unit_cost_paise
               ) FROM scoped)
             ),
             'costApprovals',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
               'method',cost_method,'approvedBy',cost_approved_by,'lineCount',line_count,
               'valuationPaise',valuation_paise,'firstApprovedAt',first_approved_at,
               'lastApprovedAt',last_approved_at
             ) ORDER BY cost_method,cost_approved_by) FROM methods),'[]'::JSONB)
           ) END"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(entity)
    .fetch_one(db)
    .await?;
    let cutover_reconciliation: Value = sqlx::query_scalar(
        r#"SELECT CASE
             WHEN COALESCE(analysis_json->'postingContract'->>'cutoverId','')='' THEN
               JSONB_BUILD_OBJECT('status','not_applicable','blockers','[]'::JSONB)
             ELSE migration_cutover_full_reconciliation(
               tenant_id,branch_id,analysis_json->'postingContract'->>'cutoverId') END
           FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let impact = rollback_impact(db, tenant, branch, id)
        .await?
        .unwrap_or_else(|| json!({}));
    let mut financial: Value =
        sqlx::query_scalar("SELECT migration_import_financial_reconciliation($1,$2,$3)")
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .fetch_one(db)
            .await?;
    if matches!(entity, "sales" | "invoices") {
        let (source_outstanding, target_outstanding): (i64, i64) = sqlx::query_as(
            r#"SELECT
                 COALESCE((SELECT SUM(
                   CASE WHEN COALESCE(source_payload->>'total_paise','')~'^-?[0-9]+$' THEN (source_payload->>'total_paise')::BIGINT ELSE 0 END-
                   CASE WHEN COALESCE(source_payload->>'paid_paise','')~'^-?[0-9]+$' THEN (source_payload->>'paid_paise')::BIGINT ELSE 0 END)
                   FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action<>''),0),
                 COALESCE((SELECT SUM(sale.total_paise-sale.paid_paise) FROM pos_sales sale
                   JOIN (SELECT DISTINCT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND target_id IS NOT NULL AND action<>'') target ON target.target_id=sale.id
                   WHERE sale.tenant_id=$1 AND sale.branch_id=$2),0)"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_one(db)
        .await?;
        if let Some(metrics) = financial.get_mut("metrics").and_then(Value::as_object_mut) {
            metrics.insert(
                "outstandingPaise".into(),
                json!({"sourcePaise":source_outstanding,"targetPaise":target_outstanding,"differencePaise":target_outstanding-source_outstanding}),
            );
        }
    }
    let dependencies: Value = sqlx::query_scalar(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
             'jobId',required.id,'entity',required.entity,'status',required.status,
             'completed',required.status='completed') ORDER BY required.created_at),'[]'::JSONB)
           FROM integration_import_job_dependencies dependency
           JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id
           WHERE dependency.tenant_id=$1 AND dependency.branch_id=$2 AND dependency.job_id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let dependency_pending_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='dependency_pending'",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let dependency_deadlock: Option<Value> = sqlx::query_scalar(
        "SELECT analysis_json->'dependencyDeadlock' FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await?
    .flatten();
    let expected_valid = job
        .pointer("/expected/validRows")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let processed = job
        .get("processedRows")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let failed = actual.get("failed").and_then(Value::as_i64).unwrap_or(0);
    let committed_rows = ["created", "merged", "linked", "kept"]
        .iter()
        .map(|key| actual.get(key).and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut mismatch_explanation = Vec::new();
    if committed_rows != expected_valid {
        mismatch_explanation.push(json!({"code":"SOURCE_TARGET_COUNT_MISMATCH","sourceCount":expected_valid,"targetCount":committed_rows,"difference":committed_rows-expected_valid}));
    }
    if processed != expected_valid {
        mismatch_explanation.push(json!({"code":"CHECKPOINT_COUNT_MISMATCH","sourceCount":expected_valid,"checkpointCount":processed,"difference":processed-expected_valid}));
    }
    if failed > 0 {
        mismatch_explanation.push(json!({"code":"FAILED_ROWS_PRESENT","count":failed}));
    }
    if let Some(metrics) = financial.get("metrics").and_then(Value::as_object) {
        for (name, metric) in metrics {
            let difference = metric
                .get("differencePaise")
                .or_else(|| metric.get("difference"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            if difference != 0 {
                mismatch_explanation.push(json!({"code":"FINANCIAL_TOTAL_MISMATCH","metric":name,"difference":difference}));
            }
        }
    }
    if let Some(financial_object) = financial.as_object_mut() {
        financial_object.insert(
            "mismatchExplanation".into(),
            Value::Array(
                mismatch_explanation
                    .iter()
                    .filter(|item| {
                        item.get("code").and_then(Value::as_str) == Some("FINANCIAL_TOTAL_MISMATCH")
                    })
                    .cloned()
                    .collect(),
            ),
        );
        if status == "completed"
            && mismatch_explanation.iter().any(|item| {
                item.get("code").and_then(Value::as_str) == Some("FINANCIAL_TOTAL_MISMATCH")
            })
        {
            financial_object.insert("matched".into(), Value::Bool(false));
            financial_object.insert("status".into(), Value::String("mismatch".into()));
        }
    }
    let reconciliation = if status == "rolled_back" {
        "rolled_back"
    } else if status != "completed" {
        "pending"
    } else if processed == expected_valid
        && committed_rows == expected_valid
        && failed == 0
        && financial.get("status").and_then(Value::as_str) != Some("mismatch")
    {
        "matched"
    } else {
        "mismatch"
    };
    let dependencies_completed = dependencies.as_array().map_or(true, |items| {
        items
            .iter()
            .all(|item| item.get("completed").and_then(Value::as_bool) == Some(true))
    });
    let approval_complete = matches!(
        job.get("approvalStatus").and_then(Value::as_str),
        Some("approved" | "not_required")
    );
    let financial_status = financial
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let financial_matched = matches!(financial_status, "matched" | "not_applicable");
    let cutover_ready = status == "completed"
        && reconciliation == "matched"
        && financial_matched
        && matches!(
            cutover_reconciliation.get("status").and_then(Value::as_str),
            Some("matched" | "not_applicable")
        )
        && dependencies_completed
        && approval_complete;
    let mut recommendations = Vec::new();
    if job.get("approvalStatus").and_then(Value::as_str) == Some("pending") {
        recommendations.push("Owner approval is required before commit");
    }
    if failed > 0 {
        recommendations.push("Export failed rows, correct the source data, then retry");
    }
    if reconciliation == "mismatch" {
        recommendations.push("Review the proof pack before rollback");
    }
    if financial.get("status").and_then(Value::as_str) == Some("mismatch") {
        recommendations.push("Financial totals differ from the imported source; do not cut over");
    }
    if !dependencies_completed {
        recommendations.push("Waiting for prerequisite migration jobs to complete");
    }
    if cutover_reconciliation.get("status").and_then(Value::as_str) == Some("blocked") {
        recommendations.push("Resolve every cutover reconciliation blocker before go-live");
    }
    if impact
        .pointer("/dependencies/blockingRecords")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        recommendations.push("Rollback or detach dependent records first");
    }
    if impact
        .pointer("/calculatedRecovery/snapshotLiveMovements")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        recommendations.push("Snapshot rollback is blocked to preserve post-cutover stock movements; use the calculated recovery report");
    }
    if impact
        .pointer("/calculatedRecovery/openingPayableSettlementEvents")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        recommendations.push(
            "Opening payable rollback is blocked because supplier settlement activity exists",
        );
    }
    if recommendations.is_empty() && status == "completed" {
        recommendations.push("Reconciliation and rollback preflight are clear");
    }
    Ok(Some(json!({
        "job": job,
        "dryRunSummary": dry_run_summary,
        "preview": preview,
        "openingStockPreview": opening_stock_preview,
        "openingPayablePreview": opening_payable_preview,
        "duplicateResolution": duplicate_resolution,
        "actual": actual,
        "reconciliation": {"status":reconciliation,"sourceCount":expected_valid,"targetCount":committed_rows,"actualProcessedRows":processed,"mismatchExplanation":mismatch_explanation},
        "financialReconciliation": financial,
        "openingInventoryReconciliation": opening_inventory_reconciliation,
        "cutoverReconciliation": cutover_reconciliation,
        "dependencies": dependencies,
        "dependencyExecution": {"state":status,"pendingRows":dependency_pending_rows,"deadlock":dependency_deadlock},
        "cutover": {"ready":cutover_ready,"checks":{"jobCompleted":status == "completed","rowsMatched":reconciliation == "matched","financialsMatched":financial_matched,"fullReconciliationMatched":matches!(cutover_reconciliation.get("status").and_then(Value::as_str),Some("matched" | "not_applicable")),"dependenciesCompleted":dependencies_completed,"approvalComplete":approval_complete}},
        "branchEntityTotals": branch_totals,
        "preRollbackImpact": impact,
        "recoveryRecommendations": recommendations
    })))
}

pub async fn proof_pack(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let Some(governance) = governance_report(db, tenant, branch, id).await? else {
        return Ok(None);
    };
    let audit: Value = sqlx::query_scalar(
        "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('eventType',event_type,'outcome',outcome,'actorUserId',actor_user_id,'details',details_json,'createdAt',created_at) ORDER BY created_at),'[]'::JSONB) FROM integration_import_audit_events WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let batches: Value = sqlx::query_scalar(
        "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('batchNumber',batch_number,'status',status,'startOffset',start_offset,'endOffset',end_offset,'processedRows',processed_rows,'importedRows',imported_rows,'errorRows',error_rows,'lastError',last_error) ORDER BY batch_number),'[]'::JSONB) FROM integration_import_batches WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let chunks: Value = sqlx::query_scalar(
        "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('chunkNumber',chunk_number,'status',status,'sourceSheet',source_sheet,'sourceRowStart',source_row_start,'sourceRowEnd',source_row_end,'totalRows',total_rows,'readyRows',ready_rows,'errorRows',error_rows,'checksum',checksum,'processedRows',processed_rows,'attempts',attempts,'lastError',last_error) ORDER BY chunk_number),'[]'::JSONB) FROM integration_import_chunks WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let row_results: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'count',COUNT(result.id),
             'rows',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'idempotencyKey',ENCODE(DIGEST(CONCAT_WS(':',job.source_hash,result.source_sheet,result.source_row_number::TEXT),'sha256'),'hex'),
               'sourceSheet',result.source_sheet,'sourceRowNumber',result.source_row_number,
               'originalRow',COALESCE(result.source_payload#>'{__migration_evidence,sourceValues}','{}'::JSONB),
               'transformations',COALESCE(result.source_payload#>'{__migration_evidence,fields}','[]'::JSONB),
               'confidence',CASE WHEN result.status IN ('error','quarantined','failed') THEN 'red' WHEN result.status IN ('warning','approval_required','duplicate','dependency_pending') THEN 'yellow' ELSE 'green' END,
               'warnings',result.warnings_json,'errorCode',NULLIF(result.error_code,''),'message',NULLIF(result.message,''),
               'approvalUserId',job.approval_decided_by,'status',result.status,'action',NULLIF(result.action,''),
               'crmRecordId',result.target_id,'beforeImage',result.before_snapshot,'recoveryAction',NULLIF(result.recovery_action,''),
               'createdAt',result.created_at,'updatedAt',result.updated_at
             ) ORDER BY result.source_sheet,result.source_row_number) FILTER(WHERE result.id IS NOT NULL),'[]'::JSONB)
           )
           FROM integration_import_jobs job
           LEFT JOIN integration_import_row_results result ON result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id AND result.job_id=job.id
           WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
           GROUP BY job.id"#,
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let transformations: Value = sqlx::query_scalar(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
             'transformer',transformer,'version',version,'fieldCount',field_count,'warningCount',warning_count,'errorCount',error_count
           ) ORDER BY transformer,version),'[]'::JSONB)
           FROM (
             SELECT field->>'transformer' transformer,field->>'transformerVersion' version,COUNT(*) field_count,
                    COUNT(*) FILTER(WHERE JSONB_ARRAY_LENGTH(COALESCE(field->'warnings','[]'::JSONB))>0) warning_count,
                    COUNT(*) FILTER(WHERE JSONB_ARRAY_LENGTH(COALESCE(field->'errors','[]'::JSONB))>0) error_count
             FROM integration_import_row_results result
             CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(CASE WHEN JSONB_TYPEOF(result.source_payload#>'{__migration_evidence,fields}')='array' THEN result.source_payload#>'{__migration_evidence,fields}' ELSE '[]'::JSONB END) field
             WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
             GROUP BY field->>'transformer',field->>'transformerVersion'
           ) summary"#,
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let approvals: Value = sqlx::query_scalar(
        "SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('eventType',event_type,'outcome',outcome,'actorUserId',actor_user_id,'details',details_json,'createdAt',created_at) ORDER BY created_at),'[]'::JSONB) FROM integration_import_audit_events WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND event_type IN ('migration.governance.yellow_approved','migration.opening_payable.finance_approved','migration.opening_payable.branch_confirmed','migration.opening_payable.branch_rejected','migration.governance.approved','migration.governance.rejected')",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    let mut pack = json!({"schemaVersion":"1.2","generatedAt":Utc::now(),"governance":governance,"approvalHistory":approvals,"transformationSummary":transformations,"rowResults":row_results,"auditEvents":audit,"batches":batches,"chunks":chunks,"signatureProfile":{"required":true,"algorithm":"HMAC-SHA256","keyManagement":"environment-secret-or-external-KMS-injection"}});
    let payload_sha256 = format!("{:x}", Sha256::digest(pack.to_string().as_bytes()));
    pack.as_object_mut()
        .expect("proof pack is an object")
        .insert(
            "integrity".into(),
            json!({"algorithm":"SHA-256","payloadSha256":payload_sha256}),
        );
    Ok(Some(pack))
}

pub async fn cutover_proof_pack(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let Some(cutover) = get_cutover(db, tenant, branch, Some(id)).await? else {
        return Ok(None);
    };
    let jobs: Value = sqlx::query_scalar(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
             'id',job.id,'entity',job.entity,'mode',job.mode,'status',job.status,
             'sourceChecksum',job.source_hash,'sourceFileId',job.source_file_id,
             'sourceRows',job.source_row_count,'validRows',job.valid_row_count,
             'processedRows',job.processed_rows,'errorRows',job.error_row_count,
             'duplicateRows',job.duplicate_row_count,'mappingId',job.mapping_id,
             'mappingVersion',job.mapping_version,'mappingHeaderFingerprint',job.mapping_header_fingerprint,
             'transformerVersions',job.transformer_versions_json,'approvalStatus',job.approval_status,
             'approvedBy',job.approval_decided_by,'completedAt',job.completed_at,
             'rolledBackAt',job.rolled_back_at
           ) ORDER BY job.created_at,job.id),'[]'::JSONB)
           FROM integration_import_jobs job
           WHERE job.tenant_id=$1 AND job.branch_id=$2
             AND job.analysis_json->'postingContract'->>'cutoverId'=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let evidence: Value = sqlx::query_scalar(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
             'sourceFileId',source.id,'kind',evidence.evidence_kind,
             'supplierBatch',NULLIF(evidence.supplier_batch,''),'originalFileName',source.original_file_name,
             'format',source.file_format,'sizeBytes',source.size_bytes,'pageCount',evidence.page_count,
             'sha256',source.sha256,'evidenceStatus',source.evidence_status,
             'uploadedBy',source.created_by,'createdAt',source.created_at
           ) ORDER BY evidence.created_at,evidence.id),'[]'::JSONB)
           FROM historical_purchase_evidence_items evidence
           JOIN integration_import_source_files source ON source.tenant_id=evidence.tenant_id
             AND source.branch_id=evidence.branch_id AND source.id=evidence.source_file_id
           WHERE evidence.tenant_id=$1 AND evidence.branch_id=$2 AND evidence.cutover_id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let archive: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'batches',(SELECT COUNT(*) FROM historical_purchase_archive_batches batch
               WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3),
             'expectedBills',(SELECT COALESCE(SUM(batch.expected_bill_count),0) FROM historical_purchase_archive_batches batch
               WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3),
             'items',(SELECT COUNT(*) FROM historical_purchase_archive_items item
               JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
               WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3),
             'statusCounts',COALESCE((SELECT JSONB_OBJECT_AGG(status,total) FROM (
               SELECT item_status.status,COUNT(*) total
               FROM historical_purchase_archive_items item_status
               JOIN historical_purchase_archive_batches batch_status ON batch_status.job_id=item_status.job_id
               WHERE batch_status.tenant_id=$1 AND batch_status.branch_id=$2 AND batch_status.cutover_id=$3
               GROUP BY item_status.status
             ) counts),'{}'::JSONB),
             'sourceTotalPaise',(SELECT COALESCE(SUM(item.source_total_paise),0) FROM historical_purchase_archive_items item
               JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
               WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3),
             'archiveTotalPaise',(SELECT COALESCE(SUM(item.archive_total_paise),0) FROM historical_purchase_archive_items item
               JOIN historical_purchase_archive_batches batch ON batch.job_id=item.job_id
               WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.cutover_id=$3)
           )"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let opening_inventory: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'snapshots',COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
               'id',snapshot.id,'jobId',snapshot.import_job_id,'sourceFileId',snapshot.source_file_id,
               'sourceChecksum',snapshot.source_checksum,'snapshotAt',snapshot.snapshot_at,
               'approvedBy',snapshot.approved_by,'createdAt',snapshot.created_at
             )) FILTER(WHERE snapshot.id IS NOT NULL),'[]'::JSONB),
             'lines',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'id',line.id,'snapshotId',line.snapshot_id,'inventoryItemId',line.inventory_item_id,
               'locationCode',line.location_code,'stockUnit',line.stock_unit,'quantity',line.quantity,
               'unitCostPaise',line.unit_cost_paise,'valuationPaise',line.valuation_paise,
               'batches',line.batches_json,'classifications',line.classifications_json,
               'countedBy',line.counted_by,'sourceSheet',line.source_sheet,
               'sourceRowNumber',line.source_row_number,'sourceRowChecksum',line.source_row_checksum
             ) ORDER BY line.source_sheet,line.source_row_number) FILTER(WHERE line.id IS NOT NULL),'[]'::JSONB)
           )
           FROM integration_opening_inventory_snapshots snapshot
           LEFT JOIN integration_opening_inventory_snapshot_lines line ON line.snapshot_id=snapshot.id
           WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.cutover_id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let opening_payables: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'imports',COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
               'id',opening.id,'jobId',opening.import_job_id,'sourceFileId',opening.source_file_id,
               'sourceChecksum',opening.source_checksum,'sourceOutstandingPaise',opening.source_outstanding_total_paise,
               'currency',opening.currency,'openingBalanceAccount',opening.opening_balance_account,
               'payableAccount',opening.payable_account,'supplierAdvanceAccount',opening.supplier_advance_account,
               'journalEntryId',opening.journal_entry_id,'financeApprovedBy',opening.finance_approved_by,
               'financeApprovedAt',opening.finance_approved_at,'approvedBy',opening.approved_by,
               'appliedAt',opening.applied_at,'rolledBackAt',opening.rolled_back_at
             )) FILTER(WHERE opening.id IS NOT NULL),'[]'::JSONB),
             'balances',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'id',line.id,'openingImportId',line.opening_import_id,'supplierId',line.supplier_id,
               'externalId',line.external_id,'balanceSide',line.balance_side,'amountPaise',line.amount_paise,
               'currency',line.currency,'dueDate',line.due_date,'gstPaise',line.gst_paise,
               'unallocatedPaise',line.unallocated_paise,'unallocatedApproved',line.unallocated_approved,
               'sourceRowNumber',line.source_row_number,'sourceRowChecksum',line.source_row_checksum
             ) ORDER BY line.source_row_number) FILTER(WHERE line.id IS NOT NULL),'[]'::JSONB)
           )
           FROM supplier_opening_payable_imports opening
           LEFT JOIN supplier_opening_payables line ON line.opening_import_id=opening.id
           WHERE opening.tenant_id=$1 AND opening.branch_id=$2 AND opening.cutover_id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    let journal_balances: Value = sqlx::query_scalar(
        r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
             'journalEntryId',entry.id,'sourceType',entry.source_type,'sourceId',entry.source_id,
             'debitPaise',balance.debit_paise,'creditPaise',balance.credit_paise,
             'balanced',balance.debit_paise=balance.credit_paise
           ) ORDER BY entry.created_at,entry.id),'[]'::JSONB)
           FROM accounting_journal_entries entry
           JOIN LATERAL (SELECT COALESCE(SUM(line.debit_paise),0)::BIGINT debit_paise,
                                COALESCE(SUM(line.credit_paise),0)::BIGINT credit_paise
                         FROM accounting_journal_lines line WHERE line.journal_entry_id=entry.id) balance ON TRUE
           WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND (
             entry.id IN (SELECT opening.journal_entry_id FROM supplier_opening_payable_imports opening
               WHERE opening.tenant_id=$1 AND opening.branch_id=$2 AND opening.cutover_id=$3)
             OR entry.id IN (SELECT accounting.journal_entry_id FROM integration_opening_inventory_accounting accounting
               WHERE accounting.tenant_id=$1 AND accounting.branch_id=$2 AND accounting.cutover_id=$3)
           )"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    Ok(Some(json!({
        "schemaVersion":"2026-07-phase7-v1",
        "generatedAt":Utc::now(),
        "cutover":cutover,
        "sourceEvidence":evidence,
        "jobs":jobs,
        "historicalArchive":archive,
        "openingInventory":opening_inventory,
        "openingPayables":opening_payables,
        "journalBalances":journal_balances,
        "activationOrder":[
            "historical_archive_lock","opening_snapshot_approval","opening_snapshot_apply",
            "opening_payable_post","full_reconciliation","owner_go_live_approval",
            "live_grn_enable","pos_inventory_consumption_enable","supplier_payments_enable",
            "reports_and_dashboards_verify"
        ],
        "signatureProfile":{"required":true,"algorithm":"HMAC-SHA256","keyManagement":"environment-secret-or-external-KMS-injection"}
    })))
}

pub async fn failed_rows_csv(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    error_export_csv(db, tenant, branch, id, "failed-rows").await
}

pub async fn error_export_csv(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    kind: &str,
) -> Result<Option<String>, sqlx::Error> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    if !exists {
        return Ok(None);
    }
    let predicate = match kind {
        "failed-rows" => "status IN ('failed','quarantined','error')",
        "quarantined-rows" => "status='quarantined'",
        "mapping-errors" => {
            "status IN ('quarantined','error') AND (error_code LIKE '%FIELD%' OR error_code LIKE 'INVALID_%' OR error_code LIKE 'UNSUPPORTED_%' OR error_code='REQUIRED_FIELD')"
        }
        "missing-dependencies" => "status='dependency_pending'",
        "financial-mismatches" => {
            "status IN ('quarantined','error') AND (error_code LIKE '%TOTAL%' OR error_code LIKE '%BALANCE%' OR error_code LIKE '%TAX%' OR error_code LIKE '%MONEY%' OR error_code LIKE 'REFUND_EXCEEDS_%')"
        }
        "duplicate-decisions" => "status='duplicate' OR duplicate_target_id IS NOT NULL",
        _ => return Ok(None),
    };
    let rows: Vec<(String, i32, Option<String>, String, String, String, String, Value)> = sqlx::query_as(&format!(
        "SELECT source_sheet,source_row_number,source_external_id,status,error_code,message,COALESCE(duplicate_decision,''),COALESCE(source_payload#>'{{__migration_evidence,sourceValues}}','{{}}'::JSONB) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND ({predicate}) ORDER BY source_sheet,source_row_number"
    )).bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    let mut csv = String::from(
        "sourceSheet,sourceRowNumber,sourceExternalId,state,errorCode,explanation,duplicateDecision,originalRow\r\n",
    );
    for (sheet, row, external_id, state, code, message, duplicate_decision, original_row) in rows {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{}\r\n",
            csv_cell(&sheet),
            row,
            csv_cell(external_id.as_deref().unwrap_or("")),
            csv_cell(&state),
            csv_cell(&code),
            csv_cell(&message),
            csv_cell(&duplicate_decision),
            csv_cell(&original_row.to_string())
        ));
    }
    Ok(Some(csv))
}

fn csv_cell(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    let safe = if matches!(
        escaped.trim_start().as_bytes().first(),
        Some(b'=' | b'+' | b'-' | b'@' | b'\t' | b'\r')
    ) {
        format!("'{escaped}")
    } else {
        escaped
    };
    format!("\"{safe}\"")
}

pub async fn find_active_commit_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_hash: &str,
) -> Result<Option<ImportJob>, sqlx::Error> {
    let row = sqlx::query_as::<_, ImportJobRow>(&format!(
        "SELECT {COLUMNS} FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND entity=$3 AND source_hash=$4 AND mode='commit' AND status NOT IN ('cancelled','rolled_back') ORDER BY created_at DESC LIMIT 1"
    ))
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(source_hash)
    .fetch_optional(db)
    .await?;
    row.map(into_import_job).transpose()
}

pub fn is_active_source_duplicate_error(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database_error)
            if database_error.constraint() == Some("uq_integration_import_jobs_active_source")
    )
}

pub async fn claim_job(db: &PgPool) -> Result<Option<ClaimedImportJob>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ClaimedImportJobRow>(
        r#"WITH due AS(
             SELECT job.id FROM integration_import_jobs job
             WHERE job.status='queued' AND job.source_file_id IS NULL
               AND (job.mode<>'commit' OR (
                 job.approval_status='approved' AND job.approval_decided_at IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM integration_import_row_results result WHERE result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id AND result.job_id=job.id AND (
                   (NOT job.allow_partial_import AND result.status IN ('error','quarantined','failed'))
                   OR result.status='dependency_pending'
                   OR (result.status='duplicate' AND COALESCE(result.duplicate_decision,'') NOT IN ('merge','keep','link'))))
                 AND (job.warning_row_count=0 OR ((job.analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((job.analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=job.warning_row_count))
               ))
               AND NOT EXISTS(SELECT 1 FROM integration_import_job_dependencies dependency JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id WHERE dependency.job_id=job.id AND (dependency.tenant_id<>job.tenant_id OR dependency.branch_id<>job.branch_id OR required.tenant_id<>job.tenant_id OR required.branch_id<>job.branch_id OR required.status<>'completed'))
             ORDER BY job.created_at FOR UPDATE OF job SKIP LOCKED LIMIT 1
           )
           UPDATE integration_import_jobs job SET status='processing',updated_at=NOW()
           FROM due WHERE job.id=due.id
           RETURNING job.id,job.tenant_id,job.branch_id,job.entity,job.rows_json,job.total_rows,job.next_row,job.created_by"#,
    )
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    row.map(into_claimed_job).transpose()
}

async fn opening_payable_controls_valid(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(analysis_json->'openingPayableControls'->>'financeApproved','false')='true'
                  AND analysis_json->'openingPayableControls'->>'sourceHash'=source_hash
                  AND analysis_json->'openingPayableControls'->>'dataHash'=(
                    SELECT ENCODE(DIGEST(COALESCE(STRING_AGG(result.source_payload::TEXT,'|'
                      ORDER BY result.source_sheet,result.source_row_number),''),'sha256'),'hex')
                      FROM integration_import_row_results result
                     WHERE result.tenant_id=integration_import_jobs.tenant_id
                       AND result.branch_id=integration_import_jobs.branch_id
                       AND result.job_id=integration_import_jobs.id)
                  AND analysis_json->'openingPayableControls'->>'openingBalanceAccount'
                    IN ('OWNER_EQUITY','RETAINED_EARNINGS')
                  AND analysis_json->'openingPayableControls'->>'payableAccount'='ACCOUNTS_PAYABLE'
                  AND analysis_json->'openingPayableControls'->>'supplierAdvanceAccount'='SUPPLIER_ADVANCE_ASSET'
             FROM integration_import_jobs
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND entity='opening-payables'
              AND approval_status='approved' AND approval_decided_by IS NOT NULL"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map(|value| value.unwrap_or(false))
}

pub async fn apply_batch(
    db: &PgPool,
    job: &ClaimedImportJob,
    batch: &Value,
    start: usize,
    end: usize,
) -> Result<(), sqlx::Error> {
    let batch_number = (start / 100 + 1) as i32;
    apply_batch_numbered(db, job, batch, batch_number, start, end, None).await
}

pub async fn apply_batch_numbered(
    db: &PgPool,
    job: &ClaimedImportJob,
    batch: &Value,
    batch_number: i32,
    start: usize,
    end: usize,
    chunk_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let (active, posting_mode): (bool, Option<String>) = sqlx::query_as(
        r#"SELECT status='processing' AND (mode<>'commit' OR (
             approval_status='approved' AND approval_decided_at IS NOT NULL
             AND NOT EXISTS(SELECT 1 FROM integration_import_row_results result WHERE result.tenant_id=integration_import_jobs.tenant_id AND result.branch_id=integration_import_jobs.branch_id AND result.job_id=integration_import_jobs.id AND (
               (NOT integration_import_jobs.allow_partial_import AND result.status IN ('error','quarantined','failed'))
               OR result.status='dependency_pending'
               OR (result.status='duplicate' AND COALESCE(result.duplicate_decision,'') NOT IN ('merge','keep','link'))))
             AND (warning_row_count=0 OR ((analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=warning_row_count))
            )),COALESCE(analysis_json->'postingContract'->>'postingMode',analysis_json->>'postingMode')
           FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;
    if !active {
        return Err(sqlx::Error::RowNotFound);
    }
    if let Some(code) = three_layer_commit_block_code(job.entity, posting_mode.as_deref()) {
        return Err(sqlx::Error::Protocol(code.to_string()));
    }
    if job.entity == MigrationEntity::OpeningPayables
        && !opening_payable_controls_valid(&mut tx, &job.tenant_id, &job.branch_id, &job.id).await?
    {
        return Err(sqlx::Error::Protocol(
            "OPENING_PAYABLE_APPROVAL_REQUIRED".into(),
        ));
    }
    if job.entity == MigrationEntity::Inventory {
        let ambiguous_live_movement: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1
                   FROM integration_import_row_results result
                   JOIN integration_import_jobs source_job
                     ON source_job.tenant_id=result.tenant_id
                    AND source_job.branch_id=result.branch_id AND source_job.id=result.job_id
                   JOIN integration_migration_cutovers cutover
                     ON cutover.tenant_id::TEXT=source_job.tenant_id
                    AND cutover.branch_id::TEXT=source_job.branch_id
                    AND cutover.id=source_job.analysis_json->'postingContract'->>'cutoverId'
                   JOIN inventory_stock_ledger ledger
                     ON ledger.tenant_id=result.tenant_id AND ledger.branch_id=result.branch_id
                    AND ledger.inventory_item_id=result.source_payload->>'inventory_item_id'
                    AND ledger.created_at>cutover.cutover_at
                    AND ledger.movement_type<>'opening_snapshot'
                    AND ledger.inventory_location_code IS NULL
                  WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
                  GROUP BY result.source_payload->>'inventory_item_id'
                 HAVING COUNT(DISTINCT result.source_payload->>'location_code')>1
               )"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut *tx)
        .await?;
        if ambiguous_live_movement {
            return Err(sqlx::Error::Protocol(
                "LIVE_MOVEMENT_LOCATION_REQUIRED".into(),
            ));
        }
    }
    sqlx::query(
        "UPDATE integration_import_jobs SET analysis_json=COALESCE(analysis_json,'{}'::JSONB)||JSONB_BUILD_OBJECT('commitRevalidation',JSONB_BUILD_OBJECT('passed',TRUE,'checkedAt',NOW(),'approvalUserId',approval_decided_by,'sourceHash',source_hash,'mappingVersion',mapping_version,'transformerVersions',transformer_versions_json)),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!(
            "migration:{}:{}:{}",
            job.tenant_id,
            job.branch_id,
            job.entity.as_str()
        ))
        .execute(&mut *tx)
        .await?;
    insert_audit(
        &mut tx,
        &job.tenant_id,
        &job.branch_id,
        Some(&job.id),
        None,
        "migration.commit.revalidated",
        "success",
        &job.created_by,
        json!({"batchNumber":batch_number,"sourceRowStart":start,"sourceRowEnd":end}),
    )
    .await?;
    let batch_id: String = sqlx::query_scalar(
        r#"
        INSERT INTO integration_import_batches(
          tenant_id,branch_id,job_id,batch_number,status,start_offset,end_offset
        ) VALUES($1,$2,$3,$4,'processing',$5,$6)
        ON CONFLICT(job_id,batch_number) DO UPDATE SET
          status='processing',start_offset=EXCLUDED.start_offset,end_offset=EXCLUDED.end_offset,
          last_error='',started_at=NOW(),completed_at=NULL,updated_at=NOW()
        RETURNING id
        "#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(batch_number)
    .bind(start as i32)
    .bind(end as i32)
    .fetch_one(&mut *tx)
    .await?;

    let items = batch.as_array().cloned().unwrap_or_default();
    let mut write_rows = Vec::new();
    let mut created_rows = 0_i32;
    let mut merged_rows = 0_i32;
    let mut linked_rows = 0_i32;
    let mut kept_rows = 0_i32;
    for row in &items {
        let line = row
            .get("source_row_number")
            .and_then(Value::as_i64)
            .ok_or(sqlx::Error::RowNotFound)? as i32;
        let decision = row
            .get("duplicate_decision")
            .and_then(Value::as_str)
            .unwrap_or("");
        let target_id = row
            .get("duplicate_target_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        match decision {
            "link" => {
                mark_row_action(
                    &mut tx,
                    job,
                    &batch_id,
                    line,
                    "linked",
                    target_id,
                    &Value::Object(Default::default()),
                )
                .await?;
                linked_rows += 1;
            }
            "keep" => {
                if job.entity != MigrationEntity::Clients {
                    return Err(sqlx::Error::Protocol("DUPLICATE_ACTION_NOT_ALLOWED".into()));
                }
                write_rows.push(row.clone());
                kept_rows += 1;
            }
            "merge" => {
                if target_id.is_empty() {
                    return Err(sqlx::Error::RowNotFound);
                }
                match job.entity {
                    MigrationEntity::Clients => {
                        let snapshot = clients_repository::merge_import_row_tx(
                            &mut tx,
                            &job.tenant_id,
                            &job.branch_id,
                            target_id,
                            row,
                            &job.created_by,
                            &job.id,
                        )
                        .await?
                        .ok_or(sqlx::Error::RowNotFound)?;
                        mark_row_action(
                            &mut tx,
                            job,
                            &batch_id,
                            line,
                            "merged",
                            target_id,
                            &json!({"record":snapshot}),
                        )
                        .await?;
                    }
                    MigrationEntity::Staff => {
                        let snapshot: Option<Value> = sqlx::query_scalar(
                            r#"SELECT JSONB_BUILD_OBJECT(
                                 'record',TO_JSONB(staff),
                                 'profile',(SELECT TO_JSONB(profile) FROM staff_profiles profile WHERE profile.tenant_id=$1 AND profile.branch_id=$2 AND profile.staff_id=staff.id)
                               ) FROM staff staff
                               WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$3 FOR UPDATE"#,
                        )
                        .bind(&job.tenant_id)
                        .bind(&job.branch_id)
                        .bind(target_id)
                        .fetch_optional(&mut *tx)
                        .await?;
                        mark_row_action(
                            &mut tx,
                            job,
                            &batch_id,
                            line,
                            "merged",
                            target_id,
                            &snapshot.ok_or(sqlx::Error::RowNotFound)?,
                        )
                        .await?;
                        write_rows.push(row.clone());
                    }
                    MigrationEntity::Services
                    | MigrationEntity::Products
                    | MigrationEntity::Suppliers
                    | MigrationEntity::Memberships
                    | MigrationEntity::Packages => {
                        let snapshot = master_snapshot(
                            &mut tx,
                            &job.tenant_id,
                            &job.branch_id,
                            job.entity,
                            target_id,
                        )
                        .await?
                        .ok_or(sqlx::Error::RowNotFound)?;
                        mark_row_action(
                            &mut tx,
                            job,
                            &batch_id,
                            line,
                            "merged",
                            target_id,
                            &json!({"record":snapshot}),
                        )
                        .await?;
                        write_rows.push(row.clone());
                    }
                    MigrationEntity::Inventory => return Err(sqlx::Error::RowNotFound),
                    MigrationEntity::ClientMemberships => return Err(sqlx::Error::RowNotFound),
                    MigrationEntity::Appointments
                    | MigrationEntity::Sales
                    | MigrationEntity::Invoices
                    | MigrationEntity::Payments
                    | MigrationEntity::Expenses
                    | MigrationEntity::PurchaseBills => return Err(sqlx::Error::RowNotFound),
                    MigrationEntity::Refunds
                    | MigrationEntity::GiftCards
                    | MigrationEntity::Loyalty
                    | MigrationEntity::Payroll
                    | MigrationEntity::Commissions
                    | MigrationEntity::ClientNotes
                    | MigrationEntity::Files
                    | MigrationEntity::StockMovements
                    | MigrationEntity::OpeningPayables => return Err(sqlx::Error::RowNotFound),
                }
                let before_image: Value = sqlx::query_scalar(
                    "SELECT before_snapshot FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_row_number=$4",
                )
                .bind(&job.tenant_id)
                .bind(&job.branch_id)
                .bind(&job.id)
                .bind(line)
                .fetch_one(&mut *tx)
                .await?;
                insert_audit(
                    &mut tx,
                    &job.tenant_id,
                    &job.branch_id,
                    Some(&job.id),
                    Some(&batch_id),
                    "migration.duplicate.merged",
                    "success",
                    &job.created_by,
                    json!({"sourceRowNumber":line,"targetId":target_id,"beforeImage":before_image}),
                )
                .await?;
                merged_rows += 1;
            }
            _ => {
                write_rows.push(row.clone());
                if job.entity == MigrationEntity::Inventory
                    || (job.entity == MigrationEntity::Invoices
                        && row
                            .get("linked_sale_id")
                            .and_then(Value::as_str)
                            .is_some_and(|id| !id.is_empty()))
                {
                    merged_rows += 1;
                } else {
                    created_rows += 1;
                }
            }
        }
    }

    match job.entity {
        MigrationEntity::Clients if !write_rows.is_empty() => {
            clients_repository::bulk_import_tx(
                &mut tx,
                &job.tenant_id,
                &job.branch_id,
                &Value::Array(write_rows),
                &job.created_by,
                Some(&job.id),
            )
            .await?;
            sqlx::query(
                r#"UPDATE integration_import_row_results result
                   SET status=CASE WHEN result.duplicate_decision='keep' THEN 'kept' ELSE 'created' END,
                       action=CASE WHEN result.duplicate_decision='keep' THEN 'kept' ELSE 'created' END,
                       batch_id=$4,target_id=target.id,updated_at=NOW()
                   FROM clients target
                   WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
                     AND target.tenant_id=$1 AND target.branch_id=$2 AND target.import_job_id=$3
                     AND target.normalized_phone=result.source_payload->>'normalized_phone'
                     AND result.action NOT IN ('merged','linked')
                     AND result.source_row_number IN (
                       SELECT source_row_number FROM JSONB_TO_RECORDSET($5::JSONB)
                       source(source_row_number INTEGER)
                     )"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(&job.id)
            .bind(&batch_id)
            .bind(batch)
            .execute(&mut *tx)
            .await?;
        }
        MigrationEntity::Staff if !write_rows.is_empty() => {
            let staff_rows = serde_json::from_value::<Vec<staff_hr_repository::BulkStaffInput>>(
                Value::Array(write_rows),
            )
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
            staff_hr_repository::apply_bulk_import_tx(
                &mut tx,
                &job.tenant_id,
                &job.branch_id,
                &format!("migration:{}:{}", job.id, batch_number),
                &job.created_by,
                &staff_rows,
                Some(&job.id),
            )
            .await?;
            sqlx::query(
                r#"UPDATE integration_import_row_results result
                   SET status=CASE WHEN result.action='merged' THEN 'merged' ELSE 'created' END,
                       action=CASE WHEN result.action='merged' THEN 'merged' ELSE 'created' END,
                       batch_id=$4,target_id=target.id,updated_at=NOW()
                   FROM staff target
                   WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
                     AND target.tenant_id=$1 AND target.branch_id=$2
                     AND LOWER(target.employee_code)=LOWER(result.source_payload->>'employee_code')
                     AND result.action NOT IN ('linked','kept')
                     AND result.source_row_number IN (
                       SELECT source_row_number FROM JSONB_TO_RECORDSET($5::JSONB)
                       source(source_row_number INTEGER)
                     )"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(&job.id)
            .bind(&batch_id)
            .bind(batch)
            .execute(&mut *tx)
            .await?;
        }
        MigrationEntity::Services
        | MigrationEntity::Products
        | MigrationEntity::Suppliers
        | MigrationEntity::Inventory
        | MigrationEntity::Memberships
        | MigrationEntity::Packages
            if !write_rows.is_empty() =>
        {
            for row in &write_rows {
                apply_master_row(&mut tx, job, &batch_id, row).await?;
            }
        }
        MigrationEntity::ClientMemberships if !write_rows.is_empty() => {
            for row in &write_rows {
                apply_client_membership_row(&mut tx, job, &batch_id, row).await?;
            }
        }
        MigrationEntity::Appointments
        | MigrationEntity::Sales
        | MigrationEntity::Invoices
        | MigrationEntity::Payments
        | MigrationEntity::Expenses
            if !write_rows.is_empty() =>
        {
            for row in &write_rows {
                apply_transaction_row(&mut tx, job, &batch_id, row).await?;
            }
        }
        MigrationEntity::PurchaseBills if !write_rows.is_empty() => {
            if posting_mode.as_deref() != Some("history_only") {
                return Err(sqlx::Error::Protocol("POSTING_MODE_ENTITY_MISMATCH".into()));
            }
            sqlx::query("SELECT SET_CONFIG('aurashine.historical_archive_write','on',TRUE)")
                .execute(&mut *tx)
                .await?;
            for row in &write_rows {
                apply_historical_purchase_bill_row(&mut tx, job, &batch_id, row).await?;
            }
            let completes_job = if let Some(chunk_id) = chunk_id {
                !sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM integration_import_chunks WHERE job_id=$1 AND id<>$2 AND status<>'completed')",
                )
                .bind(&job.id)
                .bind(chunk_id)
                .fetch_one(&mut *tx)
                .await?
            } else {
                end >= job.total_rows as usize
            };
            if completes_job {
                let mismatch: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM historical_purchase_bills WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3 AND total_paise>0 AND total_paise<>line_total_paise)",
                )
                .bind(&job.tenant_id)
                .bind(&job.branch_id)
                .bind(&job.id)
                .fetch_one(&mut *tx)
                .await?;
                if mismatch {
                    return Err(sqlx::Error::Protocol(
                        "HISTORICAL_PURCHASE_BILL_TOTAL_MISMATCH".into(),
                    ));
                }
            }
        }
        MigrationEntity::Refunds
        | MigrationEntity::GiftCards
        | MigrationEntity::Loyalty
        | MigrationEntity::Payroll
        | MigrationEntity::Commissions
        | MigrationEntity::ClientNotes
        | MigrationEntity::Files
        | MigrationEntity::StockMovements
        | MigrationEntity::OpeningPayables
            if !write_rows.is_empty() =>
        {
            for row in &write_rows {
                apply_extended_row(&mut tx, job, &batch_id, row).await?;
            }
        }
        _ => {}
    }

    let imported_rows = created_rows + merged_rows + linked_rows + kept_rows;
    let processed_rows = (end - start) as i32;
    sqlx::query("UPDATE integration_import_batches SET status='completed',processed_rows=$2,imported_rows=$3,error_rows=0,last_error='',completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$4 AND branch_id=$5 AND id=$1")
        .bind(&batch_id).bind(processed_rows).bind(imported_rows).bind(&job.tenant_id).bind(&job.branch_id).execute(&mut *tx).await?;
    if let Some(chunk_id) = chunk_id {
        let completed_chunk = sqlx::query("UPDATE integration_import_chunks SET status='completed',processed_rows=$2,worker_id='',heartbeat_at=NOW(),lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$3 AND branch_id=$4 AND job_id=$5 AND id=$1 AND status='processing'")
            .bind(chunk_id).bind(processed_rows).bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id)
            .execute(&mut *tx).await?.rows_affected();
        if completed_chunk != 1 {
            return Err(sqlx::Error::RowNotFound);
        }
        let (aggregate_processed, completed_chunks, failed_chunks, remaining_chunks): (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT COALESCE(SUM(processed_rows),0),COUNT(*) FILTER(WHERE status='completed'),COUNT(*) FILTER(WHERE status='failed'),COUNT(*) FILTER(WHERE status<>'completed') FROM integration_import_chunks WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
        )
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).fetch_one(&mut *tx).await?;
        let completed = remaining_chunks == 0 && failed_chunks == 0;
        sqlx::query("UPDATE integration_import_jobs SET status=CASE WHEN $4 THEN 'completed' ELSE 'processing' END,processed_rows=$5,next_row=$5,completed_chunks=$6,failed_chunks=$7,worker_id='',heartbeat_at=NOW(),lease_expires_at=NULL,last_error='',completed_at=CASE WHEN $4 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(completed)
            .bind(aggregate_processed as i32).bind(completed_chunks as i32).bind(failed_chunks as i32)
            .execute(&mut *tx).await?;
    } else {
        let completed = end >= job.total_rows as usize;
        sqlx::query("UPDATE integration_import_jobs SET status=CASE WHEN $2 THEN 'completed' ELSE 'queued' END,processed_rows=$3,next_row=$3,last_error='',completed_at=CASE WHEN $2 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$4 AND branch_id=$5 AND id=$1")
            .bind(&job.id).bind(completed).bind(end as i32).bind(&job.tenant_id).bind(&job.branch_id).execute(&mut *tx).await?;
    }
    let job_completed = sqlx::query_scalar::<_, bool>(
            "SELECT status='completed' FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut *tx)
        .await?;
    if job.entity == MigrationEntity::OpeningPayables && job_completed {
        finalize_opening_payables(&mut tx, job).await?;
    }
    if job.entity == MigrationEntity::Inventory && job_completed {
        let mismatch: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1
                   FROM integration_opening_inventory_snapshot_lines line
                   JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
                   JOIN inventory_items item ON item.id=line.inventory_item_id
                  WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3
                    AND (
                      line.quantity <> line.approved_unbatched_quantity
                        + COALESCE((SELECT SUM((batch->>'quantity')::INTEGER)
                            FROM JSONB_ARRAY_ELEMENTS(line.batches_json) batch),0)
                      OR (item.batch_tracked AND JSONB_ARRAY_LENGTH(line.batches_json)=0)
                      OR line.applied_at IS NULL
                      OR line.expected_quantity <> COALESCE((SELECT stock.quantity
                           FROM inventory_location_stock stock
                          WHERE stock.tenant_id=$1 AND stock.branch_id=$2
                            AND stock.inventory_item_id=item.id
                            AND stock.location_code=line.location_code),-2147483648)
                      OR item.stock_quantity <> (SELECT COALESCE(SUM(stock.quantity),0)::INTEGER
                           FROM inventory_location_stock stock
                          WHERE stock.tenant_id=$1 AND stock.branch_id=$2
                            AND stock.inventory_item_id=item.id)
                    )
               )"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut *tx)
        .await?;
        if mismatch {
            return Err(sqlx::Error::Protocol(
                "OPENING_SNAPSHOT_RECONCILIATION_FAILED".into(),
            ));
        }
        let valuation_mismatch: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(
                 SELECT 1
                   FROM integration_opening_inventory_snapshot_lines line
                   JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=line.snapshot_id
                   LEFT JOIN inventory_location_stock stock
                     ON stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
                    AND stock.inventory_item_id=line.inventory_item_id
                    AND stock.location_code=line.location_code
                  WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3
                    AND (line.cost_approved_by IS NULL OR line.cost_approved_at IS NULL
                      OR line.valuation_paise::NUMERIC<>line.quantity::NUMERIC*line.unit_cost_paise::NUMERIC
                      OR stock.unit_cost_paise IS DISTINCT FROM line.unit_cost_paise)
               )"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut *tx)
        .await?;
        if valuation_mismatch {
            return Err(sqlx::Error::Protocol(
                "OPENING_VALUATION_RECONCILIATION_FAILED".into(),
            ));
        }
        finalize_opening_inventory_accounting(&mut tx, job).await?;
        let approval_user: String = sqlx::query_scalar(
            "SELECT approval_decided_by FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("SELECT SET_CONFIG('aurashine.cutover_actor_id',$1,TRUE)")
            .bind(&approval_user)
            .execute(&mut *tx)
            .await?;
        sqlx::query("SELECT SET_CONFIG('aurashine.cutover_actor_role','migration-approver',TRUE)")
            .execute(&mut *tx)
            .await?;
        let transitioned = sqlx::query(
            r#"UPDATE integration_migration_cutovers cutover SET status='snapshot_applied'
                FROM integration_import_jobs job
               WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
                 AND cutover.tenant_id::TEXT=job.tenant_id
                 AND cutover.branch_id::TEXT=job.branch_id
                 AND cutover.id=job.analysis_json->'postingContract'->>'cutoverId'
                 AND cutover.status='snapshot_approved'"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if transitioned != 1 {
            return Err(sqlx::Error::Protocol(
                "OPENING_SNAPSHOT_CUTOVER_TRANSITION_FAILED".into(),
            ));
        }
    }
    insert_audit(
        &mut tx,
        &job.tenant_id,
        &job.branch_id,
        Some(&job.id),
        Some(&batch_id),
        "migration.batch.completed",
        "success",
        &job.created_by,
        json!({"batchNumber":batch_number,"startOffset":start,"endOffset":end,"processedRows":processed_rows,"importedRows":imported_rows,"createdRows":created_rows,"mergedRows":merged_rows,"linkedRows":linked_rows,"keptRows":kept_rows}),
    )
    .await?;
    tx.commit().await
}

fn three_layer_commit_block_code(
    entity: MigrationEntity,
    posting_mode: Option<&str>,
) -> Option<&'static str> {
    if entity == MigrationEntity::Inventory {
        return match posting_mode {
            Some("opening_snapshot") => None,
            None => Some("POSTING_MODE_REQUIRED"),
            Some(_) => Some("POSTING_MODE_ENTITY_MISMATCH"),
        };
    }
    if entity == MigrationEntity::PurchaseBills {
        return match posting_mode {
            None => Some("POSTING_MODE_REQUIRED"),
            Some("history_only") => None,
            Some("live_receipt") => Some("LIVE_RECEIPT_EXECUTION_NOT_READY"),
            Some(_) => Some("POSTING_MODE_ENTITY_MISMATCH"),
        };
    }
    if entity == MigrationEntity::OpeningPayables {
        return match posting_mode {
            Some("opening_payable") => None,
            None => Some("POSTING_MODE_REQUIRED"),
            Some(_) => Some("POSTING_MODE_ENTITY_MISMATCH"),
        };
    }
    None
}

pub fn migration_safety_error_code(error: &sqlx::Error) -> Option<&str> {
    let sqlx::Error::Protocol(code) = error else {
        return None;
    };
    matches!(
        code.as_str(),
        "POSTING_MODE_REQUIRED"
            | "HISTORICAL_PURCHASE_ARCHIVE_NOT_READY"
            | "LIVE_RECEIPT_EXECUTION_NOT_READY"
            | "OPENING_SNAPSHOT_EXECUTION_NOT_READY"
            | "OPENING_SNAPSHOT_CONTRACT_INVALID"
            | "OPENING_SNAPSHOT_TIME_MISMATCH"
            | "NEGATIVE_STOCK_POLICY_BLOCKED"
            | "DUPLICATE_SNAPSHOT_PRODUCT_LOCATION"
            | "OPENING_SNAPSHOT_RECONCILIATION_FAILED"
            | "OPENING_SNAPSHOT_CUTOVER_TRANSITION_FAILED"
            | "OPENING_SNAPSHOT_SET_TO_VERIFICATION_FAILED"
            | "LIVE_MOVEMENT_LOCATION_REQUIRED"
            | "LIVE_BATCH_BALANCE_NEGATIVE"
            | "OPENING_PAYABLE_CUTOVER_INVALID"
            | "OPENING_PAYABLE_APPROVAL_REQUIRED"
            | "OPENING_PAYABLE_SOURCE_TOTAL_MISMATCH"
            | "OPENING_PAYABLE_GST_MUST_BE_ZERO"
            | "OPENING_PAYABLE_ALLOCATION_INVALID"
            | "OPENING_PAYABLE_ALLOCATION_TOTAL_MISMATCH"
            | "OPENING_PAYABLE_CURRENCY_UNSUPPORTED"
            | "OPENING_PAYABLE_UNALLOCATED_APPROVAL_REQUIRED"
            | "POSTING_MODE_ENTITY_MISMATCH"
    )
    .then_some(code.as_str())
}

async fn master_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    target_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let sql = match entity {
        MigrationEntity::Services => {
            "SELECT TO_JSONB(record) FROM services record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
        }
        MigrationEntity::Products => {
            "SELECT TO_JSONB(record) FROM inventory_items record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
        }
        MigrationEntity::Suppliers => {
            "SELECT TO_JSONB(record) FROM suppliers record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
        }
        MigrationEntity::Memberships => {
            "SELECT TO_JSONB(record) FROM memberships record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
        }
        MigrationEntity::Packages => {
            "SELECT TO_JSONB(record) FROM packages record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
        }
        _ => return Ok(None),
    };
    sqlx::query_scalar(sql)
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .fetch_optional(&mut **tx)
        .await
}

async fn apply_master_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let line = row
        .get("source_row_number")
        .and_then(Value::as_i64)
        .ok_or(sqlx::Error::RowNotFound)? as i32;
    if job.entity == MigrationEntity::Inventory {
        return apply_opening_stock(tx, job, batch_id, row, line).await;
    }
    let merge = row.get("duplicate_decision").and_then(Value::as_str) == Some("merge");
    let existing_id = row
        .get("duplicate_target_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let target_id: String = match (job.entity, merge) {
        (MigrationEntity::Services, true) => sqlx::query_scalar(
            r#"UPDATE services SET name=$4->>'name',category=$4->>'category',duration_minutes=($4->>'duration_minutes')::INTEGER,
                 price_paise=($4->>'price_paise')::INTEGER,gst_percent=($4->>'gst_percent')::INTEGER,sac_code=$4->>'sac_code',
                 wait_time_minutes=($4->>'wait_time_minutes')::INTEGER,cleanup_time_minutes=($4->>'cleanup_time_minutes')::INTEGER,
                 buffer_time_minutes=($4->>'buffer_time_minutes')::INTEGER,active=($4->>'active')::BOOLEAN,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(existing_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Services, false) => sqlx::query_scalar(
            r#"INSERT INTO services(tenant_id,branch_id,name,category,duration_minutes,price_paise,gst_percent,sac_code,wait_time_minutes,cleanup_time_minutes,buffer_time_minutes,active)
               SELECT $1,$2,$3->>'name',$3->>'category',($3->>'duration_minutes')::INTEGER,($3->>'price_paise')::INTEGER,($3->>'gst_percent')::INTEGER,
                      $3->>'sac_code',($3->>'wait_time_minutes')::INTEGER,($3->>'cleanup_time_minutes')::INTEGER,($3->>'buffer_time_minutes')::INTEGER,($3->>'active')::BOOLEAN
                WHERE NOT EXISTS(SELECT 1 FROM services WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(name))=LOWER(BTRIM($3->>'name'))) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Products, true) => sqlx::query_scalar(
            r#"UPDATE inventory_items SET sku=$4->>'sku',name=$4->>'name',category=$4->>'category',unit=$4->>'unit',
                 reorder_point=($4->>'reorder_point')::INTEGER,unit_cost_paise=($4->>'unit_cost_paise')::BIGINT,hsn_code=$4->>'hsn_code',
                 gst_percent=($4->>'gst_percent')::INTEGER,barcode=$4->>'barcode',batch_tracked=($4->>'batch_tracked')::BOOLEAN,
                 active=($4->>'active')::BOOLEAN,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(existing_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Products, false) => sqlx::query_scalar(
            r#"INSERT INTO inventory_items(tenant_id,branch_id,sku,name,category,unit,stock_quantity,reorder_point,unit_cost_paise,hsn_code,gst_percent,barcode,batch_tracked,active)
               VALUES($1,$2,$3->>'sku',$3->>'name',$3->>'category',$3->>'unit',0,($3->>'reorder_point')::INTEGER,($3->>'unit_cost_paise')::BIGINT,
                      $3->>'hsn_code',($3->>'gst_percent')::INTEGER,$3->>'barcode',($3->>'batch_tracked')::BOOLEAN,($3->>'active')::BOOLEAN) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Suppliers, true) => sqlx::query_scalar(
            r#"UPDATE suppliers SET code=$4->>'code',name=$4->>'name',gstin=$4->>'gstin',contact_name=$4->>'contact_name',phone=$4->>'phone',
                 email=$4->>'email',address=$4->>'address',payment_terms_days=($4->>'payment_terms_days')::INTEGER,active=($4->>'active')::BOOLEAN,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(existing_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Suppliers, false) => sqlx::query_scalar(
            r#"INSERT INTO suppliers(tenant_id,branch_id,code,name,gstin,contact_name,phone,email,address,payment_terms_days,active)
               VALUES($1,$2,$3->>'code',$3->>'name',$3->>'gstin',$3->>'contact_name',$3->>'phone',$3->>'email',$3->>'address',($3->>'payment_terms_days')::INTEGER,($3->>'active')::BOOLEAN) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Memberships, true) => sqlx::query_scalar(
            r#"UPDATE memberships SET name=$4->>'name',code=$4->>'code',plan_type=$4->>'plan_type',price_paise=($4->>'price_paise')::BIGINT,
                 points_required=($4->>'points_required')::INTEGER,discount_percent=($4->>'discount_percent')::INTEGER,validity_days=($4->>'validity_days')::INTEGER,
                 notes=$4->>'notes',service_ids_json=COALESCE($4->'service_ids_json','[]'::JSONB),active=($4->>'active')::BOOLEAN,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(existing_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Memberships, false) => sqlx::query_scalar(
            r#"INSERT INTO memberships(tenant_id,branch_id,name,code,plan_type,price_paise,points_required,discount_percent,validity_days,notes,service_ids_json,active)
               VALUES($1,$2,$3->>'name',$3->>'code',$3->>'plan_type',($3->>'price_paise')::BIGINT,($3->>'points_required')::INTEGER,
                      ($3->>'discount_percent')::INTEGER,($3->>'validity_days')::INTEGER,$3->>'notes',COALESCE($3->'service_ids_json','[]'::JSONB),($3->>'active')::BOOLEAN) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Packages, true) => sqlx::query_scalar(
            r#"UPDATE packages SET name=$4->>'name',description=$4->>'description',price_paise=($4->>'price_paise')::BIGINT,
                 discount_percent=($4->>'discount_percent')::INTEGER,validity_days=($4->>'validity_days')::INTEGER,
                 service_ids_json=$4->'service_ids_json',paid_sessions=($4->>'paid_sessions')::INTEGER,free_sessions=($4->>'free_sessions')::INTEGER,
                 cost_price_paise=($4->>'cost_price_paise')::BIGINT,service_rows_json=$4->'service_rows_json',show_mobile_app=($4->>'show_mobile_app')::BOOLEAN,
                 show_online_booking=($4->>'show_online_booking')::BOOLEAN,active=($4->>'active')::BOOLEAN,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(existing_id).bind(row).fetch_one(&mut **tx).await?,
        (MigrationEntity::Packages, false) => sqlx::query_scalar(
            r#"INSERT INTO packages(tenant_id,branch_id,name,description,price_paise,discount_percent,validity_days,service_ids_json,paid_sessions,free_sessions,cost_price_paise,service_rows_json,show_mobile_app,show_online_booking,active)
               SELECT $1,$2,$3->>'name',$3->>'description',($3->>'price_paise')::BIGINT,($3->>'discount_percent')::INTEGER,($3->>'validity_days')::INTEGER,
                      $3->'service_ids_json',($3->>'paid_sessions')::INTEGER,($3->>'free_sessions')::INTEGER,($3->>'cost_price_paise')::BIGINT,$3->'service_rows_json',
                      ($3->>'show_mobile_app')::BOOLEAN,($3->>'show_online_booking')::BOOLEAN,($3->>'active')::BOOLEAN
                WHERE NOT EXISTS(SELECT 1 FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(name))=LOWER(BTRIM($3->>'name'))) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(row).fetch_one(&mut **tx).await?,
        _ => return Err(sqlx::Error::RowNotFound),
    };
    if !merge {
        mark_row_action(
            tx,
            job,
            batch_id,
            line,
            "created",
            &target_id,
            &Value::Object(Default::default()),
        )
        .await?;
    }
    Ok(())
}

async fn apply_opening_stock(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
    line: i32,
) -> Result<(), sqlx::Error> {
    let item_id = row
        .get("inventory_item_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(sqlx::Error::RowNotFound)?;
    let quantity = row
        .get("opening_stock")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or(sqlx::Error::RowNotFound)?;
    let unit_cost = row
        .get("unit_cost_paise")
        .and_then(Value::as_i64)
        .ok_or(sqlx::Error::RowNotFound)?;
    let location = value_str(row, "location_code")?;
    let stock_unit = value_str(row, "stock_unit")?;
    let snapshot_at = DateTime::parse_from_rfc3339(value_str(row, "snapshot_at")?)
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
        .with_timezone(&Utc);
    let source_sheet = value_str(row, "__migration_source_sheet")?;
    let original = row
        .pointer("/__migration_evidence/sourceValues")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let row_checksum = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&original).map_err(|error| sqlx::Error::Decode(Box::new(error)))?
        )
    );
    let (source_file_id, source_checksum, cutover_id, approved_by, cutover_at, negative_rule) =
        sqlx::query_as::<_, (String, String, String, String, DateTime<Utc>, String)>(
            r#"SELECT source.id,source.sha256,
                      job.analysis_json->'postingContract'->>'cutoverId',
                      job.approval_decided_by,cutover.cutover_at,
                      COALESCE(policy.negative_stock_rule,'block')
                 FROM integration_import_jobs job
                 JOIN integration_import_source_files source
                   ON source.tenant_id=job.tenant_id AND source.branch_id=job.branch_id
                  AND source.id=job.source_file_id
                 JOIN integration_migration_cutovers cutover
                   ON cutover.tenant_id::TEXT=job.tenant_id
                  AND cutover.branch_id::TEXT=job.branch_id
                  AND cutover.id=job.analysis_json->'postingContract'->>'cutoverId'
                 LEFT JOIN inventory_policies policy
                   ON policy.tenant_id=job.tenant_id AND policy.branch_id=job.branch_id
                WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
                  AND job.mode='commit' AND job.approval_status='approved'
                  AND source.read_only AND source.evidence_status='verified'
                  AND LOWER(source.sha256)=LOWER(job.source_hash)
                  AND cutover.status='snapshot_approved'
                  AND LOWER(cutover.snapshot_checksum)=LOWER(source.sha256)
                FOR UPDATE OF cutover"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| sqlx::Error::Protocol("OPENING_SNAPSHOT_CONTRACT_INVALID".into()))?;
    if snapshot_at != cutover_at {
        return Err(sqlx::Error::Protocol(
            "OPENING_SNAPSHOT_TIME_MISMATCH".into(),
        ));
    }
    if quantity < 0
        && (row.get("negative_stock_approved").and_then(Value::as_bool) != Some(true)
            || negative_rule != "approval_required")
    {
        return Err(sqlx::Error::Protocol(
            "NEGATIVE_STOCK_POLICY_BLOCKED".into(),
        ));
    }
    sqlx::query("SELECT SET_CONFIG('aurashine.cutover_snapshot_apply','on',TRUE)")
        .execute(&mut **tx)
        .await?;
    let snapshot_id: String = sqlx::query_scalar(
        r#"WITH inserted AS (
             INSERT INTO integration_opening_inventory_snapshots(
               tenant_id,branch_id,import_job_id,source_file_id,cutover_id,snapshot_at,
               source_checksum,approved_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT DO NOTHING RETURNING id
           )
           SELECT id FROM inserted
           UNION ALL
           SELECT id FROM integration_opening_inventory_snapshots
            WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3
           LIMIT 1"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(&source_file_id)
    .bind(&cutover_id)
    .bind(snapshot_at)
    .bind(&source_checksum)
    .bind(&approved_by)
    .fetch_one(&mut **tx)
    .await?;
    if let Some(existing_checksum) = sqlx::query_scalar::<_, String>(
        "SELECT source_row_checksum FROM integration_opening_inventory_snapshot_lines WHERE snapshot_id=$1 AND inventory_item_id=$2 AND location_code=$3",
    )
    .bind(&snapshot_id)
    .bind(item_id)
    .bind(location)
    .fetch_optional(&mut **tx)
    .await?
    {
        if existing_checksum != row_checksum {
            return Err(sqlx::Error::Protocol(
                "DUPLICATE_SNAPSHOT_PRODUCT_LOCATION".into(),
            ));
        }
        return mark_row_action(
            tx,
            job,
            batch_id,
            line,
            "linked",
            item_id,
            &json!({"snapshotId":snapshot_id,"idempotentReplay":true}),
        )
        .await;
    }
    let before: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'record',JSONB_BUILD_OBJECT('stock_quantity',item.stock_quantity,'unit_cost_paise',item.unit_cost_paise,'updated_at',item.updated_at),
             'locationStock',(SELECT TO_JSONB(stock) FROM inventory_location_stock stock
               WHERE stock.tenant_id=$1 AND stock.branch_id=$2 AND stock.inventory_item_id=$3 AND stock.location_code=$4),
             'locationBatches',COALESCE((SELECT JSONB_AGG(TO_JSONB(batch) ORDER BY batch.batch_number)
               FROM inventory_location_batches batch WHERE batch.tenant_id=$1 AND batch.branch_id=$2
                 AND batch.inventory_item_id=$3 AND batch.location_code=$4),'[]'::JSONB),
             'itemBatches',COALESCE((SELECT JSONB_AGG(TO_JSONB(batch) ORDER BY batch.batch_number)
               FROM inventory_batches batch WHERE batch.tenant_id=$1 AND batch.branch_id=$2
                 AND batch.inventory_item_id=$3),'[]'::JSONB))
           FROM inventory_items item
           WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3 FOR UPDATE"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .fetch_one(&mut **tx)
    .await?;
    let location_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(DISTINCT source_payload->>'location_code')
             FROM integration_import_row_results
            WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3
              AND source_payload->>'inventory_item_id'=$4"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(item_id)
    .fetch_one(&mut **tx)
    .await?;
    let post_cutover_delta: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(quantity_delta),0)::BIGINT
             FROM inventory_stock_ledger
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3
              AND created_at>$4 AND movement_type<>'opening_snapshot'
              AND (inventory_location_code=$5
                   OR (inventory_location_code IS NULL AND $6=1))"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(cutover_at)
    .bind(location)
    .bind(location_count)
    .fetch_one(&mut **tx)
    .await?;
    let post_cutover_delta_i32 = i32::try_from(post_cutover_delta)
        .map_err(|_| sqlx::Error::Protocol("STOCK_QUANTITY_OVERFLOW".into()))?;
    let expected_quantity = expected_stock_quantity(quantity, post_cutover_delta)
        .ok_or_else(|| sqlx::Error::Protocol("STOCK_QUANTITY_OVERFLOW".into()))?;
    if expected_quantity < 0
        && (row.get("negative_stock_approved").and_then(Value::as_bool) != Some(true)
            || negative_rule != "approval_required")
    {
        return Err(sqlx::Error::Protocol(
            "NEGATIVE_STOCK_POLICY_BLOCKED".into(),
        ));
    }
    let stock_before = before
        .pointer("/record/stock_quantity")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or(sqlx::Error::RowNotFound)?;
    let other_location_quantity: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(quantity),0)::BIGINT
             FROM inventory_location_stock
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3
              AND location_code<>$4"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .fetch_one(&mut **tx)
    .await?;
    let projected_stock_after = other_location_quantity
        .checked_add(i64::from(expected_quantity))
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| sqlx::Error::Protocol("STOCK_QUANTITY_OVERFLOW".into()))?;
    let applied_delta = projected_stock_after
        .checked_sub(stock_before)
        .ok_or_else(|| sqlx::Error::Protocol("STOCK_QUANTITY_OVERFLOW".into()))?;
    let snapshot_line_id: String = sqlx::query_scalar(
        r#"INSERT INTO integration_opening_inventory_snapshot_lines(
             snapshot_id,tenant_id,branch_id,inventory_item_id,location_code,stock_unit,
             quantity,unit_cost_paise,valuation_paise,batches_json,approved_unbatched_quantity,
             source_sheet,source_row_number,source_row_checksum,post_cutover_delta,
             expected_quantity,applied_delta,applied_at,source_unit_cost_paise,
             source_valuation_paise,suggested_source_system_cost_paise,suggested_latest_cost_paise,
             suggested_weighted_average_cost_paise,cost_method,cost_approved_by,cost_approved_at,
             counted_by,count_notes,source_quantity,source_unit,unit_multiplier,classifications_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),
             $18,$19,$20,$21,$22,$23,$24,NOW(),$25,$26,$27,$28,$29,$30)
           RETURNING id"#,
    )
    .bind(&snapshot_id)
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .bind(stock_unit)
    .bind(quantity)
    .bind(unit_cost)
    .bind(value_i64(row, "valuation_paise")?)
    .bind(
        row.get("batches_json")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .bind(value_i64(row, "approved_unbatched_quantity")? as i32)
    .bind(source_sheet)
    .bind(line)
    .bind(&row_checksum)
    .bind(post_cutover_delta_i32)
    .bind(expected_quantity)
    .bind(applied_delta)
    .bind(row.get("source_unit_cost_paise").and_then(Value::as_i64))
    .bind(row.get("source_valuation_paise").and_then(Value::as_i64))
    .bind(
        row.get("suggested_source_system_cost_paise")
            .and_then(Value::as_i64),
    )
    .bind(
        row.get("suggested_latest_cost_paise")
            .and_then(Value::as_i64),
    )
    .bind(
        row.get("suggested_weighted_average_cost_paise")
            .and_then(Value::as_i64),
    )
    .bind(value_str(row, "cost_method")?)
    .bind(&approved_by)
    .bind(value_str(row, "counted_by")?)
    .bind(row.get("count_notes").and_then(Value::as_str).unwrap_or(""))
    .bind(value_str(row, "source_quantity")?)
    .bind(value_str(row, "source_unit")?)
    .bind(value_i64(row, "unit_multiplier")? as i32)
    .bind(
        row.get("classifications_json")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO inventory_location_stock(
             tenant_id,branch_id,inventory_item_id,location_code,stock_unit,quantity,
             unit_cost_paise,snapshot_line_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(tenant_id,branch_id,inventory_item_id,location_code) DO UPDATE SET
             stock_unit=EXCLUDED.stock_unit,quantity=EXCLUDED.quantity,
             unit_cost_paise=EXCLUDED.unit_cost_paise,snapshot_line_id=EXCLUDED.snapshot_line_id,
             updated_at=NOW()"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .bind(stock_unit)
    .bind(expected_quantity)
    .bind(unit_cost)
    .bind(&snapshot_line_id)
    .execute(&mut **tx)
    .await?;
    let batches_json = row
        .get("batches_json")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let negative_batch_balance: bool = sqlx::query_scalar(
        r#"WITH declared AS (
             SELECT source."batchNumber" AS batch_number,source.quantity
               FROM JSONB_TO_RECORDSET($7) AS source("batchNumber" TEXT,quantity INTEGER)
           ), live AS (
             SELECT batch.batch_number,SUM(movement.quantity_delta)::INTEGER AS quantity
               FROM inventory_batch_movements movement
               JOIN inventory_batches batch ON batch.id=movement.batch_id
               JOIN inventory_stock_ledger ledger ON ledger.id=movement.stock_ledger_id
              WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
                AND ledger.inventory_item_id=$3 AND ledger.created_at>$4
                AND ledger.movement_type<>'opening_snapshot'
                AND (ledger.inventory_location_code=$5
                     OR (ledger.inventory_location_code IS NULL AND $6=1))
              GROUP BY batch.batch_number
           )
           SELECT EXISTS(
             SELECT 1 FROM declared FULL JOIN live USING(batch_number)
              WHERE COALESCE(declared.quantity,0)+COALESCE(live.quantity,0)<0
           )"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(cutover_at)
    .bind(location)
    .bind(location_count)
    .bind(&batches_json)
    .fetch_one(&mut **tx)
    .await?;
    if negative_batch_balance {
        return Err(sqlx::Error::Protocol("LIVE_BATCH_BALANCE_NEGATIVE".into()));
    }
    sqlx::query(
        "DELETE FROM inventory_location_batches WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND location_code=$4",
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO inventory_location_batches(
             tenant_id,branch_id,inventory_item_id,location_code,batch_number,expiry_date,
             quantity,unit_cost_paise,snapshot_line_id)
           SELECT $1,$2,$3,$5,batch.batch_number,MAX(batch.expiry_date),
                  SUM(movement.quantity_delta)::INTEGER,MAX(movement_ledger.unit_cost_paise),$7
             FROM inventory_batch_movements movement
             JOIN inventory_batches batch ON batch.id=movement.batch_id
             JOIN inventory_stock_ledger movement_ledger ON movement_ledger.id=movement.stock_ledger_id
            WHERE movement_ledger.tenant_id=$1 AND movement_ledger.branch_id=$2
              AND movement_ledger.inventory_item_id=$3 AND movement_ledger.created_at>$4
              AND movement_ledger.movement_type<>'opening_snapshot'
              AND (movement_ledger.inventory_location_code=$5
                   OR (movement_ledger.inventory_location_code IS NULL AND $6=1))
            GROUP BY batch.batch_number
           ON CONFLICT(tenant_id,branch_id,inventory_item_id,location_code,batch_number)
           DO UPDATE SET quantity=inventory_location_batches.quantity+EXCLUDED.quantity,
             expiry_date=COALESCE(EXCLUDED.expiry_date,inventory_location_batches.expiry_date),
             unit_cost_paise=EXCLUDED.unit_cost_paise,
             snapshot_line_id=EXCLUDED.snapshot_line_id,updated_at=NOW()"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(cutover_at)
    .bind(location)
    .bind(location_count)
    .bind(&snapshot_line_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO integration_opening_inventory_batch_applications(
             snapshot_line_id,tenant_id,branch_id,inventory_item_id,location_code,batch_number,
             declared_quantity,post_cutover_delta,expected_quantity,idempotency_key)
           SELECT $1,$2,$3,$4,$5,current.batch_number,
                  COALESCE(declared.quantity,0),
                  current.quantity-COALESCE(declared.quantity,0),current.quantity,
                  CONCAT($6,':',LOWER(current.batch_number))
             FROM inventory_location_batches current
             LEFT JOIN JSONB_TO_RECORDSET($7) AS declared("batchNumber" TEXT,quantity INTEGER)
               ON LOWER(declared."batchNumber")=LOWER(current.batch_number)
            WHERE current.tenant_id=$2 AND current.branch_id=$3
              AND current.inventory_item_id=$4 AND current.location_code=$5"#,
    )
    .bind(&snapshot_line_id)
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(location)
    .bind(format!(
        "migration:{}:{}:{}:{}",
        snapshot_id, item_id, location, line
    ))
    .bind(&batches_json)
    .execute(&mut **tx)
    .await?;
    for batch in row
        .get("batches_json")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        sqlx::query(
            r#"INSERT INTO inventory_location_batches(
                 tenant_id,branch_id,inventory_item_id,location_code,batch_number,expiry_date,
                 quantity,unit_cost_paise,snapshot_line_id)
               VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::DATE,$7,$8,$9)"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(item_id)
        .bind(location)
        .bind(value_str(batch, "batchNumber")?)
        .bind(
            batch
                .get("expiryDate")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )
        .bind(value_i64(batch, "quantity")? as i32)
        .bind(unit_cost)
        .bind(&snapshot_line_id)
        .execute(&mut **tx)
        .await?;
    }
    sqlx::query(
        "UPDATE inventory_batches SET quantity=0,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3",
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO inventory_batches(
             tenant_id,branch_id,inventory_item_id,batch_number,expiry_date,received_date,
             quantity,unit_cost_paise)
           SELECT tenant_id,branch_id,inventory_item_id,batch_number,MAX(expiry_date),$4::DATE,
                  SUM(quantity)::INTEGER,MAX(unit_cost_paise)
             FROM inventory_location_batches
            WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3
            GROUP BY tenant_id,branch_id,inventory_item_id,batch_number
           ON CONFLICT(tenant_id,branch_id,inventory_item_id,batch_number) DO UPDATE SET
             expiry_date=EXCLUDED.expiry_date,quantity=EXCLUDED.quantity,
             unit_cost_paise=EXCLUDED.unit_cost_paise,updated_at=NOW()"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(snapshot_at.date_naive())
    .execute(&mut **tx)
    .await?;
    let (updated_from, stock_after): (i32, i32) = sqlx::query_as(
        r#"WITH previous AS (
             SELECT stock_quantity FROM inventory_items
              WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           ), changed AS (
             UPDATE inventory_items item SET
               stock_quantity=(SELECT COALESCE(SUM(stock.quantity),0)::INTEGER
                 FROM inventory_location_stock stock WHERE stock.tenant_id=$1
                  AND stock.branch_id=$2 AND stock.inventory_item_id=$3),
               unit_cost_paise=$4,updated_at=NOW()
              WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3
              RETURNING stock_quantity
           ) SELECT previous.stock_quantity,changed.stock_quantity FROM previous,changed"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(item_id)
    .bind(unit_cost)
    .fetch_one(&mut **tx)
    .await?;
    if updated_from != stock_before || stock_after != projected_stock_after {
        return Err(sqlx::Error::Protocol(
            "OPENING_SNAPSHOT_SET_TO_VERIFICATION_FAILED".into(),
        ));
    }
    let delta = stock_after
        .checked_sub(updated_from)
        .ok_or_else(|| sqlx::Error::Protocol("STOCK_QUANTITY_OVERFLOW".into()))?;
    let ledger_id = if delta == 0 {
        None
    } else {
        Some(
            sqlx::query_scalar::<_, String>(
                r#"INSERT INTO inventory_stock_ledger(
                 tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,
                 quantity_delta,unit_cost_paise,stock_after_quantity,adjustment_reason,
                 adjustment_idempotency_key,opening_snapshot_id,opening_snapshot_line_id,
                 inventory_location_code)
               VALUES($1,$2,$3,NULL,NULL,'opening_snapshot',$4,$5,$6,
                 'Migration exact set-to opening snapshot',$7,$8,$9,$10)
               RETURNING id"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(item_id)
            .bind(delta)
            .bind(unit_cost)
            .bind(stock_after)
            .bind(format!(
                "opening-snapshot:{}:{}:{}",
                snapshot_id,
                item_id,
                location.to_ascii_lowercase()
            ))
            .bind(&snapshot_id)
            .bind(&snapshot_line_id)
            .bind(location)
            .fetch_one(&mut **tx)
            .await?,
        )
    };
    mark_row_action(
        tx,
        job,
        batch_id,
        line,
        "merged",
        item_id,
        &json!({"record":before["record"],"locationCode":location,"locationStock":before["locationStock"],"locationBatches":before["locationBatches"],"itemBatches":before["itemBatches"],"declaredQuantity":quantity,"postCutoverDelta":post_cutover_delta_i32,"expectedQuantity":expected_quantity,"appliedDelta":delta,"ledgerId":ledger_id,"snapshotId":snapshot_id,"snapshotLineId":snapshot_line_id}),
    )
    .await
}

fn expected_stock_quantity(declared_cutover_quantity: i32, signed_live_delta: i64) -> Option<i32> {
    i64::from(declared_cutover_quantity)
        .checked_add(signed_live_delta)
        .and_then(|value| i32::try_from(value).ok())
}

async fn apply_client_membership_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let line = value_i64(row, "source_row_number")? as i32;
    let (membership_id, created_membership_plan) = match row
        .get("membership_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        Some(id) => (id.to_string(), false),
        None => {
            let created = sqlx::query_scalar::<_, String>(
                r#"INSERT INTO memberships(tenant_id,branch_id,name,code,plan_type,price_paise,validity_days,notes,active)
                   VALUES($1,$2,$3->>'membership_name',$3->>'membership_code','discount',($3->>'price_paid_paise')::BIGINT,
                          CASE WHEN NULLIF($3->>'expires_at','') IS NULL THEN 0 ELSE GREATEST(0,(($3->>'expires_at')::DATE-($3->>'assigned_at')::DATE)) END,
                          'Created from data migration',TRUE)
                   ON CONFLICT (tenant_id,branch_id,code) DO NOTHING RETURNING id"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(row)
            .fetch_optional(&mut **tx)
            .await?;
            match created {
                Some(id) => (id, true),
                None => {
                    let id = sqlx::query_scalar(
                        "SELECT id FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND code=$3",
                    )
                    .bind(&job.tenant_id)
                    .bind(&job.branch_id)
                    .bind(value_str(row, "membership_code")?)
                    .fetch_one(&mut **tx)
                    .await?;
                    (id, false)
                }
            }
        }
    };
    let target_id: String = sqlx::query_scalar(
        r#"INSERT INTO client_memberships(
             tenant_id,branch_id,client_id,membership_id,assigned_at,expires_at,active,source_sale_id,
             migration_price_paid_paise,migration_balance_paise,migration_staff_id,migration_source_id,import_job_id,created_at,updated_at)
           VALUES($1,$2,$3,$4,($5->>'assigned_at')::DATE,CASE WHEN $5->>'expires_at'='' THEN NULL ELSE ($5->>'expires_at')::DATE END,
             ($5->>'active')::BOOLEAN,$6,($5->>'price_paid_paise')::BIGINT,($5->>'balance_paise')::BIGINT,
             NULLIF($5->>'staff_id',''),$6,$7,NOW(),NOW())
           ON CONFLICT (tenant_id,branch_id,migration_source_id) WHERE migration_source_id<>'' DO NOTHING RETURNING id"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(value_str(row, "client_id")?)
    .bind(&membership_id)
    .bind(row)
    .bind(value_str(row, "source_external_id")?)
    .bind(&job.id)
    .fetch_one(&mut **tx)
    .await?;
    mark_row_action(
        tx,
        job,
        batch_id,
        line,
        "created",
        &target_id,
        &json!({"membershipId":membership_id,"createdMembershipPlan":created_membership_plan}),
    )
    .await
}

async fn apply_transaction_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let line = value_i64(row, "source_row_number")? as i32;
    let external_id = value_str(row, "source_external_id")?;
    match job.entity {
        MigrationEntity::Appointments => {
            let id: String = sqlx::query_scalar(
                r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id)
                   VALUES(gen_random_uuid()::TEXT,$1,$2,$3,$4,$5::JSONB::TEXT,$6::TIMESTAMPTZ,$7::TIMESTAMPTZ,$8,$9,'migration','migration',$10) RETURNING id"#,
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"client_id")?)
             .bind(value_str(row,"staff_id")?).bind(row.get("service_ids_json").unwrap_or(&Value::Null))
             .bind(value_str(row,"start_at")?).bind(value_str(row,"end_at")?).bind(value_str(row,"status")?)
             .bind(row.get("notes").and_then(Value::as_str).unwrap_or(""))
             .bind(external_id).fetch_one(&mut **tx).await?;
            mark_row_action(tx, job, batch_id, line, "created", &id, &json!({})).await
        }
        MigrationEntity::Sales | MigrationEntity::Invoices => {
            apply_sale_or_invoice(tx, job, batch_id, row, line, external_id).await
        }
        MigrationEntity::Payments => {
            let sale_id = value_str(row, "sale_id")?;
            let (before_paid, total, before_status): (i64, i64, String) = sqlx::query_as(
                "SELECT paid_paise,total_paise,status FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).fetch_one(&mut **tx).await?;
            let amount = value_i64(row, "amount_paise")?;
            if before_paid.saturating_add(amount) > total {
                return Err(sqlx::Error::Protocol(
                    "migration payment exceeds invoice balance".into(),
                ));
            }
            let payment_id: String = sqlx::query_scalar(
                "INSERT INTO pos_payments(tenant_id,branch_id,sale_id,method,amount_paise,method_reference,notes,paid_at,created_at) VALUES($1,$2,$3,$4,$5,$6,'Migration payment',$7::TIMESTAMPTZ,$7::TIMESTAMPTZ) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(value_str(row,"method")?)
             .bind(amount).bind(value_str(row,"reference")?).bind(value_str(row,"paid_at")?).fetch_one(&mut **tx).await?;
            let new_paid = before_paid + amount;
            sqlx::query("UPDATE pos_sales SET paid_paise=$4,status=CASE WHEN $4>=total_paise THEN 'paid' ELSE status END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(new_paid).execute(&mut **tx).await?;
            accounting_service::post_payment_backfill(
                tx,
                &job.tenant_id,
                &job.branch_id,
                &payment_id,
                value_str(row, "method")?,
                amount,
                DateTime::parse_from_rfc3339(value_str(row, "paid_at")?)
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?
                    .date_naive(),
                &job.created_by,
            )
            .await
            .map_err(accounting_error)?;
            mark_row_action(
                tx,
                job,
                batch_id,
                line,
                "created",
                &payment_id,
                &json!({"saleId":sale_id,"salePaidPaise":before_paid,"saleStatus":before_status}),
            )
            .await
        }
        MigrationEntity::Expenses => {
            let amount = value_i64(row, "amount_paise")?;
            let payment_account = if value_str(row, "payment_method")?.eq_ignore_ascii_case("cash")
            {
                "CASH_ON_HAND"
            } else {
                "BANK_CLEARING"
            };
            let voucher_id: String = sqlx::query_scalar(
                r#"INSERT INTO outgoing_fund_vouchers(tenant_id,branch_id,voucher_number,business_date,payment_account_code,payment_mode,reference_number,linked_party_type,linked_party_name,bill_reference,remarks,status,idempotency_key,created_by_user_id,submitted_by_user_id,approved_by_user_id,submitted_at,approved_at)
                   VALUES($1,$2,$3,$4::DATE,$5,$6,NULLIF($7,''),CASE WHEN $8='' THEN 'none' ELSE 'vendor' END,NULLIF($8,''),NULLIF($7,''),NULLIF($9,''),'approved',$10,$11,$11,$11,NOW(),NOW()) RETURNING id"#,
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(format!("MIG-{}-{line}", &job.id[..job.id.len().min(8)]))
             .bind(value_str(row,"business_date")?).bind(payment_account).bind(value_str(row,"payment_method")?)
             .bind(value_str(row,"reference")?).bind(value_str(row,"vendor")?).bind(value_str(row,"notes")?)
             .bind(format!("migration:{external_id}")).bind(&job.created_by).fetch_one(&mut **tx).await?;
            sqlx::query("INSERT INTO outgoing_fund_lines(tenant_id,branch_id,voucher_id,line_number,category_key,account_code,amount_paise,gst_treatment,gst_paise,remarks) VALUES($1,$2,$3,1,$4,$5,$6,CASE WHEN $7>0 THEN 'igst' ELSE 'none' END,$7,NULLIF($8,''))")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&voucher_id).bind(value_str(row,"category")?)
                .bind(value_str(row,"account_code")?).bind(amount).bind(value_i64(row,"gst_paise")?).bind(value_str(row,"notes")?).execute(&mut **tx).await?;
            let journal_id = accounting_service::post_control_journal(
                tx,
                &job.tenant_id,
                &job.branch_id,
                "migration_expense",
                &voucher_id,
                parse_date(row, "business_date")?,
                "Migrated historical expense",
                &job.created_by,
                &[
                    ManualJournalLine {
                        account_code: value_str(row, "account_code")?.into(),
                        debit_paise: amount,
                        credit_paise: 0,
                    },
                    ManualJournalLine {
                        account_code: payment_account.into(),
                        debit_paise: 0,
                        credit_paise: amount,
                    },
                ],
            )
            .await
            .map_err(accounting_error)?
            .ok_or_else(|| sqlx::Error::Protocol("expense journal was not created".into()))?;
            sqlx::query("UPDATE outgoing_fund_vouchers SET journal_entry_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&voucher_id).bind(&journal_id).execute(&mut **tx).await?;
            mark_row_action(
                tx,
                job,
                batch_id,
                line,
                "created",
                &voucher_id,
                &json!({"journalIds":[journal_id]}),
            )
            .await
        }
        MigrationEntity::PurchaseBills => {
            apply_purchase_bill_row(tx, job, batch_id, row, line).await
        }
        _ => Err(sqlx::Error::RowNotFound),
    }
}

async fn apply_extended_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let line = value_i64(row, "source_row_number")? as i32;
    let external_id = value_str(row, "source_external_id")?;
    let occurred_at = row
        .get("occurred_at")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    match job.entity {
        MigrationEntity::Refunds => {
            let sale_id = value_str(row, "sale_id")?;
            let amount = value_i64(row, "amount_paise")?;
            let method = value_str(row, "payment_method")?;
            let (paid, total, status, client_id, staff_id): (i64, i64, String, String, String) = sqlx::query_as(
                "SELECT paid_paise,total_paise,status,client_id,staff_id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).fetch_one(&mut **tx).await?;
            let refunded: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM pos_invoice_refunds WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).fetch_one(&mut **tx).await?;
            if refunded
                .checked_add(amount)
                .is_none_or(|next_refund| next_refund > paid)
            {
                return Err(sqlx::Error::Protocol(
                    "REFUND_EXCEEDS_REFUNDABLE_BALANCE".into(),
                ));
            }
            let refundable_payments: Vec<(String, i64)> = sqlx::query_as(
                r#"SELECT payment.id,
                          payment.amount_paise-COALESCE((SELECT SUM(allocation.amount_paise) FROM pos_refund_payment_allocations allocation WHERE allocation.tenant_id=$1 AND allocation.branch_id=$2 AND allocation.pos_payment_id=payment.id),0)::BIGINT AS available
                   FROM pos_payments payment
                   WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND payment.sale_id=$3
                     AND LOWER(payment.method)=LOWER($4)
                     AND payment.amount_paise-COALESCE((SELECT SUM(allocation.amount_paise) FROM pos_refund_payment_allocations allocation WHERE allocation.tenant_id=$1 AND allocation.branch_id=$2 AND allocation.pos_payment_id=payment.id),0)>0
                   ORDER BY payment.created_at,payment.id FOR UPDATE OF payment"#,
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(method).fetch_all(&mut **tx).await?;
            if refundable_payments.is_empty() {
                return Err(sqlx::Error::Protocol("REFUND_PAYMENT_NOT_FOUND".into()));
            }
            if refundable_payments
                .iter()
                .try_fold(0_i64, |total, (_, available)| total.checked_add(*available))
                .is_none_or(|available| amount > available)
            {
                return Err(sqlx::Error::Protocol(
                    "REFUND_EXCEEDS_REFUNDABLE_BALANCE".into(),
                ));
            }
            let refund_id: String = sqlx::query_scalar(
                "INSERT INTO pos_invoice_refunds(tenant_id,branch_id,sale_id,actor_user_id,amount_paise,reason,notes,idempotency_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::TIMESTAMPTZ,NOW())) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(&job.created_by).bind(amount)
             .bind(value_str(row,"reason")?).bind(value_str(row,"notes")?).bind(format!("migration:{external_id}")).bind(occurred_at)
             .fetch_one(&mut **tx).await?;
            let credit_note_number = format!("MIG-CN-{}-{line}", &job.id[..job.id.len().min(8)]);
            let credit_note_id: String = sqlx::query_scalar(
                "INSERT INTO pos_credit_notes(tenant_id,branch_id,sale_id,credit_note_number,amount_paise,reason,notes,idempotency_key,actor_user_id,refund_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::TIMESTAMPTZ,NOW())) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(&credit_note_number).bind(amount)
             .bind(value_str(row,"reason")?).bind(value_str(row,"notes")?).bind(format!("migration:{external_id}"))
             .bind(&job.created_by).bind(&refund_id).bind(occurred_at).fetch_one(&mut **tx).await?;
            sqlx::query("UPDATE pos_invoice_refunds SET credit_note_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&refund_id).bind(&credit_note_id).execute(&mut **tx).await?;
            let mut remaining = amount;
            for (payment_id, available) in refundable_payments {
                let allocated = remaining.min(available);
                sqlx::query("INSERT INTO pos_refund_payment_allocations(tenant_id,branch_id,refund_id,pos_payment_id,method,amount_paise) VALUES($1,$2,$3,$4,$5,$6)")
                    .bind(&job.tenant_id).bind(&job.branch_id).bind(&refund_id).bind(payment_id).bind(method).bind(allocated).execute(&mut **tx).await?;
                remaining -= allocated;
                if remaining == 0 {
                    break;
                }
            }
            let next_refunded = refunded + amount;
            sqlx::query("UPDATE pos_sales SET status=CASE WHEN $4>=paid_paise THEN 'refunded' ELSE 'partial_refund' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(next_refunded).execute(&mut **tx).await?;
            membership_service::reverse_rewards_for_refund(
                tx,
                &job.tenant_id,
                &job.branch_id,
                &client_id,
                &staff_id,
                sale_id,
                &refund_id,
                next_refunded,
                total,
            )
            .await
            .map_err(accounting_error)?;
            accounting_service::post_refund(
                tx,
                &job.tenant_id,
                &job.branch_id,
                &refund_id,
                &[RefundSettlement {
                    method: method.into(),
                    amount_paise: amount,
                }],
            )
            .await
            .map_err(accounting_error)?;
            let journal_ids: Vec<String> = sqlx::query_scalar("SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='refund' AND source_id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&refund_id).fetch_all(&mut **tx).await?;
            mark_row_action(tx, job, batch_id, line, "created", &refund_id, &json!({"saleId":sale_id,"saleStatus":status,"creditNoteId":credit_note_id,"journalIds":journal_ids})).await
        }
        MigrationEntity::GiftCards => {
            let initial = value_i64(row, "initial_amount_paise")?;
            let balance = value_i64(row, "balance_paise")?;
            if balance > initial {
                return Err(sqlx::Error::Protocol(
                    "GIFT_CARD_BALANCE_EXCEEDS_INITIAL".into(),
                ));
            }
            let card_id: String = sqlx::query_scalar(
                "INSERT INTO gift_cards(tenant_id,branch_id,code,client_id,initial_amount_paise,balance_paise,status,expires_at,idempotency_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::DATE,$9,COALESCE($10::TIMESTAMPTZ,NOW())) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"code")?).bind(value_str(row,"client_id")?)
             .bind(initial).bind(balance).bind(value_str(row,"status")?).bind(row.get("expires_at").and_then(Value::as_str))
             .bind(format!("migration:{external_id}")).bind(occurred_at).fetch_one(&mut **tx).await?;
            sqlx::query("INSERT INTO gift_card_transactions(tenant_id,branch_id,gift_card_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes,created_at) VALUES($1,$2,$3,'issue',$4,$4,$5,'Migrated gift-card issue',COALESCE($6::TIMESTAMPTZ,NOW()))")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&card_id).bind(initial).bind(format!("migration:{external_id}:issue")).bind(occurred_at).execute(&mut **tx).await?;
            if balance != initial {
                sqlx::query("INSERT INTO gift_card_transactions(tenant_id,branch_id,gift_card_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes,created_at) VALUES($1,$2,$3,'adjustment_debit',$4,$5,$6,'Migrated current balance',COALESCE($7::TIMESTAMPTZ,NOW()))")
                    .bind(&job.tenant_id).bind(&job.branch_id).bind(&card_id).bind(balance-initial).bind(balance)
                    .bind(format!("migration:{external_id}:balance")).bind(occurred_at).execute(&mut **tx).await?;
            }
            mark_row_action(tx, job, batch_id, line, "created", &card_id, &json!({})).await
        }
        MigrationEntity::Loyalty => {
            let id: String = sqlx::query_scalar(
                "INSERT INTO membership_reward_ledger(tenant_id,branch_id,client_id,source_sale_id,transaction_type,points,balance_after,expires_at,staff_id,note,idempotency_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::DATE,$9,$10,$11,COALESCE($12::TIMESTAMPTZ,NOW())) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"client_id")?).bind(value_str(row,"sale_id")?)
             .bind(value_str(row,"transaction_type")?).bind(value_i64(row,"points")? as i32).bind(value_i64(row,"balance_after")? as i32)
             .bind(row.get("expires_at").and_then(Value::as_str)).bind(value_str(row,"staff_id")?).bind(value_str(row,"note")?)
             .bind(format!("migration:{external_id}")).bind(occurred_at).fetch_one(&mut **tx).await?;
            mark_row_action(tx, job, batch_id, line, "created", &id, &json!({})).await
        }
        MigrationEntity::Payroll => {
            let staff_id = value_str(row, "staff_id")?;
            if value_i64(row, "gross_paise")?.checked_sub(value_i64(row, "deductions_paise")?)
                != Some(value_i64(row, "net_paise")?)
            {
                return Err(sqlx::Error::Protocol("PAYROLL_TOTAL_MISMATCH".into()));
            }
            let (staff_name, employee_code): (String, Option<String>) = sqlx::query_as(
                "SELECT CONCAT_WS(' ',first_name,last_name),NULLIF(employee_code,'') FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(staff_id).fetch_one(&mut **tx).await?;
            let run_id: String = sqlx::query_scalar(
                "INSERT INTO staff_payroll_runs(tenant_id,branch_id,period_start,period_end,status,created_by) VALUES($1,$2,$3::DATE,$4::DATE,$5,$6) ON CONFLICT(tenant_id,branch_id,cycle,period_start,period_end) DO UPDATE SET updated_at=NOW() RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"period_start")?).bind(value_str(row,"period_end")?)
             .bind(value_str(row,"status")?).bind(&job.created_by).fetch_one(&mut **tx).await?;
            let item_status = if value_str(row, "status")? == "partially_paid" {
                "finalized"
            } else {
                value_str(row, "status")?
            };
            let item_id: String = sqlx::query_scalar(
                r#"INSERT INTO staff_payroll_items(tenant_id,branch_id,payroll_run_id,staff_id,staff_name,employee_code,earned_salary_paise,overtime_paise,commission_paise,adjustment_paise,penalty_paise,gross_paise,deductions_paise,net_paise,notes,status,calculation_json)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,JSONB_BUILD_OBJECT('source','migration','externalId',$17)) RETURNING id"#,
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(&run_id).bind(staff_id).bind(staff_name).bind(employee_code)
             .bind(value_i64(row,"earned_salary_paise")?).bind(value_i64(row,"overtime_paise")?).bind(value_i64(row,"commission_paise")?)
             .bind(value_i64(row,"adjustment_paise")?).bind(value_i64(row,"penalty_paise")?).bind(value_i64(row,"gross_paise")?)
             .bind(value_i64(row,"deductions_paise")?).bind(value_i64(row,"net_paise")?).bind(value_str(row,"notes")?).bind(item_status).bind(external_id)
             .fetch_one(&mut **tx).await?;
            sqlx::query("UPDATE staff_payroll_runs run SET gross_paise=summary.gross,deductions_paise=summary.deductions,net_paise=summary.net,staff_count=summary.staff_count,updated_at=NOW() FROM (SELECT COALESCE(SUM(gross_paise),0)::BIGINT gross,COALESCE(SUM(deductions_paise),0)::BIGINT deductions,COALESCE(SUM(net_paise),0)::BIGINT net,COUNT(*)::INTEGER staff_count FROM staff_payroll_items WHERE payroll_run_id=$3) summary WHERE run.tenant_id=$1 AND run.branch_id=$2 AND run.id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(&run_id).execute(&mut **tx).await?;
            mark_row_action(
                tx,
                job,
                batch_id,
                line,
                "created",
                &item_id,
                &json!({"payrollRunId":run_id}),
            )
            .await
        }
        MigrationEntity::Commissions => {
            let sale_id = value_str(row, "sale_id")?;
            let sale_line_id = value_str(row, "sale_line_id")?;
            let split_bps = value_i64(row, "split_bps")?;
            let rate_percent = value_i64(row, "rate_percent")?;
            if !(1..=10_000).contains(&split_bps) {
                return Err(sqlx::Error::Protocol(
                    "COMMISSION_SPLIT_EXCEEDS_10000_BPS".into(),
                ));
            }
            if !(0..=100).contains(&rate_percent) {
                return Err(sqlx::Error::Protocol("COMMISSION_RATE_OUT_OF_RANGE".into()));
            }
            sqlx::query_scalar::<_, i32>(
                "SELECT 1 FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND id=$4 FOR UPDATE",
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(sale_id)
            .bind(sale_line_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| sqlx::Error::Protocol("COMMISSION_SALE_LINE_NOT_FOUND".into()))?;
            let existing_split: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(split_bps),0)::BIGINT FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND sale_line_id=$3",
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(sale_line_id)
            .fetch_one(&mut **tx)
            .await?;
            if existing_split
                .checked_add(split_bps)
                .is_none_or(|total| total > 10_000)
            {
                return Err(sqlx::Error::Protocol(
                    "COMMISSION_SPLIT_EXCEEDS_10000_BPS".into(),
                ));
            }
            let (business_date, sale_created_at): (NaiveDate, DateTime<Utc>) = sqlx::query_as("SELECT business_date,created_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).fetch_one(&mut **tx).await?;
            let id: String = sqlx::query_scalar(
                "INSERT INTO pos_staff_commission_snapshots(tenant_id,branch_id,sale_id,sale_line_id,staff_id,line_type,item_id,split_bps,base_paise,rate_percent,commission_paise,rule_source,rule_name,business_date,sale_created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'migration',$12,$13,$14) RETURNING id",
            ).bind(&job.tenant_id).bind(&job.branch_id).bind(sale_id).bind(sale_line_id).bind(value_str(row,"staff_id")?)
             .bind(value_str(row,"line_type")?).bind(value_str(row,"item_id")?).bind(split_bps as i32)
             .bind(value_i64(row,"base_paise")?).bind(rate_percent as i32).bind(value_i64(row,"commission_paise")?)
             .bind(format!("Migrated {external_id}")).bind(business_date).bind(sale_created_at).fetch_one(&mut **tx).await?;
            mark_row_action(tx, job, batch_id, line, "created", &id, &json!({})).await
        }
        MigrationEntity::ClientNotes => {
            let id: String = sqlx::query_scalar("INSERT INTO client_notes(tenant_id,branch_id,client_id,note_type,note,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::TIMESTAMPTZ,NOW())) RETURNING id")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"client_id")?).bind(value_str(row,"note_type")?)
                .bind(value_str(row,"note")?).bind(&job.created_by).bind(occurred_at).fetch_one(&mut **tx).await?;
            mark_row_action(
                tx,
                job,
                batch_id,
                line,
                "created",
                &id,
                &json!({"fileTable":"client_notes"}),
            )
            .await
        }
        MigrationEntity::Files => {
            let content = STANDARD
                .decode(value_str(row, "content_base64")?)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
            let owner_type = value_str(row, "owner_type")?;
            let id: String = if owner_type == "client" {
                sqlx::query_scalar("INSERT INTO client_treatment_photos(tenant_id,branch_id,client_id,appointment_id,caption,file_name,content_type,byte_size,sha256,photo_type,content,uploaded_by) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id")
                    .bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"owner_id")?)
                    .bind(row.get("appointment_id").and_then(Value::as_str).unwrap_or(""))
                    .bind(value_str(row,"caption")?).bind(value_str(row,"file_name")?).bind(value_str(row,"content_type")?).bind(content.len() as i32)
                    .bind(value_str(row,"sha256")?).bind(value_str(row,"photo_type")?).bind(content).bind(&job.created_by).fetch_one(&mut **tx).await?
            } else {
                sqlx::query_scalar("INSERT INTO staff_files(tenant_id,branch_id,staff_id,file_kind,file_name,content_type,byte_size,content,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id")
                    .bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"owner_id")?).bind(value_str(row,"file_kind")?)
                    .bind(value_str(row,"file_name")?).bind(value_str(row,"content_type")?).bind(content.len() as i32).bind(content).bind(&job.created_by)
                    .fetch_one(&mut **tx).await?
            };
            mark_row_action(tx, job, batch_id, line, "created", &id, &json!({"fileTable":if owner_type=="client"{"client_treatment_photos"}else{"staff_files"}})).await
        }
        MigrationEntity::OpeningPayables => {
            let header_id: String = sqlx::query_scalar(
                r#"WITH inserted AS (
                     INSERT INTO supplier_opening_payable_imports(
                       tenant_id,branch_id,import_job_id,source_file_id,cutover_id,source_checksum,
                       source_outstanding_total_paise,opening_balance_account,currency,
                       payable_account,supplier_advance_account,finance_approved_by,
                       finance_approved_at,branch_confirmed_by,branch_confirmed_at,
                       approved_by,owner_approved_at
                     )
                     SELECT job.tenant_id,job.branch_id,job.id,job.source_file_id,
                            job.analysis_json->'postingContract'->>'cutoverId',job.source_hash,$4,$5,$6,
                            job.analysis_json->'openingPayableControls'->>'payableAccount',
                            job.analysis_json->'openingPayableControls'->>'supplierAdvanceAccount',
                            job.analysis_json->'openingPayableControls'->>'approvedBy',
                            (job.analysis_json->'openingPayableControls'->>'approvedAt')::TIMESTAMPTZ,
                            job.analysis_json->'openingPayableBranchConfirmation'->>'approvedBy',
                            (job.analysis_json->'openingPayableBranchConfirmation'->>'approvedAt')::TIMESTAMPTZ,
                            job.approval_decided_by,job.approval_decided_at
                       FROM integration_import_jobs job
                       JOIN integration_migration_cutovers cutover
                         ON cutover.tenant_id::TEXT=job.tenant_id AND cutover.branch_id::TEXT=job.branch_id
                        AND cutover.id=job.analysis_json->'postingContract'->>'cutoverId'
                        AND cutover.status='snapshot_applied'
                      WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
                        AND job.source_file_id IS NOT NULL AND job.approval_decided_by IS NOT NULL
                     ON CONFLICT(import_job_id) DO NOTHING RETURNING id
                   )
                   SELECT id FROM inserted
                   UNION ALL
                   SELECT id FROM supplier_opening_payable_imports
                    WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3
                   LIMIT 1"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(&job.id)
            .bind(value_i64(row, "source_outstanding_total_paise")?)
            .bind(value_str(row, "opening_balance_account")?)
            .bind(value_str(row, "currency")?)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| sqlx::Error::Protocol("OPENING_PAYABLE_CUTOVER_INVALID".into()))?;
            let contract_matches: bool = sqlx::query_scalar(
                "SELECT source_outstanding_total_paise=$4 AND opening_balance_account=$5 AND currency=$6 FROM supplier_opening_payable_imports WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(&header_id)
            .bind(value_i64(row, "source_outstanding_total_paise")?)
            .bind(value_str(row, "opening_balance_account")?)
            .bind(value_str(row, "currency")?)
            .fetch_one(&mut **tx)
            .await?;
            if !contract_matches {
                return Err(sqlx::Error::Protocol(
                    "OPENING_PAYABLE_SOURCE_TOTAL_MISMATCH".into(),
                ));
            }
            let payable_id: String = sqlx::query_scalar(
                r#"WITH inserted AS (
                     INSERT INTO supplier_opening_payables(
                       tenant_id,branch_id,opening_import_id,supplier_id,external_id,balance_side,
                       amount_paise,due_date,gst_paise,source_row_number,source_row_checksum,
                       currency,unallocated_paise,unallocated_approved
                     ) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::DATE,$9,$10,$11,$12,$13,$14)
                     ON CONFLICT(opening_import_id,source_row_number) DO NOTHING RETURNING id
                   )
                   SELECT id FROM inserted UNION ALL
                   SELECT id FROM supplier_opening_payables
                    WHERE opening_import_id=$3 AND source_row_number=$10 LIMIT 1"#,
            )
            .bind(&job.tenant_id)
            .bind(&job.branch_id)
            .bind(&header_id)
            .bind(value_str(row, "supplier_id")?)
            .bind(external_id)
            .bind(value_str(row, "balance_side")?)
            .bind(value_i64(row, "amount_paise")?)
            .bind(row.get("due_date").and_then(Value::as_str).unwrap_or(""))
            .bind(value_i64(row, "gst_paise")?)
            .bind(line)
            .bind(value_str(row, "source_row_checksum")?)
            .bind(value_str(row, "currency")?)
            .bind(value_i64(row, "unallocated_paise")?)
            .bind(
                row.get("unallocated_approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .fetch_one(&mut **tx)
            .await?;
            for allocation in row
                .get("allocations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let bill_id = allocation
                    .get("historicalBillId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        sqlx::Error::Protocol("OPENING_PAYABLE_ALLOCATION_INVALID".into())
                    })?;
                let amount = allocation
                    .get("amountPaise")
                    .and_then(Value::as_i64)
                    .filter(|value| *value > 0)
                    .ok_or_else(|| {
                        sqlx::Error::Protocol("OPENING_PAYABLE_ALLOCATION_INVALID".into())
                    })?;
                let valid_bill: bool = sqlx::query_scalar(
                    r#"SELECT EXISTS(
                         SELECT 1 FROM historical_purchase_bills bill
                         JOIN supplier_opening_payable_imports opening ON opening.id=$4
                         JOIN historical_purchase_identity_mappings mapping
                           ON mapping.tenant_id=bill.tenant_id AND mapping.branch_id=bill.branch_id
                          AND mapping.identity_type='vendor' AND mapping.provider=bill.provider
                          AND mapping.source_key=ENCODE(DIGEST(CONCAT_WS('|',bill.provider,CASE
                            WHEN BTRIM(bill.supplier_external_id)<>'' THEN 'provider:'||LOWER(BTRIM(bill.supplier_external_id))
                            WHEN BTRIM(bill.supplier_gstin)<>'' THEN 'gstin:'||UPPER(BTRIM(bill.supplier_gstin))
                            WHEN BTRIM(bill.supplier_code)<>'' THEN 'code:'||LOWER(BTRIM(bill.supplier_code))
                            ELSE CONCAT_WS(':','attributes',REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_name)),'[^a-z0-9]+','','g'),REGEXP_REPLACE(LOWER(BTRIM(bill.supplier_phone)),'[^0-9]+','','g'),LOWER(BTRIM(bill.supplier_email))) END),'sha256'),'hex')
                          AND mapping.current_decision IN ('link','create') AND mapping.target_supplier_id=$5
                        WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND bill.id=$3
                          AND bill.cutover_id=opening.cutover_id
                          AND LOWER(BTRIM(bill.payment_status)) NOT IN ('paid','settled')
                          AND LOWER(BTRIM(bill.source_status)) NOT IN ('cancelled','canceled','void','voided','rejected')
                          AND LOWER(BTRIM(bill.document_type)) NOT IN ('cancelled','canceled','void','voided')
                          AND $6<=GREATEST(bill.total_paise,0)
                          AND NOT EXISTS(SELECT 1 FROM supplier_opening_payable_allocations existing
                            WHERE existing.historical_bill_id=bill.id AND existing.rolled_back_at IS NULL)
                       )"#,
                )
                .bind(&job.tenant_id)
                .bind(&job.branch_id)
                .bind(bill_id)
                .bind(&header_id)
                .bind(value_str(row, "supplier_id")?)
                .bind(amount)
                .fetch_one(&mut **tx)
                .await?;
                if !valid_bill {
                    return Err(sqlx::Error::Protocol(
                        "OPENING_PAYABLE_ALLOCATION_INVALID".into(),
                    ));
                }
                sqlx::query("INSERT INTO supplier_opening_payable_allocations(tenant_id,branch_id,opening_payable_id,historical_bill_id,amount_paise) VALUES($1,$2,$3,$4,$5) ON CONFLICT(opening_payable_id,historical_bill_id) DO NOTHING")
                    .bind(&job.tenant_id).bind(&job.branch_id).bind(&payable_id).bind(bill_id).bind(amount).execute(&mut **tx).await?;
            }
            mark_row_action(
                tx,
                job,
                batch_id,
                line,
                "created",
                &payable_id,
                &json!({"openingImportId":header_id}),
            )
            .await
        }
        MigrationEntity::StockMovements => {
            let item_id = value_str(row, "inventory_item_id")?;
            let (before, before_cost): (i32, i64) = sqlx::query_as("SELECT stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).fetch_one(&mut **tx).await?;
            let delta = value_i64(row, "quantity_delta")? as i32;
            let after = before
                .checked_add(delta)
                .ok_or_else(|| sqlx::Error::Protocol("stock movement overflow".into()))?;
            if after < 0 {
                return Err(sqlx::Error::Protocol("NEGATIVE_STOCK_NOT_ALLOWED".into()));
            }
            let supplied_cost = value_i64(row, "unit_cost_paise")?;
            let cost = if supplied_cost == 0 {
                before_cost
            } else {
                supplied_cost
            };
            sqlx::query("UPDATE inventory_items SET stock_quantity=$4,unit_cost_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(after).bind(cost).execute(&mut **tx).await?;
            let ledger_id: String = sqlx::query_scalar("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,adjustment_reason,adjustment_idempotency_key,created_at) VALUES($1,$2,$3,'adjustment',$4,$5,$6,$7,$8,COALESCE($9::TIMESTAMPTZ,NOW())) RETURNING id")
                .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(delta).bind(cost).bind(after).bind(value_str(row,"reason")?)
                .bind(format!("migration:{external_id}")).bind(occurred_at).fetch_one(&mut **tx).await?;
            mark_row_action(tx, job, batch_id, line, "created", &ledger_id, &json!({"ledgerId":ledger_id,"inventoryItemId":item_id,"stockQuantity":before,"unitCostPaise":before_cost})).await
        }
        _ => Err(sqlx::Error::RowNotFound),
    }
}

async fn finalize_opening_payables(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
) -> Result<(), sqlx::Error> {
    let (header_id, source_total, account, payable_account, advance_account, business_date, journal_id): (String, i64, String, String, String, NaiveDate, Option<String>) = sqlx::query_as(
        r#"SELECT opening.id,opening.source_outstanding_total_paise,opening.opening_balance_account,
                  opening.payable_account,opening.supplier_advance_account,
                  cutover.cutover_at::DATE,opening.journal_entry_id
             FROM supplier_opening_payable_imports opening
             JOIN integration_migration_cutovers cutover
               ON cutover.tenant_id::TEXT=opening.tenant_id AND cutover.branch_id::TEXT=opening.branch_id
              AND cutover.id=opening.cutover_id
            WHERE opening.tenant_id=$1 AND opening.branch_id=$2 AND opening.import_job_id=$3
              AND opening.rolled_back_at IS NULL FOR UPDATE"#,
    )
    .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).fetch_one(&mut **tx).await?;
    if journal_id.is_some() {
        return Ok(());
    }
    let (credit, debit, bad_gst, bad_allocations): (i64, i64, bool, bool) = sqlx::query_as(
        r#"SELECT COALESCE(SUM(amount_paise) FILTER(WHERE balance_side='credit'),0)::BIGINT,
                  COALESCE(SUM(amount_paise) FILTER(WHERE balance_side='debit'),0)::BIGINT,
                  BOOL_OR(gst_paise<>0),
                  BOOL_OR(amount_paise<>unallocated_paise+(SELECT COALESCE(SUM(allocation.amount_paise),0)::BIGINT
                    FROM supplier_opening_payable_allocations allocation
                    WHERE allocation.opening_payable_id=line.id AND allocation.rolled_back_at IS NULL)
                    OR (unallocated_paise>0 AND NOT unallocated_approved))
             FROM supplier_opening_payables line WHERE opening_import_id=$1"#,
    ).bind(&header_id).fetch_one(&mut **tx).await?;
    if bad_gst {
        return Err(sqlx::Error::Protocol(
            "OPENING_PAYABLE_GST_MUST_BE_ZERO".into(),
        ));
    }
    if bad_allocations {
        return Err(sqlx::Error::Protocol(
            "OPENING_PAYABLE_ALLOCATION_TOTAL_MISMATCH".into(),
        ));
    }
    if credit.checked_sub(debit) != Some(source_total) {
        return Err(sqlx::Error::Protocol(
            "OPENING_PAYABLE_SOURCE_TOTAL_MISMATCH".into(),
        ));
    }
    let lines = [
        ManualJournalLine {
            account_code: account.clone(),
            debit_paise: credit,
            credit_paise: 0,
        },
        ManualJournalLine {
            account_code: payable_account,
            debit_paise: 0,
            credit_paise: credit,
        },
        ManualJournalLine {
            account_code: advance_account,
            debit_paise: debit,
            credit_paise: 0,
        },
        ManualJournalLine {
            account_code: account,
            debit_paise: 0,
            credit_paise: debit,
        },
    ];
    let posted = accounting_service::post_control_journal(
        tx,
        &job.tenant_id,
        &job.branch_id,
        "supplier_opening_payable",
        &header_id,
        business_date,
        "Supplier opening payable migration",
        &job.created_by,
        &lines,
    )
    .await
    .map_err(accounting_error)?;
    let journal_id = match posted {
        Some(id) => id,
        None => sqlx::query_scalar("SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='supplier_opening_payable' AND source_id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(&header_id).fetch_one(&mut **tx).await?,
    };
    sqlx::query("UPDATE supplier_opening_payable_imports SET journal_entry_id=$4,applied_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND journal_entry_id IS NULL")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&header_id).bind(journal_id).execute(&mut **tx).await?;
    Ok(())
}

async fn finalize_opening_inventory_accounting(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
) -> Result<(), sqlx::Error> {
    let (snapshot_id, valuation, business_date, approved_by): (String, i64, NaiveDate, String) =
        sqlx::query_as(
            r#"SELECT snapshot.id,COALESCE(SUM(line.valuation_paise),0)::BIGINT,
                      snapshot.snapshot_at::DATE,snapshot.approved_by
                 FROM integration_opening_inventory_snapshots snapshot
                 JOIN integration_opening_inventory_snapshot_lines line ON line.snapshot_id=snapshot.id
                WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3
                GROUP BY snapshot.id,snapshot.snapshot_at,snapshot.approved_by"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&job.id)
        .fetch_one(&mut **tx)
        .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM integration_opening_inventory_accounting WHERE snapshot_id=$1)",
    )
    .bind(&snapshot_id)
    .fetch_one(&mut **tx)
    .await?;
    if exists {
        return Ok(());
    }
    let journal_id = if valuation == 0 {
        None
    } else {
        let amount = valuation
            .checked_abs()
            .ok_or_else(|| sqlx::Error::Protocol("OPENING_VALUATION_OVERFLOW".into()))?;
        let lines = if valuation > 0 {
            [
                ManualJournalLine {
                    account_code: accounting_service::INVENTORY_ASSET_ACCOUNT.into(),
                    debit_paise: amount,
                    credit_paise: 0,
                },
                ManualJournalLine {
                    account_code: "OWNER_EQUITY".into(),
                    debit_paise: 0,
                    credit_paise: amount,
                },
            ]
        } else {
            [
                ManualJournalLine {
                    account_code: "OWNER_EQUITY".into(),
                    debit_paise: amount,
                    credit_paise: 0,
                },
                ManualJournalLine {
                    account_code: accounting_service::INVENTORY_ASSET_ACCOUNT.into(),
                    debit_paise: 0,
                    credit_paise: amount,
                },
            ]
        };
        match accounting_service::post_control_journal(
            tx,
            &job.tenant_id,
            &job.branch_id,
            "inventory_opening_snapshot",
            &snapshot_id,
            business_date,
            "Opening inventory migration",
            &approved_by,
            &lines,
        )
        .await
        .map_err(accounting_error)?
        {
            Some(id) => Some(id),
            None => Some(
                sqlx::query_scalar(
                    "SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='inventory_opening_snapshot' AND source_id=$3",
                )
                .bind(&job.tenant_id)
                .bind(&job.branch_id)
                .bind(&snapshot_id)
                .fetch_one(&mut **tx)
                .await?,
            ),
        }
    };
    sqlx::query(
        r#"INSERT INTO integration_opening_inventory_accounting(
             snapshot_id,tenant_id,branch_id,cutover_id,opening_valuation_paise,
             journal_entry_id,approved_by)
           SELECT snapshot.id,snapshot.tenant_id,snapshot.branch_id,snapshot.cutover_id,$2,$3,$4
             FROM integration_opening_inventory_snapshots snapshot WHERE snapshot.id=$1"#,
    )
    .bind(&snapshot_id)
    .bind(valuation)
    .bind(journal_id)
    .bind(&approved_by)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_sale_or_invoice(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
    line: i32,
    external_id: &str,
) -> Result<(), sqlx::Error> {
    let linked = row
        .get("linked_sale_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let snapshot = if linked.is_empty() {
        None
    } else {
        sqlx::query_scalar::<_, Value>("SELECT TO_JSONB(sale) FROM pos_sales sale WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(linked).fetch_optional(&mut **tx).await?
    };
    let sale_id = if linked.is_empty() {
        sqlx::query_scalar::<_, String>(
            r#"INSERT INTO pos_sales(tenant_id,branch_id,client_id,invoice_number,subtotal_paise,discount_paise,tax_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,status,source,reference_id,business_date,finalized_at,locked_at)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,'migration',$13,$14::DATE,NOW(),NOW()) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"client_id")?).bind(value_str(row,"invoice_number")?)
         .bind(value_i64(row,"subtotal_paise")?).bind(value_i64(row,"discount_paise")?).bind(value_i64(row,"tax_paise")?)
         .bind(value_i64(row,"cgst_paise")?).bind(value_i64(row,"sgst_paise")?).bind(value_i64(row,"igst_paise")?)
         .bind(value_i64(row,"total_paise")?).bind(value_str(row,"status")?).bind(external_id).bind(value_str(row,"business_date")?)
         .fetch_one(&mut **tx).await?
    } else {
        let existing_total: i64 = snapshot
            .as_ref()
            .and_then(|value| value.get("total_paise"))
            .and_then(Value::as_i64)
            .ok_or(sqlx::Error::RowNotFound)?;
        if existing_total != value_i64(row, "total_paise")? {
            return Err(sqlx::Error::Protocol(
                "linked invoice total does not match sale".into(),
            ));
        }
        sqlx::query("UPDATE pos_sales SET invoice_number=$4,business_date=$5::DATE,status=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(linked).bind(value_str(row,"invoice_number")?)
            .bind(value_str(row,"business_date")?).bind(value_str(row,"status")?).execute(&mut **tx).await?;
        linked.to_string()
    };
    if linked.is_empty() {
        let item_name = row
            .get("item_name")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .unwrap_or("Migrated transaction");
        let quantity = row.get("quantity").and_then(Value::as_i64).unwrap_or(1);
        let line_id: String = sqlx::query_scalar(
            r#"INSERT INTO pos_sale_lines(tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,discount_paise,tax_percent,line_total_paise,taxable_paise,gst_paise,cgst_paise,sgst_paise,igst_paise)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15) RETURNING id"#,
        ).bind(&job.tenant_id).bind(&job.branch_id).bind(&sale_id).bind(row.get("line_type").and_then(Value::as_str).unwrap_or("custom"))
         .bind(row.get("item_id").and_then(Value::as_str).unwrap_or("")).bind(item_name).bind(quantity)
         .bind(row.get("unit_price_paise").and_then(Value::as_i64).unwrap_or(value_i64(row,"subtotal_paise")?))
         .bind(value_i64(row,"discount_paise")?).bind(value_i64(row,"total_paise")?).bind(value_i64(row,"subtotal_paise")?-value_i64(row,"discount_paise")?)
         .bind(value_i64(row,"tax_paise")?).bind(value_i64(row,"cgst_paise")?).bind(value_i64(row,"sgst_paise")?).bind(value_i64(row,"igst_paise")?)
         .fetch_one(&mut **tx).await?;
        if row.get("line_type").and_then(Value::as_str) == Some("product") {
            apply_sale_inventory(tx, job, row, &sale_id, &line_id, quantity as i32).await?;
        }
    }
    let journal_before: Option<String> = sqlx::query_scalar("SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='invoice' AND source_id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&sale_id).fetch_optional(&mut **tx).await?;
    accounting_service::post_invoice_backfill(
        tx,
        &job.tenant_id,
        &job.branch_id,
        &sale_id,
        value_i64(row, "total_paise")?,
        value_i64(row, "tax_paise")?,
        value_i64(row, "cgst_paise")?,
        value_i64(row, "sgst_paise")?,
        value_i64(row, "igst_paise")?,
        0,
        0,
        parse_date(row, "business_date")?,
        &job.created_by,
    )
    .await
    .map_err(accounting_error)?;
    let journal_ids: Vec<String> = if journal_before.is_none() {
        sqlx::query_scalar("SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='invoice' AND source_id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(&sale_id).fetch_all(&mut **tx).await?
    } else {
        Vec::new()
    };
    mark_row_action(
        tx,
        job,
        batch_id,
        line,
        if linked.is_empty() {
            "created"
        } else {
            "merged"
        },
        &sale_id,
        &json!({"record":snapshot,"journalIds":journal_ids}),
    )
    .await
}

async fn apply_sale_inventory(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    row: &Value,
    sale_id: &str,
    line_id: &str,
    quantity: i32,
) -> Result<(), sqlx::Error> {
    let item_id = value_str(row, "item_id")?;
    let (before,unit_cost):(i32,i64)=sqlx::query_as("SELECT stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).fetch_one(&mut **tx).await?;
    if before < quantity {
        return Err(sqlx::Error::Protocol(
            "insufficient inventory for migrated sale".into(),
        ));
    }
    let after = before - quantity;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(after).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,'sale',$6,$7,$8)")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(sale_id).bind(line_id).bind(-quantity).bind(unit_cost).bind(after).execute(&mut **tx).await?;
    Ok(())
}

async fn apply_purchase_bill_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
    line: i32,
) -> Result<(), sqlx::Error> {
    let key = format!(
        "migration:{}:{}:{}",
        job.id,
        value_str(row, "supplier_gstin")?,
        value_str(row, "invoice_number")?
    );
    let receipt_id:String=sqlx::query_scalar(r#"INSERT INTO purchase_receipts(tenant_id,branch_id,grr_number,supplier_name,supplier_gstin,supplier_invoice_number,supplier_invoice_date,received_date,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,actor_user_id,idempotency_key)
      VALUES($1,$2,'GRR-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),$3,$4,$5,$6::DATE,$6::DATE,0,0,0,0,0,$7,$8) ON CONFLICT(tenant_id,branch_id,idempotency_key) DO UPDATE SET supplier_name=EXCLUDED.supplier_name RETURNING id"#)
      .bind(&job.tenant_id).bind(&job.branch_id).bind(value_str(row,"supplier_name")?).bind(value_str(row,"supplier_gstin")?).bind(value_str(row,"invoice_number")?)
      .bind(value_str(row,"received_date")?).bind(&job.created_by).bind(&key).fetch_one(&mut **tx).await?;
    let item_id = value_str(row, "inventory_item_id")?;
    let (before,before_cost):(i32,i64)=sqlx::query_as("SELECT stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
      .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).fetch_one(&mut **tx).await?;
    let receipt_line:Option<String>=sqlx::query_scalar(r#"INSERT INTO purchase_receipt_lines(tenant_id,branch_id,purchase_receipt_id,inventory_item_id,quantity,delivered_quantity,gross_unit_cost_paise,unit_cost_paise,gst_percent,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise)
      VALUES($1,$2,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(purchase_receipt_id,inventory_item_id) DO NOTHING RETURNING id"#)
      .bind(&job.tenant_id).bind(&job.branch_id).bind(&receipt_id).bind(item_id).bind(value_i64(row,"quantity")? as i32).bind(value_i64(row,"unit_cost_paise")?)
      .bind(value_i64(row,"gst_percent")? as i32).bind(value_i64(row,"taxable_paise")?).bind(value_i64(row,"cgst_paise")?).bind(value_i64(row,"sgst_paise")?).bind(value_i64(row,"igst_paise")?).bind(value_i64(row,"total_paise")?).fetch_optional(&mut **tx).await?;
    let Some(receipt_line) = receipt_line else {
        return Err(sqlx::Error::Protocol(
            "purchase bill contains duplicate product".into(),
        ));
    };
    sqlx::query("UPDATE purchase_receipts SET taxable_paise=taxable_paise+$4,cgst_paise=cgst_paise+$5,sgst_paise=sgst_paise+$6,igst_paise=igst_paise+$7,total_paise=total_paise+$8 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
      .bind(&job.tenant_id).bind(&job.branch_id).bind(&receipt_id).bind(value_i64(row,"taxable_paise")?).bind(value_i64(row,"cgst_paise")?).bind(value_i64(row,"sgst_paise")?).bind(value_i64(row,"igst_paise")?).bind(value_i64(row,"total_paise")?).execute(&mut **tx).await?;
    let quantity = value_i64(row, "quantity")? as i32;
    let after = before + quantity;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,unit_cost_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(after).bind(value_i64(row,"unit_cost_paise")?).execute(&mut **tx).await?;
    let ledger_id:String=sqlx::query_scalar("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,purchase_receipt_id,purchase_receipt_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,'purchase',$6,$7,$8) RETURNING id")
      .bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(&receipt_id).bind(&receipt_line).bind(quantity).bind(value_i64(row,"unit_cost_paise")?).bind(after).fetch_one(&mut **tx).await?;
    mark_row_action(tx,job,batch_id,line,"created",&receipt_id,&json!({"inventoryItemId":item_id,"stockQuantity":before,"unitCostPaise":before_cost,"ledgerId":ledger_id,"receiptLineId":receipt_line})).await
}

async fn apply_historical_purchase_bill_row(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    row: &Value,
) -> Result<(), sqlx::Error> {
    let line = value_i64(row, "source_row_number")? as i32;
    let source_sheet = value_str(row, "__migration_source_sheet")?;
    let original = row
        .pointer("/__migration_evidence/sourceValues")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let row_checksum = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&original).map_err(|error| sqlx::Error::Decode(Box::new(error)))?
        )
    );
    let metadata = sqlx::query_as::<_, (String, String, String, String, i32, Option<String>, String, String, String)>(
        r#"SELECT source.id,source.sha256,
                  COALESCE(NULLIF(job.analysis_json->'postingContract'->>'provider',''),NULLIF(job.analysis_json->>'sourceProvider',''),SPLIT_PART(job.source_type,'|',1)),
                  job.analysis_json->'postingContract'->>'cutoverId',
                  GREATEST(COALESCE(job.mapping_version,1),1),job.approval_decided_by,
                  source.original_file_name,source.detected_content_type,source.storage_key
           FROM integration_import_jobs job
           JOIN integration_import_source_files source
             ON source.tenant_id=job.tenant_id AND source.branch_id=job.branch_id AND source.id=job.source_file_id
           WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3
             AND job.mode='commit' AND job.approval_status='approved'
             AND source.read_only AND source.evidence_status='verified'
             AND LOWER(source.sha256)=LOWER(job.source_hash)"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        sqlx::Error::Protocol("HISTORICAL_PURCHASE_SOURCE_EVIDENCE_REQUIRED".into())
    })?;
    let (
        source_file_id,
        source_checksum,
        provider,
        cutover_id,
        mapping_version,
        approved_by,
        original_file_name,
        media_type,
        storage_key,
    ) = metadata;
    if provider.is_empty() || cutover_id.is_empty() {
        return Err(sqlx::Error::Protocol(
            "HISTORICAL_PURCHASE_CONTRACT_INVALID".into(),
        ));
    }
    let external_bill_id = value_str(row, "source_external_id")?;
    let bill_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO historical_purchase_bills(
             tenant_id,branch_id,provider,source_file_id,import_job_id,cutover_id,external_bill_id,
             supplier_name,supplier_gstin,supplier_external_id,supplier_code,supplier_phone,supplier_email,
             invoice_number,invoice_date,received_date,
             currency,document_type,source_status,payment_status,discount_paise,shipping_paise,
             handling_paise,total_paise,original_json,source_checksum,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::DATE,$16::DATE,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
           ON CONFLICT(tenant_id,branch_id,source_file_id,cutover_id,external_bill_id) DO NOTHING
           RETURNING id"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&provider)
    .bind(&source_file_id)
    .bind(&job.id)
    .bind(&cutover_id)
    .bind(external_bill_id)
    .bind(value_str(row, "supplier_name")?)
    .bind(value_str(row, "supplier_gstin")?)
    .bind(value_str(row, "supplier_external_id")?)
    .bind(value_str(row, "supplier_code")?)
    .bind(value_str(row, "supplier_phone")?)
    .bind(value_str(row, "supplier_email")?)
    .bind(value_str(row, "invoice_number")?)
    .bind(value_str(row, "invoice_date")?)
    .bind(value_str(row, "received_date")?)
    .bind(value_str(row, "currency")?)
    .bind(value_str(row, "document_type")?)
    .bind(value_str(row, "source_status")?)
    .bind(value_str(row, "payment_status")?)
    .bind(value_i64(row, "discount_paise")?)
    .bind(value_i64(row, "shipping_paise")?)
    .bind(value_i64(row, "handling_paise")?)
    .bind(value_i64(row, "bill_total_paise")?)
    .bind(&original)
    .bind(&source_checksum)
    .bind(&job.created_by)
    .fetch_optional(&mut **tx)
    .await?
    .or(sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM historical_purchase_bills
           WHERE tenant_id=$1 AND branch_id=$2 AND source_file_id=$3 AND cutover_id=$4 AND external_bill_id=$5
             AND supplier_name=$6 AND supplier_gstin=$7 AND supplier_external_id=$8
             AND supplier_code=$9 AND supplier_phone=$10 AND supplier_email=$11
             AND invoice_number=$12 AND invoice_date=$13::DATE AND received_date=$14::DATE
             AND currency=$15 AND document_type=$16 AND source_status=$17 AND payment_status=$18
             AND discount_paise=$19 AND shipping_paise=$20 AND handling_paise=$21 AND total_paise=$22"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&source_file_id)
    .bind(&cutover_id)
    .bind(external_bill_id)
    .bind(value_str(row, "supplier_name")?)
    .bind(value_str(row, "supplier_gstin")?)
    .bind(value_str(row, "supplier_external_id")?)
    .bind(value_str(row, "supplier_code")?)
    .bind(value_str(row, "supplier_phone")?)
    .bind(value_str(row, "supplier_email")?)
    .bind(value_str(row, "invoice_number")?)
    .bind(value_str(row, "invoice_date")?)
    .bind(value_str(row, "received_date")?)
    .bind(value_str(row, "currency")?)
    .bind(value_str(row, "document_type")?)
    .bind(value_str(row, "source_status")?)
    .bind(value_str(row, "payment_status")?)
    .bind(value_i64(row, "discount_paise")?)
    .bind(value_i64(row, "shipping_paise")?)
    .bind(value_i64(row, "handling_paise")?)
    .bind(value_i64(row, "bill_total_paise")?)
    .fetch_optional(&mut **tx)
    .await?)
    .ok_or_else(|| sqlx::Error::Protocol("HISTORICAL_PURCHASE_BILL_HEADER_MISMATCH".into()))?;

    sqlx::query(
        r#"INSERT INTO historical_purchase_bill_files(
             tenant_id,branch_id,historical_bill_id,source_file_id,original_file_name,media_type,sha256,storage_key)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&bill_id)
    .bind(&source_file_id)
    .bind(&original_file_name)
    .bind(&media_type)
    .bind(&source_checksum)
    .bind(&storage_key)
    .execute(&mut **tx)
    .await?;
    let bill_file_name = value_str(row, "bill_file_name")?;
    if !bill_file_name.is_empty() {
        sqlx::query(
            r#"INSERT INTO historical_purchase_bill_files(
                 tenant_id,branch_id,historical_bill_id,source_file_id,source_artifact_id,
                 original_file_name,media_type,sha256,storage_key)
               SELECT $1,$2,$3,$4,artifact.id,artifact.entry_name,artifact.detected_content_type,
                      artifact.sha256,artifact.storage_key
               FROM integration_import_source_artifacts artifact
               WHERE artifact.tenant_id=$1 AND artifact.branch_id=$2 AND artifact.source_file_id=$4
                 AND artifact.file_format IN ('pdf','png','jpeg','webp')
                 AND (LOWER(artifact.entry_name)=LOWER($5) OR LOWER(artifact.entry_name) LIKE '%/'||LOWER($5))
               ON CONFLICT DO NOTHING"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&bill_id)
        .bind(&source_file_id)
        .bind(bill_file_name)
        .execute(&mut **tx)
        .await?;
        let linked: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM historical_purchase_bill_files file
                 JOIN integration_import_source_artifacts artifact ON artifact.id=file.source_artifact_id
               WHERE file.tenant_id=$1 AND file.branch_id=$2 AND file.historical_bill_id=$3
                 AND (LOWER(artifact.entry_name)=LOWER($4) OR LOWER(artifact.entry_name) LIKE '%/'||LOWER($4)))"#,
        )
        .bind(&job.tenant_id)
        .bind(&job.branch_id)
        .bind(&bill_id)
        .bind(bill_file_name)
        .fetch_one(&mut **tx)
        .await?;
        if !linked {
            return Err(sqlx::Error::Protocol(
                "HISTORICAL_PURCHASE_BILL_FILE_NOT_FOUND".into(),
            ));
        }
    }

    let mapped_item = value_str(row, "inventory_item_id")?;
    let gst_bps = value_i64(row, "gst_percent")?
        .checked_mul(100)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| sqlx::Error::Protocol("HISTORICAL_PURCHASE_GST_RATE_INVALID".into()))?;
    let line_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO historical_purchase_bill_lines(
             tenant_id,branch_id,historical_bill_id,original_product_name,sku,barcode,source_product_id,
             brand,size,shade,color,vendor_catalog_code,
             mapped_inventory_item_id,package_unit,stock_unit,units_per_package,purchased_quantity,
             accepted_quantity,damaged_quantity,rejected_quantity,unit_cost_paise,gst_percent_bps,
             taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,batch_number,expiry_date,
             source_line_id,source_sheet,source_row_number,original_json,source_row_checksum)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULLIF($13,''),$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NULLIF($29,'')::DATE,$30,$31,$32,$33,$34)
           ON CONFLICT(historical_bill_id,source_sheet,source_row_number) DO NOTHING RETURNING id"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&bill_id)
    .bind(value_str(row, "original_product_name")?)
    .bind(value_str(row, "sku")?)
    .bind(value_str(row, "barcode")?)
    .bind(value_str(row, "source_product_id")?)
    .bind(value_str(row, "brand")?)
    .bind(value_str(row, "size")?)
    .bind(value_str(row, "shade")?)
    .bind(value_str(row, "color")?)
    .bind(value_str(row, "vendor_catalog_code")?)
    .bind(mapped_item)
    .bind(value_str(row, "package_unit")?)
    .bind(value_str(row, "stock_unit")?)
    .bind(value_i64(row, "units_per_package")?)
    .bind(value_i64(row, "quantity")?)
    .bind(value_i64(row, "accepted_quantity")?)
    .bind(value_i64(row, "damaged_quantity")?)
    .bind(value_i64(row, "rejected_quantity")?)
    .bind(value_i64(row, "unit_cost_paise")?)
    .bind(gst_bps)
    .bind(value_i64(row, "taxable_paise")?)
    .bind(value_i64(row, "cgst_paise")?)
    .bind(value_i64(row, "sgst_paise")?)
    .bind(value_i64(row, "igst_paise")?)
    .bind(value_i64(row, "total_paise")?)
    .bind(value_str(row, "batch_number")?)
    .bind(row.get("expiry_date").and_then(Value::as_str).unwrap_or(""))
    .bind(value_str(row, "source_line_id")?)
    .bind(source_sheet)
    .bind(line)
    .bind(&original)
    .bind(&row_checksum)
    .fetch_optional(&mut **tx)
    .await?
    .or(sqlx::query_scalar::<_, String>(
        "SELECT id FROM historical_purchase_bill_lines WHERE historical_bill_id=$1 AND source_sheet=$2 AND source_row_number=$3 AND source_row_checksum=$4",
    )
    .bind(&bill_id)
    .bind(source_sheet)
    .bind(line)
    .bind(&row_checksum)
    .fetch_optional(&mut **tx)
    .await?)
    .ok_or_else(|| sqlx::Error::Protocol("HISTORICAL_PURCHASE_LINE_IDENTITY_MISMATCH".into()))?;

    sqlx::query(
        r#"INSERT INTO historical_purchase_product_mappings(
             tenant_id,branch_id,historical_bill_line_id,mapping_version,original_product_name,
             source_product_id,sku,barcode,mapped_inventory_item_id,mapping_status,approved_by,approved_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),CASE WHEN $9='' THEN 'unmapped' ELSE 'mapped' END,$10,CASE WHEN $10 IS NULL THEN NULL ELSE NOW() END)
           ON CONFLICT(historical_bill_line_id,mapping_version) DO NOTHING"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&line_id)
    .bind(mapping_version)
    .bind(value_str(row, "original_product_name")?)
    .bind(value_str(row, "source_product_id")?)
    .bind(value_str(row, "sku")?)
    .bind(value_str(row, "barcode")?)
    .bind(mapped_item)
    .bind(approved_by)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"UPDATE historical_purchase_bills bill SET
             taxable_paise=totals.taxable,cgst_paise=totals.cgst,sgst_paise=totals.sgst,
             igst_paise=totals.igst,line_total_paise=totals.total
           FROM (SELECT COALESCE(SUM(taxable_paise),0)::BIGINT taxable,
                        COALESCE(SUM(cgst_paise),0)::BIGINT cgst,COALESCE(SUM(sgst_paise),0)::BIGINT sgst,
                        COALESCE(SUM(igst_paise),0)::BIGINT igst,COALESCE(SUM(total_paise),0)::BIGINT total
                 FROM historical_purchase_bill_lines WHERE historical_bill_id=$3) totals
           WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND bill.id=$3"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&bill_id)
    .execute(&mut **tx)
    .await?;
    let affected = sqlx::query(
        r#"UPDATE integration_import_row_results SET status='created',action='created',batch_id=$4,target_id=$5,
             before_snapshot=$6,updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_sheet=$7 AND source_row_number=$8"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(batch_id)
    .bind(&bill_id)
    .bind(json!({"archiveOnly":true,"historicalBillLineId":line_id}))
    .bind(source_sheet)
    .bind(line)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if affected != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

async fn post_purchase_bill_journals(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
) -> Result<(), sqlx::Error> {
    let receipts:Vec<(String,i64,i64,i64,i64,NaiveDate)>=sqlx::query_as("SELECT DISTINCT receipt.id,receipt.taxable_paise,receipt.cgst_paise,receipt.sgst_paise,receipt.igst_paise,receipt.received_date FROM purchase_receipts receipt JOIN integration_import_row_results result ON result.target_id=receipt.id AND result.job_id=$3 WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2")
      .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).fetch_all(&mut **tx).await?;
    for (id, taxable, cgst, sgst, igst, received_date) in receipts {
        accounting_service::post_purchase_grn_backfill(
            tx,
            &job.tenant_id,
            &job.branch_id,
            &id,
            taxable,
            cgst,
            sgst,
            igst,
            received_date,
            &job.created_by,
        )
        .await
        .map_err(accounting_error)?;
    }
    Ok(())
}

fn value_str<'a>(row: &'a Value, key: &str) -> Result<&'a str, sqlx::Error> {
    row.get(key)
        .and_then(Value::as_str)
        .ok_or(sqlx::Error::RowNotFound)
}
fn value_i64(row: &Value, key: &str) -> Result<i64, sqlx::Error> {
    row.get(key)
        .and_then(Value::as_i64)
        .ok_or(sqlx::Error::RowNotFound)
}
fn parse_date(row: &Value, key: &str) -> Result<NaiveDate, sqlx::Error> {
    NaiveDate::parse_from_str(value_str(row, key)?, "%Y-%m-%d")
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}
fn accounting_error(_: crate::models::common::AppError) -> sqlx::Error {
    sqlx::Error::Protocol("migration accounting operation failed".into())
}

async fn mark_row_action(
    tx: &mut Transaction<'_, Postgres>,
    job: &ClaimedImportJob,
    batch_id: &str,
    source_row_number: i32,
    action: &str,
    target_id: &str,
    before_snapshot: &Value,
) -> Result<(), sqlx::Error> {
    let affected = sqlx::query(
        r#"UPDATE integration_import_row_results
           SET status=$6,action=$6,batch_id=$4,target_id=NULLIF($5,''),
               before_snapshot=$7,updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_row_number=$8"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(batch_id)
    .bind(target_id)
    .bind(action)
    .bind(before_snapshot)
    .bind(source_row_number)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if affected != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn fail_job_batch(
    db: &PgPool,
    job: &ClaimedImportJob,
    start: usize,
    end: usize,
    safe_error: &str,
) -> Result<(), sqlx::Error> {
    let batch_number = (start / 100 + 1) as i32;
    let mut tx = db.begin().await?;
    let batch_id: String = sqlx::query_scalar(
        r#"
        INSERT INTO integration_import_batches(
          tenant_id,branch_id,job_id,batch_number,status,start_offset,end_offset,error_rows,last_error
        ) VALUES($1,$2,$3,$4,'failed',$5,$6,$7,$8)
        ON CONFLICT(job_id,batch_number) DO UPDATE SET
          status='failed',end_offset=EXCLUDED.end_offset,error_rows=EXCLUDED.error_rows,
          last_error=EXCLUDED.last_error,completed_at=NOW(),updated_at=NOW()
        RETURNING id
        "#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(batch_number)
    .bind(start as i32)
    .bind(end as i32)
    .bind((end - start) as i32)
    .bind(safe_error)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE integration_import_jobs SET status='failed',last_error=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(safe_error).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        &job.tenant_id,
        &job.branch_id,
        Some(&job.id),
        Some(&batch_id),
        "migration.batch.failed",
        "failure",
        &job.created_by,
        json!({"batchNumber":batch_number,"startOffset":start,"endOffset":end,"message":safe_error}),
    )
    .await?;
    tx.commit().await
}

pub async fn resume_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let affected = sqlx::query("UPDATE integration_import_jobs SET status='queued',paused_at=NULL,last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('failed','paused') AND errors_json='[]'::JSONB AND mode='commit'")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?.rows_affected();
    if affected > 0 {
        insert_audit(
            &mut tx,
            tenant,
            branch,
            Some(id),
            None,
            "migration.job.resumed",
            "success",
            actor,
            json!({"queued":true}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(affected > 0)
}

pub async fn rollback_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
) -> Result<Option<MigrationRecoveryReport>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let entity = sqlx::query_scalar::<_, String>("SELECT entity FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='completed' FOR UPDATE")
        .bind(tenant).bind(branch).bind(id).fetch_optional(&mut *tx).await?;
    let Some(entity) = entity else {
        tx.rollback().await?;
        return Ok(None);
    };
    if entity == "purchase-bills"
        && sqlx::query_scalar::<_, bool>(
            "SELECT COALESCE(analysis_json->'postingContract'->>'postingMode',analysis_json->>'postingMode')='history_only' FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?
    {
        return rollback_historical_purchase_job(tx, tenant, branch, id, actor).await;
    }
    if entity == "opening-payables" {
        return rollback_opening_payables_job(tx, tenant, branch, id, actor).await;
    }
    let dependency_impact: Value =
        sqlx::query_scalar("SELECT migration_import_dependency_impact($1,$2,$3)")
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if dependency_impact
        .get("blockingRecords")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        return Err(sqlx::Error::Protocol(
            "ROLLBACK_BLOCKED_BY_LIVE_DEPENDENCIES".into(),
        ));
    }
    if entity == MigrationEntity::Inventory.as_str() {
        let live_movements: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT
                 FROM integration_opening_inventory_snapshots snapshot
                 JOIN integration_opening_inventory_snapshot_lines line ON line.snapshot_id=snapshot.id
                 JOIN inventory_stock_ledger movement
                   ON movement.tenant_id=line.tenant_id AND movement.branch_id=line.branch_id
                  AND movement.inventory_item_id=line.inventory_item_id
                  AND movement.created_at>line.applied_at
                  AND movement.movement_type<>'opening_snapshot'
                  AND movement.reversal_of_ledger_id IS NULL
                  AND (movement.inventory_location_code=line.location_code OR movement.inventory_location_code IS NULL)
                WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.import_job_id=$3"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if live_movements > 0 {
            return Err(sqlx::Error::Protocol(
                "ROLLBACK_SNAPSHOT_DEPENDENT_MOVEMENTS".into(),
            ));
        }
    }
    let opening_inventory_journal = if entity == "inventory" {
        sqlx::query_as::<_, (String, Option<String>)>(
            r#"SELECT accounting.snapshot_id,accounting.journal_entry_id
                 FROM integration_opening_inventory_accounting accounting
                 JOIN integration_opening_inventory_snapshots snapshot ON snapshot.id=accounting.snapshot_id
                WHERE accounting.tenant_id=$1 AND accounting.branch_id=$2
                  AND snapshot.import_job_id=$3 AND accounting.rolled_back_at IS NULL FOR UPDATE"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
    } else {
        None
    };
    let opening_inventory_reversal = if let Some((snapshot_id, Some(journal_id))) =
        opening_inventory_journal.as_ref()
    {
        let reversal_id = accounting_service::reverse_journal(
            &mut tx,
            tenant,
            branch,
            journal_id,
            &format!("{id}:{journal_id}"),
            actor,
        )
        .await
        .map_err(accounting_error)?;
        sqlx::query("UPDATE integration_opening_inventory_accounting SET rolled_back_at=NOW() WHERE snapshot_id=$1")
            .bind(snapshot_id)
            .execute(&mut *tx)
            .await?;
        reversal_id
    } else if let Some((snapshot_id, None)) = opening_inventory_journal.as_ref() {
        sqlx::query("UPDATE integration_opening_inventory_accounting SET rolled_back_at=NOW() WHERE snapshot_id=$1")
            .bind(snapshot_id)
            .execute(&mut *tx)
            .await?;
        None
    } else {
        None
    };
    if matches!(
        entity.as_str(),
        "appointments"
            | "sales"
            | "invoices"
            | "payments"
            | "expenses"
            | "purchase-bills"
            | "refunds"
            | "gift-cards"
            | "loyalty"
            | "payroll"
            | "commissions"
            | "client-notes"
            | "files"
            | "stock-movements"
    ) {
        return rollback_transaction_job(tx, tenant, branch, id, actor, &entity).await;
    }
    let delete_sql = match entity.as_str() {
        "clients" => Some(
            "DELETE FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action IN ('created','kept') AND target_id IS NOT NULL)",
        ),
        "staff" => Some(
            "DELETE FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "services" => Some(
            "DELETE FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "products" => Some(
            "DELETE FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "suppliers" => Some(
            "DELETE FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "memberships" => Some(
            "DELETE FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "client-memberships" => None,
        "packages" => Some(
            "DELETE FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)",
        ),
        "inventory" => None,
        _ => return Err(sqlx::Error::RowNotFound),
    };
    let (expected_deleted, expected_restored): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*) FILTER(WHERE action IN ('created','kept'))::BIGINT,COUNT(*) FILTER(WHERE action='merged')::BIGINT FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let deleted = if entity == "client-memberships" {
        let deleted = sqlx::query("DELETE FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)")
            .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?.rows_affected();
        sqlx::query("DELETE FROM memberships plan WHERE plan.tenant_id=$1 AND plan.branch_id=$2 AND plan.id IN (SELECT DISTINCT result.before_snapshot->>'membershipId' FROM integration_import_row_results result WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3 AND result.action='created' AND COALESCE((result.before_snapshot->>'createdMembershipPlan')::BOOLEAN,FALSE)) AND NOT EXISTS (SELECT 1 FROM client_memberships assigned WHERE assigned.tenant_id=$1 AND assigned.branch_id=$2 AND assigned.membership_id=plan.id)")
            .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        deleted
    } else {
        match delete_sql {
            Some(sql) => sqlx::query(sql)
                .bind(tenant)
                .bind(branch)
                .bind(id)
                .execute(&mut *tx)
                .await?
                .rows_affected(),
            None => 0,
        }
    };
    let merged_rows = sqlx::query_as::<_, (String, Value)>(
        "SELECT target_id,before_snapshot FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='merged' AND target_id IS NOT NULL ORDER BY source_row_number",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let mut restored = 0_i64;
    for (target_id, snapshot) in merged_rows {
        match entity.as_str() {
            "clients" => {
                restore_client_snapshot(&mut tx, tenant, branch, &target_id, &snapshot).await?
            }
            "staff" => {
                restore_staff_snapshot(&mut tx, tenant, branch, &target_id, &snapshot).await?
            }
            _ => {
                restore_master_snapshot(
                    &mut tx, tenant, branch, &entity, &target_id, actor, &snapshot,
                )
                .await?
            }
        }
        restored += 1;
    }
    let (linked, kept): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*) FILTER(WHERE action='linked')::BIGINT,COUNT(*) FILTER(WHERE action='kept')::BIGINT FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let rolled_back = sqlx::query("UPDATE integration_import_row_results SET status='rolled_back',recovery_action=CASE action WHEN 'created' THEN 'deleted' WHEN 'merged' THEN 'restored' WHEN 'linked' THEN 'unlinked' WHEN 'kept' THEN 'deleted' ELSE recovery_action END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action<>''")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?.rows_affected() as i64;
    let database_verified = deleted as i64 == expected_deleted
        && restored == expected_restored
        && rolled_back == expected_deleted + expected_restored + linked;
    if !database_verified {
        return Err(sqlx::Error::Protocol(
            "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
        ));
    }
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
    let mut report = MigrationRecoveryReport {
        job_id: id.to_string(),
        deleted_rows: deleted as i64,
        restored_rows: restored,
        linked_rows: linked,
        kept_rows: kept,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
        audit: json!({}),
        verification: json!({}),
    };
    let rollback_audit: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'sourceHash',job.source_hash,
             'cutoverId',COALESCE(job.analysis_json->'postingContract'->>'cutoverId',''),
             'actorUserId',$4,'timestamp',NOW(),
             'journalId',$5,'reversalJournalId',$6,
             'rows',COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
               'sourceRowNumber',result.source_row_number,
               'snapshotRowId',result.before_snapshot->>'snapshotLineId',
               'originalValue',result.before_snapshot->'record',
               'transformedValues',result.source_payload#>'{__migration_evidence,fields}',
               'mapping',job.mapping_json,'approvalUserId',job.approval_decided_by,
               'delta',result.before_snapshot->'appliedDelta',
               'finalStock',item.stock_quantity,'finalCostPaise',item.unit_cost_paise,
               'ledgerId',result.before_snapshot->>'ledgerId',
               'reversalLedgerId',(SELECT reversal.id FROM inventory_stock_ledger reversal
                  WHERE reversal.tenant_id=result.tenant_id AND reversal.branch_id=result.branch_id
                    AND reversal.reversal_of_ledger_id=result.before_snapshot->>'ledgerId' LIMIT 1)
             ) ORDER BY result.source_row_number) FILTER(WHERE result.id IS NOT NULL),'[]'::JSONB))
           FROM integration_import_jobs job
           LEFT JOIN integration_import_row_results result ON result.job_id=job.id AND result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id
           LEFT JOIN inventory_items item ON item.id=result.target_id AND item.tenant_id=result.tenant_id AND item.branch_id=result.branch_id
           WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3 GROUP BY job.id"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .bind(actor)
    .bind(opening_inventory_journal.as_ref().and_then(|row| row.1.as_deref()))
    .bind(opening_inventory_reversal.as_deref())
    .fetch_one(&mut *tx)
    .await?;
    report.audit = rollback_audit;
    report.verification = json!({"databaseVerified":true,"reconciliationStatus":"matched","verifiedAt":Utc::now(),"expectedDeletedRows":expected_deleted,"deletedRows":deleted,"expectedRestoredRows":expected_restored,"restoredRows":restored,"dependencyImpact":dependency_impact});
    let report_json =
        serde_json::to_value(&report).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    sqlx::query("UPDATE integration_import_jobs SET status='rolled_back',recovery_json=$4,rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).bind(&report_json).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(id),
        None,
        "migration.job.rolled_back",
        "success",
        actor,
        json!({"entity":entity,"report":report_json}),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(report))
}

async fn rollback_historical_purchase_job(
    mut tx: Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    job_id: &str,
    actor: &str,
) -> Result<Option<MigrationRecoveryReport>, sqlx::Error> {
    let (source_hash, cutover_id): (String, String) = sqlx::query_as(
        "SELECT COALESCE(source_hash,''),COALESCE(analysis_json->'postingContract'->>'cutoverId','') FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    let attachment_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM historical_purchase_bill_files file JOIN historical_purchase_bills bill ON bill.id=file.historical_bill_id WHERE bill.tenant_id=$1 AND bill.branch_id=$2 AND bill.import_job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    let expected_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created'",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("SELECT SET_CONFIG('aurashine.historical_archive_rollback','on',TRUE)")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM historical_purchase_bills WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .execute(&mut *tx)
    .await?;
    let rolled_back = sqlx::query(
        "UPDATE integration_import_row_results SET status='rolled_back',recovery_action='deleted',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created'",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    let remains: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM historical_purchase_bills WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3)",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .fetch_one(&mut *tx)
    .await?;
    if remains || rolled_back != expected_rows {
        return Err(sqlx::Error::Protocol(
            "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
        ));
    }
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'")
        .bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?;
    let report = MigrationRecoveryReport {
        job_id: job_id.to_string(),
        deleted_rows: rolled_back,
        restored_rows: 0,
        linked_rows: 0,
        kept_rows: 0,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
        audit: json!({"sourceHash":source_hash,"cutoverId":cutover_id,"attachmentLinksRemoved":attachment_count,"actorUserId":actor,"timestamp":Utc::now()}),
        verification: json!({"databaseVerified":true,"archiveOnly":true,"stockUnchanged":true,"sourceEvidenceRetained":true,"attachmentRetention":"source-evidence-policy","reconciliationStatus":"matched","verifiedAt":Utc::now()}),
    };
    let report_json =
        serde_json::to_value(&report).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    sqlx::query("UPDATE integration_import_jobs SET status='rolled_back',recovery_json=$4,rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(job_id).bind(&report_json).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(job_id),
        None,
        "migration.job.rolled_back",
        "success",
        actor,
        json!({"entity":"purchase-bills","archiveOnly":true,"report":report_json}),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(report))
}

async fn rollback_opening_payables_job(
    mut tx: Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    job_id: &str,
    actor: &str,
) -> Result<Option<MigrationRecoveryReport>, sqlx::Error> {
    let (header_id, journal_id, source_checksum, cutover_id): (String, String, String, String) = sqlx::query_as(
        "SELECT id,journal_entry_id,source_checksum,cutover_id FROM supplier_opening_payable_imports WHERE tenant_id=$1 AND branch_id=$2 AND import_job_id=$3 AND applied_at IS NOT NULL AND rolled_back_at IS NULL FOR UPDATE",
    )
    .bind(tenant).bind(branch).bind(job_id).fetch_one(&mut *tx).await?;
    let settlement_events: i64 = sqlx::query_scalar(
        r#"SELECT
             (SELECT COUNT(*) FROM supplier_payments payment
               WHERE payment.tenant_id=opening.tenant_id AND payment.branch_id=opening.branch_id
                 AND payment.supplier_id IN (SELECT line.supplier_id FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
                 AND payment.paid_at>=opening.applied_at)
             +(SELECT COUNT(*) FROM supplier_advances advance
               WHERE advance.tenant_id=opening.tenant_id AND advance.branch_id=opening.branch_id
                 AND advance.supplier_id IN (SELECT line.supplier_id FROM supplier_opening_payables line WHERE line.opening_import_id=opening.id)
                 AND advance.paid_at>=opening.applied_at)
             FROM supplier_opening_payable_imports opening WHERE opening.id=$1"#,
    )
    .bind(&header_id)
    .fetch_one(&mut *tx)
    .await?;
    if settlement_events > 0 {
        return Err(sqlx::Error::Protocol(
            "ROLLBACK_OPENING_PAYABLE_SETTLED".into(),
        ));
    }
    let reversal_journal_id = accounting_service::reverse_journal(
        &mut tx,
        tenant,
        branch,
        &journal_id,
        &format!("{job_id}:{journal_id}"),
        actor,
    )
    .await
    .map_err(accounting_error)?;
    let rolled_back = sqlx::query(
        "UPDATE integration_import_row_results SET status='rolled_back',recovery_action='reversed',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created'",
    ).bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?.rows_affected() as i64;
    sqlx::query("UPDATE supplier_opening_payable_allocations allocation SET rolled_back_at=NOW() FROM supplier_opening_payables line WHERE line.id=allocation.opening_payable_id AND line.opening_import_id=$1 AND allocation.rolled_back_at IS NULL")
        .bind(&header_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE supplier_opening_payable_imports SET rolled_back_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(&header_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'")
        .bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?;
    let report = MigrationRecoveryReport {
        job_id: job_id.into(),
        deleted_rows: 0,
        restored_rows: rolled_back,
        linked_rows: 0,
        kept_rows: 0,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
        audit: json!({"sourceHash":source_checksum,"cutoverId":cutover_id,"journalId":journal_id,"reversalJournalId":reversal_journal_id,"actorUserId":actor,"timestamp":Utc::now()}),
        verification: json!({"databaseVerified":true,"journalReversed":true,"settlementEvents":0,"sourceEvidenceRetained":true,"reconciliationStatus":"matched","verifiedAt":Utc::now()}),
    };
    let report_json =
        serde_json::to_value(&report).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    sqlx::query("UPDATE integration_import_jobs SET status='rolled_back',recovery_json=$4,rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(job_id).bind(&report_json).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(job_id),
        None,
        "migration.job.rolled_back",
        "success",
        actor,
        json!({"entity":"opening-payables","report":report_json}),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(report))
}

async fn reverse_inventory_ledger(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    ledger_id: &str,
    actor: &str,
    reason: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT reverse_inventory_stock_ledger($1,$2,$3,$4,$5)")
        .bind(tenant)
        .bind(branch)
        .bind(ledger_id)
        .bind(actor)
        .bind(reason)
        .fetch_one(&mut **tx)
        .await
}

async fn rollback_transaction_job(
    mut tx: Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    job_id: &str,
    actor: &str,
    entity: &str,
) -> Result<Option<MigrationRecoveryReport>, sqlx::Error> {
    let rows:Vec<(String,String,Value)>=sqlx::query_as(
        "SELECT COALESCE(target_id,''),action,before_snapshot FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action IN ('created','merged') ORDER BY source_row_number DESC FOR UPDATE",
    ).bind(tenant).bind(branch).bind(job_id).fetch_all(&mut *tx).await?;
    let mut reversed = std::collections::HashSet::new();
    let mut deleted = 0_i64;
    let mut restored = 0_i64;
    for (target_id, action, snapshot) in &rows {
        let handled_before = deleted + restored;
        let source_type = match entity {
            "sales" | "invoices" => None,
            "payments" => Some("payment"),
            "expenses" => Some("migration_expense"),
            "purchase-bills" => Some("purchase_grn"),
            "refunds" => Some("refund"),
            _ => None,
        };
        if matches!(entity, "sales" | "invoices") {
            if let Some(journals) = snapshot.get("journalIds").and_then(Value::as_array) {
                for journal in journals.iter().filter_map(Value::as_str) {
                    if reversed.insert(journal.to_string()) {
                        accounting_service::reverse_journal(
                            &mut tx,
                            tenant,
                            branch,
                            journal,
                            &format!("{job_id}:{journal}"),
                            actor,
                        )
                        .await
                        .map_err(accounting_error)?;
                    }
                }
            }
        }
        if let Some(source_type) = source_type {
            let journals:Vec<String>=sqlx::query_scalar("SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type=$3 AND source_id=$4")
                .bind(tenant).bind(branch).bind(source_type).bind(target_id).fetch_all(&mut *tx).await?;
            for journal in journals {
                if reversed.insert(journal.clone()) {
                    accounting_service::reverse_journal(
                        &mut tx,
                        tenant,
                        branch,
                        &journal,
                        &format!("{job_id}:{journal}"),
                        actor,
                    )
                    .await
                    .map_err(accounting_error)?;
                }
            }
        }
        match entity {
            "appointments" => {
                deleted += sqlx::query(
                    "DELETE FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
            }
            "refunds" => {
                let sale_id = snapshot.get("saleId").and_then(Value::as_str).unwrap_or("");
                sqlx::query("DELETE FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND source_refund_id=$3")
                    .bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?;
                sqlx::query("DELETE FROM pos_credit_notes WHERE tenant_id=$1 AND branch_id=$2 AND refund_id=$3")
                    .bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?;
                sqlx::query("DELETE FROM pos_refund_payment_allocations WHERE tenant_id=$1 AND branch_id=$2 AND refund_id=$3")
                    .bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?;
                deleted += sqlx::query(
                    "DELETE FROM pos_invoice_refunds WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
                if !sale_id.is_empty() {
                    sqlx::query("UPDATE pos_sales SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                        .bind(tenant).bind(branch).bind(sale_id).bind(snapshot.get("saleStatus").and_then(Value::as_str).unwrap_or("paid"))
                        .execute(&mut *tx).await?;
                }
            }
            "gift-cards" => {
                deleted += sqlx::query(
                    "DELETE FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
            }
            "loyalty" => {
                deleted += sqlx::query("DELETE FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                    .bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?.rows_affected() as i64;
            }
            "payroll" => {
                let run_id = snapshot
                    .get("payrollRunId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                deleted += sqlx::query(
                    "DELETE FROM staff_payroll_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
                if !run_id.is_empty() {
                    sqlx::query("DELETE FROM staff_payroll_runs run WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND NOT EXISTS(SELECT 1 FROM staff_payroll_items item WHERE item.payroll_run_id=run.id)")
                        .bind(tenant).bind(branch).bind(run_id).execute(&mut *tx).await?;
                }
            }
            "commissions" => {
                deleted += sqlx::query("DELETE FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                    .bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?.rows_affected() as i64;
            }
            "client-notes" => {
                deleted += sqlx::query(
                    "DELETE FROM client_notes WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
            }
            "files" => {
                let table = snapshot
                    .get("fileTable")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let sql = match table {
                    "client_treatment_photos" => {
                        "DELETE FROM client_treatment_photos WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
                    }
                    "staff_files" => {
                        "DELETE FROM staff_files WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
                    }
                    _ => return Err(sqlx::Error::RowNotFound),
                };
                deleted += sqlx::query(sql)
                    .bind(tenant)
                    .bind(branch)
                    .bind(target_id)
                    .execute(&mut *tx)
                    .await?
                    .rows_affected() as i64;
            }
            "stock-movements" => {
                reverse_inventory_ledger(
                    &mut tx,
                    tenant,
                    branch,
                    target_id,
                    actor,
                    "Migration stock movement rollback",
                )
                .await?;
                restored += 1;
            }
            "sales" | "invoices" => {
                if action == "merged" {
                    let affected=sqlx::query(r#"UPDATE pos_sales SET invoice_number=$4->'record'->>'invoice_number',business_date=($4->'record'->>'business_date')::DATE,status=$4->'record'->>'status',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#)
                        .bind(tenant).bind(branch).bind(target_id).bind(snapshot).execute(&mut *tx).await?.rows_affected();
                    if affected != 1 {
                        return Err(sqlx::Error::RowNotFound);
                    }
                    restored += 1;
                } else {
                    let ledger_ids: Vec<String> = sqlx::query_scalar(
                        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND reversal_of_ledger_id IS NULL ORDER BY created_at,id",
                    )
                    .bind(tenant)
                    .bind(branch)
                    .bind(target_id)
                    .fetch_all(&mut *tx)
                    .await?;
                    for ledger_id in ledger_ids {
                        reverse_inventory_ledger(
                            &mut tx,
                            tenant,
                            branch,
                            &ledger_id,
                            actor,
                            &format!("Migration rollback {job_id}"),
                        )
                        .await?;
                    }
                    deleted += sqlx::query("UPDATE pos_sales SET is_deleted=TRUE,deleted_at=NOW(),deleted_by_user_id=$4,delete_reason=$5,status='voided',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND is_deleted=FALSE")
                        .bind(tenant).bind(branch).bind(target_id).bind(actor)
                        .bind(format!("Migration rollback {job_id}")).execute(&mut *tx).await?.rows_affected() as i64;
                }
            }
            "payments" => {
                let payment_deleted = sqlx::query(
                    "DELETE FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
                if payment_deleted != 1 {
                    return Err(sqlx::Error::Protocol(
                        "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
                    ));
                }
                deleted += payment_deleted;
                let affected=sqlx::query("UPDATE pos_sales SET paid_paise=($3->>'salePaidPaise')::BIGINT,status=$3->>'saleStatus',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3->>'saleId'")
                    .bind(tenant).bind(branch).bind(snapshot).execute(&mut *tx).await?.rows_affected();
                if affected != 1 {
                    return Err(sqlx::Error::RowNotFound);
                }
                restored += 1;
            }
            "expenses" => {
                deleted+=sqlx::query("DELETE FROM outgoing_fund_vouchers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(target_id).execute(&mut *tx).await?.rows_affected() as i64;
            }
            "purchase-bills" => {
                let item_id = snapshot
                    .get("inventoryItemId")
                    .and_then(Value::as_str)
                    .ok_or(sqlx::Error::RowNotFound)?;
                if let Some(ledger) = snapshot.get("ledgerId").and_then(Value::as_str) {
                    reverse_inventory_ledger(
                        &mut tx,
                        tenant,
                        branch,
                        ledger,
                        actor,
                        &format!("Migration rollback {job_id}"),
                    )
                    .await?;
                }
                let affected=sqlx::query("UPDATE inventory_items SET unit_cost_paise=($4->>'unitCostPaise')::BIGINT,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                    .bind(tenant).bind(branch).bind(item_id).bind(snapshot).execute(&mut *tx).await?.rows_affected();
                if affected != 1 {
                    return Err(sqlx::Error::RowNotFound);
                }
                restored += 1;
            }
            _ => return Err(sqlx::Error::RowNotFound),
        }
        if deleted + restored == handled_before {
            return Err(sqlx::Error::Protocol(
                "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
            ));
        }
    }
    if entity == "purchase-bills" {
        let receipt_ids = rows
            .iter()
            .map(|row| row.0.clone())
            .collect::<std::collections::HashSet<_>>();
        for receipt_id in receipt_ids {
            deleted += sqlx::query("UPDATE purchase_receipts SET rolled_back_at=NOW(),rolled_back_by=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND rolled_back_at IS NULL")
                .bind(tenant).bind(branch).bind(&receipt_id).bind(actor)
                .execute(&mut *tx).await?.rows_affected() as i64;
        }
    }
    let (linked,kept):(i64,i64)=sqlx::query_as("SELECT COUNT(*) FILTER(WHERE action='linked')::BIGINT,COUNT(*) FILTER(WHERE action='kept')::BIGINT FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3").bind(tenant).bind(branch).bind(job_id).fetch_one(&mut *tx).await?;
    let rolled_back=sqlx::query("UPDATE integration_import_row_results SET status='rolled_back',recovery_action=CASE action WHEN 'created' THEN 'deleted' WHEN 'merged' THEN 'restored' WHEN 'linked' THEN 'unlinked' WHEN 'kept' THEN 'none' ELSE recovery_action END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action<>''").bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?.rows_affected() as i64;
    let database_verified = rolled_back == rows.len() as i64 + linked + kept;
    if !database_verified {
        return Err(sqlx::Error::Protocol(
            "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
        ));
    }
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'").bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?;
    let report = MigrationRecoveryReport {
        job_id: job_id.into(),
        deleted_rows: deleted,
        restored_rows: restored,
        linked_rows: linked,
        kept_rows: kept,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
        audit: json!({"actorUserId":actor,"timestamp":Utc::now(),"reversedJournals":reversed}),
        verification: json!({"databaseVerified":true,"reconciliationStatus":"matched","verifiedRows":rows.len()}),
    };
    let mut report_json =
        serde_json::to_value(&report).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    report_json["verification"] = json!({"databaseVerified":true,"reconciliationStatus":"matched","verifiedAt":Utc::now(),"verifiedRows":rows.len(),"reversedJournals":reversed.len()});
    sqlx::query("UPDATE integration_import_jobs SET status='rolled_back',recovery_json=$4,rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(job_id).bind(&report_json).execute(&mut *tx).await?;
    insert_audit(
        &mut tx,
        tenant,
        branch,
        Some(job_id),
        None,
        "migration.job.rolled_back",
        "success",
        actor,
        json!({"entity":entity,"report":report_json,"reversedJournals":reversed.len()}),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(report))
}

pub async fn recovery_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<MigrationRecoveryReport>, sqlx::Error> {
    let row = sqlx::query_as::<_, (String, Value)>(
        "SELECT status,recovery_json FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await?;
    let Some((status, recovery)) = row else {
        return Ok(None);
    };
    if recovery.as_object().is_some_and(|value| !value.is_empty()) {
        return serde_json::from_value(recovery)
            .map(Some)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)));
    }
    let (created, merged, linked, kept, rolled_back): (i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT
                 COUNT(*) FILTER(WHERE action='created')::BIGINT,
                 COUNT(*) FILTER(WHERE action='merged')::BIGINT,
                 COUNT(*) FILTER(WHERE action='linked')::BIGINT,
                 COUNT(*) FILTER(WHERE action='kept')::BIGINT,
                 COUNT(*) FILTER(WHERE status='rolled_back')::BIGINT
               FROM integration_import_row_results
               WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(db)
    .await?;
    Ok(Some(MigrationRecoveryReport {
        job_id: id.to_string(),
        deleted_rows: if status == "rolled_back" { created } else { 0 },
        restored_rows: if status == "rolled_back" { merged } else { 0 },
        linked_rows: linked,
        kept_rows: kept,
        rolled_back_rows: rolled_back,
        status,
        audit: json!({}),
        verification: json!({}),
    }))
}

async fn restore_client_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    target_id: &str,
    snapshot: &Value,
) -> Result<(), sqlx::Error> {
    let affected = sqlx::query(
        r#"UPDATE clients client SET
             code=source.code,first_name=source.first_name,last_name=source.last_name,
             email=source.email,membership_label=source.membership_label,
             categories_json=source.categories_json,birthday=source.birthday,
             anniversary=source.anniversary,notes=source.notes,updated_at=source.updated_at
           FROM JSONB_TO_RECORD($4->'record') AS source(
             code TEXT,first_name TEXT,last_name TEXT,email TEXT,membership_label TEXT,
             categories_json JSONB,birthday DATE,anniversary DATE,notes TEXT,updated_at TIMESTAMPTZ
           ) WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(target_id)
    .bind(snapshot)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if affected != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

async fn restore_master_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    entity: &str,
    target_id: &str,
    actor: &str,
    snapshot: &Value,
) -> Result<(), sqlx::Error> {
    if entity == MigrationEntity::Inventory.as_str() {
        sqlx::query("SELECT SET_CONFIG('aurashine.cutover_snapshot_rollback','on',TRUE)")
            .execute(&mut **tx)
            .await?;
        let expected_quantity = snapshot
            .get("expectedQuantity")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
            .ok_or(sqlx::Error::RowNotFound)?;
        let location = value_str(snapshot, "locationCode")?;
        let applied_state_matches: bool = sqlx::query_scalar(
            r#"SELECT COALESCE((SELECT quantity=$5 FROM inventory_location_stock
                  WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND location_code=$4),$5=0)
                AND NOT EXISTS(
                  SELECT 1 FROM inventory_stock_ledger movement
                   JOIN integration_opening_inventory_snapshot_lines line
                     ON line.id=$6 AND line.inventory_item_id=movement.inventory_item_id
                  WHERE movement.tenant_id=$1 AND movement.branch_id=$2
                    AND movement.created_at>line.applied_at
                    AND movement.movement_type<>'opening_snapshot'
                    AND movement.reversal_of_ledger_id IS NULL
                    AND (movement.inventory_location_code=$4 OR movement.inventory_location_code IS NULL))"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(location)
        .bind(expected_quantity)
        .bind(value_str(snapshot, "snapshotLineId")?)
        .fetch_one(&mut **tx)
        .await?;
        if !applied_state_matches {
            return Err(sqlx::Error::Protocol(
                "ROLLBACK_SNAPSHOT_DEPENDENT_MOVEMENTS".into(),
            ));
        }
        if let Some(ledger_id) = snapshot.get("ledgerId").and_then(Value::as_str) {
            reverse_inventory_ledger(
                tx,
                tenant,
                branch,
                ledger_id,
                actor,
                "Migration inventory rollback",
            )
            .await?;
        }
        sqlx::query(
            "DELETE FROM inventory_location_batches WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND location_code=$4",
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(location)
        .execute(&mut **tx)
        .await?;
        if snapshot.get("locationStock").is_some_and(Value::is_object) {
            sqlx::query(
                r#"INSERT INTO inventory_location_stock(
                     tenant_id,branch_id,inventory_item_id,location_code,stock_unit,quantity,
                     unit_cost_paise,snapshot_line_id,updated_at)
                   VALUES($1,$2,$3,$4,$5->>'stock_unit',($5->>'quantity')::INTEGER,
                     ($5->>'unit_cost_paise')::BIGINT,$5->>'snapshot_line_id',
                     COALESCE(($5->>'updated_at')::TIMESTAMPTZ,NOW()))
                   ON CONFLICT(tenant_id,branch_id,inventory_item_id,location_code) DO UPDATE SET
                     stock_unit=EXCLUDED.stock_unit,quantity=EXCLUDED.quantity,
                     unit_cost_paise=EXCLUDED.unit_cost_paise,
                     snapshot_line_id=EXCLUDED.snapshot_line_id,updated_at=EXCLUDED.updated_at"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(target_id)
            .bind(location)
            .bind(&snapshot["locationStock"])
            .execute(&mut **tx)
            .await?;
            sqlx::query(
                r#"INSERT INTO inventory_location_batches(
                     tenant_id,branch_id,inventory_item_id,location_code,batch_number,expiry_date,
                     quantity,unit_cost_paise,snapshot_line_id,updated_at)
                   SELECT $1,$2,$3,$4,source.batch_number,source.expiry_date,source.quantity,
                          source.unit_cost_paise,source.snapshot_line_id,source.updated_at
                     FROM JSONB_TO_RECORDSET($5) AS source(
                       batch_number TEXT,expiry_date DATE,quantity INTEGER,unit_cost_paise BIGINT,
                       snapshot_line_id TEXT,updated_at TIMESTAMPTZ)"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(target_id)
            .bind(location)
            .bind(&snapshot["locationBatches"])
            .execute(&mut **tx)
            .await?;
        } else {
            sqlx::query(
                "DELETE FROM inventory_location_stock WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND location_code=$4",
            )
            .bind(tenant)
            .bind(branch)
            .bind(target_id)
            .bind(location)
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query(
            "UPDATE inventory_batches SET quantity=0,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO inventory_batches(
                 id,tenant_id,branch_id,inventory_item_id,batch_number,barcode,expiry_date,
                 received_date,quantity,unit_cost_paise,created_at,updated_at)
               SELECT source.id,$1,$2,$3,source.batch_number,source.barcode,source.expiry_date,
                      source.received_date,source.quantity,source.unit_cost_paise,
                      source.created_at,source.updated_at
                 FROM JSONB_TO_RECORDSET($4) AS source(
                   id TEXT,batch_number TEXT,barcode TEXT,expiry_date DATE,received_date DATE,
                   quantity INTEGER,unit_cost_paise BIGINT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)
               ON CONFLICT(tenant_id,branch_id,inventory_item_id,batch_number) DO UPDATE SET
                 barcode=EXCLUDED.barcode,expiry_date=EXCLUDED.expiry_date,
                 received_date=EXCLUDED.received_date,quantity=EXCLUDED.quantity,
                 unit_cost_paise=EXCLUDED.unit_cost_paise,updated_at=EXCLUDED.updated_at"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(&snapshot["itemBatches"])
        .execute(&mut **tx)
        .await?;
        let affected = sqlx::query(
            r#"UPDATE inventory_items SET unit_cost_paise=($4->'record'->>'unit_cost_paise')::BIGINT,
                 updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(snapshot)
        .execute(&mut **tx)
        .await?
        .rows_affected();
        if affected != 1 {
            return Err(sqlx::Error::RowNotFound);
        }
        let restored_matches: bool = sqlx::query_scalar(
            "SELECT stock_quantity=($4->'record'->>'stock_quantity')::INTEGER AND unit_cost_paise=($4->'record'->>'unit_cost_paise')::BIGINT FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(snapshot)
        .fetch_one(&mut **tx)
        .await?;
        if !restored_matches {
            return Err(sqlx::Error::Protocol(
                "ROLLBACK_DATABASE_VERIFICATION_FAILED".into(),
            ));
        }
        return Ok(());
    }
    let sql = match entity {
        "services" => {
            r#"UPDATE services SET name=$4->'record'->>'name',category=$4->'record'->>'category',
            duration_minutes=($4->'record'->>'duration_minutes')::INTEGER,price_paise=($4->'record'->>'price_paise')::INTEGER,
            gst_percent=($4->'record'->>'gst_percent')::INTEGER,sac_code=$4->'record'->>'sac_code',wait_time_minutes=($4->'record'->>'wait_time_minutes')::INTEGER,
            cleanup_time_minutes=($4->'record'->>'cleanup_time_minutes')::INTEGER,buffer_time_minutes=($4->'record'->>'buffer_time_minutes')::INTEGER,
            active=($4->'record'->>'active')::BOOLEAN,updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#
        }
        "products" => {
            r#"UPDATE inventory_items SET sku=$4->'record'->>'sku',name=$4->'record'->>'name',category=$4->'record'->>'category',unit=$4->'record'->>'unit',
            reorder_point=($4->'record'->>'reorder_point')::INTEGER,unit_cost_paise=($4->'record'->>'unit_cost_paise')::BIGINT,hsn_code=$4->'record'->>'hsn_code',
            gst_percent=($4->'record'->>'gst_percent')::INTEGER,barcode=$4->'record'->>'barcode',batch_tracked=($4->'record'->>'batch_tracked')::BOOLEAN,
            active=($4->'record'->>'active')::BOOLEAN,updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#
        }
        "suppliers" => {
            r#"UPDATE suppliers SET code=$4->'record'->>'code',name=$4->'record'->>'name',gstin=$4->'record'->>'gstin',contact_name=$4->'record'->>'contact_name',
            phone=$4->'record'->>'phone',email=$4->'record'->>'email',address=$4->'record'->>'address',payment_terms_days=($4->'record'->>'payment_terms_days')::INTEGER,
            active=($4->'record'->>'active')::BOOLEAN,updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#
        }
        "memberships" => {
            r#"UPDATE memberships SET name=$4->'record'->>'name',code=$4->'record'->>'code',plan_type=$4->'record'->>'plan_type',price_paise=($4->'record'->>'price_paise')::BIGINT,
            points_required=($4->'record'->>'points_required')::INTEGER,discount_percent=($4->'record'->>'discount_percent')::INTEGER,validity_days=($4->'record'->>'validity_days')::INTEGER,
            notes=$4->'record'->>'notes',service_ids_json=$4->'record'->'service_ids_json',active=($4->'record'->>'active')::BOOLEAN,
            updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#
        }
        "packages" => {
            r#"UPDATE packages SET name=$4->'record'->>'name',description=$4->'record'->>'description',price_paise=($4->'record'->>'price_paise')::BIGINT,
            discount_percent=($4->'record'->>'discount_percent')::INTEGER,validity_days=($4->'record'->>'validity_days')::INTEGER,service_ids_json=$4->'record'->'service_ids_json',
            paid_sessions=($4->'record'->>'paid_sessions')::INTEGER,free_sessions=($4->'record'->>'free_sessions')::INTEGER,cost_price_paise=($4->'record'->>'cost_price_paise')::BIGINT,
            service_rows_json=$4->'record'->'service_rows_json',show_mobile_app=($4->'record'->>'show_mobile_app')::BOOLEAN,show_online_booking=($4->'record'->>'show_online_booking')::BOOLEAN,
            active=($4->'record'->>'active')::BOOLEAN,updated_at=($4->'record'->>'updated_at')::TIMESTAMPTZ WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#
        }
        _ => return Err(sqlx::Error::RowNotFound),
    };
    let affected = sqlx::query(sql)
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(snapshot)
        .execute(&mut **tx)
        .await?
        .rows_affected();
    if affected != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

async fn restore_staff_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    target_id: &str,
    snapshot: &Value,
) -> Result<(), sqlx::Error> {
    let affected = sqlx::query(
        r#"UPDATE staff staff SET
             first_name=source.first_name,last_name=source.last_name,
             appointment_display_name=source.appointment_display_name,email=source.email,
             mobile_phone=source.mobile_phone,job_title=source.job_title,
             active=source.active,updated_at=source.updated_at
           FROM JSONB_TO_RECORD($4->'record') AS source(
             first_name TEXT,last_name TEXT,appointment_display_name TEXT,email TEXT,
             mobile_phone TEXT,job_title TEXT,active BOOLEAN,updated_at TIMESTAMPTZ
           ) WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$3"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(target_id)
    .bind(snapshot)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    if affected != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    if snapshot.get("profile").is_none_or(Value::is_null) {
        sqlx::query(
            "DELETE FROM staff_profiles WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .execute(&mut **tx)
        .await?;
    } else {
        sqlx::query(
            r#"INSERT INTO staff_profiles(
                 staff_id,tenant_id,branch_id,category_id,shift_template_id,photo_url,
                 date_of_birth,joining_date,gender,employment_type,department,
                 reporting_manager_id,created_at,updated_at
               ) SELECT $3,$1,$2,source.category_id,source.shift_template_id,source.photo_url,
                        source.date_of_birth,source.joining_date,source.gender,
                        source.employment_type,source.department,source.reporting_manager_id,
                        source.created_at,source.updated_at
                 FROM JSONB_TO_RECORD($4->'profile') AS source(
                   category_id TEXT,shift_template_id TEXT,photo_url TEXT,date_of_birth DATE,
                   joining_date DATE,gender TEXT,employment_type TEXT,department TEXT,
                   reporting_manager_id TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ
                 )
               ON CONFLICT(staff_id) DO UPDATE SET
                 category_id=EXCLUDED.category_id,shift_template_id=EXCLUDED.shift_template_id,
                 photo_url=EXCLUDED.photo_url,date_of_birth=EXCLUDED.date_of_birth,
                 joining_date=EXCLUDED.joining_date,gender=EXCLUDED.gender,
                 employment_type=EXCLUDED.employment_type,department=EXCLUDED.department,
                 reporting_manager_id=EXCLUDED.reporting_manager_id,
                 created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at"#,
        )
        .bind(tenant)
        .bind(branch)
        .bind(target_id)
        .bind(snapshot)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub(crate) fn into_import_job(row: ImportJobRow) -> Result<ImportJob, sqlx::Error> {
    Ok(ImportJob {
        id: row.id,
        entity: decode_enum("entity", &row.entity)?,
        file_name: row.file_name,
        mode: decode_enum("mode", &row.mode)?,
        status: decode_enum("status", &row.status)?,
        source_hash: row.source_hash,
        source_row_count: row.source_row_count,
        valid_row_count: row.valid_row_count,
        error_row_count: row.error_row_count,
        warning_row_count: row.warning_row_count,
        duplicate_row_count: row.duplicate_row_count,
        errors_json: row.errors_json,
        mapping_json: row.mapping_json,
        mapping_id: row.mapping_id,
        mapping_version: row.mapping_version,
        mapping_header_fingerprint: row.mapping_header_fingerprint,
        transformer_versions: row.transformer_versions_json,
        analysis_json: row.analysis_json,
        recovery_json: row.recovery_json,
        total_rows: row.total_rows,
        processed_rows: row.processed_rows,
        next_row: row.next_row,
        last_error: row.last_error,
        source_file_id: row.source_file_id,
        chunk_size: row.chunk_size,
        allow_partial_import: row.allow_partial_import,
        worker_phase: row.worker_phase,
        worker_id: row.worker_id,
        heartbeat_at: row.heartbeat_at,
        total_chunks: row.total_chunks,
        completed_chunks: row.completed_chunks,
        failed_chunks: row.failed_chunks,
        owner_user_id: row.owner_user_id,
        approval_status: row.approval_status,
        approval_requested_at: row.approval_requested_at,
        approval_decided_at: row.approval_decided_at,
        approval_decided_by: row.approval_decided_by,
        approval_note: row.approval_note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        rolled_back_at: row.rolled_back_at,
    })
}

fn into_mapping(row: MigrationMappingRow) -> Result<MigrationMapping, sqlx::Error> {
    let mapping = serde_json::from_value::<BTreeMap<String, String>>(row.mapping_json)
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    let source_columns = serde_json::from_value::<Vec<String>>(row.source_columns_json)
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    let normalized_headers = serde_json::from_value::<Vec<String>>(row.normalized_headers_json)
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
    Ok(MigrationMapping {
        id: row.id,
        name: row.name,
        entity: decode_enum("mapping entity", &row.entity)?,
        mapping,
        source_columns,
        source_provider: decode_enum("mapping provider", &row.source_provider)?,
        source_sheet: row.source_sheet,
        normalized_headers,
        header_fingerprint: row.header_fingerprint,
        column_count: row.column_count,
        mapping_version: row.current_version,
        transformer_versions: row.transformer_versions_json,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn into_mapping_version(
    row: MigrationMappingVersionRow,
) -> Result<MigrationMappingVersion, sqlx::Error> {
    Ok(MigrationMappingVersion {
        mapping_id: row.mapping_id,
        version: row.version,
        entity: decode_enum("mapping version entity", &row.entity)?,
        source_provider: decode_enum("mapping version provider", &row.source_provider)?,
        source_sheet: row.source_sheet,
        source_columns: serde_json::from_value(row.source_columns_json)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        normalized_headers: serde_json::from_value(row.normalized_headers_json)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        header_fingerprint: row.header_fingerprint,
        column_count: row.column_count,
        mapping: serde_json::from_value(row.mapping_json)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        transformer_versions: row.transformer_versions_json,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        change_kind: row.change_kind,
        rolled_back_from_version: row.rolled_back_from_version,
    })
}

fn into_alias(row: MigrationAliasRow) -> Result<MigrationAlias, sqlx::Error> {
    Ok(MigrationAlias {
        id: row.id,
        entity: decode_enum("alias entity", &row.entity)?,
        source_provider: decode_enum("alias provider", &row.source_provider)?,
        alias: row.alias,
        target_field: row.target_field,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn into_mapping_approval(
    row: MigrationMappingApprovalRow,
) -> Result<MigrationMappingApproval, sqlx::Error> {
    Ok(MigrationMappingApproval {
        id: row.id,
        entity: decode_enum("mapping approval entity", &row.entity)?,
        source_provider: decode_enum("mapping approval provider", &row.source_provider)?,
        rule_version: row.rule_version,
        fingerprint: row.fingerprint,
        source_file_id: row.source_file_id,
        source_sheet: row.source_sheet,
        source_column: row.source_column,
        target_field: row.target_field,
        confidence_percentage: u8::try_from(row.confidence_percentage)
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        decision: row.decision_json,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
    })
}

fn into_claimed_job(row: ClaimedImportJobRow) -> Result<ClaimedImportJob, sqlx::Error> {
    Ok(ClaimedImportJob {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        entity: decode_enum("entity", &row.entity)?,
        rows_json: row.rows_json,
        total_rows: row.total_rows,
        next_row: row.next_row,
        created_by: row.created_by,
    })
}

fn decode_enum<T>(label: &str, value: &str) -> Result<T, sqlx::Error>
where
    T: for<'a> TryFrom<&'a str, Error = String>,
{
    T::try_from(value).map_err(|message| {
        sqlx::Error::Decode(Box::new(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid migration {label}: {message}"),
        )))
    })
}

async fn insert_audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    job_id: Option<&str>,
    batch_id: Option<&str>,
    event_type: &str,
    outcome: &str,
    actor: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,batch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant).bind(branch).bind(job_id).bind(batch_id).bind(event_type).bind(outcome).bind(actor).bind(details).execute(&mut **tx).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_to_engine_preserves_signed_post_cutover_movements() {
        assert_eq!(expected_stock_quantity(18, 5 - 3 + 2 - 1), Some(21));
        assert_eq!(expected_stock_quantity(18, 0), Some(18));
        assert_eq!(expected_stock_quantity(i32::MAX, 1), None);
    }

    #[test]
    fn three_layer_apply_guard_blocks_every_operational_mode() {
        assert_eq!(
            three_layer_commit_block_code(MigrationEntity::PurchaseBills, None),
            Some("POSTING_MODE_REQUIRED")
        );
        assert_eq!(
            three_layer_commit_block_code(MigrationEntity::PurchaseBills, Some("history_only")),
            None
        );
        assert_eq!(
            three_layer_commit_block_code(MigrationEntity::PurchaseBills, Some("live_receipt")),
            Some("LIVE_RECEIPT_EXECUTION_NOT_READY")
        );
        assert_eq!(
            three_layer_commit_block_code(MigrationEntity::Inventory, Some("opening_snapshot")),
            None
        );
    }

    #[test]
    fn failed_row_csv_neutralizes_spreadsheet_formulas() {
        assert_eq!(
            csv_cell("=HYPERLINK(\"bad\")"),
            "\"'=HYPERLINK(\"\"bad\"\")\""
        );
        assert_eq!(csv_cell("safe"), "\"safe\"");
    }

    #[test]
    fn historical_mapping_normalizes_size_and_protects_shades() {
        assert!(historical_size_matches("1000 ml", "Repair Shampoo 1 Litre"));
        assert!(historical_variant_matches("4.0", "Color Tube 4.0"));
        assert!(!historical_variant_matches("4", "Color Tube 4.0"));
    }

    #[test]
    fn historical_mapping_drift_ignores_only_aggregate_counts() {
        let old = json!({"sku":"MB1000","billCount":1,"historicalQuantity":2});
        let same_identity = json!({"sku":"MB1000","billCount":8,"historicalQuantity":20});
        let drifted = json!({"sku":"","billCount":8,"historicalQuantity":20});
        assert_eq!(
            historical_mapping_material_snapshot(&old),
            historical_mapping_material_snapshot(&same_identity)
        );
        assert_ne!(
            historical_mapping_material_snapshot(&old),
            historical_mapping_material_snapshot(&drifted)
        );
    }

    async fn prepare_schema(pool: &PgPool) {
        for statement in [
            "CREATE EXTENSION IF NOT EXISTS pgcrypto",
            "CREATE TABLE clients(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,code TEXT,first_name TEXT NOT NULL,last_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',normalized_phone TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',membership_label TEXT NOT NULL DEFAULT '',categories_json JSONB NOT NULL DEFAULT '[]',birthday DATE,anniversary DATE,notes TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,merged_into_client_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ)",
            "CREATE TABLE client_audit_events(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_user_id TEXT NOT NULL,details_json JSONB NOT NULL)",
            "CREATE TABLE staff(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,employee_code TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL DEFAULT '',appointment_display_name TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',mobile_phone TEXT NOT NULL DEFAULT '',job_title TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ)",
            "CREATE TABLE staff_profiles(staff_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,category_id TEXT,shift_template_id TEXT,photo_url TEXT NOT NULL DEFAULT '',date_of_birth DATE,joining_date DATE,gender TEXT NOT NULL DEFAULT '',employment_type TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',reporting_manager_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ)",
            "CREATE TABLE staff_bulk_import_jobs(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,batch_key TEXT NOT NULL,total_rows INTEGER NOT NULL,created_rows INTEGER NOT NULL DEFAULT 0,updated_rows INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,staff_ids JSONB NOT NULL DEFAULT '[]',requested_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(tenant_id,branch_id,batch_key))",
        ] {
            sqlx::query(statement).execute(pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!("../../migrations/0125_data_import_jobs.sql"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0167_data_migration_foundation.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0168_data_migration_clients_staff_parity.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0170_data_migration_file_intake.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0174_data_migration_large_worker.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0187_data_migration_governance.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0191_data_migration_governance_rollback_impact.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0294_data_migration_financial_reconciliation.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0295_data_migration_dependencies.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0302_data_migration_schema_alias_registry.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0316_data_migration_dependency_execution.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0317_data_migration_quarantine_retry.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    #[test]
    fn phase_eight_dependency_rank_matches_execution_contract() {
        for (entity, rank) in [
            (MigrationEntity::Clients, 0),
            (MigrationEntity::Staff, 1),
            (MigrationEntity::Services, 1),
            (MigrationEntity::Products, 1),
            (MigrationEntity::Suppliers, 1),
            (MigrationEntity::Memberships, 2),
            (MigrationEntity::Packages, 2),
            (MigrationEntity::Inventory, 2),
            (MigrationEntity::ClientMemberships, 3),
            (MigrationEntity::Appointments, 3),
            (MigrationEntity::Sales, 4),
            (MigrationEntity::Invoices, 4),
            (MigrationEntity::Payments, 5),
            (MigrationEntity::Refunds, 5),
            (MigrationEntity::Loyalty, 6),
            (MigrationEntity::Commissions, 6),
            (MigrationEntity::StockMovements, 6),
            (MigrationEntity::OpeningPayables, 6),
            (MigrationEntity::Files, 6),
        ] {
            assert_eq!(dependency_rank(entity), rank, "{entity}");
        }
    }

    #[sqlx::test(migrations = false)]
    async fn import_foundation_is_scoped_traceable_audited_and_duplicate_safe(pool: PgPool) {
        prepare_schema(&pool).await;
        let rows = json!([{
            "source_row_number": 2,
            "source_external_id": "legacy-client-1",
            "first_name": "Asha",
            "last_name": "Kumar",
            "phone": "+919876543210",
            "normalized_phone": "+919876543210",
            "email": "asha@example.test",
            "membership_label":"",
            "categories_json":[],
            "birthday":null,
            "anniversary":null,
            "notes":"",
            "active":true
        }]);
        let row_results = json!([{
            "source_row_number": 2,
            "source_external_id": "legacy-client-1",
            "status": "validated",
            "error_code": "",
            "message": "",
            "warnings": [],
            "duplicate_target_id":"",
            "duplicate_decision":"",
            "source_payload": rows[0]
        }]);

        let job = create_job(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "clients.csv",
            MigrationMode::Commit,
            MigrationJobStatus::Queued,
            "source-hash-1",
            1,
            &rows,
            &json!([]),
            &row_results,
            None,
            &json!({}),
            &json!({}),
            0,
            0,
            "owner-1",
        )
        .await
        .unwrap();

        assert!(find_active_commit_duplicate(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "source-hash-1"
        )
        .await
        .unwrap()
        .is_some());
        assert!(find_active_commit_duplicate(
            &pool,
            "tenant-1",
            "branch-2",
            MigrationEntity::Clients,
            "source-hash-1"
        )
        .await
        .unwrap()
        .is_none());
        assert!(list_jobs(&pool, "tenant-1", "branch-2")
            .await
            .unwrap()
            .is_empty());
        assert!(governance_report(&pool, "tenant-2", "branch-1", &job.id)
            .await
            .unwrap()
            .is_none());
        assert!(rollback_impact(&pool, "tenant-1", "branch-2", &job.id)
            .await
            .unwrap()
            .is_none());

        let duplicate = create_job(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "clients-again.csv",
            MigrationMode::Commit,
            MigrationJobStatus::Queued,
            "source-hash-1",
            1,
            &rows,
            &json!([]),
            &row_results,
            None,
            &json!({}),
            &json!({}),
            0,
            0,
            "owner-1",
        )
        .await
        .unwrap_err();
        assert!(is_active_source_duplicate_error(&duplicate));

        let claimed = claim_job(&pool).await.unwrap().unwrap();
        assert_eq!(claimed.id, job.id);
        apply_batch(&pool, &claimed, &rows, 0, 1).await.unwrap();

        let trace: (String, String, Option<String>) = sqlx::query_as(
            "SELECT status,source_external_id,target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_row_number=2",
        )
        .bind("tenant-1")
        .bind("branch-1")
        .bind(&job.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(trace.0, "created");
        assert_eq!(trace.1, "legacy-client-1");
        assert!(trace.2.is_some());

        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM integration_import_audit_events WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
        )
        .bind("tenant-1")
        .bind("branch-1")
        .bind(&job.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit_count, 2);

        let recovery = rollback_job(&pool, "tenant-1", "branch-1", &job.id, "owner-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(recovery.deleted_rows, 1);
        let client_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM clients WHERE import_job_id=$1")
                .bind(&job.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(client_count, 0);
    }

    #[sqlx::test(migrations = false)]
    async fn phase_nine_preview_and_yellow_gate_commit_approval(pool: PgPool) {
        prepare_schema(&pool).await;
        let payload = json!({
            "source_row_number":2,
            "source_external_id":"legacy-client-1",
            "__migration_evidence":{"fields":[{
                "sourceField":"Customer Contact","targetField":"phone",
                "originalValue":"9876543210","transformer":"phone_e164",
                "transformerVersion":"v1","transformedValue":"+919876543210",
                "warnings":[{"message":"Country code inferred"}],"errors":[]
            }]}
        });
        let job = create_job(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "clients.csv",
            MigrationMode::Commit,
            MigrationJobStatus::Validated,
            "phase-nine-source",
            1,
            &json!([payload]),
            &json!([]),
            &json!([{
                "source_row_number":2,"source_external_id":"legacy-client-1",
                "status":"warning","error_code":"","message":"",
                "warnings":[{"message":"Country code inferred"}],
                "duplicate_target_id":"","duplicate_decision":"","source_payload":payload
            }]),
            None,
            &json!({"Customer Contact":"phone"}),
            &json!({}),
            1,
            0,
            "owner-1",
        )
        .await
        .unwrap();

        let before = governance_report(&pool, "tenant-1", "branch-1", &job.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            before.pointer("/preview/fields/0/sourceColumn"),
            Some(&json!("Customer Contact"))
        );
        assert_eq!(
            before.pointer("/dryRunSummary/commitBlocked"),
            Some(&json!(true))
        );
        assert!(
            !decide_approval(&pool, "tenant-1", "branch-1", &job.id, "owner-1", true, "")
                .await
                .unwrap()
        );
        assert!(
            approve_yellow_warnings(&pool, "tenant-1", "branch-1", &job.id, "owner-1")
                .await
                .unwrap()
        );
        let after = governance_report(&pool, "tenant-1", "branch-1", &job.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            after.pointer("/dryRunSummary/yellowApproved"),
            Some(&json!(true))
        );
        assert_eq!(
            after.pointer("/dryRunSummary/commitBlocked"),
            Some(&json!(false))
        );
        assert_eq!(
            after.pointer("/preview/fields/0/decision"),
            Some(&json!("approved"))
        );
        assert!(
            decide_approval(&pool, "tenant-1", "branch-1", &job.id, "owner-1", true, "")
                .await
                .unwrap()
        );
    }

    #[sqlx::test(migrations = false)]
    async fn phase_ten_quarantine_retry_preserves_original_and_adds_checkpoint(pool: PgPool) {
        prepare_schema(&pool).await;
        sqlx::query("INSERT INTO integration_import_upload_sessions(id,tenant_id,branch_id,original_file_name,file_extension,expected_size_bytes,total_parts,status,created_by) VALUES('upload-1','tenant-1','branch-1','clients.csv','csv',10,1,'completed','owner-1')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO integration_import_source_files(id,tenant_id,branch_id,upload_session_id,original_file_name,file_extension,declared_content_type,detected_content_type,file_format,size_bytes,sha256,storage_key,created_by) VALUES('source-1','tenant-1','branch-1','upload-1','clients.csv','csv','text/csv','text/csv','csv',10,'phase10-hash','evidence/source-1','owner-1')")
            .execute(&pool).await.unwrap();
        let job = crate::repositories::migration_large_import_repository::create_job(
            &pool,
            "tenant-1",
            "branch-1",
            "source-1",
            MigrationEntity::Clients,
            MigrationMode::Commit,
            "clients.csv",
            "phase10-hash",
            MigrationProvider::Csv,
            "clients",
            "clients",
            100,
            true,
            None,
            &json!({"First Name":"firstName","Customer Contact":"phone"}),
            &json!({}),
            crate::services::migration_adapter_service::MIGRATION_TRANSFORMER_VERSION,
            None,
            "owner-1",
        )
        .await
        .unwrap();
        sqlx::query("UPDATE integration_import_jobs SET status='processing',worker_phase='staging',worker_id='test-worker' WHERE id=$1")
            .bind(&job.id).execute(&pool).await.unwrap();
        let staging_job = crate::repositories::migration_large_import_repository::LargeStagingJob {
            id: job.id.clone(),
            tenant_id: "tenant-1".into(),
            branch_id: "branch-1".into(),
            source_file_id: "source-1".into(),
            source_provider: MigrationProvider::Csv,
            source_sheet: "clients".into(),
            header_source_sheet: "clients".into(),
            entity: MigrationEntity::Clients,
            mode: MigrationMode::Commit,
            chunk_size: 100,
            allow_partial_import: true,
            mapping_json: json!({"First Name":"firstName","Customer Contact":"phone"}),
            duplicate_decisions_json: json!({}),
            posting_contract: None,
            transformation_version:
                crate::services::migration_adapter_service::MIGRATION_TRANSFORMER_VERSION.into(),
            created_by: "owner-1".into(),
        };
        let original = json!({"source_row_number":2,"source_external_id":"legacy-1","first_name":"Asha","__migration_evidence":{"sourceValues":{"First Name":"Asha","Customer Contact":"bad"},"fields":[{"sourceField":"Customer Contact","targetField":"phone","originalValue":"bad","transformer":"phone_e164","transformerVersion":"v1","transformedValue":null,"warnings":[],"errors":[{"message":"phone is invalid","suggestedTarget":"phone"}]}]}});
        let staged_error = json!([{"source_row_number":2,"source_external_id":"legacy-1","status":"error","ready":false,"error_code":"INVALID_PHONE","message":"phone is invalid","warnings":[],"duplicate_target_id":"","duplicate_decision":"","source_payload":original}]);
        assert!(
            crate::repositories::migration_large_import_repository::stage_chunk(
                &pool,
                &staging_job,
                "test-worker",
                1,
                "clients",
                2,
                2,
                "error-checksum",
                &staged_error,
                &json!({}),
                0,
                1,
                0,
                0
            )
            .await
            .unwrap()
        );
        crate::repositories::migration_large_import_repository::finish_staging(&pool, &staging_job)
            .await
            .unwrap();
        let quarantine =
            crate::repositories::migration_large_import_repository::quarantine_records(
                &pool, "tenant-1", "branch-1", &job.id, 200,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            quarantine.pointer("/records/0/errorCode"),
            Some(&json!("INVALID_PHONE"))
        );

        let result = crate::services::migration_large_import_service::selective_retry(
            &pool,
            "tenant-1",
            "branch-1",
            &job.id,
            "owner-1",
            crate::models::migration::MigrationSelectiveRetryRequest {
                rows: vec![crate::models::migration::MigrationRetryCorrection {
                    source_sheet: "clients".into(),
                    source_row_number: 2,
                    corrections: BTreeMap::from([("Customer Contact".into(), "9876543210".into())]),
                }],
                approve_partial: true,
            },
        )
        .await
        .unwrap();
        assert_eq!(result.get("queued"), Some(&json!(true)));
        let row:(String,Value,Value,i32)=sqlx::query_as("SELECT status,source_payload,correction_payload,retry_count FROM integration_import_row_results WHERE job_id=$1 AND source_sheet='clients' AND source_row_number=2")
            .bind(&job.id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.0, "ready");
        assert_eq!(
            row.1
                .pointer("/__migration_evidence/sourceValues/Customer Contact"),
            Some(&json!("bad"))
        );
        assert_eq!(
            row.2
                .pointer("/__migration_evidence/sourceValues/Customer Contact"),
            Some(&json!("9876543210"))
        );
        assert_eq!(row.3, 1);
        let chunks: Vec<String> = sqlx::query_scalar(
            "SELECT status FROM integration_import_chunks WHERE job_id=$1 ORDER BY chunk_number",
        )
        .bind(&job.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(chunks, vec!["completed", "pending"]);
    }

    #[sqlx::test(migrations = false)]
    async fn duplicate_actions_merge_link_keep_and_rollback_exactly(pool: PgPool) {
        prepare_schema(&pool).await;
        sqlx::query(
            "INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,normalized_phone,email) VALUES('existing-1','tenant-1','branch-1','Existing','Client','+919000000001','+919000000001','')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let rows = json!([
            {"source_row_number":2,"source_external_id":"legacy-merge","code":"","first_name":"Incoming","last_name":"","phone":"+919000000001","normalized_phone":"+919000000001","email":"merged@example.test","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true,"duplicate_target_id":"existing-1","duplicate_decision":"merge"},
            {"source_row_number":3,"source_external_id":"legacy-link","code":"","first_name":"Linked","last_name":"","phone":"+919000000001","normalized_phone":"+919000000001","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true,"duplicate_target_id":"existing-1","duplicate_decision":"link"},
            {"source_row_number":4,"source_external_id":"legacy-keep","code":"","first_name":"Kept","last_name":"","phone":"+919000000001","normalized_phone":"+919000000001","email":"","membership_label":"","categories_json":[],"birthday":null,"anniversary":null,"notes":"","active":true,"duplicate_target_id":"existing-1","duplicate_decision":"keep"}
        ]);
        let row_results = json!([
            {"source_row_number":2,"source_external_id":"legacy-merge","status":"duplicate","error_code":"","message":"","warnings":[],"duplicate_target_id":"existing-1","duplicate_decision":"merge","source_payload":rows[0]},
            {"source_row_number":3,"source_external_id":"legacy-link","status":"duplicate","error_code":"","message":"","warnings":[],"duplicate_target_id":"existing-1","duplicate_decision":"link","source_payload":rows[1]},
            {"source_row_number":4,"source_external_id":"legacy-keep","status":"duplicate","error_code":"","message":"","warnings":[],"duplicate_target_id":"existing-1","duplicate_decision":"keep","source_payload":rows[2]}
        ]);
        let job = create_job(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "duplicates.csv",
            MigrationMode::Commit,
            MigrationJobStatus::Queued,
            "duplicate-actions-hash",
            3,
            &rows,
            &json!([]),
            &row_results,
            None,
            &json!({}),
            &json!({}),
            0,
            3,
            "owner-1",
        )
        .await
        .unwrap();
        let claimed = claim_job(&pool).await.unwrap().unwrap();
        apply_batch(&pool, &claimed, &rows, 0, 3).await.unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT email FROM clients WHERE id='existing-1'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "merged@example.test"
        );
        let actions: Vec<String> = sqlx::query_scalar(
            "SELECT action FROM integration_import_row_results WHERE job_id=$1 ORDER BY source_row_number",
        )
        .bind(&job.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(actions, vec!["merged", "linked", "kept"]);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM clients WHERE tenant_id='tenant-1' AND branch_id='branch-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            2
        );

        let report = rollback_job(&pool, "tenant-1", "branch-1", &job.id, "owner-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(report.deleted_rows, 1);
        assert_eq!(report.restored_rows, 1);
        assert_eq!(report.linked_rows, 1);
        assert_eq!(report.kept_rows, 1);
        assert_eq!(report.rolled_back_rows, 3);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM clients WHERE tenant_id='tenant-1' AND branch_id='branch-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT email FROM clients WHERE id='existing-1'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            ""
        );
        assert_eq!(
            recovery_report(&pool, "tenant-1", "branch-1", &job.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            "rolled_back"
        );
    }

    #[sqlx::test(migrations = false)]
    async fn saved_mappings_are_tenant_and_branch_scoped(pool: PgPool) {
        prepare_schema(&pool).await;
        let mapping = save_mapping(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "Legacy clients",
            &json!({"Customer Name":"firstName","Mobile":"phone"}),
            &json!(["Customer Name", "Mobile"]),
            MigrationProvider::Dingg,
            "Clients",
            &json!(["customer_name", "mobile"]),
            "1111111111111111111111111111111111111111111111111111111111111111",
            &json!({"mappingRule":"phase11-test","rowTransformer":"phase11-test"}),
            "owner-1",
        )
        .await
        .unwrap();
        assert_eq!(mapping.mapping["Mobile"], "phone");
        assert_eq!(
            list_mappings(&pool, "tenant-1", "branch-1")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(list_mappings(&pool, "tenant-1", "branch-2")
            .await
            .unwrap()
            .is_empty());
        assert!(get_mapping(&pool, "tenant-2", "branch-1", &mapping.id)
            .await
            .unwrap()
            .is_none());
        let updated = save_mapping(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            "Legacy clients",
            &json!({"Customer Name":"firstName","Mobile":"phone","Email":"email"}),
            &json!(["Customer Name", "Mobile", "Email"]),
            MigrationProvider::Dingg,
            "Clients",
            &json!(["customer_name", "mobile", "email"]),
            "2222222222222222222222222222222222222222222222222222222222222222",
            &json!({"mappingRule":"phase11-test","rowTransformer":"phase11-test"}),
            "owner-2",
        )
        .await
        .unwrap();
        assert_eq!(updated.mapping_version, 2);
        assert_eq!(
            list_mapping_versions(&pool, "tenant-1", "branch-1", &mapping.id)
                .await
                .unwrap()
                .len(),
            2
        );
        assert!(
            list_mapping_versions(&pool, "tenant-2", "branch-1", &mapping.id)
                .await
                .unwrap()
                .is_empty()
        );
        let rolled_back =
            rollback_mapping(&pool, "tenant-1", "branch-1", &mapping.id, 1, "owner-3")
                .await
                .unwrap()
                .unwrap();
        assert_eq!(rolled_back.mapping_version, 3);
        assert!(!rolled_back.mapping.contains_key("Email"));
        assert_eq!(
            list_mapping_versions(&pool, "tenant-1", "branch-1", &mapping.id)
                .await
                .unwrap()
                .len(),
            3
        );

        let alias = save_alias(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            MigrationProvider::Dingg,
            "Customer Contact",
            "phone",
            "owner-1",
        )
        .await
        .unwrap();
        assert_eq!(alias.target_field, "phone");
        assert_eq!(
            list_aliases(
                &pool,
                "tenant-1",
                "branch-1",
                Some(MigrationEntity::Clients)
            )
            .await
            .unwrap()
            .len(),
            1
        );
        assert!(list_aliases(&pool, "tenant-1", "branch-2", None)
            .await
            .unwrap()
            .is_empty());
    }
}
