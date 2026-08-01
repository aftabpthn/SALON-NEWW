use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct UploadSessionRow {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub source_provider: String,
    pub created_by: String,
    pub original_file_name: String,
    pub file_extension: String,
    pub declared_content_type: String,
    pub expected_size_bytes: i64,
    pub expected_sha256: String,
    pub total_parts: i32,
    pub received_parts: i32,
    pub received_bytes: i64,
    pub status: String,
    pub source_file_id: Option<String>,
    pub last_error: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub retention_days: i32,
    pub evidence_kind: String,
    pub supplier_batch: String,
    pub cutover_id: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct UploadPartRow {
    pub part_number: i32,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_key: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct SourceFileRow {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub source_provider: String,
    pub created_by: String,
    pub upload_session_id: String,
    pub original_file_name: String,
    pub file_extension: String,
    pub declared_content_type: String,
    pub detected_content_type: String,
    pub file_format: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_key: String,
    pub evidence_status: String,
    pub read_only: bool,
    pub encryption_scheme: String,
    pub retention_until: DateTime<Utc>,
    pub purged_at: Option<DateTime<Utc>>,
    pub manifest_json: Value,
    pub created_at: DateTime<Utc>,
    pub page_count: i32,
}

#[derive(Debug, Clone, FromRow)]
pub struct SourceArtifactRow {
    pub id: String,
    pub source_file_id: String,
    pub entry_name: String,
    pub file_format: String,
    pub detected_content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub storage_key: String,
    pub page_count: i32,
}

pub struct NewSourceFile<'a> {
    pub id: &'a str,
    pub original_file_name: &'a str,
    pub file_extension: &'a str,
    pub declared_content_type: &'a str,
    pub detected_content_type: &'a str,
    pub file_format: &'a str,
    pub size_bytes: i64,
    pub sha256: &'a str,
    pub storage_key: &'a str,
    pub encryption_scheme: &'a str,
    pub manifest_json: &'a Value,
    pub page_count: i32,
}

pub struct NewSourceArtifact<'a> {
    pub id: &'a str,
    pub entry_name: &'a str,
    pub file_format: &'a str,
    pub detected_content_type: &'a str,
    pub size_bytes: i64,
    pub sha256: &'a str,
    pub storage_key: &'a str,
    pub page_count: i32,
}

#[derive(Debug, FromRow)]
pub struct HistoricalEvidenceSourceRow {
    pub id: String,
    pub source_file_id: String,
    pub evidence_kind: String,
    pub supplier_batch: String,
    pub original_supplier_batch: String,
    pub evidence_state: String,
    pub correction_reason: String,
    pub corrected_by: Option<String>,
    pub corrected_at: Option<DateTime<Utc>>,
    pub downstream_used: bool,
    pub original_file_name: String,
    pub file_format: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub page_count: i32,
    pub uploaded_by: String,
    pub created_at: DateTime<Utc>,
    pub artifacts_json: Value,
}

