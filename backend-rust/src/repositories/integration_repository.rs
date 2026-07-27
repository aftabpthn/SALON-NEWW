use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyRecord {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub scopes_json: Value,
    pub status: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub integration_type: String,
    pub rate_limit_per_minute: i32,
    pub ip_allowlist_json: Value,
    pub last_used_ip: Option<String>,
}

#[derive(Debug, FromRow)]
pub struct ApiKeyCredential {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub secret_hash: String,
    pub scopes_json: Value,
    pub integration_type: String,
    pub rate_limit_per_minute: i32,
    pub ip_allowlist_json: Value,
}

#[derive(Debug, Clone, FromRow)]
pub struct WebhookRecord {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub events_json: Value,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct WebhookDeliveryRecord {
    pub id: String,
    pub endpoint_url: String,
    pub secret_ciphertext: String,
    pub event_type: String,
    pub event_id: String,
    pub payload_json: Value,
    pub attempts: i32,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryLog {
    pub id: String,
    pub subscription_id: String,
    pub event_type: String,
    pub event_id: String,
    pub status: String,
    pub attempts: i32,
    pub response_status: Option<i32>,
    pub last_error: String,
    pub delivered_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorRecord {
    pub id: String,
    pub provider: String,
    pub display_name: String,
    pub status: String,
    pub external_account_id: String,
    pub external_account_name: String,
    pub scopes_json: Value,
    pub config_json: Value,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct ConnectorCredential {
    pub id: String,
    pub access_token_ciphertext: String,
    pub refresh_token_ciphertext: String,
    pub token_expires_at: Option<DateTime<Utc>>,
    pub external_account_id: String,
    pub config_json: Value,
}

#[derive(Debug, FromRow)]
pub struct ConnectorOauthState {
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: String,
    pub actor_id: String,
    pub code_verifier: String,
    pub return_uri: String,
    pub config_json: Value,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSyncJob {
    pub id: String,
    pub provider: String,
    pub trigger_source: String,
    pub status: String,
    pub attempts: i32,
    pub result_json: Value,
    pub last_error: String,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct ClaimedConnectorSyncJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub connection_id: String,
    pub provider: String,
    pub attempts: i32,
}

const API_KEY_COLUMNS: &str = "id,name,key_prefix,scopes_json,status,expires_at,last_used_at,created_at,integration_type,rate_limit_per_minute,ip_allowlist_json,last_used_ip";

pub async fn list_api_keys(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ApiKeyRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {API_KEY_COLUMNS} FROM integration_api_keys WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC"))
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn insert_api_key(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    prefix: &str,
    secret_hash: &str,
    scopes: &Value,
    expires_at: Option<DateTime<Utc>>,
    actor: &str,
    rotated_from: Option<&str>,
    controls: ApiKeyControls<'_>,
) -> Result<ApiKeyRecord, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO integration_api_keys(tenant_id,branch_id,name,key_prefix,secret_hash,scopes_json,expires_at,created_by,rotated_from_id,integration_type,rate_limit_per_minute,ip_allowlist_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING {API_KEY_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(name).bind(prefix).bind(secret_hash).bind(scopes).bind(expires_at).bind(actor).bind(rotated_from)
        .bind(controls.integration_type).bind(controls.rate_limit_per_minute).bind(controls.ip_allowlist)
        .fetch_one(db).await
}

/// Per-key machine-integration controls stored alongside the hashed secret.
pub struct ApiKeyControls<'a> {
    pub integration_type: &'a str,
    pub rate_limit_per_minute: i32,
    pub ip_allowlist: &'a Value,
}

pub async fn rotate_api_key(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    name: &str,
    prefix: &str,
    secret_hash: &str,
    scopes: &Value,
    expires_at: Option<DateTime<Utc>>,
    actor: &str,
    controls: ApiKeyControls<'_>,
) -> Result<Option<ApiKeyRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "WITH revoked AS (\
           UPDATE integration_api_keys \
              SET status='revoked',revoked_by=$9,revoked_at=NOW() \
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' \
            RETURNING id\
         ) \
         INSERT INTO integration_api_keys(\
           tenant_id,branch_id,name,key_prefix,secret_hash,scopes_json,expires_at,created_by,rotated_from_id,\
           integration_type,rate_limit_per_minute,ip_allowlist_json,rotated_at\
         ) \
         SELECT $1,$2,$4,$5,$6,$7,$8,$9,revoked.id,$10,$11,$12,NOW() FROM revoked \
         RETURNING {API_KEY_COLUMNS}"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(name)
    .bind(prefix)
    .bind(secret_hash)
    .bind(scopes)
    .bind(expires_at)
    .bind(actor)
    .bind(controls.integration_type)
    .bind(controls.rate_limit_per_minute)
    .bind(controls.ip_allowlist)
    .fetch_optional(db)
    .await
}

pub async fn revoke_api_key(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE integration_api_keys SET status='revoked',revoked_by=$4,revoked_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).execute(db).await?.rows_affected()>0)
}

pub async fn active_api_key(
    db: &PgPool,
    prefix: &str,
) -> Result<Option<ApiKeyCredential>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,secret_hash,scopes_json,integration_type,rate_limit_per_minute,ip_allowlist_json FROM integration_api_keys WHERE key_prefix=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())")
        .bind(prefix).fetch_optional(db).await
}

pub async fn touch_api_key(
    db: &PgPool,
    id: &str,
    client_ip: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE integration_api_keys SET last_used_at=NOW(), last_used_ip=COALESCE($2,last_used_ip) WHERE id=$1")
        .bind(id)
        .bind(client_ip)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn api_clients(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'code',code,'firstName',first_name,'lastName',last_name,'phone',phone,'email',email,'active',active,'createdAt',created_at,'updatedAt',updated_at) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id IS NULL ORDER BY created_at DESC,id LIMIT $3")
        .bind(tenant_id).bind(branch_id).bind(limit).fetch_all(db).await
}
pub async fn api_appointments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'clientId',client_id,'staffId',staff_id,'startAt',start_at,'endAt',end_at,'status',status,'createdAt',created_at,'updatedAt',updated_at) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 ORDER BY start_at DESC,id LIMIT $3").bind(tenant_id).bind(branch_id).bind(limit).fetch_all(db).await
}
pub async fn api_sales(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'invoiceNumber',invoice_number,'clientId',client_id,'totalPaise',total_paise,'paidPaise',paid_paise,'status',status,'createdAt',created_at,'updatedAt',updated_at) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC,id LIMIT $3").bind(tenant_id).bind(branch_id).bind(limit).fetch_all(db).await
}

