use crate::models::migration::{
    ClaimedImportJob, ImportJob, MigrationEntity, MigrationImportChunk, MigrationMode,
    MigrationProvider, ThreeLayerPostingContract,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
struct LargeStagingJobRow {
    id: String,
    tenant_id: String,
    branch_id: String,
    source_file_id: String,
    source_type: String,
    entity: String,
    mode: String,
    chunk_size: i32,
    allow_partial_import: bool,
    mapping_json: Value,
    duplicate_decisions_json: Value,
    analysis_json: Value,
    transformation_version: String,
    created_by: String,
}

pub struct LargeStagingJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub source_file_id: String,
    pub source_provider: MigrationProvider,
    pub source_sheet: String,
    pub header_source_sheet: String,
    pub entity: MigrationEntity,
    pub mode: MigrationMode,
    pub chunk_size: i32,
    pub allow_partial_import: bool,
    pub mapping_json: Value,
    pub duplicate_decisions_json: Value,
    pub posting_contract: Option<ThreeLayerPostingContract>,
    pub transformation_version: String,
    pub created_by: String,
}

#[derive(Debug, FromRow)]
struct ClaimedChunkRow {
    chunk_id: String,
    chunk_number: i32,
    checksum: String,
    start_offset: i64,
    id: String,
    tenant_id: String,
    branch_id: String,
    entity: String,
    total_rows: i32,
    created_by: String,
    rows_json: Value,
}

pub struct ClaimedLargeChunk {
    pub chunk_id: String,
    pub chunk_number: i32,
    pub checksum: String,
    pub job: ClaimedImportJob,
    pub start: usize,
    pub end: usize,
    pub rows: Value,
}

#[derive(Debug, FromRow)]
struct ChunkRow {
    id: String,
    chunk_number: i32,
    source_sheet: String,
    source_row_start: i32,
    source_row_end: i32,
    total_rows: i32,
    ready_rows: i32,
    error_rows: i32,
    status: String,
    checksum: String,
    processed_rows: i32,
    attempts: i32,
    worker_id: String,
    heartbeat_at: Option<DateTime<Utc>>,
    last_error: String,
    updated_at: DateTime<Utc>,
}

