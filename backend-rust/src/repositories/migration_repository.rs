use crate::{
    models::migration::{
        ClaimedImportJob, ImportJob, MigrationAlias, MigrationEntity, MigrationJobStatus,
        MigrationMapping, MigrationMappingApproval, MigrationMode, MigrationProvider,
        MigrationRecoveryReport,
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
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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

pub(crate) const COLUMNS: &str = "id,entity,file_name,mode,status,source_hash,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,errors_json,mapping_json,analysis_json,recovery_json,total_rows,processed_rows,next_row,last_error,source_file_id,chunk_size,allow_partial_import,worker_phase,worker_id,heartbeat_at,total_chunks,completed_chunks,failed_chunks,owner_user_id,approval_status,approval_requested_at,approval_decided_at,approval_decided_by,approval_note,created_at,updated_at,completed_at,rolled_back_at";

#[derive(Debug, PartialEq, Eq)]
pub struct MigrationMonitoringCounts {
    pub status_counts: BTreeMap<String, i64>,
    pub queue_depth: i64,
    pub stale_workers: i64,
    pub failed_24h: i64,
    pub overdue_approvals: i64,
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
        "INSERT INTO integration_import_jobs(tenant_id,branch_id,entity,file_name,mode,status,source_hash,source_type,rows_json,errors_json,total_rows,source_row_count,valid_row_count,error_row_count,warning_row_count,duplicate_row_count,mapping_id,mapping_json,analysis_json,created_by,owner_user_id,approval_status,approval_requested_at,approval_decided_at,approval_decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,'csv',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,CASE WHEN $5='commit' AND $6='validated' THEN 'pending' WHEN $5='commit' THEN 'approved' ELSE 'not_required' END,CASE WHEN $5='commit' THEN NOW() ELSE NULL END,CASE WHEN $5='commit' AND $6<>'validated' THEN NOW() ELSE NULL END,CASE WHEN $5='commit' AND $6<>'validated' THEN $19 ELSE NULL END) RETURNING {COLUMNS}"
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

fn dependency_phase(entity: MigrationEntity) -> i32 {
    match entity {
        MigrationEntity::Clients
        | MigrationEntity::Staff
        | MigrationEntity::Services
        | MigrationEntity::Products
        | MigrationEntity::Suppliers
        | MigrationEntity::Memberships
        | MigrationEntity::Packages => 0,
        MigrationEntity::Inventory
        | MigrationEntity::ClientMemberships
        | MigrationEntity::GiftCards
        | MigrationEntity::Loyalty
        | MigrationEntity::Payroll
        | MigrationEntity::ClientNotes
        | MigrationEntity::Files
        | MigrationEntity::StockMovements => 1,
        MigrationEntity::Appointments | MigrationEntity::PurchaseBills => 2,
        MigrationEntity::Sales | MigrationEntity::Invoices | MigrationEntity::Expenses => 3,
        MigrationEntity::Payments | MigrationEntity::Commissions => 4,
        MigrationEntity::Refunds => 5,
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
    let phase = dependency_phase(entity);
    for (related_id, related_entity) in related {
        let related_entity = decode_enum::<MigrationEntity>(&related_entity, "entity")?;
        let related_phase = dependency_phase(related_entity);
        let (dependent, prerequisite) = if phase > related_phase {
            (job_id, related_id.as_str())
        } else if related_phase > phase {
            (related_id.as_str(), job_id)
        } else {
            continue;
        };
        sqlx::query(
            "INSERT INTO integration_import_job_dependencies(tenant_id,branch_id,job_id,depends_on_job_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        )
        .bind(tenant)
        .bind(branch)
        .bind(dependent)
        .bind(prerequisite)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
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
    let (queue_depth, stale_workers, failed_24h, overdue_approvals) =
        sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT
                COUNT(*) FILTER (WHERE status IN ('staging','queued')),
                COUNT(*) FILTER (WHERE status IN ('staging','processing') AND COALESCE(heartbeat_at,updated_at) < NOW() - INTERVAL '5 minutes'),
                COUNT(*) FILTER (WHERE status='failed' AND updated_at >= NOW() - INTERVAL '24 hours'),
                COUNT(*) FILTER (WHERE approval_status='pending' AND approval_requested_at < NOW() - INTERVAL '30 minutes')
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
    let job = sqlx::query_as::<_, (String, String, Option<String>, String)>(
        "SELECT status,worker_phase,source_file_id,owner_user_id FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status='pending' FOR UPDATE",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((status, worker_phase, source_file_id, owner)) = job else {
        tx.rollback().await?;
        return Ok(false);
    };
    if owner != actor {
        tx.rollback().await?;
        return Ok(false);
    }

    if approved {
        if source_file_id.is_some() && status == "validated" && worker_phase == "staging" {
            sqlx::query("UPDATE integration_import_chunks SET status=CASE WHEN ready_rows>0 THEN 'pending' ELSE 'completed' END,completed_at=CASE WHEN ready_rows=0 THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='staged'")
                .bind(tenant).bind(branch).bind(id).execute(&mut *tx).await?;
        }
        sqlx::query(
            "UPDATE integration_import_jobs SET approval_status='approved',approval_decided_at=NOW(),approval_decided_by=$4,approval_note=$5,status=CASE WHEN status='validated' THEN 'queued' ELSE status END,worker_phase=CASE WHEN source_file_id IS NOT NULL AND status='validated' THEN 'import' ELSE worker_phase END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(note)
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
    Ok(Some(json!({
        "jobId": id,
        "entity": entity,
        "jobStatus": status,
        "safeToRollback": status == "completed" && blocking == 0,
        "actions": {"wouldDelete":created,"wouldRestore":merged,"wouldUnlink":linked,"noChange":kept},
        "dependencies": dependencies
    })))
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
             'sourceHash',source_hash,'sourceFileId',source_file_id,'ownerUserId',owner_user_id,
             'approvalStatus',approval_status,'approvalRequestedAt',approval_requested_at,
             'approvalDecidedAt',approval_decided_at,'approvalDecidedBy',approval_decided_by,'approvalNote',approval_note,
             'lastError',last_error,'failedChunks',failed_chunks,'heartbeatAt',heartbeat_at,
             'expected',JSONB_BUILD_OBJECT('sourceRows',source_row_count,'validRows',valid_row_count,'errorRows',error_row_count,'warningRows',warning_row_count,'duplicateRows',duplicate_row_count),
             'processedRows',processed_rows,'totalRows',total_rows,'createdAt',created_at,'completedAt',completed_at,'rolledBackAt',rolled_back_at)
           FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    ).bind(tenant).bind(branch).bind(id).fetch_optional(db).await?;
    let Some(job) = job else {
        return Ok(None);
    };
    let actual: Value = sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
             'created',COUNT(*) FILTER(WHERE action='created'),'merged',COUNT(*) FILTER(WHERE action='merged'),
             'linked',COUNT(*) FILTER(WHERE action='linked'),'kept',COUNT(*) FILTER(WHERE action='kept'),
             'failed',COUNT(*) FILTER(WHERE status='error' OR error_code<>''),
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
    let impact = rollback_impact(db, tenant, branch, id)
        .await?
        .unwrap_or_else(|| json!({}));
    let financial: Value =
        sqlx::query_scalar("SELECT migration_import_financial_reconciliation($1,$2,$3)")
            .bind(tenant)
            .bind(branch)
            .bind(id)
            .fetch_one(db)
            .await?;
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
    let expected_valid = job
        .pointer("/expected/validRows")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let processed = job
        .get("processedRows")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let failed = actual.get("failed").and_then(Value::as_i64).unwrap_or(0);
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reconciliation = if status == "rolled_back" {
        "rolled_back"
    } else if status != "completed" {
        "pending"
    } else if processed == expected_valid
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
    if impact
        .pointer("/dependencies/blockingRecords")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        recommendations.push("Rollback or detach dependent records first");
    }
    if recommendations.is_empty() && status == "completed" {
        recommendations.push("Reconciliation and rollback preflight are clear");
    }
    Ok(Some(json!({
        "job": job,
        "actual": actual,
        "reconciliation": {"status":reconciliation,"expectedValidRows":expected_valid,"actualProcessedRows":processed},
        "financialReconciliation": financial,
        "dependencies": dependencies,
        "cutover": {"ready":cutover_ready,"checks":{"jobCompleted":status == "completed","rowsMatched":reconciliation == "matched","financialsMatched":financial_matched,"dependenciesCompleted":dependencies_completed,"approvalComplete":approval_complete}},
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
    let mut pack = json!({"schemaVersion":"1.1","generatedAt":Utc::now(),"governance":governance,"auditEvents":audit,"batches":batches,"chunks":chunks});
    let payload_sha256 = format!("{:x}", Sha256::digest(pack.to_string().as_bytes()));
    pack.as_object_mut()
        .expect("proof pack is an object")
        .insert(
            "integrity".into(),
            json!({"algorithm":"SHA-256","payloadSha256":payload_sha256}),
        );
    Ok(Some(pack))
}

pub async fn failed_rows_csv(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM integration_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await?;
    if !exists {
        return Ok(None);
    }
    let rows: Vec<(String, i32, Option<String>, String, String)> = sqlx::query_as(
        "SELECT source_sheet,source_row_number,source_external_id,error_code,message FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND (status='error' OR error_code<>'') ORDER BY source_sheet,source_row_number",
    ).bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    let mut csv =
        String::from("sourceSheet,sourceRowNumber,sourceExternalId,errorCode,message\r\n");
    for (sheet, row, external_id, code, message) in rows {
        csv.push_str(&format!(
            "{},{},{},{},{}\r\n",
            csv_cell(&sheet),
            row,
            csv_cell(external_id.as_deref().unwrap_or("")),
            csv_cell(&code),
            csv_cell(&message)
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
        "WITH due AS(SELECT job.id FROM integration_import_jobs job WHERE job.status='queued' AND job.source_file_id IS NULL AND NOT EXISTS(SELECT 1 FROM integration_import_job_dependencies dependency JOIN integration_import_jobs required ON required.id=dependency.depends_on_job_id WHERE dependency.job_id=job.id AND required.status<>'completed') ORDER BY job.created_at FOR UPDATE OF job SKIP LOCKED LIMIT 1) UPDATE integration_import_jobs job SET status='processing',updated_at=NOW() FROM due WHERE job.id=due.id RETURNING job.id,job.tenant_id,job.branch_id,job.entity,job.rows_json,job.total_rows,job.next_row,job.created_by",
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
                    | MigrationEntity::StockMovements => return Err(sqlx::Error::RowNotFound),
                }
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
        | MigrationEntity::PurchaseBills
            if !write_rows.is_empty() =>
        {
            for row in &write_rows {
                apply_transaction_row(&mut tx, job, &batch_id, row).await?;
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
            if job.entity == MigrationEntity::PurchaseBills && completes_job {
                post_purchase_bill_journals(&mut tx, job).await?;
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
            if !write_rows.is_empty() =>
        {
            for row in &write_rows {
                apply_extended_row(&mut tx, job, &batch_id, row).await?;
            }
        }
        _ => {}
    }

    let imported_rows = created_rows + merged_rows + linked_rows;
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
        "clients" => Some("DELETE FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "staff" => Some("DELETE FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "services" => Some("DELETE FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "products" => Some("DELETE FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "suppliers" => Some("DELETE FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "memberships" => Some("DELETE FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "client-memberships" => None,
        "packages" => Some("DELETE FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND id IN (SELECT target_id FROM integration_import_row_results WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND action='created' AND target_id IS NOT NULL)"),
        "inventory" => None,
        _ => return Err(sqlx::Error::RowNotFound),
    };
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
                    "client_treatment_photos" => "DELETE FROM client_treatment_photos WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                    "staff_files" => "DELETE FROM staff_files WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
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
                deleted += sqlx::query(
                    "DELETE FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
                )
                .bind(tenant)
                .bind(branch)
                .bind(target_id)
                .execute(&mut *tx)
                .await?
                .rows_affected() as i64;
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
    sqlx::query("UPDATE integration_import_batches SET status='rolled_back',rolled_back_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND job_id=$3 AND status='completed'").bind(tenant).bind(branch).bind(job_id).execute(&mut *tx).await?;
    let report = MigrationRecoveryReport {
        job_id: job_id.into(),
        deleted_rows: deleted,
        restored_rows: restored,
        linked_rows: linked,
        kept_rows: kept,
        rolled_back_rows: rolled_back,
        status: "rolled_back".into(),
    };
    let report_json =
        serde_json::to_value(&report).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
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
    fn failed_row_csv_neutralizes_spreadsheet_formulas() {
        assert_eq!(
            csv_cell("=HYPERLINK(\"bad\")"),
            "\"'=HYPERLINK(\"\"bad\"\")\""
        );
        assert_eq!(csv_cell("safe"), "\"safe\"");
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
    }

    #[test]
    fn dependency_phases_order_master_data_before_payments() {
        assert!(
            dependency_phase(MigrationEntity::Clients)
                < dependency_phase(MigrationEntity::Appointments)
        );
        assert!(
            dependency_phase(MigrationEntity::Appointments)
                < dependency_phase(MigrationEntity::Invoices)
        );
        assert!(
            dependency_phase(MigrationEntity::Invoices)
                < dependency_phase(MigrationEntity::Payments)
        );
        assert_eq!(
            dependency_phase(MigrationEntity::Clients),
            dependency_phase(MigrationEntity::Staff)
        );
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
