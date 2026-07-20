use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub status: String,
    pub name: String,
    pub blind_counting: bool,
    pub required_counters: i32,
    pub recount_threshold: i32,
    pub cutoff_at: DateTime<Utc>,
    pub cutoff_ledger_at: Option<DateTime<Utc>>,
    pub created_by: String,
    pub submitted_by: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub rejection_reason: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionItemRecord {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub sku: String,
    pub unit: String,
    pub expected_quantity: i32,
    pub approved_quantity: Option<i32>,
    pub variance_quantity: Option<i32>,
    pub variance_reason: String,
    pub adjustment_ledger_id: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountLineRecord {
    pub id: String,
    pub session_item_id: String,
    pub counter_user_id: String,
    pub round_number: i32,
    pub counted_quantity: i32,
    pub device_id: String,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingRecord {
    pub id: String,
    pub session_item_id: String,
    pub finding_type: String,
    pub notes: String,
    pub evidence: Value,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerEventRecord {
    pub id: String,
    pub user_id: String,
    pub device_id: String,
    pub workflow: String,
    pub code: String,
    pub result: String,
    pub inventory_item_id: Option<String>,
    pub client_event_id: String,
    pub captured_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
    pub details: Value,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarcodeAliasRecord {
    pub id: String,
    pub code: String,
    pub alias_type: String,
    pub target_id: String,
    pub inventory_item_id: Option<String>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InventoryLockRecord {
    pub id: String,
    pub stock_quantity: i32,
    pub unit_cost_paise: i64,
    pub batch_tracked: bool,
}

pub async fn list_sessions(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<SessionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,status,name,blind_counting,required_counters,recount_threshold,cutoff_at,cutoff_ledger_at,created_by,submitted_by,submitted_at,approved_by,approved_at,rejection_reason,created_at,updated_at FROM stock_count_sessions WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 100").bind(tenant).bind(branch).fetch_all(db).await
}
pub async fn get_session(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<SessionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,status,name,blind_counting,required_counters,recount_threshold,cutoff_at,cutoff_ledger_at,created_by,submitted_by,submitted_at,approved_by,approved_at,rejection_reason,created_at,updated_at FROM stock_count_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}
pub async fn create_session(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    name: &str,
    blind: bool,
    counters: i32,
    threshold: i32,
    actor: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO stock_count_sessions(tenant_id,branch_id,name,blind_counting,required_counters,recount_threshold,cutoff_ledger_at,created_by) VALUES($1,$2,$3,$4,$5,$6,(SELECT MAX(created_at) FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2),$7) RETURNING id").bind(tenant).bind(branch).bind(name).bind(blind).bind(counters).bind(threshold).bind(actor).fetch_one(&mut **tx).await
}
pub async fn snapshot_items(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO stock_count_session_items(tenant_id,branch_id,session_id,inventory_item_id,expected_quantity) SELECT $1,$2,$3,id,stock_quantity FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE").bind(tenant).bind(branch).bind(session).execute(&mut **tx).await?.rows_affected())
}
pub async fn session_items(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    session: &str,
) -> Result<Vec<SessionItemRecord>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,item.name AS item_name,item.sku,item.unit,line.expected_quantity,line.approved_quantity,line.variance_quantity,line.variance_reason,line.adjustment_ledger_id,line.posted_at FROM stock_count_session_items line JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.session_id=$3 ORDER BY item.name").bind(tenant).bind(branch).bind(session).fetch_all(db).await
}
pub async fn count_lines(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    session: &str,
) -> Result<Vec<CountLineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.session_item_id,line.counter_user_id,line.round_number,line.counted_quantity,line.device_id,line.idempotency_key,line.created_at FROM stock_count_lines line JOIN stock_count_session_items item ON item.id=line.session_item_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND item.session_id=$3 ORDER BY line.created_at").bind(tenant).bind(branch).bind(session).fetch_all(db).await
}
pub async fn findings(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    session: &str,
) -> Result<Vec<FindingRecord>, sqlx::Error> {
    sqlx::query_as("SELECT finding.id,finding.session_item_id,finding.finding_type,finding.notes,finding.evidence,finding.created_by,finding.created_at FROM stock_count_findings finding JOIN stock_count_session_items item ON item.id=finding.session_item_id WHERE finding.tenant_id=$1 AND finding.branch_id=$2 AND item.session_id=$3 ORDER BY finding.created_at DESC").bind(tenant).bind(branch).bind(session).fetch_all(db).await
}
pub async fn session_item(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    session: &str,
    item: &str,
) -> Result<Option<SessionItemRecord>, sqlx::Error> {
    sqlx::query_as("SELECT line.id,line.inventory_item_id,item.name AS item_name,item.sku,item.unit,line.expected_quantity,line.approved_quantity,line.variance_quantity,line.variance_reason,line.adjustment_ledger_id,line.posted_at FROM stock_count_session_items line JOIN inventory_items item ON item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.session_id=$3 AND line.inventory_item_id=$4").bind(tenant).bind(branch).bind(session).bind(item).fetch_optional(db).await
}
pub async fn count_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    key: &str,
) -> Result<Option<CountLineRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,session_item_id,counter_user_id,round_number,counted_quantity,device_id,idempotency_key,created_at FROM stock_count_lines WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3").bind(tenant).bind(branch).bind(key).fetch_optional(&mut **tx).await
}
pub async fn insert_count(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session_item: &str,
    actor: &str,
    round: i32,
    quantity: i32,
    device: &str,
    key: &str,
) -> Result<CountLineRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO stock_count_lines(tenant_id,branch_id,session_item_id,counter_user_id,round_number,counted_quantity,device_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,session_item_id,counter_user_id,round_number,counted_quantity,device_id,idempotency_key,created_at").bind(tenant).bind(branch).bind(session_item).bind(actor).bind(round).bind(quantity).bind(device).bind(key).fetch_one(&mut **tx).await
}
pub async fn set_review_results(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    quantity: i32,
    variance: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE stock_count_session_items SET approved_quantity=$4,variance_quantity=$5 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(item).bind(quantity).bind(variance).execute(&mut **tx).await?;
    Ok(())
}
pub async fn set_reason(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE stock_count_session_items SET variance_reason=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND variance_quantity IS NOT NULL").bind(tenant).bind(branch).bind(item).bind(reason).execute(&mut **tx).await?.rows_affected()==1)
}
pub async fn set_status(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session: &str,
    expected: &str,
    next: &str,
    actor: &str,
    rejection: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE stock_count_sessions SET status=$5,submitted_by=CASE WHEN $5='pending_approval' THEN $6 ELSE submitted_by END,submitted_at=CASE WHEN $5='pending_approval' THEN NOW() ELSE submitted_at END,approved_by=CASE WHEN $5 IN ('approved','posted') THEN $6 ELSE approved_by END,approved_at=CASE WHEN $5 IN ('approved','posted') THEN NOW() ELSE approved_at END,rejection_reason=CASE WHEN $5='rejected' THEN $7 ELSE rejection_reason END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status=$4").bind(tenant).bind(branch).bind(session).bind(expected).bind(next).bind(actor).bind(rejection).execute(&mut **tx).await?.rows_affected()==1)
}
pub async fn counters_for_session(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    session: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM stock_count_lines line JOIN stock_count_session_items item ON item.id=line.session_item_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND item.session_id=$3 AND line.counter_user_id=$4)").bind(tenant).bind(branch).bind(session).bind(actor).fetch_one(db).await
}
pub async fn lock_inventory(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
) -> Result<Option<InventoryLockRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,stock_quantity,unit_cost_paise,batch_tracked FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE").bind(tenant).bind(branch).bind(item).fetch_optional(&mut **tx).await
}
pub async fn mark_posted(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session_item: &str,
    ledger: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE stock_count_session_items SET adjustment_ledger_id=$4,posted_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND posted_at IS NULL").bind(tenant).bind(branch).bind(session_item).bind(ledger).execute(&mut **tx).await?;
    Ok(())
}
pub async fn add_finding(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    session_item: &str,
    kind: &str,
    notes: &str,
    evidence: &Value,
    actor: &str,
) -> Result<FindingRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO stock_count_findings(tenant_id,branch_id,session_item_id,finding_type,notes,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,session_item_id,finding_type,notes,evidence,created_by,created_at").bind(tenant).bind(branch).bind(session_item).bind(kind).bind(notes).bind(evidence).bind(actor).fetch_one(&mut **tx).await
}
pub async fn resolve_code(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    code: &str,
) -> Result<Option<(Option<String>, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT inventory_item_id,alias_type,target_id FROM inventory_barcode_aliases WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(code))=LOWER(BTRIM($3)) AND active=TRUE UNION ALL SELECT id,'product',id FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND (LOWER(BTRIM(barcode))=LOWER(BTRIM($3)) OR LOWER(BTRIM(sku))=LOWER(BTRIM($3))) AND active=TRUE UNION ALL SELECT inventory_item_id,'batch',id FROM inventory_batches WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(BTRIM(barcode))=LOWER(BTRIM($3)) LIMIT 1").bind(tenant).bind(branch).bind(code).fetch_optional(db).await
}
pub async fn scanner_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    user: &str,
    device: &str,
    workflow: &str,
    code: &str,
    result: &str,
    item: Option<&str>,
    client_event: &str,
    captured_at: DateTime<Utc>,
    details: &Value,
) -> Result<ScannerEventRecord, sqlx::Error> {
    if let Some(row)=sqlx::query_as("SELECT id,user_id,device_id,workflow,code,result,inventory_item_id,client_event_id,captured_at,received_at,details FROM inventory_scanner_events WHERE tenant_id=$1 AND branch_id=$2 AND client_event_id=$3").bind(tenant).bind(branch).bind(client_event).fetch_optional(&mut **tx).await? { return Ok(row); }
    sqlx::query_as("INSERT INTO inventory_scanner_events(tenant_id,branch_id,user_id,device_id,workflow,code,result,inventory_item_id,client_event_id,captured_at,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,user_id,device_id,workflow,code,result,inventory_item_id,client_event_id,captured_at,received_at,details").bind(tenant).bind(branch).bind(user).bind(device).bind(workflow).bind(code).bind(result).bind(item).bind(client_event).bind(captured_at).bind(details).fetch_one(&mut **tx).await
}
pub async fn list_scanner_events(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ScannerEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,user_id,device_id,workflow,code,result,inventory_item_id,client_event_id,captured_at,received_at,details FROM inventory_scanner_events WHERE tenant_id=$1 AND branch_id=$2 ORDER BY received_at DESC LIMIT 100").bind(tenant).bind(branch).fetch_all(db).await
}
pub async fn upsert_alias(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    code: &str,
    kind: &str,
    target: &str,
    item: Option<&str>,
    active: bool,
    actor: &str,
) -> Result<BarcodeAliasRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO inventory_barcode_aliases(tenant_id,branch_id,code,alias_type,target_id,inventory_item_id,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id,LOWER(BTRIM(code))) DO UPDATE SET alias_type=EXCLUDED.alias_type,target_id=EXCLUDED.target_id,inventory_item_id=EXCLUDED.inventory_item_id,active=EXCLUDED.active,updated_at=NOW() RETURNING id,code,alias_type,target_id,inventory_item_id,active,created_at").bind(tenant).bind(branch).bind(code).bind(kind).bind(target).bind(item).bind(active).bind(actor).fetch_one(&mut **tx).await
}
pub async fn list_aliases(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<BarcodeAliasRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,code,alias_type,target_id,inventory_item_id,active,created_at FROM inventory_barcode_aliases WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200").bind(tenant).bind(branch).fetch_all(db).await
}