pub async fn create_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    source_file_id: &str,
    entity: MigrationEntity,
    mode: MigrationMode,
    file_name: &str,
    source_hash: &str,
    source_provider: MigrationProvider,
    source_sheet: &str,
    header_source_sheet: &str,
    chunk_size: i32,
    allow_partial_import: bool,
    mapping_id: Option<&str>,
    mapping: &Value,
    duplicate_decisions: &Value,
    transformation_version: &str,
    posting_contract: Option<&ThreeLayerPostingContract>,
    actor: &str,
) -> Result<ImportJob, sqlx::Error> {
    let mut tx = db.begin().await?;
    let posting_contract_json = json!(posting_contract);
    let row = sqlx::query_as::<_, super::migration_repository::ImportJobRow>(&format!(
        "INSERT INTO integration_import_jobs(tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,source_file_id,chunk_size,allow_partial_import,mapping_id,mapping_json,duplicate_decisions_json,analysis_json,worker_phase,created_by,owner_user_id,approval_status,approval_requested_at) VALUES($1,$2,$3,$4,$5,'staging',$6,$7,$8,$9,$10,$11,$12,$13,JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT('transformationVersion',$14,'postingContract',$15,'headerSourceSheet',NULLIF($16,''))),'staging',$17,$17,CASE WHEN $5='commit' THEN 'pending' ELSE 'not_required' END,CASE WHEN $5='commit' THEN NOW() ELSE NULL END) RETURNING {}",
        super::migration_repository::COLUMNS
    ))
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(file_name)
    .bind(mode.as_str())
    .bind(source_hash)
    .bind(format!("{}|{}", source_provider.as_str(), source_sheet))
    .bind(source_file_id)
    .bind(chunk_size)
    .bind(allow_partial_import)
    .bind(mapping_id)
    .bind(mapping)
    .bind(duplicate_decisions)
    .bind(transformation_version)
    .bind(posting_contract_json)
    .bind(header_source_sheet)
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
    } else {
        sqlx::query("UPDATE integration_import_jobs SET transformer_versions_json=JSONB_BUILD_OBJECT('rowTransformer',$2) WHERE id=$1")
            .bind(&row.id).bind(transformation_version).execute(&mut *tx).await?;
    }
    if mode == MigrationMode::Commit {
        super::migration_repository::sync_job_dependencies(
            &mut tx,
            tenant,
            branch,
            &row.id,
            entity,
            source_hash,
        )
        .await?;
    }
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.large_job.created','success',$4,$5)")
        .bind(tenant).bind(branch).bind(&row.id).bind(actor)
        .bind(json!({"sourceFileId":source_file_id,"sourceHash":source_hash,"sourceProvider":source_provider,"sourceSheet":source_sheet,"headerSourceSheet":header_source_sheet,"entity":entity,"mode":mode,"postingContract":posting_contract,"chunkSize":chunk_size,"allowPartialImport":allow_partial_import,"transformationVersion":transformation_version}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    super::migration_repository::into_import_job(row)
}

pub async fn claim_staging_job(
    db: &PgPool,
    worker_id: &str,
    transformation_version: &str,
) -> Result<Option<LargeStagingJob>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, LargeStagingJobRow>(
        r#"SELECT id,tenant_id,branch_id,source_file_id,source_type,entity,mode,chunk_size,
                   allow_partial_import,mapping_json,duplicate_decisions_json,analysis_json,
                  COALESCE(NULLIF(analysis_json->>'transformationVersion',''),$1) transformation_version,
                  created_by
           FROM integration_import_jobs
           WHERE source_file_id IS NOT NULL AND worker_phase='staging'
             AND (status='staging' OR (status='processing' AND lease_expires_at<NOW()))
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"#,
    )
    .bind(transformation_version)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query(
        "DELETE FROM integration_import_chunks WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3",
    )
    .bind(&row.tenant_id)
    .bind(&row.branch_id)
    .bind(&row.id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM integration_import_projection_state WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3")
        .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3")
        .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.id).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_jobs SET status='processing',worker_id=$4,heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',source_row_count=0,valid_row_count=0,error_row_count=0,warning_row_count=0,duplicate_row_count=0,total_rows=0,processed_rows=0,next_row=0,total_chunks=0,completed_chunks=0,failed_chunks=0,errors_json='[]'::JSONB,last_error='',analysis_json=(COALESCE(analysis_json,'{}'::JSONB)-'yellowApproval')||JSONB_BUILD_OBJECT('transformationVersion',$5),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.id).bind(worker_id).bind(&row.transformation_version).execute(&mut *tx).await?;
    tx.commit().await?;
    let (provider, source_sheet) = row.source_type.split_once('|').unwrap_or(("auto", ""));
    let posting_contract = row
        .analysis_json
        .get("postingContract")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| decode_error(error.to_string()))?;
    Ok(Some(LargeStagingJob {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        source_file_id: row.source_file_id,
        source_provider: MigrationProvider::try_from(provider).map_err(decode_error)?,
        source_sheet: source_sheet.to_string(),
        header_source_sheet: row
            .analysis_json
            .get("headerSourceSheet")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        entity: MigrationEntity::try_from(row.entity.as_str()).map_err(decode_error)?,
        mode: MigrationMode::try_from(row.mode.as_str()).map_err(decode_error)?,
        chunk_size: row.chunk_size,
        allow_partial_import: row.allow_partial_import,
        mapping_json: row.mapping_json,
        duplicate_decisions_json: row.duplicate_decisions_json,
        posting_contract,
        transformation_version: row.transformation_version,
        created_by: row.created_by,
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn stage_chunk(
    db: &PgPool,
    job: &LargeStagingJob,
    worker_id: &str,
    chunk_number: i32,
    source_sheet: &str,
    source_row_start: i32,
    source_row_end: i32,
    checksum: &str,
    staging_rows: &Value,
    projection_state: &Value,
    ready_rows: i32,
    error_rows: i32,
    warning_rows: i32,
    duplicate_rows: i32,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let active: bool = sqlx::query_scalar("SELECT status='processing' AND worker_phase='staging' AND worker_id=$4 FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(worker_id)
        .fetch_optional(&mut *tx).await?.unwrap_or(false);
    if !active {
        tx.rollback().await?;
        return Ok(false);
    }
    let total_rows = staging_rows.as_array().map_or(0, |rows| rows.len() as i32);
    let chunk_id: String = sqlx::query_scalar("INSERT INTO integration_import_chunks(tenant_id,branch_id,job_id,chunk_number,source_sheet,source_row_start,source_row_end,total_rows,ready_rows,error_rows,status,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'staged',$11) RETURNING id")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(chunk_number)
        .bind(source_sheet).bind(source_row_start).bind(source_row_end).bind(total_rows)
        .bind(ready_rows).bind(error_rows).bind(checksum).fetch_one(&mut *tx).await?;
    sqlx::query(
        r#"INSERT INTO integration_import_staging_rows(
             tenant_id,branch_id,job_id,chunk_id,source_sheet,source_row_number,
             source_external_id,source_key,status,ready,error_code,message,warnings_json,payload_json)
           SELECT $1,$2,$3,$4,$5,row.source_row_number,NULLIF(row.source_external_id,''),
                  NULLIF(row.source_key,''),row.status,row.ready,row.error_code,row.message,row.warnings,row.source_payload
           FROM JSONB_TO_RECORDSET($6::JSONB) AS row(
             source_row_number INTEGER,source_external_id TEXT,source_key TEXT,status TEXT,ready BOOLEAN,
             error_code TEXT,message TEXT,warnings JSONB,source_payload JSONB)"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(&chunk_id)
    .bind(source_sheet)
    .bind(staging_rows)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO integration_import_projection_state(
             tenant_id,branch_id,job_id,projection_key,balance)
           SELECT $1,$2,$3,entry.key,entry.value::BIGINT
           FROM JSONB_EACH_TEXT($4::JSONB) entry
           ON CONFLICT(job_id,projection_key) DO UPDATE SET
             balance=EXCLUDED.balance,updated_at=NOW()"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(projection_state)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO integration_import_row_results(
             tenant_id,branch_id,job_id,entity,source_sheet,source_row_number,
             source_external_id,status,error_code,message,warnings_json,
             duplicate_target_id,duplicate_decision,source_payload,retry_eligible,quarantined_at)
           SELECT $1,$2,$3,$4,$5,row.source_row_number,NULLIF(row.source_external_id,''),
                  CASE WHEN row.status='error' THEN 'quarantined' WHEN row.status='warning' THEN 'approval_required' ELSE row.status END,row.error_code,row.message,row.warnings,
                  NULLIF(row.duplicate_target_id,''),row.duplicate_decision,row.source_payload,
                  row.status='error',CASE WHEN row.status='error' THEN NOW() ELSE NULL END
           FROM JSONB_TO_RECORDSET($6::JSONB) AS row(
             source_row_number INTEGER,source_external_id TEXT,status TEXT,ready BOOLEAN,
             error_code TEXT,message TEXT,warnings JSONB,duplicate_target_id TEXT,
             duplicate_decision TEXT,source_payload JSONB)"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .bind(job.entity.as_str())
    .bind(source_sheet)
    .bind(staging_rows)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE integration_import_jobs SET source_row_count=source_row_count+$4,valid_row_count=valid_row_count+$5,error_row_count=error_row_count+$6,warning_row_count=warning_row_count+$7,duplicate_row_count=duplicate_row_count+$8,total_chunks=total_chunks+1,heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(total_rows)
        .bind(ready_rows).bind(error_rows).bind(warning_rows).bind(duplicate_rows)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn existing_source_identities(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job_id: &str,
    source_sheet: &str,
    external_ids: &[String],
    source_keys: &[String],
) -> Result<(Vec<String>, Vec<String>), sqlx::Error> {
    let existing_external_ids = sqlx::query_scalar(
        r#"SELECT DISTINCT LOWER(BTRIM(source_external_id))
           FROM integration_import_staging_rows
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_sheet=$4
             AND source_external_id IS NOT NULL
             AND LOWER(BTRIM(source_external_id))=ANY($5::TEXT[])"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(source_sheet)
    .bind(external_ids)
    .fetch_all(db)
    .await?;
    let existing_source_keys = sqlx::query_scalar(
        r#"SELECT DISTINCT source_key
           FROM integration_import_staging_rows
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND source_sheet=$4
             AND source_key=ANY($5::TEXT[])"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(source_sheet)
    .bind(source_keys)
    .fetch_all(db)
    .await?;
    Ok((existing_external_ids, existing_source_keys))
}

pub async fn projection_balance(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job_id: &str,
    projection_key: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT balance FROM integration_import_projection_state WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND projection_key=$4",
    )
    .bind(tenant)
    .bind(branch)
    .bind(job_id)
    .bind(projection_key)
    .fetch_optional(db)
    .await
}

pub async fn finish_staging(db: &PgPool, job: &LargeStagingJob) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let counts: Option<(i32, i32, String)> = sqlx::query_as("SELECT source_row_count,error_row_count,approval_status FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='processing' AND worker_phase='staging' FOR UPDATE")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).fetch_optional(&mut *tx).await?;
    let Some((source_rows, error_rows, approval_status)) = counts else {
        tx.rollback().await?;
        return Ok(());
    };
    let dependency_pending_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='dependency_pending'",
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .fetch_one(&mut *tx)
    .await?;
    let unmet_dependencies: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM integration_import_job_dependencies dependency
             JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id
             WHERE dependency.tenant_id=$1 AND dependency.branch_id=$2 AND dependency.job_id=$3
               AND (required.tenant_id<>$1 OR required.branch_id<>$2 OR required.status<>'completed'))"#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .fetch_one(&mut *tx)
    .await?;
    let status = if source_rows == 0 || error_rows > 0 && !job.allow_partial_import {
        "failed"
    } else if job.mode == MigrationMode::DryRun {
        "validated"
    } else if dependency_pending_rows > 0 || unmet_dependencies {
        "dependency_pending"
    } else if approval_status == "approved" {
        "queued"
    } else {
        "validated"
    };
    if status == "queued" {
        sqlx::query("UPDATE integration_import_chunks SET status=CASE WHEN ready_rows>0 THEN 'pending' ELSE 'completed' END,completed_at=CASE WHEN ready_rows=0 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).execute(&mut *tx).await?;
    }
    let last_error = if source_rows == 0 {
        "source contains no data rows"
    } else if error_rows > 0 && !job.allow_partial_import {
        "staging validation failed; partial import is disabled"
    } else if status == "dependency_pending" {
        "DEPENDENCY_PENDING"
    } else {
        ""
    };
    sqlx::query("UPDATE integration_import_jobs SET status=$4,worker_phase=CASE WHEN $4='queued' THEN 'import' ELSE worker_phase END,total_rows=valid_row_count,completed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$3 AND status='completed'),worker_id='',lease_expires_at=NULL,last_error=$5,analysis_json=COALESCE(analysis_json,'{}'::JSONB)||JSONB_BUILD_OBJECT('sourceRows',source_row_count,'readyRows',valid_row_count,'errorRows',error_row_count,'dependencyPendingRows',$6,'warningRows',warning_row_count,'duplicateRows',duplicate_row_count,'partialImportAllowed',allow_partial_import,'dependencyRuleVersion','2026-07-phase8-v1'),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(status).bind(last_error).bind(dependency_pending_rows).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.staging.completed',$4,$5,$6)")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id)
        .bind(if status == "failed" { "failure" } else { "success" }).bind(&job.created_by)
        .bind(json!({"status":status,"sourceRows":source_rows,"errorRows":error_rows,"dependencyPendingRows":dependency_pending_rows,"unmetDependencies":unmet_dependencies,"allowPartialImport":job.allow_partial_import}))
        .execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn fail_staging(
    db: &PgPool,
    job: &LargeStagingJob,
    message: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_import_jobs SET status='failed',worker_id='',lease_expires_at=NULL,last_error=$4,failed_chunks=failed_chunks+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='processing'")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(message).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.staging.failed','failure',$4,$5)")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(&job.created_by)
        .bind(json!({"message":message})).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn claim_chunk(
    db: &PgPool,
    worker_id: &str,
) -> Result<Option<ClaimedLargeChunk>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, ClaimedChunkRow>(
        r#"WITH due AS (
             SELECT chunk.id FROM integration_import_chunks chunk
             JOIN integration_import_jobs job ON job.id=chunk.job_id
             WHERE job.worker_phase='import' AND job.status IN ('queued','processing')
               AND (job.mode<>'commit' OR (
                 job.approval_status='approved' AND job.approval_decided_at IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM integration_import_row_results result WHERE result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id AND result.job_id=job.id AND (
                   (NOT job.allow_partial_import AND result.status IN ('error','quarantined','failed'))
                   OR result.status='dependency_pending'
                   OR (result.status='duplicate' AND COALESCE(result.duplicate_decision,'') NOT IN ('merge','keep','link'))))
                 AND (job.warning_row_count=0 OR ((job.analysis_json->'yellowApproval'->>'approved')='true' AND COALESCE((job.analysis_json->'yellowApproval'->>'warningRows')::INTEGER,-1)=job.warning_row_count))
               ))
               AND NOT EXISTS(
                 SELECT 1 FROM integration_import_job_dependencies dependency
                 JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id
                 WHERE dependency.job_id=job.id
                   AND (dependency.tenant_id<>job.tenant_id OR dependency.branch_id<>job.branch_id
                     OR required.tenant_id<>job.tenant_id OR required.branch_id<>job.branch_id
                     OR required.status<>'completed')
               )
               AND (chunk.status='pending' OR (chunk.status='processing' AND chunk.lease_expires_at<NOW()))
             ORDER BY job.created_at,chunk.chunk_number FOR UPDATE OF chunk SKIP LOCKED LIMIT 1
           ), claimed AS (
             UPDATE integration_import_chunks chunk SET status='processing',worker_id=$1,
               heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',attempts=attempts+1,
               started_at=COALESCE(started_at,NOW()),last_error='',updated_at=NOW()
             FROM due WHERE chunk.id=due.id RETURNING chunk.*
           )
           SELECT claimed.id chunk_id,claimed.chunk_number,claimed.checksum,job.id,job.tenant_id,job.branch_id,
                  job.entity,job.total_rows,job.created_by,
                  COALESCE((SELECT SUM(previous.ready_rows) FROM integration_import_chunks previous
                    WHERE previous.job_id=job.id AND previous.chunk_number<claimed.chunk_number),0)::BIGINT start_offset,
                  COALESCE((SELECT JSONB_AGG(row.payload_json||JSONB_BUILD_OBJECT('__migration_source_sheet',row.source_sheet) ORDER BY row.source_row_number)
                    FROM integration_import_staging_rows row WHERE row.chunk_id=claimed.id AND row.ready),'[]'::JSONB) rows_json
           FROM claimed JOIN integration_import_jobs job ON job.id=claimed.job_id"#,
    )
    .bind(worker_id).fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query("UPDATE integration_import_jobs SET status='processing',worker_id=$2,heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=$1")
        .bind(&row.id).bind(worker_id).execute(&mut *tx).await?;
    tx.commit().await?;
    let rows = row.rows_json.as_array().cloned().unwrap_or_default();
    let start = row.start_offset.max(0) as usize;
    let end = start + rows.len();
    Ok(Some(ClaimedLargeChunk {
        chunk_id: row.chunk_id,
        chunk_number: row.chunk_number,
        checksum: row.checksum,
        rows: Value::Array(rows),
        start,
        end,
        job: ClaimedImportJob {
            id: row.id,
            tenant_id: row.tenant_id,
            branch_id: row.branch_id,
            entity: MigrationEntity::try_from(row.entity.as_str()).map_err(decode_error)?,
            rows_json: Value::Array(Vec::new()),
            total_rows: row.total_rows,
            next_row: start as i32,
            created_by: row.created_by,
        },
    }))
}

