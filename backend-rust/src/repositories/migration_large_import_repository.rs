use crate::models::migration::{
    ClaimedImportJob, ImportJob, MigrationEntity, MigrationImportChunk, MigrationMode,
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
    entity: String,
    mode: String,
    chunk_size: i32,
    allow_partial_import: bool,
    mapping_json: Value,
    duplicate_decisions_json: Value,
    created_by: String,
}

pub struct LargeStagingJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub source_file_id: String,
    pub entity: MigrationEntity,
    pub mode: MigrationMode,
    pub chunk_size: i32,
    pub allow_partial_import: bool,
    pub mapping_json: Value,
    pub duplicate_decisions_json: Value,
    pub created_by: String,
}

#[derive(Debug, FromRow)]
struct ClaimedChunkRow {
    chunk_id: String,
    chunk_number: i32,
    checksum: String,
    id: String,
    tenant_id: String,
    branch_id: String,
    entity: String,
    total_rows: i32,
    processed_rows: i32,
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
    chunk_size: i32,
    allow_partial_import: bool,
    mapping_id: Option<&str>,
    mapping: &Value,
    duplicate_decisions: &Value,
    actor: &str,
) -> Result<ImportJob, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, super::migration_repository::ImportJobRow>(&format!(
        "INSERT INTO integration_import_jobs(tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,source_file_id,chunk_size,allow_partial_import,mapping_id,mapping_json,duplicate_decisions_json,worker_phase,created_by,owner_user_id,approval_status,approval_requested_at) VALUES($1,$2,$3,$4,$5,'staging',$6,'server-file',$7,$8,$9,$10,$11,$12,'staging',$13,$13,CASE WHEN $5='commit' THEN 'pending' ELSE 'not_required' END,CASE WHEN $5='commit' THEN NOW() ELSE NULL END) RETURNING {}",
        super::migration_repository::COLUMNS
    ))
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(file_name)
    .bind(mode.as_str())
    .bind(source_hash)
    .bind(source_file_id)
    .bind(chunk_size)
    .bind(allow_partial_import)
    .bind(mapping_id)
    .bind(mapping)
    .bind(duplicate_decisions)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.large_job.created','success',$4,$5)")
        .bind(tenant).bind(branch).bind(&row.id).bind(actor)
        .bind(json!({"sourceFileId":source_file_id,"sourceHash":source_hash,"entity":entity,"mode":mode,"chunkSize":chunk_size,"allowPartialImport":allow_partial_import}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    super::migration_repository::into_import_job(row)
}

pub async fn claim_staging_job(
    db: &PgPool,
    worker_id: &str,
) -> Result<Option<LargeStagingJob>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, LargeStagingJobRow>(
        r#"SELECT id,tenant_id,branch_id,source_file_id,entity,mode,chunk_size,
                  allow_partial_import,mapping_json,duplicate_decisions_json,created_by
           FROM integration_import_jobs
           WHERE source_file_id IS NOT NULL AND worker_phase='staging'
             AND (status='staging' OR (status='processing' AND lease_expires_at<NOW()))
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"#,
    )
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
    sqlx::query("DELETE FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3")
        .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.id).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_jobs SET status='processing',worker_id=$4,heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',source_row_count=0,valid_row_count=0,error_row_count=0,warning_row_count=0,duplicate_row_count=0,total_rows=0,processed_rows=0,next_row=0,total_chunks=0,completed_chunks=0,failed_chunks=0,errors_json='[]'::JSONB,last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.id).bind(worker_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(LargeStagingJob {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        source_file_id: row.source_file_id,
        entity: MigrationEntity::try_from(row.entity.as_str()).map_err(decode_error)?,
        mode: MigrationMode::try_from(row.mode.as_str()).map_err(decode_error)?,
        chunk_size: row.chunk_size,
        allow_partial_import: row.allow_partial_import,
        mapping_json: row.mapping_json,
        duplicate_decisions_json: row.duplicate_decisions_json,
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
             source_external_id,status,ready,error_code,message,warnings_json,payload_json)
           SELECT $1,$2,$3,$4,$5,row.source_row_number,NULLIF(row.source_external_id,''),
                  row.status,row.ready,row.error_code,row.message,row.warnings,row.source_payload
           FROM JSONB_TO_RECORDSET($6::JSONB) AS row(
             source_row_number INTEGER,source_external_id TEXT,status TEXT,ready BOOLEAN,
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
        r#"INSERT INTO integration_import_row_results(
             tenant_id,branch_id,job_id,entity,source_sheet,source_row_number,
             source_external_id,status,error_code,message,warnings_json,
             duplicate_target_id,duplicate_decision,source_payload)
           SELECT $1,$2,$3,$4,$5,row.source_row_number,NULLIF(row.source_external_id,''),
                  row.status,row.error_code,row.message,row.warnings,
                  NULLIF(row.duplicate_target_id,''),row.duplicate_decision,row.source_payload
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

