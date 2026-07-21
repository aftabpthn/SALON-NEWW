use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppSummary {
    pub total_messages: i64,
    pub inbound_messages: i64,
    pub outbound_messages: i64,
    pub delivered_messages: i64,
    pub failed_messages: i64,
    pub thread_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppThread {
    pub client_id: String,
    pub client_name: String,
    pub recipient: String,
    pub last_message_id: String,
    pub last_direction: String,
    pub last_status: String,
    pub last_body: String,
    pub last_occurred_at: DateTime<Utc>,
    pub message_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppMessage {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub direction: String,
    pub status: String,
    pub recipient: String,
    pub subject: String,
    pub body: String,
    pub provider_message_id: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppRule {
    pub id: String,
    pub name: String,
    pub trigger_event: String,
    pub action_template: String,
    pub status: String,
    pub priority: i32,
    pub config_json: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppHandoff {
    pub id: String,
    pub thread_id: String,
    pub client_id: Option<String>,
    pub reason: String,
    pub priority: String,
    pub status: String,
    pub assigned_to: String,
    pub note: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppCampaignPlan {
    pub id: String,
    pub campaign_type: String,
    pub title: String,
    pub objective: String,
    pub message_text: String,
    pub segment_key: String,
    pub criteria_json: Value,
    pub status: String,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub created_by: String,
    pub approved_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppCampaignOutcome {
    pub id: String,
    pub plan_id: String,
    pub sent_count: i32,
    pub delivered_count: i32,
    pub reply_count: i32,
    pub booking_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageTemplate {
    pub id: String,
    pub template_key: String,
    pub name: String,
    pub channel: String,
    pub audience: String,
    pub event_key: String,
    pub body: String,
    pub provider_template_id: String,
    pub language: String,
    pub service_id: String,
    pub occasion_key: String,
    pub offer_id: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageHistorySettings {
    pub branch_id: String,
    pub settings_json: Value,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4())
}

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<WhatsAppSummary, sqlx::Error> {
    sqlx::query_as::<_, WhatsAppSummary>(
        r#"
        SELECT COUNT(*)::BIGINT AS total_messages,
               COUNT(*) FILTER (WHERE direction='inbound')::BIGINT AS inbound_messages,
               COUNT(*) FILTER (WHERE direction='outbound')::BIGINT AS outbound_messages,
               COUNT(*) FILTER (WHERE status IN ('delivered','read','sent'))::BIGINT AS delivered_messages,
               COUNT(*) FILTER (WHERE status IN ('failed','error'))::BIGINT AS failed_messages,
               COUNT(DISTINCT client_id)::BIGINT AS thread_count
          FROM client_communications
         WHERE tenant_id=$1 AND branch_id=$2 AND channel='whatsapp'
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn threads(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WhatsAppThread>, sqlx::Error> {
    sqlx::query_as::<_, WhatsAppThread>(
        r#"
        WITH ranked AS (
          SELECT communication.*,
                 ROW_NUMBER() OVER (PARTITION BY communication.client_id ORDER BY communication.occurred_at DESC, communication.id DESC) AS row_number,
                 COUNT(*) OVER (PARTITION BY communication.client_id)::BIGINT AS message_count
            FROM client_communications communication
           WHERE communication.tenant_id=$1 AND communication.branch_id=$2 AND communication.channel='whatsapp'
        )
        SELECT ranked.client_id,
               TRIM(CONCAT_WS(' ', client.first_name, client.last_name)) AS client_name,
               ranked.recipient,
               ranked.id AS last_message_id,
               ranked.direction AS last_direction,
               ranked.status AS last_status,
               ranked.body AS last_body,
               ranked.occurred_at AS last_occurred_at,
               ranked.message_count
          FROM ranked
          JOIN clients client ON client.tenant_id=ranked.tenant_id
                             AND client.branch_id=ranked.branch_id
                             AND client.id=ranked.client_id
         WHERE ranked.row_number=1
         ORDER BY ranked.occurred_at DESC, ranked.id DESC
         LIMIT 200
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn messages(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
) -> Result<Vec<WhatsAppMessage>, sqlx::Error> {
    let client_id = client_id.unwrap_or_default().trim();
    sqlx::query_as::<_, WhatsAppMessage>(
        r#"
        SELECT communication.id,
               communication.client_id,
               TRIM(CONCAT_WS(' ', client.first_name, client.last_name)) AS client_name,
               communication.direction,
               communication.status,
               communication.recipient,
               communication.subject,
               communication.body,
               communication.provider_message_id,
               communication.occurred_at
          FROM client_communications communication
          JOIN clients client ON client.tenant_id=communication.tenant_id
                             AND client.branch_id=communication.branch_id
                             AND client.id=communication.client_id
         WHERE communication.tenant_id=$1 AND communication.branch_id=$2
           AND communication.channel='whatsapp'
           AND ($3='' OR communication.client_id=$3)
         ORDER BY communication.occurred_at DESC, communication.id DESC
         LIMIT 500
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(db)
    .await
}

pub async fn insert_inbound(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    phone: &str,
    body: &str,
    provider_message_id: &str,
) -> Result<WhatsAppMessage, sqlx::Error> {
    sqlx::query_as::<_, WhatsAppMessage>(
        r#"
        INSERT INTO client_communications (
          tenant_id, branch_id, client_id, source_type, source_id, channel, direction,
          status, recipient, subject, body, provider_message_id, occurred_at, updated_at
        ) VALUES (
          $1, $2, $3, 'provider', gen_random_uuid()::TEXT, 'whatsapp', 'inbound',
          'received', $4, 'Inbound WhatsApp', $5, $6, NOW(), NOW()
        )
        ON CONFLICT (tenant_id, branch_id, channel, provider_message_id)
        WHERE provider_message_id <> ''
        DO UPDATE SET body=EXCLUDED.body, updated_at=NOW()
        RETURNING id, client_id,
          (SELECT TRIM(CONCAT_WS(' ', first_name, last_name)) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3) AS client_name,
          direction, status, recipient, subject, body, provider_message_id, occurred_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(phone)
    .bind(body)
    .bind(provider_message_id)
    .fetch_one(db)
    .await
}

pub async fn find_client_by_phone(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    phone: &str,
) -> Result<Option<String>, sqlx::Error> {
    let normalized = phone
        .chars()
        .filter(|value| value.is_ascii_digit())
        .collect::<String>();
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT id
          FROM clients
         WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL
           AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = $3
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(normalized)
    .fetch_optional(db)
    .await
}

pub async fn client_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM clients
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
             AND active=TRUE AND merged_into_client_id IS NULL
        )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_one(db)
    .await
}

pub async fn rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WhatsAppRule>, sqlx::Error> {
    sqlx::query_as("SELECT id,name,trigger_event,action_template,status,priority,config_json,created_at,updated_at FROM whatsapp_automation_rules WHERE tenant_id=$1 AND branch_id=$2 AND status <> 'archived' ORDER BY priority ASC, created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn handoffs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WhatsAppHandoff>, sqlx::Error> {
    sqlx::query_as("SELECT id,thread_id,client_id,reason,priority,status,assigned_to,note,created_at,updated_at FROM whatsapp_handoffs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn create_handoff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    thread_id: &str,
    client_id: Option<&str>,
    reason: &str,
    priority: &str,
    assigned_to: &str,
) -> Result<WhatsAppHandoff, sqlx::Error> {
    sqlx::query_as("INSERT INTO whatsapp_handoffs (id,tenant_id,branch_id,thread_id,client_id,reason,priority,assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,thread_id,client_id,reason,priority,status,assigned_to,note,created_at,updated_at")
        .bind(new_id("handoff")).bind(tenant_id).bind(branch_id).bind(thread_id).bind(client_id).bind(reason).bind(priority).bind(assigned_to).fetch_one(db).await
}

pub async fn update_handoff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    assigned_to: &str,
    note: &str,
) -> Result<Option<WhatsAppHandoff>, sqlx::Error> {
    sqlx::query_as("UPDATE whatsapp_handoffs SET status=$4,assigned_to=$5,note=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND $4 IN ('open','assigned','resolved') RETURNING id,thread_id,client_id,reason,priority,status,assigned_to,note,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(assigned_to).bind(note).fetch_optional(db).await
}

pub async fn campaign_plans(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WhatsAppCampaignPlan>, sqlx::Error> {
    sqlx::query_as("SELECT id,campaign_type,title,objective,message_text,segment_key,criteria_json,status,scheduled_for,created_by,approved_by,created_at,updated_at FROM whatsapp_campaign_plans WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn create_campaign_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    campaign_type: &str,
    title: &str,
    objective: &str,
    message_text: &str,
    segment_key: &str,
    criteria: &Value,
    created_by: &str,
) -> Result<WhatsAppCampaignPlan, sqlx::Error> {
    sqlx::query_as("INSERT INTO whatsapp_campaign_plans (id,tenant_id,branch_id,campaign_type,title,objective,message_text,segment_key,criteria_json,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,campaign_type,title,objective,message_text,segment_key,criteria_json,status,scheduled_for,created_by,approved_by,created_at,updated_at")
        .bind(new_id("wacp")).bind(tenant_id).bind(branch_id).bind(campaign_type).bind(title).bind(objective).bind(message_text).bind(segment_key).bind(criteria).bind(created_by).fetch_one(db).await
}

pub async fn update_campaign_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    actor: &str,
    scheduled_for: Option<DateTime<Utc>>,
) -> Result<Option<WhatsAppCampaignPlan>, sqlx::Error> {
    sqlx::query_as("UPDATE whatsapp_campaign_plans SET status=$4,approved_by=CASE WHEN $4='approved' THEN $5 ELSE approved_by END,scheduled_for=COALESCE($6,scheduled_for),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id,campaign_type,title,objective,message_text,segment_key,criteria_json,status,scheduled_for,created_by,approved_by,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(actor).bind(scheduled_for).fetch_optional(db).await
}

pub async fn campaign_outcomes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<WhatsAppCampaignOutcome>, sqlx::Error> {
    sqlx::query_as("SELECT id,plan_id,sent_count,delivered_count,reply_count,booking_count,created_at,updated_at FROM whatsapp_campaign_outcomes WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn templates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MessageTemplate>, sqlx::Error> {
    sqlx::query_as("SELECT id,template_key,name,channel,audience,event_key,body,provider_template_id,language,service_id,occasion_key,offer_id,status,created_at,updated_at FROM message_templates WHERE tenant_id=$1 AND (branch_id=$2 OR branch_id='') AND status <> 'archived' ORDER BY channel,language,name LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn create_template(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
    name: &str,
    channel: &str,
    audience: &str,
    event_key: &str,
    body: &str,
    provider_template_id: &str,
    language: &str,
    service_id: &str,
    occasion_key: &str,
    offer_id: &str,
) -> Result<MessageTemplate, sqlx::Error> {
    sqlx::query_as("INSERT INTO message_templates (id,tenant_id,branch_id,template_key,name,channel,audience,event_key,body,provider_template_id,language,service_id,occasion_key,offer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,template_key,name,channel,audience,event_key,body,provider_template_id,language,service_id,occasion_key,offer_id,status,created_at,updated_at")
        .bind(new_id("msg_tpl")).bind(tenant_id).bind(branch_id).bind(key).bind(name).bind(channel).bind(audience).bind(event_key).bind(body).bind(provider_template_id).bind(language).bind(service_id).bind(occasion_key).bind(offer_id).fetch_one(db).await
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings: &Value,
    actor: &str,
) -> Result<MessageHistorySettings, sqlx::Error> {
    sqlx::query_as("INSERT INTO message_history_settings (tenant_id,branch_id,settings_json,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,branch_id) DO UPDATE SET settings_json=EXCLUDED.settings_json,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING branch_id,settings_json,updated_by,updated_at")
        .bind(tenant_id).bind(branch_id).bind(settings).bind(actor).fetch_one(db).await
}

pub async fn settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<MessageHistorySettings>, sqlx::Error> {
    sqlx::query_as("SELECT branch_id,settings_json,updated_by,updated_at FROM message_history_settings WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant_id).bind(branch_id).fetch_optional(db).await
}
