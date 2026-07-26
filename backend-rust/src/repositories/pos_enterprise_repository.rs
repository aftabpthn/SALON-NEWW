use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use super::business_code_repository::{next_branch_code, BusinessCodeKind};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PosTerminal {
    pub id: String,
    pub terminal_code: String,
    pub terminal_name: String,
    pub device_fingerprint: String,
    pub assigned_counter: String,
    pub status: String,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub active_session_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrintDevice {
    pub id: String,
    pub terminal_id: String,
    pub device_name: String,
    pub device_type: String,
    pub connection_type: String,
    pub config_json: Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: String,
    pub terminal_id: String,
    pub device_id: Option<String>,
    pub sale_id: String,
    pub invoice_number: String,
    pub format: String,
    pub status: String,
    pub attempts: i32,
    pub last_error: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DayLock {
    pub id: String,
    pub business_date: NaiveDate,
    pub status: String,
    pub reason: String,
    pub actor_user_id: String,
    pub locked_at: DateTime<Utc>,
    pub reopened_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ZReport {
    pub id: String,
    pub business_date: NaiveDate,
    pub version: i32,
    pub report_json: Value,
    pub sha256: String,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RiskCase {
    pub id: String,
    pub business_date: NaiveDate,
    pub risk_code: String,
    pub severity: String,
    pub risk_score: i32,
    pub entity_type: String,
    pub entity_id: String,
    pub evidence_json: Value,
    pub amount_at_risk_paise: i64,
    pub status: String,
    pub resolution_note: String,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationProfile {
    pub id: String,
    pub sender_email: String,
    pub sender_phone: String,
    pub logo_url: String,
    pub signature_url: String,
    pub email_verified: bool,
    pub phone_verified: bool,
    pub owner_email: String,
    pub owner_phone: String,
    pub reporting_email: String,
    pub owner_email_verified: bool,
    pub owner_phone_verified: bool,
    pub reporting_email_verified: bool,
    pub client_email_enabled: bool,
    pub client_whatsapp_enabled: bool,
    pub owner_email_enabled: bool,
    pub owner_whatsapp_enabled: bool,
    pub daily_report_enabled: bool,
    pub daily_report_time: chrono::NaiveTime,
    pub daily_report_timezone: String,
    pub last_daily_report_date: Option<NaiveDate>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CorporateAccount {
    pub id: String,
    pub account_code: String,
    pub account_name: String,
    pub billing_email: String,
    pub phone: String,
    pub gstin: String,
    pub credit_limit_paise: i64,
    pub outstanding_paise: i64,
    pub payment_terms_days: i32,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CorporateMember {
    pub id: String,
    pub corporate_account_id: String,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub employee_code: String,
    pub department: String,
    pub spending_limit_paise: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CorporateStatementRow {
    pub id: String,
    pub sale_id: String,
    pub invoice_number: String,
    pub due_date: NaiveDate,
    pub original_amount_paise: i64,
    pub paid_paise: i64,
    pub outstanding_paise: i64,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct ReliabilitySnapshotRow {
    pub invoice_pending: i64,
    pub invoice_dead_letter: i64,
    pub invoice_oldest_lag_seconds: i64,
    pub print_pending: i64,
    pub print_dead_letter: i64,
    pub print_oldest_lag_seconds: i64,
    pub compliance_pending: i64,
    pub compliance_dead_letter: i64,
    pub open_integrity_cases: i64,
    pub payment_mismatches: i64,
    pub settlement_exceptions: i64,
}

pub async fn snapshot_staff_commissions(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    sale_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH sale AS (
          SELECT id,business_date,created_at
            FROM pos_sales
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
             AND status NOT IN ('draft','cancelled','voided')
        ), line_base AS (
          SELECT l.id AS sale_line_id,l.sale_id,l.line_type,l.item_id,l.staff_id,l.staff_splits,
                 l.taxable_paise,s.business_date,s.created_at AS sale_created_at
            FROM pos_sale_lines l
            JOIN sale s ON s.id=l.sale_id
           WHERE l.tenant_id=$1 AND l.branch_id=$2
        ), attributions AS (
          SELECT sale_line_id,sale_id,line_type,item_id,
                 COALESCE(split.value->>'staffId',split.value->>'staff_id','') AS staff_id,
                 ROUND(COALESCE((split.value->>'percent')::NUMERIC,0) * 100)::INTEGER AS split_bps,
                 taxable_paise,business_date,sale_created_at
            FROM line_base
            JOIN LATERAL jsonb_array_elements(COALESCE(staff_splits,'[]'::jsonb)) split(value)
              ON jsonb_array_length(COALESCE(staff_splits,'[]'::jsonb)) > 0
          UNION ALL
          SELECT sale_line_id,sale_id,line_type,item_id,staff_id,10000,
                 taxable_paise,business_date,sale_created_at
            FROM line_base
           WHERE jsonb_array_length(COALESCE(staff_splits,'[]'::jsonb)) = 0
             AND COALESCE(staff_id,'') <> ''
        ), rated AS (
          SELECT a.*,
                 COALESCE(catalog.commission_percent,rule.rate_percent,0)::INTEGER AS rate_percent,
                 CASE WHEN catalog.staff_id IS NOT NULL THEN 'catalog'
                      WHEN rule.id IS NOT NULL THEN 'rule'
                      ELSE '' END AS rule_source,
                 COALESCE(rule.id,'') AS rule_id,
                 COALESCE(rule.name,'') AS rule_name
            FROM attributions a
            LEFT JOIN staff_catalog_assignments catalog
              ON catalog.tenant_id=$1 AND catalog.branch_id=$2
             AND catalog.staff_id=a.staff_id
             AND catalog.item_type=a.line_type
             AND catalog.item_id=a.item_id
             AND catalog.commission_percent IS NOT NULL
            LEFT JOIN LATERAL (
              SELECT id,name,rate_percent
                FROM staff_commission_rules
               WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=a.staff_id
                 AND active=TRUE
                 AND applies_to IN (a.line_type,'all')
                 AND (effective_from IS NULL OR effective_from <= a.business_date)
               ORDER BY CASE WHEN applies_to=a.line_type THEN 0 ELSE 1 END,
                        effective_from DESC NULLS LAST, created_at DESC
               LIMIT 1
            ) rule ON catalog.staff_id IS NULL
        )
        INSERT INTO pos_staff_commission_snapshots (
          tenant_id,branch_id,sale_id,sale_line_id,staff_id,line_type,item_id,
          split_bps,base_paise,rate_percent,commission_paise,
          rule_source,rule_id,rule_name,business_date,sale_created_at
        )
        SELECT $1,$2,sale_id,sale_line_id,staff_id,line_type,item_id,
               GREATEST(1,LEAST(split_bps,10000)),
               ((taxable_paise * GREATEST(1,LEAST(split_bps,10000)) + 5000) / 10000)::BIGINT AS base_paise,
               rate_percent,
               ((((taxable_paise * GREATEST(1,LEAST(split_bps,10000)) + 5000) / 10000) * rate_percent + 50) / 100)::BIGINT AS commission_paise,
               rule_source,rule_id,rule_name,business_date,sale_created_at
          FROM rated
         WHERE COALESCE(staff_id,'') <> '' AND split_bps > 0
        ON CONFLICT (tenant_id,branch_id,sale_line_id,staff_id) DO NOTHING
        "#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_id)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
}

pub async fn list_terminals(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<PosTerminal>, sqlx::Error> {
    sqlx::query_as("SELECT t.id,t.terminal_code,t.terminal_name,t.device_fingerprint,t.assigned_counter,t.status,t.last_seen_at,(SELECT s.id FROM pos_terminal_sessions s WHERE s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id AND s.terminal_id=t.id AND s.status='active' ORDER BY s.opened_at DESC LIMIT 1) active_session_id,t.created_at FROM pos_terminals t WHERE t.tenant_id=$1 AND t.branch_id=$2 ORDER BY t.created_at DESC")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_terminal(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    fingerprint: &str,
    counter: &str,
) -> Result<PosTerminal, sqlx::Error> {
    let mut tx = db.begin().await?;
    let code = next_branch_code(&mut tx, tenant, branch, BusinessCodeKind::PosTerminal).await?;
    let row = sqlx::query_as("INSERT INTO pos_terminals (tenant_id,branch_id,terminal_code,terminal_name,device_fingerprint,assigned_counter,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,terminal_code,terminal_name,device_fingerprint,assigned_counter,status,last_seen_at,NULL::TEXT active_session_id,created_at")
        .bind(tenant).bind(branch).bind(code).bind(name).bind(fingerprint).bind(counter).bind(actor).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn set_terminal_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    status: &str,
) -> Result<Option<PosTerminal>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_terminals SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,terminal_code,terminal_name,device_fingerprint,assigned_counter,status,last_seen_at,NULL::TEXT active_session_id,created_at")
        .bind(tenant).bind(branch).bind(id).bind(status).fetch_optional(db).await
}

pub async fn heartbeat(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    fingerprint: &str,
) -> Result<Option<PosTerminal>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_terminals SET last_seen_at=NOW(),device_fingerprint=COALESCE(NULLIF($4,''),device_fingerprint),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' RETURNING id,terminal_code,terminal_name,device_fingerprint,assigned_counter,status,last_seen_at,NULL::TEXT active_session_id,created_at")
        .bind(tenant).bind(branch).bind(id).bind(fingerprint).fetch_optional(db).await
}

pub async fn start_terminal_session(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    terminal_id: &str,
    user_id: &str,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO pos_terminal_sessions (tenant_id,branch_id,terminal_id,user_id) SELECT $1,$2,id,$4 FROM pos_terminals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' RETURNING id")
        .bind(tenant).bind(branch).bind(terminal_id).bind(user_id).fetch_one(db).await
}

pub async fn end_terminal_session(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    terminal_id: &str,
    user_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("UPDATE pos_terminal_sessions SET status='closed',closed_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND terminal_id=$3 AND user_id=$4 AND status='active' RETURNING id")
        .bind(tenant).bind(branch).bind(terminal_id).bind(user_id).fetch_optional(db).await
}

pub async fn terminal_sales(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    terminal_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<(i64, i64, i64), sqlx::Error> {
    sqlx::query_as("SELECT COUNT(*)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT,COALESCE(SUM(paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND terminal_id=$3 AND business_date BETWEEN $4 AND $5")
        .bind(tenant).bind(branch).bind(terminal_id).bind(from).bind(to).fetch_one(db).await
}

pub async fn list_print_devices(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<PrintDevice>, sqlx::Error> {
    sqlx::query_as("SELECT id,terminal_id,device_name,device_type,connection_type,config_json,status,created_at FROM pos_print_devices WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_print_device(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    terminal_id: &str,
    name: &str,
    device_type: &str,
    connection: &str,
    config: Value,
) -> Result<PrintDevice, sqlx::Error> {
    sqlx::query_as("INSERT INTO pos_print_devices (tenant_id,branch_id,terminal_id,device_name,device_type,connection_type,config_json) SELECT $1,$2,id,$4,$5,$6,$7 FROM pos_terminals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,terminal_id,device_name,device_type,connection_type,config_json,status,created_at")
        .bind(tenant).bind(branch).bind(terminal_id).bind(name).bind(device_type).bind(connection).bind(config).fetch_one(db).await
}

pub async fn list_print_jobs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<PrintJob>, sqlx::Error> {
    sqlx::query_as("SELECT j.id,j.terminal_id,j.device_id,j.sale_id,s.invoice_number,j.format,j.status,j.attempts,j.last_error,j.created_at FROM pos_print_jobs j JOIN pos_sales s ON s.id=j.sale_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id WHERE j.tenant_id=$1 AND j.branch_id=$2 ORDER BY j.created_at DESC LIMIT 100")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_print_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    terminal_id: &str,
    device_id: Option<&str>,
    sale_id: &str,
    format: &str,
) -> Result<PrintJob, sqlx::Error> {
    sqlx::query_as("WITH inserted AS (INSERT INTO pos_print_jobs (tenant_id,branch_id,terminal_id,device_id,sale_id,format,requested_by_user_id) SELECT $1,$2,t.id,$4,s.id,$6,$7 FROM pos_terminals t JOIN pos_sales s ON s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id AND s.id=$5 WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.id=$3 AND t.status='active' RETURNING *) SELECT j.id,j.terminal_id,j.device_id,j.sale_id,s.invoice_number,j.format,j.status,j.attempts,j.last_error,j.created_at FROM inserted j JOIN pos_sales s ON s.id=j.sale_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id")
        .bind(tenant).bind(branch).bind(terminal_id).bind(device_id).bind(sale_id).bind(format).bind(actor).fetch_one(db).await
}

pub async fn retry_print_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<PrintJob>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_print_jobs j SET status='queued',attempts=0,last_error='',updated_at=NOW() FROM pos_sales s WHERE j.tenant_id=$1 AND j.branch_id=$2 AND j.id=$3 AND j.status='failed' AND s.id=j.sale_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id RETURNING j.id,j.terminal_id,j.device_id,j.sale_id,s.invoice_number,j.format,j.status,j.attempts,j.last_error,j.created_at")
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await
}

pub async fn claim_next_print_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    terminal_id: &str,
) -> Result<Option<PrintJob>, sqlx::Error> {
    sqlx::query_as("WITH candidate AS (SELECT j.id FROM pos_print_jobs j WHERE j.tenant_id=$1 AND j.branch_id=$2 AND j.terminal_id=$3 AND (j.status='queued' OR (j.status='processing' AND j.updated_at<NOW()-INTERVAL '5 minutes')) AND j.attempts<5 ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1), updated AS (UPDATE pos_print_jobs j SET status='processing',attempts=attempts+1,updated_at=NOW() FROM candidate c WHERE j.id=c.id RETURNING j.*) SELECT j.id,j.terminal_id,j.device_id,j.sale_id,s.invoice_number,j.format,j.status,j.attempts,j.last_error,j.created_at FROM updated j JOIN pos_sales s ON s.id=j.sale_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id")
        .bind(tenant).bind(branch).bind(terminal_id).fetch_optional(db).await
}

pub async fn reliability_snapshot(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<ReliabilitySnapshotRow, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          (SELECT COUNT(*)::BIGINT FROM pos_invoice_outbox WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('queued','processing')) invoice_pending,
          (SELECT COUNT(*)::BIGINT FROM pos_invoice_outbox WHERE tenant_id=$1 AND branch_id=$2 AND status='failed' AND attempts>=5) invoice_dead_letter,
          (SELECT COALESCE(GREATEST(0,EXTRACT(EPOCH FROM (NOW()-MIN(next_attempt_at)))::BIGINT),0)::BIGINT FROM pos_invoice_outbox WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('queued','processing')) invoice_oldest_lag_seconds,
          (SELECT COUNT(*)::BIGINT FROM pos_print_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('queued','processing')) print_pending,
          (SELECT COUNT(*)::BIGINT FROM pos_print_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status='failed' AND attempts>=5) print_dead_letter,
          (SELECT COALESCE(GREATEST(0,EXTRACT(EPOCH FROM (NOW()-MIN(created_at)))::BIGINT),0)::BIGINT FROM pos_print_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('queued','processing')) print_oldest_lag_seconds,
          (SELECT COUNT(*)::BIGINT FROM pos_compliance_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('queued','processing')) compliance_pending,
          (SELECT COUNT(*)::BIGINT FROM pos_compliance_jobs WHERE tenant_id=$1 AND branch_id=$2 AND status='failed' AND attempt_count>=5) compliance_dead_letter,
          (SELECT COUNT(*)::BIGINT FROM pos_financial_risk_cases WHERE tenant_id=$1 AND branch_id=$2 AND status='open') open_integrity_cases,
          (SELECT COUNT(*)::BIGINT FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE AND sale.status NOT IN ('draft','voided','cancelled','refunded') AND sale.paid_paise<>(SELECT COALESCE(SUM(payment.amount_paise),0)::BIGINT FROM pos_payments payment WHERE payment.tenant_id=sale.tenant_id AND payment.branch_id=sale.branch_id AND payment.sale_id=sale.id)) payment_mismatches,
          (SELECT COUNT(*)::BIGINT FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND status='review_required') settlement_exceptions
        "#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_one(db)
    .await
}

pub async fn active_pos_scopes(
    db: &PgPool,
) -> Result<Vec<(String, String, NaiveDate)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT DISTINCT tenant_id,branch_id,business_date FROM pos_sales WHERE business_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE",
    )
    .fetch_all(db)
    .await
}

pub async fn complete_print_job(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    status: &str,
    error: &str,
) -> Result<Option<PrintJob>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_print_jobs j SET status=CASE WHEN $4='failed' AND j.attempts<5 THEN 'queued' ELSE $4 END,last_error=$5,updated_at=NOW() FROM pos_sales s WHERE j.tenant_id=$1 AND j.branch_id=$2 AND j.id=$3 AND j.status='processing' AND s.id=j.sale_id AND s.tenant_id=j.tenant_id AND s.branch_id=j.branch_id RETURNING j.id,j.terminal_id,j.device_id,j.sale_id,s.invoice_number,j.format,j.status,j.attempts,j.last_error,j.created_at")
        .bind(tenant).bind(branch).bind(id).bind(status).bind(error).fetch_optional(db).await
}

pub async fn day_lock(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    actor: &str,
    date: NaiveDate,
    reason: &str,
    status: &str,
) -> Result<DayLock, sqlx::Error> {
    sqlx::query_as("INSERT INTO pos_day_locks (tenant_id,branch_id,business_date,status,reason,actor_user_id,reopened_at) VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $4='reopened' THEN NOW() ELSE NULL END) ON CONFLICT (tenant_id,branch_id,business_date) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,actor_user_id=EXCLUDED.actor_user_id,reopened_at=CASE WHEN EXCLUDED.status='reopened' THEN NOW() ELSE pos_day_locks.reopened_at END,locked_at=CASE WHEN EXCLUDED.status='locked' THEN NOW() ELSE pos_day_locks.locked_at END,updated_at=NOW() RETURNING id,business_date,status,reason,actor_user_id,locked_at,reopened_at")
        .bind(tenant).bind(branch).bind(date).bind(status).bind(reason).bind(actor).fetch_one(&mut **tx).await
}

pub async fn get_day_lock(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Option<DayLock>, sqlx::Error> {
    sqlx::query_as("SELECT id,business_date,status,reason,actor_user_id,locked_at,reopened_at FROM pos_day_locks WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3")
        .bind(tenant).bind(branch).bind(date).fetch_optional(db).await
}

pub async fn latest_z_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Option<ZReport>, sqlx::Error> {
    sqlx::query_as("SELECT id,business_date,version,report_json,sha256,generated_at FROM pos_z_reports WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 ORDER BY version DESC LIMIT 1")
        .bind(tenant).bind(branch).bind(date).fetch_optional(db).await
}

pub async fn insert_z_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    date: NaiveDate,
    report: Value,
    sha256: &str,
) -> Result<ZReport, sqlx::Error> {
    sqlx::query_as("INSERT INTO pos_z_reports (tenant_id,branch_id,business_date,version,report_json,sha256,generated_by_user_id) VALUES ($1,$2,$3,COALESCE((SELECT MAX(version)+1 FROM pos_z_reports WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3),1),$4,$5,$6) RETURNING id,business_date,version,report_json,sha256,generated_at")
        .bind(tenant).bind(branch).bind(date).bind(report).bind(sha256).bind(actor).fetch_one(db).await
}

pub async fn upsert_risk_case(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
    code: &str,
    severity: &str,
    score: i32,
    entity_type: &str,
    entity_id: &str,
    amount_at_risk_paise: i64,
    evidence: Value,
) -> Result<RiskCase, sqlx::Error> {
    sqlx::query_as("INSERT INTO pos_financial_risk_cases (tenant_id,branch_id,business_date,risk_code,severity,risk_score,entity_type,entity_id,amount_at_risk_paise,evidence_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,branch_id,business_date,risk_code,entity_type,entity_id) DO UPDATE SET severity=EXCLUDED.severity,risk_score=EXCLUDED.risk_score,amount_at_risk_paise=EXCLUDED.amount_at_risk_paise,evidence_json=EXCLUDED.evidence_json,updated_at=NOW() RETURNING id,business_date,risk_code,severity,risk_score,entity_type,entity_id,evidence_json,amount_at_risk_paise,status,resolution_note,created_at,resolved_at")
        .bind(tenant).bind(branch).bind(date).bind(code).bind(severity).bind(score).bind(entity_type).bind(entity_id).bind(amount_at_risk_paise).bind(evidence).fetch_one(&mut **tx).await
}

pub async fn list_risk_cases(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: &str,
) -> Result<Vec<RiskCase>, sqlx::Error> {
    sqlx::query_as("SELECT id,business_date,risk_code,severity,risk_score,entity_type,entity_id,evidence_json,amount_at_risk_paise,status,resolution_note,created_at,resolved_at FROM pos_financial_risk_cases WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR status=$3) ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,created_at DESC LIMIT 200")
        .bind(tenant).bind(branch).bind(status).fetch_all(db).await
}

pub async fn resolve_risk_case(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    status: &str,
    note: &str,
) -> Result<Option<RiskCase>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_financial_risk_cases SET status=$5,resolved_by_user_id=$4,resolution_note=$6,resolved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' RETURNING id,business_date,risk_code,severity,risk_score,entity_type,entity_id,evidence_json,amount_at_risk_paise,status,resolution_note,created_at,resolved_at")
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(status).bind(note).fetch_optional(db).await
}

pub async fn get_notification_profile(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Option<NotificationProfile>, sqlx::Error> {
    sqlx::query_as("SELECT id,sender_email,sender_phone,logo_url,signature_url,email_verified,phone_verified,owner_email,owner_phone,reporting_email,owner_email_verified,owner_phone_verified,reporting_email_verified,client_email_enabled,client_whatsapp_enabled,owner_email_enabled,owner_whatsapp_enabled,daily_report_enabled,daily_report_time,daily_report_timezone,last_daily_report_date,updated_at FROM invoice_notification_profiles WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant).bind(branch).fetch_optional(db).await
}

pub async fn save_notification_profile(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    email: &str,
    phone: &str,
    logo: &str,
    signature: &str,
    owner_email: &str,
    owner_phone: &str,
    reporting_email: &str,
    client_email_enabled: bool,
    client_whatsapp_enabled: bool,
    owner_email_enabled: bool,
    owner_whatsapp_enabled: bool,
    daily_report_enabled: bool,
    daily_report_time: chrono::NaiveTime,
    daily_report_timezone: &str,
) -> Result<NotificationProfile, sqlx::Error> {
    sqlx::query_as("INSERT INTO invoice_notification_profiles (tenant_id,branch_id,sender_email,sender_phone,logo_url,signature_url,owner_email,owner_phone,reporting_email,client_email_enabled,client_whatsapp_enabled,owner_email_enabled,owner_whatsapp_enabled,daily_report_enabled,daily_report_time,daily_report_timezone,updated_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (tenant_id,branch_id) DO UPDATE SET sender_email=EXCLUDED.sender_email,sender_phone=EXCLUDED.sender_phone,logo_url=EXCLUDED.logo_url,signature_url=EXCLUDED.signature_url,owner_email=EXCLUDED.owner_email,owner_phone=EXCLUDED.owner_phone,reporting_email=EXCLUDED.reporting_email,email_verified=CASE WHEN invoice_notification_profiles.sender_email=EXCLUDED.sender_email THEN invoice_notification_profiles.email_verified ELSE FALSE END,phone_verified=CASE WHEN invoice_notification_profiles.sender_phone=EXCLUDED.sender_phone THEN invoice_notification_profiles.phone_verified ELSE FALSE END,owner_email_verified=CASE WHEN invoice_notification_profiles.owner_email=EXCLUDED.owner_email THEN invoice_notification_profiles.owner_email_verified ELSE FALSE END,owner_phone_verified=CASE WHEN invoice_notification_profiles.owner_phone=EXCLUDED.owner_phone THEN invoice_notification_profiles.owner_phone_verified ELSE FALSE END,reporting_email_verified=CASE WHEN invoice_notification_profiles.reporting_email=EXCLUDED.reporting_email THEN invoice_notification_profiles.reporting_email_verified ELSE FALSE END,client_email_enabled=EXCLUDED.client_email_enabled,client_whatsapp_enabled=EXCLUDED.client_whatsapp_enabled,owner_email_enabled=EXCLUDED.owner_email_enabled,owner_whatsapp_enabled=EXCLUDED.owner_whatsapp_enabled,daily_report_enabled=EXCLUDED.daily_report_enabled,daily_report_time=EXCLUDED.daily_report_time,daily_report_timezone=EXCLUDED.daily_report_timezone,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW() RETURNING id,sender_email,sender_phone,logo_url,signature_url,email_verified,phone_verified,owner_email,owner_phone,reporting_email,owner_email_verified,owner_phone_verified,reporting_email_verified,client_email_enabled,client_whatsapp_enabled,owner_email_enabled,owner_whatsapp_enabled,daily_report_enabled,daily_report_time,daily_report_timezone,last_daily_report_date,updated_at")
        .bind(tenant).bind(branch).bind(email).bind(phone).bind(logo).bind(signature)
        .bind(owner_email).bind(owner_phone).bind(reporting_email).bind(client_email_enabled)
        .bind(client_whatsapp_enabled).bind(owner_email_enabled).bind(owner_whatsapp_enabled)
        .bind(daily_report_enabled).bind(daily_report_time).bind(daily_report_timezone).bind(actor)
        .fetch_one(db).await
}

pub async fn verify_notification_contact(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    kind: &str,
) -> Result<Option<NotificationProfile>, sqlx::Error> {
    let column = match kind {
        "sender_email" | "email" => "email_verified",
        "sender_phone" | "phone" => "phone_verified",
        "owner_email" => "owner_email_verified",
        "owner_phone" => "owner_phone_verified",
        _ => "reporting_email_verified",
    };
    sqlx::query_as(&format!("UPDATE invoice_notification_profiles SET {column}=TRUE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 RETURNING id,sender_email,sender_phone,logo_url,signature_url,email_verified,phone_verified,owner_email,owner_phone,reporting_email,owner_email_verified,owner_phone_verified,reporting_email_verified,client_email_enabled,client_whatsapp_enabled,owner_email_enabled,owner_whatsapp_enabled,daily_report_enabled,daily_report_time,daily_report_timezone,last_daily_report_date,updated_at"))
        .bind(tenant).bind(branch).fetch_optional(db).await
}

pub async fn list_corporate_accounts(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<CorporateAccount>, sqlx::Error> {
    sqlx::query_as("SELECT a.id,a.account_code,a.account_name,a.billing_email,a.phone,a.gstin,a.credit_limit_paise,(COALESCE((SELECT SUM(ci.outstanding_paise) FROM corporate_credit_invoices ci WHERE ci.tenant_id=a.tenant_id AND ci.branch_id=a.branch_id AND ci.corporate_account_id=a.id AND ci.status IN ('open','partially_paid')),0)+COALESCE((SELECT SUM(s.total_paise-s.paid_paise) FROM pos_sales s WHERE s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id AND s.corporate_account_id=a.id AND s.status NOT IN ('voided','cancelled','refunded') AND NOT EXISTS (SELECT 1 FROM corporate_credit_invoices ci WHERE ci.tenant_id=s.tenant_id AND ci.branch_id=s.branch_id AND ci.sale_id=s.id)),0))::BIGINT outstanding_paise,a.payment_terms_days,a.status,a.created_at FROM corporate_billing_accounts a WHERE a.tenant_id=$1 AND a.branch_id=$2 ORDER BY a.account_name")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn create_corporate_account(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    email: &str,
    phone: &str,
    gstin: &str,
    limit: i64,
    terms: i32,
) -> Result<CorporateAccount, sqlx::Error> {
    let mut tx = db.begin().await?;
    let code = next_branch_code(&mut tx, tenant, branch, BusinessCodeKind::CorporateAccount).await?;
    let row = sqlx::query_as("INSERT INTO corporate_billing_accounts (tenant_id,branch_id,account_code,account_name,billing_email,phone,gstin,credit_limit_paise,payment_terms_days,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,account_code,account_name,billing_email,phone,gstin,credit_limit_paise,0::BIGINT outstanding_paise,payment_terms_days,status,created_at")
        .bind(tenant).bind(branch).bind(code).bind(name).bind(email).bind(phone).bind(gstin).bind(limit).bind(terms).bind(actor).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn assign_corporate_sale(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    sale_id: &str,
    account_id: &str,
    reference: &str,
) -> Result<Option<(String, String, i64, i64)>, sqlx::Error> {
    sqlx::query_as(
        "WITH account AS MATERIALIZED (SELECT id,account_name,credit_limit_paise FROM corporate_billing_accounts WHERE tenant_id=$1 AND branch_id=$2 AND id=$4 AND status='active' FOR UPDATE), outstanding AS (SELECT COALESCE(SUM(s.total_paise-s.paid_paise) FILTER (WHERE s.status NOT IN ('voided','cancelled','refunded')),0)::BIGINT amount FROM pos_sales s,account a WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.corporate_account_id=a.id AND s.id<>$3), updated AS (UPDATE pos_sales s SET corporate_account_id=a.id,corporate_reference=$5,updated_at=NOW() FROM account a,outstanding o WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND o.amount+(s.total_paise-s.paid_paise) <= a.credit_limit_paise RETURNING s.id,a.account_name,a.credit_limit_paise,o.amount+(s.total_paise-s.paid_paise) new_outstanding) SELECT * FROM updated",
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_id)
    .bind(account_id)
    .bind(reference)
    .fetch_optional(db)
    .await
}