pub async fn fail_chunk(
    db: &PgPool,
    chunk: &ClaimedLargeChunk,
    message: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_import_chunks SET status='failed',worker_id='',lease_expires_at=NULL,last_error=$2,updated_at=NOW() WHERE id=$1")
        .bind(&chunk.chunk_id).bind(message).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_jobs SET status='failed',worker_id='',lease_expires_at=NULL,failed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$1 AND status='failed'),last_error=$2,updated_at=NOW() WHERE id=$1")
        .bind(&chunk.job.id).bind(message).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_row_results result SET status='failed',retry_eligible=TRUE,last_retry_error=$2,quarantined_at=COALESCE(quarantined_at,NOW()),updated_at=NOW() FROM integration_import_staging_rows staging WHERE staging.chunk_id=$1 AND staging.job_id=result.job_id AND staging.source_sheet=result.source_sheet AND staging.source_row_number=result.source_row_number AND result.status IN ('ready','validated','warning','duplicate')")
        .bind(&chunk.chunk_id).bind(message).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.chunk.failed','failure',$4,$5)")
        .bind(&chunk.job.tenant_id).bind(&chunk.job.branch_id).bind(&chunk.job.id)
        .bind(&chunk.job.created_by).bind(json!({"chunkId":chunk.chunk_id,"chunkNumber":chunk.chunk_number,"message":message}))
        .execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn control_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    action: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let sql = match action {
        "pause" => "UPDATE integration_import_jobs SET status='paused',paused_at=NOW(),worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('staging','queued','processing')",
        "resume" => "UPDATE integration_import_jobs SET status=CASE WHEN worker_phase='staging' THEN 'staging' ELSE 'queued' END,paused_at=NULL,last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='paused'",
        "retry" => "UPDATE integration_import_jobs SET status=CASE WHEN worker_phase='staging' THEN 'staging' ELSE 'queued' END,last_error='',failed_chunks=0,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL AND status='failed'",
        "cancel" => "UPDATE integration_import_jobs SET status='cancelled',cancelled_at=NOW(),worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('staging','dependency_pending','queued','processing','paused','failed')",
        _ => return Ok(false),
    };
    let affected = sqlx::query(sql)
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if affected > 0 {
        if action == "retry" {
            sqlx::query("UPDATE integration_import_chunks SET status='pending',last_error='',worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='failed'")
                .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        } else if action == "cancel" {
            sqlx::query("UPDATE integration_import_chunks SET status='cancelled',worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status IN ('staged','pending','failed')")
                .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,$4,'success',$5,$6)")
            .bind(tenant).bind(branch).bind(id).bind(format!("migration.job.{action}"))
            .bind(actor).bind(json!({"action":action})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(affected > 0)
}

pub async fn list_chunks(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Vec<MigrationImportChunk>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ChunkRow>("SELECT id,chunk_number,source_sheet,source_row_start,source_row_end,total_rows,ready_rows,error_rows,status,checksum,processed_rows,attempts,worker_id,heartbeat_at,last_error,updated_at FROM integration_import_chunks WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 ORDER BY chunk_number")
        .bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    Ok(rows
        .into_iter()
        .map(|row| MigrationImportChunk {
            id: row.id,
            chunk_number: row.chunk_number,
            source_sheet: row.source_sheet,
            source_row_start: row.source_row_start,
            source_row_end: row.source_row_end,
            total_rows: row.total_rows,
            ready_rows: row.ready_rows,
            error_rows: row.error_rows,
            status: row.status,
            checksum: row.checksum,
            processed_rows: row.processed_rows,
            attempts: row.attempts,
            worker_id: row.worker_id,
            heartbeat_at: row.heartbeat_at,
            last_error: row.last_error,
            updated_at: row.updated_at,
        })
        .collect())
}

pub async fn is_large_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn quarantine_records(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    limit: i64,
) -> Result<Option<Value>, sqlx::Error> {
    let job_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    if !job_exists {
        return Ok(None);
    }
    let rows: Vec<QuarantineRow> = sqlx::query_as(
        r#"SELECT source_sheet,source_row_number,status,error_code,message,warnings_json,
                  duplicate_target_id,duplicate_decision,source_payload,correction_payload,
                  retry_eligible,retry_count,last_retry_error,quarantined_at,last_retry_at,updated_at
           FROM integration_import_row_results
           WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3
             AND status IN ('quarantined','failed','dependency_pending')
           ORDER BY source_sheet,source_row_number LIMIT $4"#,
    )
    .bind(tenant).bind(branch).bind(id).bind(limit).fetch_all(db).await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status IN ('quarantined','failed','dependency_pending')",
    ).bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    Ok(Some(json!({
        "records": rows.into_iter().map(quarantine_value).collect::<Vec<_>>(),
        "total": total,
        "limit": limit,
        "truncated": total > limit
    })))
}