pub async fn list_webhooks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WebhookRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,endpoint_url,events_json,active,created_at,updated_at FROM integration_webhook_subscriptions WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn insert_webhook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    endpoint: &str,
    events: &Value,
    secret_ciphertext: &str,
    actor: &str,
) -> Result<WebhookRecord, sqlx::Error> {
    sqlx::query_as("INSERT INTO integration_webhook_subscriptions(tenant_id,branch_id,name,endpoint_url,events_json,secret_ciphertext,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,name,endpoint_url,events_json,active,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(name).bind(endpoint).bind(events).bind(secret_ciphertext).bind(actor).fetch_one(db).await
}

pub async fn update_webhook_secret(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    secret_ciphertext: &str,
    actor: &str,
) -> Result<Option<WebhookRecord>, sqlx::Error> {
    sqlx::query_as("UPDATE integration_webhook_subscriptions SET secret_ciphertext=$4,active=TRUE,updated_by=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,name,endpoint_url,events_json,active,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(secret_ciphertext).bind(actor).fetch_optional(db).await
}

pub async fn deactivate_webhook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE integration_webhook_subscriptions SET active=FALSE,updated_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).execute(db).await?.rows_affected()>0)
}

pub async fn enqueue_webhook_test(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subscription_id: &str,
) -> Result<bool, sqlx::Error> {
    let event_id = format!("test:{}", uuid::Uuid::new_v4());
    Ok(sqlx::query("INSERT INTO integration_webhook_deliveries(tenant_id,branch_id,subscription_id,event_type,event_id,payload_json) SELECT tenant_id,branch_id,id,'integration.test',$4,jsonb_build_object('id',$4,'type','integration.test','createdAt',NOW(),'data',jsonb_build_object()) FROM integration_webhook_subscriptions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(subscription_id).bind(event_id).execute(db).await?.rows_affected()>0)
}

pub async fn claim_webhook_deliveries(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<WebhookDeliveryRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows=sqlx::query_as("WITH due AS (SELECT d.id FROM integration_webhook_deliveries d JOIN integration_webhook_subscriptions s ON s.id=d.subscription_id WHERE d.status IN ('queued','failed') AND d.next_attempt_at<=NOW() AND d.attempts<d.max_attempts AND s.active=TRUE ORDER BY d.next_attempt_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT $1) UPDATE integration_webhook_deliveries d SET status='processing',attempts=d.attempts+1,updated_at=NOW() FROM due,integration_webhook_subscriptions s WHERE d.id=due.id AND s.id=d.subscription_id RETURNING d.id,s.endpoint_url,s.secret_ciphertext,d.event_type,d.event_id,d.payload_json,d.attempts")
        .bind(limit).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn mark_webhook_delivered(db: &PgPool, id: &str, status: i32) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE integration_webhook_deliveries SET status='delivered',response_status=$2,last_error='',delivered_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(id).bind(status).execute(db).await?;
    Ok(())
}

pub async fn mark_webhook_failed(
    db: &PgPool,
    row: &WebhookDeliveryRecord,
    status: Option<i32>,
    error: &str,
) -> Result<(), sqlx::Error> {
    let delay = i64::from(row.attempts.max(1)).saturating_mul(5).min(360);
    sqlx::query("UPDATE integration_webhook_deliveries SET status='failed',response_status=$2,last_error=$3,next_attempt_at=NOW()+($4::BIGINT*INTERVAL '1 minute'),updated_at=NOW() WHERE id=$1")
        .bind(&row.id).bind(status).bind(error).bind(delay).execute(db).await?;
    Ok(())
}

pub async fn webhook_logs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subscription_id: Option<&str>,
) -> Result<Vec<WebhookDeliveryLog>, sqlx::Error> {
    sqlx::query_as("SELECT id,subscription_id,event_type,event_id,status,attempts,response_status,last_error,delivered_at,created_at,updated_at FROM integration_webhook_deliveries WHERE tenant_id=$1 AND branch_id=$2 AND ($3::TEXT IS NULL OR subscription_id=$3) ORDER BY created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).bind(subscription_id).fetch_all(db).await
}

const CONNECTOR_COLUMNS: &str = "id,provider,display_name,status,external_account_id,external_account_name,scopes_json,config_json,last_synced_at,last_error,created_at,updated_at";

pub async fn list_connectors(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ConnectorRecord>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {CONNECTOR_COLUMNS} FROM integration_connector_connections WHERE tenant_id=$1 AND branch_id=$2 ORDER BY provider"))
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn save_connector_oauth_state(
    db: &PgPool,
    state_hash: &str,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    actor_id: &str,
    code_verifier: &str,
    return_uri: &str,
    config_json: &Value,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM integration_oauth_states WHERE expires_at<=NOW()")
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO integration_oauth_states(state_hash,tenant_id,branch_id,provider,actor_id,code_verifier,return_uri,config_json,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(state_hash).bind(tenant_id).bind(branch_id).bind(provider).bind(actor_id)
        .bind(code_verifier).bind(return_uri).bind(config_json).bind(expires_at).execute(db).await?;
    Ok(())
}

pub async fn consume_connector_oauth_state(
    db: &PgPool,
    state_hash: &str,
) -> Result<Option<ConnectorOauthState>, sqlx::Error> {
    sqlx::query_as("DELETE FROM integration_oauth_states WHERE state_hash=$1 AND expires_at>NOW() RETURNING tenant_id,branch_id,provider,actor_id,code_verifier,return_uri,config_json")
        .bind(state_hash).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert_connector(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    display_name: &str,
    external_account_id: &str,
    external_account_name: &str,
    access_token_ciphertext: &str,
    refresh_token_ciphertext: &str,
    token_expires_at: Option<DateTime<Utc>>,
    scopes_json: &Value,
    config_json: &Value,
    actor_id: &str,
) -> Result<ConnectorRecord, sqlx::Error> {
    sqlx::query_as(&format!(r#"
        INSERT INTO integration_connector_connections(
          tenant_id,branch_id,provider,display_name,status,external_account_id,external_account_name,
          access_token_ciphertext,refresh_token_ciphertext,token_expires_at,scopes_json,config_json,created_by,updated_by
        ) VALUES($1,$2,$3,$4,'connected',$5,$6,$7,$8,$9,$10,$11,$12,$12)
        ON CONFLICT(tenant_id,branch_id,provider) DO UPDATE SET
          display_name=EXCLUDED.display_name,status='connected',external_account_id=EXCLUDED.external_account_id,
          external_account_name=EXCLUDED.external_account_name,access_token_ciphertext=EXCLUDED.access_token_ciphertext,
          refresh_token_ciphertext=CASE WHEN EXCLUDED.refresh_token_ciphertext='' THEN integration_connector_connections.refresh_token_ciphertext ELSE EXCLUDED.refresh_token_ciphertext END,
          token_expires_at=EXCLUDED.token_expires_at,scopes_json=EXCLUDED.scopes_json,config_json=EXCLUDED.config_json,
          last_error='',updated_by=EXCLUDED.updated_by,updated_at=NOW()
        RETURNING {CONNECTOR_COLUMNS}
    "#))
    .bind(tenant_id).bind(branch_id).bind(provider).bind(display_name)
    .bind(external_account_id).bind(external_account_name).bind(access_token_ciphertext)
    .bind(refresh_token_ciphertext).bind(token_expires_at).bind(scopes_json).bind(config_json)
    .bind(actor_id).fetch_one(db).await
}

pub async fn connector_credential(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
) -> Result<Option<ConnectorCredential>, sqlx::Error> {
    sqlx::query_as("SELECT id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,external_account_id,config_json FROM integration_connector_connections WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3 AND status IN ('connected','error')")
        .bind(tenant_id).bind(branch_id).bind(provider).fetch_optional(db).await
}

pub async fn update_connector_access_token(
    db: &PgPool,
    id: &str,
    access_token_ciphertext: &str,
    refresh_token_ciphertext: &str,
    token_expires_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE integration_connector_connections SET access_token_ciphertext=$2,refresh_token_ciphertext=CASE WHEN $3='' THEN refresh_token_ciphertext ELSE $3 END,token_expires_at=$4,status='connected',last_error='',updated_at=NOW() WHERE id=$1")
        .bind(id).bind(access_token_ciphertext).bind(refresh_token_ciphertext).bind(token_expires_at).execute(db).await?;
    Ok(())
}

pub async fn disconnect_connector(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    actor_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE integration_connector_connections SET status='disconnected',access_token_ciphertext='',refresh_token_ciphertext='',token_expires_at=NULL,last_error='',updated_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3 AND status<>'disconnected'")
        .bind(tenant_id).bind(branch_id).bind(provider).bind(actor_id).execute(db).await?.rows_affected()>0)
}

pub async fn enqueue_connector_sync(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    trigger_source: &str,
    actor_id: &str,
) -> Result<Option<ConnectorSyncJob>, sqlx::Error> {
    sqlx::query_as("INSERT INTO integration_connector_sync_jobs(tenant_id,branch_id,connection_id,provider,trigger_source,created_by) SELECT tenant_id,branch_id,id,provider,$4,$5 FROM integration_connector_connections WHERE tenant_id=$1 AND branch_id=$2 AND provider=$3 AND status='connected' RETURNING id,provider,trigger_source,status,attempts,result_json,last_error,created_at,completed_at")
        .bind(tenant_id).bind(branch_id).bind(provider).bind(trigger_source).bind(actor_id).fetch_optional(db).await
}

pub async fn list_connector_sync_jobs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ConnectorSyncJob>, sqlx::Error> {
    sqlx::query_as("SELECT id,provider,trigger_source,status,attempts,result_json,last_error,created_at,completed_at FROM integration_connector_sync_jobs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn claim_connector_sync_jobs(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<ClaimedConnectorSyncJob>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows=sqlx::query_as("WITH due AS (SELECT id FROM integration_connector_sync_jobs WHERE status IN ('queued','failed') AND next_attempt_at<=NOW() AND attempts<max_attempts ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE integration_connector_sync_jobs j SET status='processing',attempts=j.attempts+1,started_at=COALESCE(j.started_at,NOW()),updated_at=NOW() FROM due WHERE j.id=due.id RETURNING j.id,j.tenant_id,j.branch_id,j.connection_id,j.provider,j.attempts")
        .bind(limit).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn complete_connector_sync(
    db: &PgPool,
    job_id: &str,
    connection_id: &str,
    result_json: &Value,
    external_account_id: &str,
    external_account_name: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_connector_sync_jobs SET status='completed',result_json=$2,last_error='',completed_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(job_id).bind(result_json).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_connector_connections SET status='connected',external_account_id=CASE WHEN $2='' THEN external_account_id ELSE $2 END,external_account_name=CASE WHEN $3='' THEN external_account_name ELSE $3 END,last_synced_at=NOW(),last_error='',updated_at=NOW() WHERE id=$1")
        .bind(connection_id).bind(external_account_id).bind(external_account_name).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn fail_connector_sync(
    db: &PgPool,
    job: &ClaimedConnectorSyncJob,
    error: &str,
) -> Result<(), sqlx::Error> {
    let delay = i64::from(job.attempts.max(1)).saturating_mul(5).min(120);
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE integration_connector_sync_jobs SET status='failed',last_error=$2,next_attempt_at=NOW()+($3::BIGINT*INTERVAL '1 minute'),updated_at=NOW() WHERE id=$1")
        .bind(&job.id).bind(error).bind(delay).execute(&mut *tx).await?;
    sqlx::query("UPDATE integration_connector_connections SET status='error',last_error=$2,updated_at=NOW() WHERE id=$1")
        .bind(&job.connection_id).bind(error).execute(&mut *tx).await?;
    tx.commit().await
}
