use crate::{
    models::migration::{
        ClaimedImportJob, ImportJob, MigrationEntity, MigrationJobStatus, MigrationMapping,
        MigrationMode, MigrationRecoveryReport,
    },
    repositories::{clients_repository, staff_hr_repository},
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
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
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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

pub(crate) const COLUMNS: &str = "id,entity,file_name,mode,status,source_hash,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,errors_json,mapping_json,analysis_json,recovery_json,total_rows,processed_rows,next_row,last_error,source_file_id,chunk_size,allow_partial_import,worker_phase,worker_id,heartbeat_at,total_chunks,completed_chunks,failed_chunks,created_at,updated_at,completed_at,rolled_back_at";

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
        "INSERT INTO integration_import_jobs(tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,rows_json,errors_json,total_rows,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,mapping_id,mapping_json,analysis_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'csv',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING {COLUMNS}"
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

    if !row_results.as_array().is_none_or(Vec::is_empty) {
        sqlx::query(
            r#"
            INSERT INTO integration_import_row_results(
              tenant_id,branch_id,job_id,entity,source_sheet,source_row_number,
              source_external_id,status,error_code,message,warnings_json,
              duplicate_target_id,duplicate_decision,source_payload
            )
            SELECT $1,$2,$3,$4,'csv',result.source_row_number,
                   NULLIF(result.source_external_id,''),result.status,
                   result.error_code,result.message,result.warnings,
                   NULLIF(result.duplicate_target_id,''),result.duplicate_decision,
                   result.source_payload
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
    actor: &str,
) -> Result<MigrationMapping, sqlx::Error> {
    let row = sqlx::query_as::<_, MigrationMappingRow>(
        r#"INSERT INTO integration_import_mappings(
             tenant_id,branch_id,entity,name,mapping_json,source_columns_json,created_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(tenant_id,branch_id,entity,(LOWER(name))) DO UPDATE SET
             mapping_json=EXCLUDED.mapping_json,source_columns_json=EXCLUDED.source_columns_json,
             created_by=EXCLUDED.created_by,updated_at=NOW()
           RETURNING id,name,entity,mapping_json,source_columns_json,created_at,updated_at"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(entity.as_str())
    .bind(name)
    .bind(mapping)
    .bind(source_columns)
    .bind(actor)
    .fetch_one(db)
    .await?;
    into_mapping(row)
}

pub async fn list_mappings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<MigrationMapping>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MigrationMappingRow>(
        "SELECT id,name,entity,mapping_json,source_columns_json,created_at,updated_at FROM integration_import_mappings WHERE tenant_id=$1 AND branch_id=$2 ORDER BY updated_at DESC LIMIT 200",
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
        "SELECT id,name,entity,mapping_json,source_columns_json,created_at,updated_at FROM integration_import_mappings WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await?;
    row.map(into_mapping).transpose()
}

pub async fn find_client_duplicate(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    normalized_phone: &str,
) -> Result<Option<(String, Value)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,TO_JSONB(client) FROM clients client WHERE tenant_id=$1 AND branch_id=$2 AND normalized_phone=$3 AND merged_into_client_id IS NULL ORDER BY created_at,id LIMIT 1",
    )
    .bind(tenant)
    .bind(branch)
    .bind(normalized_phone)
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
        "WITH due AS(SELECT id FROM integration_import_jobs WHERE status='queued' AND source_file_id IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE integration_import_jobs job SET status='processing',updated_at=NOW() FROM due WHERE job.id=due.id RETURNING job.id,job.tenant_id,job.branch_id,job.entity,job.rows_json,job.total_rows,job.next_row,job.created_by",
    )
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    row.map(into_claimed_job).transpose()
}

pub async fn apply_batch(
    db: &PgPool,
    job: &ClaimedImportJob,
    batch: &Value,
    start: usize,
    end: usize,
) -> Result<(), sqlx::Error> {
    let batch_number = (start / 100 + 1) as i32;
    apply_batch_numbered(db, job, batch, batch_number, start, end).await
}