pub async fn selective_retry_context(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    source_sheet: &str,
    source_rows: &[i32],
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'jobId',job.id,'entity',job.entity,'mode',job.mode,'status',job.status,
             'ownerUserId',job.owner_user_id,'allowPartialImport',job.allow_partial_import,
             'sourceProvider',SPLIT_PART(job.source_type,'|',1),
             'mapping',job.mapping_json,'duplicateDecisions',job.duplicate_decisions_json,
             'transformationVersion',COALESCE(job.analysis_json->>'transformationVersion',''),
             'pendingRows',(SELECT COUNT(*) FROM integration_import_row_results pending WHERE pending.job_id=job.id AND pending.tenant_id=job.tenant_id AND pending.branch_id=job.branch_id AND pending.status IN ('quarantined','failed','dependency_pending')),
             'rows',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                 'sourceSheet',result.source_sheet,'sourceRowNumber',result.source_row_number,
                 'status',result.status,'retryCount',result.retry_count,
                 'sourceValues',COALESCE(NULLIF(result.correction_payload,'{}'::JSONB),result.source_payload)#>'{__migration_evidence,sourceValues}'
               ) ORDER BY result.source_row_number)
               FROM integration_import_row_results result
               WHERE result.job_id=job.id AND result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id
                 AND result.source_sheet=$4 AND result.source_row_number=ANY($5)
                 AND result.status IN ('quarantined','failed','dependency_pending')),'[]'::JSONB)
           ) FROM integration_import_jobs job
           WHERE job.tenant_id=$1 AND job.branch_id=$2 AND job.id=$3"#,
    )
    .bind(tenant).bind(branch).bind(id).bind(source_sheet).bind(source_rows)
    .fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn stage_selective_retry(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    source_sheet: &str,
    actor: &str,
    approve_partial: bool,
    retry_results: &Value,
    ready_rows: &Value,
    checksum: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let job: Option<(String, String, String)> = sqlx::query_as(
        "SELECT mode,status,owner_user_id FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL FOR UPDATE",
    ).bind(tenant).bind(branch).bind(id).fetch_optional(&mut *tx).await?;
    let Some((mode, status, owner)) = job else {
        tx.rollback().await?;
        return Ok(None);
    };
    if owner != actor
        || !matches!(
            status.as_str(),
            "failed" | "completed" | "validated" | "dependency_pending"
        )
    {
        tx.rollback().await?;
        return Ok(None);
    }
    let retry_count = retry_results.as_array().map_or(0, Vec::len) as i64;
    let ready_count = ready_rows.as_array().map_or(0, Vec::len) as i64;
    sqlx::query(
        r#"UPDATE integration_import_row_results result SET
             status=CASE WHEN retry.ready THEN 'ready' WHEN retry.status='error' THEN 'quarantined' ELSE retry.status END,
             error_code=retry.error_code,message=retry.message,warnings_json=retry.warnings,
             correction_payload=retry.source_payload,retry_eligible=NOT retry.ready,
             retry_count=result.retry_count+1,last_retry_error=CASE WHEN retry.ready THEN '' ELSE COALESCE(NULLIF(retry.message,''),retry.error_code) END,
             quarantined_at=CASE WHEN retry.ready THEN result.quarantined_at ELSE COALESCE(result.quarantined_at,NOW()) END,
             last_retry_at=NOW(),updated_at=NOW()
           FROM JSONB_TO_RECORDSET($4::JSONB) AS retry(
             source_sheet TEXT,source_row_number INTEGER,status TEXT,ready BOOLEAN,error_code TEXT,
             message TEXT,warnings JSONB,source_payload JSONB)
           WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
             AND result.source_sheet=retry.source_sheet AND result.source_row_number=retry.source_row_number
             AND result.status IN ('quarantined','failed','dependency_pending')"#,
    ).bind(tenant).bind(branch).bind(id).bind(retry_results)
    .execute(&mut *tx).await?;
    if mode == "commit" && ready_count > 0 {
        if !approve_partial {
            tx.rollback().await?;
            return Ok(None);
        }
        sqlx::query("UPDATE integration_import_chunks SET status='completed',processed_rows=0,worker_id='',lease_expires_at=NULL,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status IN ('staged','failed')")
            .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        let chunk_number: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(chunk_number),0)+1 FROM integration_import_chunks WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3")
            .bind(tenant).bind(branch).bind(id).fetch_one(&mut *tx).await?;
        let start_row = ready_rows
            .as_array()
            .and_then(|rows| {
                rows.iter()
                    .filter_map(|row| row.get("source_row_number").and_then(Value::as_i64))
                    .min()
            })
            .unwrap_or(2) as i32;
        let end_row = ready_rows
            .as_array()
            .and_then(|rows| {
                rows.iter()
                    .filter_map(|row| row.get("source_row_number").and_then(Value::as_i64))
                    .max()
            })
            .unwrap_or(i64::from(start_row)) as i32;
        let chunk_id: String = sqlx::query_scalar("INSERT INTO integration_import_chunks(tenant_id,branch_id,job_id,chunk_number,source_sheet,source_row_start,source_row_end,total_rows,ready_rows,error_rows,status,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,0,'pending',$9) RETURNING id")
            .bind(tenant).bind(branch).bind(id).bind(chunk_number).bind(source_sheet).bind(start_row).bind(end_row).bind(ready_count as i32).bind(checksum).fetch_one(&mut *tx).await?;
        sqlx::query(
            r#"INSERT INTO integration_import_staging_rows(tenant_id,branch_id,job_id,chunk_id,source_sheet,source_row_number,source_external_id,status,ready,error_code,message,warnings_json,payload_json)
               SELECT $1,$2,$3,$4,$5,row.source_row_number,NULLIF(row.source_external_id,''),'ready',TRUE,'','', '[]'::JSONB,row.payload
               FROM JSONB_TO_RECORDSET($6::JSONB) AS row(source_row_number INTEGER,source_external_id TEXT,payload JSONB)
               ON CONFLICT(job_id,source_sheet,source_row_number) DO UPDATE SET chunk_id=EXCLUDED.chunk_id,status='ready',ready=TRUE,error_code='',message='',warnings_json='[]'::JSONB,payload_json=EXCLUDED.payload_json,updated_at=NOW()"#,
        ).bind(tenant).bind(branch).bind(id).bind(&chunk_id).bind(source_sheet).bind(ready_rows).execute(&mut *tx).await?;
        sqlx::query("UPDATE integration_import_jobs SET status='queued',worker_phase='import',approval_status='approved',approval_decided_at=NOW(),approval_decided_by=$4,total_chunks=total_chunks+1,failed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$3 AND status='failed'),worker_id='',lease_expires_at=NULL,last_error='',completed_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant).bind(branch).bind(id).bind(actor).execute(&mut *tx).await?;
    } else if mode == "dry-run" {
        sqlx::query("UPDATE integration_import_jobs SET status=CASE WHEN $4=$5 THEN 'validated' ELSE 'failed' END,last_error=CASE WHEN $4=$5 THEN '' ELSE 'quarantined rows still require correction' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant).bind(branch).bind(id).bind(ready_count).bind(retry_count).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE integration_import_jobs job SET error_row_count=(SELECT COUNT(*)::INTEGER FROM integration_import_row_results result WHERE result.job_id=job.id AND result.status IN ('quarantined','failed')),warning_row_count=(SELECT COUNT(*)::INTEGER FROM integration_import_row_results result WHERE result.job_id=job.id AND result.status IN ('warning','approval_required')),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.quarantine.retry','success',$4,$5)")
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(json!({"sourceSheet":source_sheet,"selectedRows":retry_count,"readyRows":ready_count,"approvePartial":approve_partial})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(
        json!({"selectedRows":retry_count,"readyRows":ready_count,"quarantinedRows":retry_count-ready_count,"queued":mode=="commit" && ready_count>0}),
    ))
}

#[derive(Debug, FromRow)]
struct QuarantineRow {
    source_sheet: String,
    source_row_number: i32,
    status: String,
    error_code: String,
    message: String,
    warnings_json: Value,
    duplicate_target_id: Option<String>,
    duplicate_decision: String,
    source_payload: Value,
    correction_payload: Value,
    retry_eligible: bool,
    retry_count: i32,
    last_retry_error: String,
    quarantined_at: Option<DateTime<Utc>>,
    last_retry_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
}

fn quarantine_value(row: QuarantineRow) -> Value {
    let evidence = row
        .source_payload
        .pointer("/__migration_evidence")
        .unwrap_or(&Value::Null);
    let field = evidence
        .get("fields")
        .and_then(Value::as_array)
        .and_then(|fields| {
            fields
                .iter()
                .find(|field| {
                    field
                        .get("errors")
                        .and_then(Value::as_array)
                        .is_some_and(|items| !items.is_empty())
                })
                .or_else(|| fields.first())
        });
    let issue = field
        .and_then(|field| field.get("errors"))
        .and_then(Value::as_array)
        .and_then(|items| items.first());
    json!({
        "sourceSheet":row.source_sheet,"sourceRowNumber":row.source_row_number,"state":row.status,
        "originalRow":evidence.get("sourceValues").cloned().unwrap_or(Value::Null),
        "sourceColumn":field.and_then(|value| value.get("sourceField")).and_then(Value::as_str).unwrap_or(""),
        "originalValue":field.and_then(|value| value.get("originalValue")).cloned().unwrap_or(Value::Null),
        "targetField":field.and_then(|value| value.get("targetField")).and_then(Value::as_str).unwrap_or(""),
        "transformation":field.map(|value| format!("{} @ {}",value.get("transformer").and_then(Value::as_str).unwrap_or(""),value.get("transformerVersion").and_then(Value::as_str).unwrap_or(""))).unwrap_or_default(),
        "errorCode":row.error_code,"explanation":row.message,
        "suggestedCorrection":issue.and_then(|value| value.get("suggestedTarget")).and_then(Value::as_str).unwrap_or(""),
        "retryEligible":(row.retry_eligible || matches!(row.status.as_str(),"quarantined"|"failed"|"dependency_pending")) && row.retry_count<10,
        "retryCount":row.retry_count,"lastError":row.last_retry_error,
        "quarantinedAt":row.quarantined_at.unwrap_or(row.updated_at),"lastRetryAt":row.last_retry_at,
        "warnings":row.warnings_json,"existingMatch":row.duplicate_target_id,"duplicateDecision":row.duplicate_decision,
        "correction":row.correction_payload.pointer("/__migration_evidence/sourceValues").cloned().unwrap_or(Value::Null)
    })
}

fn decode_error(error: String) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error,
    )))
}