pub async fn finish_staging(db: &PgPool, job: &LargeStagingJob) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let counts: Option<(i32, i32, String)> = sqlx::query_as("SELECT source_row_count,error_row_count,approval_status FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='processing' AND worker_phase='staging' FOR UPDATE")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).fetch_optional(&mut *tx).await?;
    let Some((source_rows, error_rows, approval_status)) = counts else {
        tx.rollback().await?;
        return Ok(());
    };
    let status = if source_rows == 0 || error_rows > 0 && !job.allow_partial_import {
        "failed"
    } else if job.mode == MigrationMode::DryRun {
        "validated"
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
    } else {
        ""
    };
    sqlx::query("UPDATE integration_import_jobs SET status=$4,worker_phase=CASE WHEN $4='queued' THEN 'import' ELSE worker_phase END,total_rows=valid_row_count,completed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$3 AND status='completed'),worker_id='',lease_expires_at=NULL,last_error=$5,analysis_json=JSONB_BUILD_OBJECT('sourceRows',source_row_count,'readyRows',valid_row_count,'errorRows',error_row_count,'warningRows',warning_row_count,'duplicateRows',duplicate_row_count,'partialImportAllowed',allow_partial_import),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id).bind(status).bind(last_error).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,job_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'migration.staging.completed',$4,$5,$6)")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.id)
        .bind(if status == "failed" { "failure" } else { "success" }).bind(&job.created_by)
        .bind(json!({"status":status,"sourceRows":source_rows,"errorRows":error_rows,"allowPartialImport":job.allow_partial_import}))
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
               AND (chunk.status='pending' OR (chunk.status='processing' AND chunk.lease_expires_at<NOW()))
             ORDER BY job.created_at,chunk.chunk_number FOR UPDATE OF chunk SKIP LOCKED LIMIT 1
           ), claimed AS (
             UPDATE integration_import_chunks chunk SET status='processing',worker_id=$1,
               heartbeat_at=NOW(),lease_expires_at=NOW()+INTERVAL '2 minutes',attempts=attempts+1,
               started_at=COALESCE(started_at,NOW()),last_error='',updated_at=NOW()
             FROM due WHERE chunk.id=due.id RETURNING chunk.*
           )
           SELECT claimed.id chunk_id,claimed.chunk_number,claimed.checksum,job.id,job.tenant_id,job.branch_id,
                  job.entity,job.total_rows,job.processed_rows,job.created_by,
                  COALESCE((SELECT JSONB_AGG(row.payload_json ORDER BY row.source_row_number)
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
    let start = row.processed_rows.max(0) as usize;
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

pub async fn complete_chunk(db: &PgPool, chunk: &ClaimedLargeChunk) -> Result<(), sqlx::Error> {
    let processed = chunk.rows.as_array().map_or(0, |rows| rows.len() as i32);
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_import_chunks SET status='completed',processed_rows=$2,worker_id='',heartbeat_at=NOW(),lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(&chunk.chunk_id).bind(processed).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_jobs SET completed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$1 AND status='completed'),failed_chunks=(SELECT COUNT(*)::INTEGER FROM integration_import_chunks WHERE job_id=$1 AND status='failed'),worker_id='',heartbeat_at=NOW(),lease_expires_at=NULL,updated_at=NOW() WHERE id=$1")
        .bind(&chunk.job.id).execute(&mut *tx).await?;
    tx.commit().await
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
        "pause" => "UPDATE integration_import_jobs SET status='paused',paused_at=NOW(),worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL AND status IN ('staging','queued','processing')",
        "resume" => "UPDATE integration_import_jobs SET status=CASE WHEN worker_phase='staging' THEN 'staging' ELSE 'queued' END,paused_at=NULL,last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL AND status='paused'",
        "retry" => "UPDATE integration_import_jobs SET status=CASE WHEN worker_phase='staging' THEN 'staging' ELSE 'queued' END,last_error='',failed_chunks=0,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL AND status='failed'",
        "cancel" => "UPDATE integration_import_jobs SET status='cancelled',cancelled_at=NOW(),worker_id='',lease_expires_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND source_file_id IS NOT NULL AND status IN ('staging','queued','processing','paused','failed')",
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

fn decode_error(error: String) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error,
    )))
}