pub async fn apply_batch_numbered(
    db: &PgPool,
    job: &ClaimedImportJob,
    batch: &Value,
    batch_number: i32,
    start: usize,
    end: usize,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let active: bool = sqlx::query_scalar(
        "SELECT status='processing' FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    if !active {
        return Err(sqlx::Error::RowNotFound);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!(
            "migration:{}:{}:{}",
            job.tenant_id,
            job.branch_id,
            job.entity.as_str()
        ))
        .execute(&mut *tx)
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
                mark_row_action(
                    &mut tx,
                    job,
                    &batch_id,
                    line,
                    "kept",
                    target_id,
                    &Value::Object(Default::default()),
                )
                .await?;
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
                }
                merged_rows += 1;
            }
            _ => {
                write_rows.push(row.clone());
                if job.entity == MigrationEntity::Inventory {
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
                   SET status='created',action='created',batch_id=$4,target_id=target.id,updated_at=NOW()
                   FROM clients target
                   WHERE result.tenant_id=$1 AND result.branch_id=$2 AND result.job_id=$3
                     AND target.tenant_id=$1 AND target.branch_id=$2 AND target.import_job_id=$3
                     AND target.normalized_phone=result.source_payload->>'normalized_phone'
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
        _ => {}
    }

    let imported_rows = created_rows + merged_rows + linked_rows;
    let processed_rows = (end - start) as i32;
    sqlx::query("UPDATE integration_import_batches SET status='completed',processed_rows=$2,imported_rows=$3,error_rows=0,last_error='',completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$4 AND branch_id=$5 AND id=$1")
        .bind(&batch_id).bind(processed_rows).bind(imported_rows).bind(&job.tenant_id).bind(&job.branch_id).execute(&mut *tx).await?;
    let completed = end >= job.total_rows as usize;
    sqlx::query("UPDATE integration_import_jobs SET status=CASE WHEN $2 THEN 'completed' ELSE 'queued' END,processed_rows=$3,next_row=$3,last_error='',completed_at=CASE WHEN $2 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$4 AND branch_id=$5 AND id=$1")
        .bind(&job.id).bind(completed).bind(end as i32).bind(&job.tenant_id).bind(&job.branch_id).execute(&mut *tx).await?;
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

async fn master_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    target_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let sql = match entity {
        MigrationEntity::Services => "SELECT TO_JSONB(record) FROM services record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        MigrationEntity::Products => "SELECT TO_JSONB(record) FROM inventory_items record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        MigrationEntity::Suppliers => "SELECT TO_JSONB(record) FROM suppliers record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        MigrationEntity::Memberships => "SELECT TO_JSONB(record) FROM memberships record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        MigrationEntity::Packages => "SELECT TO_JSONB(record) FROM packages record WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
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
    let snapshot: Value = sqlx::query_scalar(
        "SELECT JSONB_BUILD_OBJECT('stock_quantity',stock_quantity,'unit_cost_paise',unit_cost_paise,'updated_at',updated_at) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    ).bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).fetch_one(&mut **tx).await?;
    let quantity = row
        .get("opening_stock")
        .and_then(Value::as_i64)
        .ok_or(sqlx::Error::RowNotFound)? as i32;
    let unit_cost = row
        .get("unit_cost_paise")
        .and_then(Value::as_i64)
        .ok_or(sqlx::Error::RowNotFound)?;
    let stock_after: i32 = sqlx::query_scalar(
        "UPDATE inventory_items SET stock_quantity=stock_quantity+$4,unit_cost_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING stock_quantity",
    ).bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(quantity).bind(unit_cost).fetch_one(&mut **tx).await?;
    let ledger_id: String = sqlx::query_scalar(
        r#"INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,adjustment_reason,adjustment_idempotency_key)
           VALUES($1,$2,$3,NULL,NULL,'adjustment',$4,$5,$6,'Migration opening stock',$7) RETURNING id"#,
    ).bind(&job.tenant_id).bind(&job.branch_id).bind(item_id).bind(quantity).bind(unit_cost).bind(stock_after)
     .bind(format!("migration:{}:{}:opening-stock", job.id, line)).fetch_one(&mut **tx).await?;
    mark_row_action(
        tx,
        job,
        batch_id,
        line,
        "merged",
        item_id,
        &json!({"record":snapshot,"ledgerId":ledger_id}),
    )
    .await
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
    let affected = sqlx::query("UPDATE integration_import_jobs SET status='queued',last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='failed' AND errors_json='[]'::JSONB AND mode='commit'")
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
    let delete_sql = match entity.as_str() {
        "clients" => Some("DELETE FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "staff" => Some("DELETE FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "services" => Some("DELETE FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "products" => Some("DELETE FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "suppliers" => Some("DELETE FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "memberships" => Some("DELETE FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "packages" => Some("DELETE FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "inventory" => None,
        _ => return Err(sqlx::Error::RowNotFound),
    };
    let deleted = match delete_sql {
        Some(sql) => sqlx::query(sql)
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .execute(&mut *tx)
            .await?
            .rows_affected(),
        None => 0,
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
                restore_master_snapshot(&mut tx, tenant, branch, &entity, &target_id, &snapshot)
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
    let rolled_back = sqlx::query("UPDATE integration_import_row_results SET status='rolled_back',recovery_action=CASE action WHEN 'created' THEN 'deleted' WHEN 'merged' THEN 'restored' WHEN 'linked' THEN 'unlinked' WHEN 'kept' THEN 'none' ELSE recovery_action END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action<>''")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?.rows_affected() as i64;
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'")
        .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
    let report = MigrationRecoveryReport {
        job_id: id.to_string(),
        deleted_rows: deleted as i64,
        restored_rows: restored,
        linked_rows: linked,
        kept_rows: kept,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
    };
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
    snapshot: &Value,
) -> Result<(), sqlx::Error> {
    if entity == MigrationEntity::Inventory.as_str() {
        if let Some(ledger_id) = snapshot.get("ledgerId").and_then(Value::as_str) {
            sqlx::query(
                "DELETE FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(tenant)
            .bind(branch)
            .bind(ledger_id)
            .execute(&mut **tx)
            .await?;
        }
        let affected = sqlx::query(
            r#"UPDATE inventory_items SET stock_quantity=($4->'record'->>'stock_quantity')::INTEGER,
                 unit_cost_paise=($4->'record'->>'unit_cost_paise')::BIGINT,
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
    Ok(MigrationMapping {
        id: row.id,
        name: row.name,
        entity: decode_enum("mapping entity", &row.entity)?,
        mapping,
        source_columns,
        created_at: row.created_at,
        updated_at: row.updated_at,
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

        let report = rollback_job(&pool, "tenant-1", "branch-1", &job.id, "owner-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(report.deleted_rows, 0);
        assert_eq!(report.restored_rows, 1);
        assert_eq!(report.linked_rows, 1);
        assert_eq!(report.kept_rows, 1);
        assert_eq!(report.rolled_back_rows, 3);
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
    }
}