#[derive(Debug, FromRow)]
pub struct HistoricalEvidenceGroupDecisionRow {
    pub supplier_batch: String,
    pub group_key: String,
    pub decision: String,
    pub approved_page_count: i32,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct HistoricalEvidenceCutoverApprovalRow {
    pub actor_user_id: String,
    pub actor_role: String,
    pub created_at: DateTime<Utc>,
}

const SESSION_COLUMNS: &str = "id,tenant_id,branch_id,source_provider,created_by,original_file_name,file_extension,declared_content_type,expected_size_bytes,expected_sha256,total_parts,received_parts,received_bytes,status,source_file_id,last_error,expires_at,created_at,updated_at,completed_at,retention_days,evidence_kind,supplier_batch,cutover_id";
const SOURCE_COLUMNS: &str = "id,tenant_id,branch_id,source_provider,created_by,upload_session_id,original_file_name,file_extension,declared_content_type,detected_content_type,file_format,size_bytes,sha256,storage_key,evidence_status,read_only,encryption_scheme,retention_until,purged_at,manifest_json,created_at,page_count";

pub async fn create_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    file_name: &str,
    extension: &str,
    content_type: &str,
    size_bytes: i64,
    total_parts: i32,
    expected_sha256: &str,
    source_provider: &str,
    retention_days: i32,
    evidence_kind: &str,
    supplier_batch: &str,
    cutover_id: &str,
) -> Result<UploadSessionRow, sqlx::Error> {
    let sql = format!(
        "INSERT INTO integration_import_upload_sessions(tenant_id,branch_id,original_file_name,file_extension,declared_content_type,expected_size_bytes,expected_sha256,total_parts,created_by,source_provider,retention_days,evidence_kind,supplier_batch,cutover_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING {SESSION_COLUMNS}"
    );
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, UploadSessionRow>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(file_name)
        .bind(extension)
        .bind(content_type)
        .bind(size_bytes)
        .bind(expected_sha256)
        .bind(total_parts)
        .bind(actor)
        .bind(source_provider)
        .bind(retention_days)
        .bind(evidence_kind)
        .bind(supplier_batch)
        .bind(cutover_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.upload.initiated','success',$3,$4)")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(serde_json::json!({"uploadSessionId":row.id,"fileName":file_name,"sizeBytes":size_bytes,"totalParts":total_parts})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn get_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<UploadSessionRow>, sqlx::Error> {
    let sql = format!("SELECT {SESSION_COLUMNS} FROM integration_import_upload_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn list_parts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Vec<UploadPartRow>, sqlx::Error> {
    sqlx::query_as("SELECT part_number,size_bytes,sha256,storage_key FROM integration_import_upload_parts WHERE tenant_id=$1 AND branch_id=$2 AND upload_session_id=$3 ORDER BY part_number")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_all(db).await
}

pub async fn get_part(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
) -> Result<Option<UploadPartRow>, sqlx::Error> {
    sqlx::query_as("SELECT part_number,size_bytes,sha256,storage_key FROM integration_import_upload_parts WHERE tenant_id=$1 AND branch_id=$2 AND upload_session_id=$3 AND part_number=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(part_number).fetch_optional(db).await
}

pub async fn insert_part(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    part_number: i32,
    size_bytes: i64,
    sha256: &str,
    storage_key: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let inserted = sqlx::query("INSERT INTO integration_import_upload_parts(tenant_id,branch_id,upload_session_id,part_number,size_bytes,sha256,storage_key) SELECT $1,$2,$3,$4,$5,$6,$7 FROM integration_import_upload_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.status='open' AND s.expires_at>NOW() AND s.received_bytes+$5<=s.expected_size_bytes ON CONFLICT DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(id).bind(part_number).bind(size_bytes).bind(sha256).bind(storage_key).execute(&mut *tx).await?.rows_affected() == 1;
    if !inserted {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE integration_import_upload_sessions s SET received_parts=p.parts,received_bytes=p.bytes,updated_at=NOW() FROM (SELECT COUNT(*)::INTEGER parts,COALESCE(SUM(size_bytes),0)::BIGINT bytes FROM integration_import_upload_parts WHERE tenant_id=$1 AND branch_id=$2 AND upload_session_id=$3) p WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn claim_completion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<UploadSessionRow>, sqlx::Error> {
    let sql = format!("UPDATE integration_import_upload_sessions SET status='assembling',last_error='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND (status='open' OR (status='assembling' AND updated_at<NOW()-INTERVAL '15 minutes')) AND expires_at>NOW() RETURNING {SESSION_COLUMNS}");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn release_completion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE integration_import_upload_sessions SET status='open',last_error=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='assembling'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(error).execute(db).await?;
    Ok(())
}

pub async fn complete_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    session_id: &str,
    source: &NewSourceFile<'_>,
    artifacts: &[NewSourceArtifact<'_>],
) -> Result<SourceFileRow, sqlx::Error> {
    let mut tx = db.begin().await?;
    let sql = format!("INSERT INTO integration_import_source_files(id,tenant_id,branch_id,upload_session_id,original_file_name,file_extension,declared_content_type,detected_content_type,file_format,size_bytes,sha256,storage_key,manifest_json,created_by,source_provider,encryption_scheme,retention_until,page_count) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,s.source_provider,$15,NOW()+make_interval(days=>s.retention_days),$16 FROM integration_import_upload_sessions s WHERE s.tenant_id=$2 AND s.branch_id=$3 AND s.id=$4 RETURNING {SOURCE_COLUMNS}");
    let row: SourceFileRow = sqlx::query_as(&sql)
        .bind(source.id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(session_id)
        .bind(source.original_file_name)
        .bind(source.file_extension)
        .bind(source.declared_content_type)
        .bind(source.detected_content_type)
        .bind(source.file_format)
        .bind(source.size_bytes)
        .bind(source.sha256)
        .bind(source.storage_key)
        .bind(source.manifest_json)
        .bind(actor)
        .bind(source.encryption_scheme)
        .bind(source.page_count)
        .fetch_one(&mut *tx)
        .await?;
    for artifact in artifacts {
        sqlx::query("INSERT INTO integration_import_source_artifacts(id,tenant_id,branch_id,source_file_id,entry_name,file_format,detected_content_type,size_bytes,sha256,storage_key,page_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(artifact.id).bind(tenant_id).bind(branch_id).bind(source.id).bind(artifact.entry_name)
            .bind(artifact.file_format).bind(artifact.detected_content_type).bind(artifact.size_bytes)
            .bind(artifact.sha256).bind(artifact.storage_key).bind(artifact.page_count).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO historical_purchase_evidence_items(tenant_id,branch_id,cutover_id,source_file_id,evidence_kind,supplier_batch,page_count,created_by) SELECT $1,$2,s.cutover_id,$3,s.evidence_kind,s.supplier_batch,$4,$5 FROM integration_import_upload_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$6 AND s.evidence_kind<>''")
        .bind(tenant_id).bind(branch_id).bind(source.id).bind(source.page_count).bind(actor).bind(session_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) SELECT $1,$2,'migration.historical_evidence.verified','success',$3,JSONB_BUILD_OBJECT('cutoverId',s.cutover_id,'sourceFileId',$4,'evidenceKind',s.evidence_kind,'supplierBatch',s.supplier_batch,'sha256',$5,'pageCount',$6) FROM integration_import_upload_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$7 AND s.evidence_kind<>''")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(source.id).bind(source.sha256).bind(source.page_count).bind(session_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_import_upload_sessions SET status='completed',source_file_id=$4,received_bytes=expected_size_bytes,completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='assembling'")
        .bind(tenant_id).bind(branch_id).bind(session_id).bind(source.id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.source_file.verified','success',$3,$4)")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(serde_json::json!({"uploadSessionId":session_id,"sourceFileId":source.id,"sha256":source.sha256,"sizeBytes":source.size_bytes,"format":source.file_format})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn list_source_files(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SourceFileRow>, sqlx::Error> {
    let sql = format!("SELECT {SOURCE_COLUMNS} FROM integration_import_source_files WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(db)
        .await
}

pub async fn get_source_file(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<SourceFileRow>, sqlx::Error> {
    let sql = format!("SELECT {SOURCE_COLUMNS} FROM integration_import_source_files WHERE tenant_id=$1 AND branch_id=$2 AND id=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn list_artifacts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_id: &str,
) -> Result<Vec<SourceArtifactRow>, sqlx::Error> {
    sqlx::query_as("SELECT id,source_file_id,entry_name,file_format,detected_content_type,size_bytes,sha256,storage_key,page_count FROM integration_import_source_artifacts WHERE tenant_id=$1 AND branch_id=$2 AND source_file_id=$3 ORDER BY entry_name")
        .bind(tenant_id).bind(branch_id).bind(source_id).fetch_all(db).await
}

pub async fn list_scope_artifacts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SourceArtifactRow>, sqlx::Error> {
    sqlx::query_as("SELECT a.id,a.source_file_id,a.entry_name,a.file_format,a.detected_content_type,a.size_bytes,a.sha256,a.storage_key,a.page_count FROM integration_import_source_artifacts a JOIN integration_import_source_files f ON f.tenant_id=a.tenant_id AND f.branch_id=a.branch_id AND f.id=a.source_file_id WHERE a.tenant_id=$1 AND a.branch_id=$2 ORDER BY f.created_at DESC,a.entry_name")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn evidence_cutover_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM integration_migration_cutovers WHERE tenant_id::TEXT=$1 AND branch_id::TEXT=$2 AND id=$3)")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).fetch_one(db).await
}

pub async fn find_historical_evidence_duplicate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sha256: &str,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT source.id,source.original_file_name FROM historical_purchase_evidence_items item JOIN integration_import_source_files source ON source.tenant_id=item.tenant_id AND source.branch_id=item.branch_id AND source.id=item.source_file_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND source.sha256=$3 ORDER BY item.created_at LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(sha256).fetch_optional(db).await
}

pub async fn list_historical_evidence_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<Vec<HistoricalEvidenceSourceRow>, sqlx::Error> {
    sqlx::query_as("SELECT item.id,item.source_file_id,item.evidence_kind,COALESCE(batch.supplier_batch,item.supplier_batch) supplier_batch,item.supplier_batch original_supplier_batch,CASE WHEN disposition.action='exclude' THEN 'excluded' ELSE 'active' END evidence_state,COALESCE(disposition.reason,batch.reason,'') correction_reason,COALESCE(disposition.actor_user_id,batch.actor_user_id) corrected_by,COALESCE(disposition.created_at,batch.created_at) corrected_at,EXISTS(SELECT 1 FROM purchase_bill_drafts draft WHERE draft.tenant_id=item.tenant_id AND draft.branch_id=item.branch_id AND draft.migration_cutover_id=item.cutover_id AND draft.migration_source_file_id=item.source_file_id UNION ALL SELECT 1 FROM historical_purchase_archive_items archive WHERE archive.tenant_id=item.tenant_id AND archive.branch_id=item.branch_id AND archive.source_file_id=item.source_file_id) downstream_used,source.original_file_name,source.file_format,source.size_bytes,source.sha256,item.page_count,source.created_by uploaded_by,source.created_at,COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',artifact.id,'entryName',artifact.entry_name,'format',artifact.file_format,'sha256',artifact.sha256,'pageCount',artifact.page_count) ORDER BY artifact.entry_name) FILTER(WHERE artifact.id IS NOT NULL),'[]'::JSONB) artifacts_json FROM historical_purchase_evidence_items item JOIN integration_import_source_files source ON source.tenant_id=item.tenant_id AND source.branch_id=item.branch_id AND source.id=item.source_file_id LEFT JOIN LATERAL(SELECT correction.supplier_batch,correction.reason,correction.actor_user_id,correction.created_at FROM historical_purchase_evidence_corrections correction WHERE correction.tenant_id=item.tenant_id AND correction.branch_id=item.branch_id AND correction.cutover_id=item.cutover_id AND correction.source_file_id=item.source_file_id AND correction.action='correct_supplier' ORDER BY correction.created_at DESC,correction.id DESC LIMIT 1) batch ON TRUE LEFT JOIN LATERAL(SELECT correction.action,correction.reason,correction.actor_user_id,correction.created_at FROM historical_purchase_evidence_corrections correction WHERE correction.tenant_id=item.tenant_id AND correction.branch_id=item.branch_id AND correction.cutover_id=item.cutover_id AND correction.source_file_id=item.source_file_id AND correction.action IN('exclude','restore') ORDER BY correction.created_at DESC,correction.id DESC LIMIT 1) disposition ON TRUE LEFT JOIN integration_import_source_artifacts artifact ON artifact.tenant_id=source.tenant_id AND artifact.branch_id=source.branch_id AND artifact.source_file_id=source.id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.cutover_id=$3 GROUP BY item.id,item.source_file_id,item.evidence_kind,item.supplier_batch,batch.supplier_batch,batch.reason,batch.actor_user_id,batch.created_at,disposition.action,disposition.reason,disposition.actor_user_id,disposition.created_at,source.original_file_name,source.file_format,source.size_bytes,source.sha256,item.page_count,source.created_by,source.created_at ORDER BY source.created_at")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn append_historical_evidence_correction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    cutover_id: &str,
    source_file_id: &str,
    action: &str,
    supplier_batch: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO historical_purchase_evidence_corrections(tenant_id,branch_id,cutover_id,source_file_id,action,supplier_batch,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).bind(source_file_id).bind(action).bind(supplier_batch).bind(reason).bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.historical_evidence.corrected','success',$3,$4)")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(serde_json::json!({"cutoverId":cutover_id,"sourceFileId":source_file_id,"action":action,"supplierBatch":supplier_batch,"reason":reason})).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn list_historical_evidence_failures(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<Vec<UploadSessionRow>, sqlx::Error> {
    let sql = format!("SELECT {SESSION_COLUMNS} FROM integration_import_upload_sessions WHERE tenant_id=$1 AND branch_id=$2 AND cutover_id=$3 AND evidence_kind<>'' AND last_error<>'' ORDER BY updated_at DESC");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(cutover_id)
        .fetch_all(db)
        .await
}

pub async fn list_historical_evidence_group_decisions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<Vec<HistoricalEvidenceGroupDecisionRow>, sqlx::Error> {
    sqlx::query_as("SELECT DISTINCT ON(supplier_batch,group_key) supplier_batch,group_key,decision,approved_page_count,actor_user_id,created_at FROM historical_purchase_group_decisions WHERE tenant_id=$1 AND branch_id=$2 AND cutover_id=$3 ORDER BY supplier_batch,group_key,created_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).fetch_all(db).await
}

pub async fn historical_evidence_cutover_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    cutover_id: &str,
) -> Result<Option<HistoricalEvidenceCutoverApprovalRow>, sqlx::Error> {
    sqlx::query_as("SELECT actor_user_id,actor_role,created_at FROM historical_purchase_cutover_approvals WHERE tenant_id=$1 AND branch_id=$2 AND cutover_id=$3")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).fetch_optional(db).await
}

pub async fn decide_historical_evidence_group(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    cutover_id: &str,
    supplier_batch: &str,
    group_key: &str,
    decision: &str,
    approved_page_count: i32,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO historical_purchase_group_decisions(tenant_id,branch_id,cutover_id,supplier_batch,group_key,decision,approved_page_count,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).bind(supplier_batch).bind(group_key).bind(decision).bind(approved_page_count).bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.historical_evidence.group_decided','success',$3,$4)")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(serde_json::json!({"cutoverId":cutover_id,"supplierBatch":supplier_batch,"groupKey":group_key,"decision":decision,"approvedPageCount":approved_page_count})).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn approve_historical_evidence_cutover(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    cutover_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO historical_purchase_cutover_approvals(tenant_id,branch_id,cutover_id,actor_user_id,actor_role) VALUES($1,$2,$3,$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(cutover_id).bind(actor).bind(role).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.historical_evidence.cutover_approved','success',$3,$4)")
        .bind(tenant_id).bind(branch_id).bind(actor).bind(serde_json::json!({"cutoverId":cutover_id,"actorRole":role})).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn audit_evidence_read(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    source_id: &str,
) -> Result<(), sqlx::Error> {
    audit(
        db,
        tenant_id,
        branch_id,
        actor,
        "migration.source_file.evidence_read",
        serde_json::json!({"sourceFileId":source_id}),
    )
    .await
}

pub async fn mark_evidence_expired(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_import_source_files SET evidence_status='expired',purged_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND retention_until<=NOW() AND evidence_status<>'expired'")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,'migration.source_file.retention_purged','success','system',$3)")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(serde_json::json!({"sourceFileId":source_id}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

async fn audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    event_type: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO integration_import_audit_events(tenant_id,branch_id,event_type,outcome,actor_user_id,details_json) VALUES($1,$2,$3,'success',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(event_type).bind(actor).bind(details).execute(db).await?;
    Ok(())
}
