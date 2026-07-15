use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiGovernanceRecord {
    pub enabled: bool,
    pub allowed_channels: Value,
    pub require_booking_confirmation: bool,
    pub redact_sensitive_data: bool,
    pub transcript_retention_days: i32,
    pub prompt_version: String,
    pub booking_url: String,
    pub updated_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionRecord {
    pub id: String,
    pub channel: String,
    pub external_thread_id: String,
    pub client_id: Option<String>,
    pub user_id: Option<String>,
    pub locale: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiMessageRecord {
    pub id: String,
    pub role: String,
    pub body: String,
    pub provider: String,
    pub model_name: String,
    pub prompt_version: String,
    pub intent: String,
    pub safety_flags: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceCandidate {
    pub id: String,
    pub name: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
}

pub async fn governance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<AiGovernanceRecord>, sqlx::Error> {
    sqlx::query_as("SELECT enabled,allowed_channels,require_booking_confirmation,redact_sensitive_data,transcript_retention_days,prompt_version,booking_url,updated_by,created_at,updated_at FROM ai_governance_settings WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant_id).bind(branch_id).fetch_optional(db).await
}

pub async fn save_governance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    enabled: bool,
    allowed_channels: &Value,
    require_booking_confirmation: bool,
    redact_sensitive_data: bool,
    transcript_retention_days: i32,
    prompt_version: &str,
    booking_url: &str,
    updated_by: &str,
) -> Result<AiGovernanceRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_governance_settings(
              tenant_id,branch_id,enabled,allowed_channels,require_booking_confirmation,
              redact_sensitive_data,transcript_retention_days,prompt_version,booking_url,updated_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
              enabled=EXCLUDED.enabled,allowed_channels=EXCLUDED.allowed_channels,
              require_booking_confirmation=EXCLUDED.require_booking_confirmation,
              redact_sensitive_data=EXCLUDED.redact_sensitive_data,
              transcript_retention_days=EXCLUDED.transcript_retention_days,
              prompt_version=EXCLUDED.prompt_version,booking_url=EXCLUDED.booking_url,
              updated_by=EXCLUDED.updated_by,updated_at=NOW()
            RETURNING enabled,allowed_channels,require_booking_confirmation,redact_sensitive_data,
              transcript_retention_days,prompt_version,booking_url,updated_by,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(enabled)
    .bind(allowed_channels)
    .bind(require_booking_confirmation)
    .bind(redact_sensitive_data)
    .bind(transcript_retention_days)
    .bind(prompt_version)
    .bind(booking_url)
    .bind(updated_by)
    .fetch_one(db)
    .await
}

pub async fn open_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    channel: &str,
    external_thread_id: &str,
    client_id: Option<&str>,
    user_id: Option<&str>,
    locale: &str,
) -> Result<Option<AiSessionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_concierge_sessions(
              tenant_id,branch_id,channel,external_thread_id,client_id,user_id,locale
            ) SELECT $1,$2,$3,$4,$5,$6,$7
            WHERE ($5::TEXT IS NULL OR EXISTS(
              SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$5 AND active=TRUE
            ))
            ON CONFLICT(tenant_id,branch_id,channel,external_thread_id) DO UPDATE SET
              status=CASE WHEN ai_concierge_sessions.status='closed' THEN 'active' ELSE ai_concierge_sessions.status END,
              client_id=COALESCE(EXCLUDED.client_id,ai_concierge_sessions.client_id),
              user_id=COALESCE(EXCLUDED.user_id,ai_concierge_sessions.user_id),updated_at=NOW()
            RETURNING id,channel,external_thread_id,client_id,user_id,locale,status,created_at,updated_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(channel).bind(external_thread_id)
    .bind(client_id).bind(user_id).bind(locale).fetch_optional(db).await
}

pub async fn session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Result<Option<AiSessionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,channel,external_thread_id,client_id,user_id,locale,status,created_at,updated_at FROM ai_concierge_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(session_id).fetch_optional(db).await
}

pub async fn messages(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    limit: i64,
) -> Result<Vec<AiMessageRecord>, sqlx::Error> {
    let mut rows = sqlx::query_as(
        r#"SELECT id,role,body,provider,model_name,prompt_version,intent,safety_flags,created_at
             FROM ai_concierge_messages WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3
            ORDER BY created_at DESC,id DESC LIMIT $4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(limit)
    .fetch_all(db)
    .await?;
    rows.reverse();
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub async fn add_message(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    role: &str,
    body: &str,
    provider: &str,
    model_name: &str,
    prompt_version: &str,
    intent: &str,
    safety_flags: &Value,
    provider_message_id: Option<&str>,
) -> Result<Option<AiMessageRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_concierge_messages(
              tenant_id,branch_id,session_id,role,body,provider,model_name,prompt_version,
              intent,safety_flags,provider_message_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT(tenant_id,branch_id,provider_message_id)
              WHERE provider_message_id IS NOT NULL DO NOTHING
            RETURNING id,role,body,provider,model_name,prompt_version,intent,safety_flags,created_at"#,
    ).bind(tenant_id).bind(branch_id).bind(session_id).bind(role).bind(body)
      .bind(provider).bind(model_name).bind(prompt_version).bind(intent).bind(safety_flags)
      .bind(provider_message_id).fetch_optional(db).await
}

pub async fn services(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AiServiceCandidate>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,name,duration_minutes,price_paise::BIGINT AS price_paise FROM services
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
            ORDER BY name LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn add_action(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    message_id: &str,
    action_type: &str,
    payload: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO ai_concierge_actions(tenant_id,branch_id,session_id,message_id,action_type,payload_json) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(session_id).bind(message_id).bind(action_type).bind(payload)
        .execute(db).await.map(|_| ())
}

pub async fn set_session_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE ai_concierge_sessions SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(session_id).bind(status).execute(db).await.map(|_| ())
}

pub async fn active_branch_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM branches WHERE tenant_id=$1 AND (id::TEXT=$2 OR scope_id=$2) AND active=TRUE)")
        .bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn resolve_client_by_phone(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    phone: &str,
) -> Result<Option<String>, sqlx::Error> {
    let digits = phone
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    sqlx::query_scalar("SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g')=$3 ORDER BY id LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(digits).fetch_optional(db).await
}

pub async fn purge_expired_transcripts(db: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM ai_concierge_messages message
            USING ai_concierge_sessions session,ai_governance_settings policy
            WHERE session.id=message.session_id
              AND policy.tenant_id=message.tenant_id AND policy.branch_id=message.branch_id
              AND message.created_at < NOW()-(policy.transcript_retention_days || ' days')::INTERVAL"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}
