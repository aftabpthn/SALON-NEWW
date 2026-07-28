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
pub struct AiVoiceCallRecord {
    pub id: String,
    pub provider: String,
    pub provider_call_id: String,
    pub direction: String,
    pub caller_phone: String,
    pub salon_phone: String,
    pub staff_phone: String,
    pub status: String,
    pub started_at: Option<DateTime<Utc>>,
    pub answered_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub ring_duration_seconds: i32,
    pub conversation_duration_seconds: i32,
    pub recording_url: String,
    pub transcript_available: bool,
    pub ai_session_id: Option<String>,
    pub client_id: Option<String>,
    pub lead_id: Option<String>,
    pub appointment_id: Option<String>,
    pub pos_sale_id: Option<String>,
    pub ai_summary: String,
    pub ai_intent: String,
    pub ai_action_type: String,
    pub callback_required: bool,
    pub callback_due_at: Option<DateTime<Utc>>,
    pub lost_reason: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiVoiceCallReportSummary {
    pub total_calls: i64,
    pub answered_calls: i64,
    pub missed_calls: i64,
    pub unique_callers: i64,
    pub repeat_callers: i64,
    pub booking_drafts: i64,
    pub human_handoffs: i64,
    pub callback_required: i64,
    pub recordings: i64,
    pub transcript_calls: i64,
    pub linked_appointments: i64,
    pub linked_sales: i64,
    pub avg_ring_seconds: Option<f64>,
    pub avg_conversation_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiVoiceCallOpportunity {
    pub normalized_caller_phone: String,
    pub caller_phone: String,
    pub call_count: i64,
    pub missed_calls: i64,
    pub last_status: String,
    pub last_call_at: DateTime<Utc>,
    pub client_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiServiceCandidate {
    pub id: String,
    pub name: String,
    pub duration_minutes: i32,
    pub price_paise: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiOperationalContext {
    pub business_date: String,
    pub today_appointments: i64,
    pub open_appointments: i64,
    pub active_clients: i64,
    pub active_staff: i64,
    pub active_services: i64,
    pub top_service_name: Option<String>,
    pub top_service_quantity: Option<i64>,
    pub top_service_sales_paise: Option<i64>,
    pub today_sales_paise: i64,
    pub open_sales: i64,
    pub recent_completed_appointments: i64,
    pub low_stock_items: i64,
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

pub async fn operational_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<AiOperationalContext, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS business_date,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE) AS today_appointments,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(status) IN ('booked','confirmed','arrived','waiting','in-service','in_service')) AS open_appointments,
          (SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL) AS active_clients,
          (SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE) AS active_staff,
          (SELECT COUNT(*) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE) AS active_services,
          (SELECT NULLIF(line.item_name,'') FROM pos_sale_lines line JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service' AND LOWER(sale.status) IN ('completed','paid','closed') GROUP BY line.item_id,line.item_name ORDER BY SUM(line.quantity) DESC,SUM(line.line_total_paise) DESC LIMIT 1) AS top_service_name,
          (SELECT COALESCE(SUM(line.quantity),0)::BIGINT FROM pos_sale_lines line JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service' AND LOWER(sale.status) IN ('completed','paid','closed') GROUP BY line.item_id,line.item_name ORDER BY SUM(line.quantity) DESC,SUM(line.line_total_paise) DESC LIMIT 1) AS top_service_quantity,
          (SELECT COALESCE(SUM(line.line_total_paise),0)::BIGINT FROM pos_sale_lines line JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service' AND LOWER(sale.status) IN ('completed','paid','closed') GROUP BY line.item_id,line.item_name ORDER BY SUM(line.quantity) DESC,SUM(line.line_total_paise) DESC LIMIT 1) AS top_service_sales_paise,
          (SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND (created_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE) AS today_sales_paise,
          (SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(status) IN ('open','partial')) AS open_sales,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(status)='completed' AND updated_at>=NOW()-INTERVAL '7 days') AS recent_completed_appointments,
          (SELECT COUNT(*) FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND stock_quantity<=reorder_point) AS low_stock_items"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
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

#[allow(clippy::too_many_arguments)]
pub async fn upsert_voice_call_record(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    provider_call_id: &str,
    provider_event_id: &str,
    direction: &str,
    caller_phone: &str,
    normalized_caller_phone: &str,
    salon_phone: &str,
    staff_phone: &str,
    status: &str,
    started_at: Option<DateTime<Utc>>,
    answered_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    ring_duration_seconds: i32,
    conversation_duration_seconds: i32,
    recording_url: &str,
    transcript_available: bool,
    client_id: Option<&str>,
    ai_session_id: Option<&str>,
    ai_summary: &str,
    ai_intent: &str,
    ai_action_type: &str,
    callback_required: bool,
    callback_due_at: Option<DateTime<Utc>>,
    lost_reason: &str,
    metadata: &Value,
) -> Result<AiVoiceCallRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_voice_call_records(
              tenant_id,branch_id,provider,provider_call_id,provider_event_id,direction,
              caller_phone,normalized_caller_phone,salon_phone,staff_phone,status,
              started_at,answered_at,ended_at,ring_duration_seconds,conversation_duration_seconds,
              recording_url,transcript_available,client_id,ai_session_id,ai_summary,ai_intent,
              ai_action_type,callback_required,callback_due_at,lost_reason,metadata_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
            ON CONFLICT(tenant_id,branch_id,provider,provider_call_id) DO UPDATE SET
              provider_event_id=COALESCE(NULLIF(EXCLUDED.provider_event_id,''),ai_voice_call_records.provider_event_id),
              direction=EXCLUDED.direction,
              caller_phone=COALESCE(NULLIF(EXCLUDED.caller_phone,''),ai_voice_call_records.caller_phone),
              normalized_caller_phone=COALESCE(NULLIF(EXCLUDED.normalized_caller_phone,''),ai_voice_call_records.normalized_caller_phone),
              salon_phone=COALESCE(NULLIF(EXCLUDED.salon_phone,''),ai_voice_call_records.salon_phone),
              staff_phone=COALESCE(NULLIF(EXCLUDED.staff_phone,''),ai_voice_call_records.staff_phone),
              status=EXCLUDED.status,
              started_at=COALESCE(EXCLUDED.started_at,ai_voice_call_records.started_at),
              answered_at=COALESCE(EXCLUDED.answered_at,ai_voice_call_records.answered_at),
              ended_at=COALESCE(EXCLUDED.ended_at,ai_voice_call_records.ended_at),
              ring_duration_seconds=GREATEST(ai_voice_call_records.ring_duration_seconds,EXCLUDED.ring_duration_seconds),
              conversation_duration_seconds=GREATEST(ai_voice_call_records.conversation_duration_seconds,EXCLUDED.conversation_duration_seconds),
              recording_url=COALESCE(NULLIF(EXCLUDED.recording_url,''),ai_voice_call_records.recording_url),
              transcript_available=ai_voice_call_records.transcript_available OR EXCLUDED.transcript_available,
              client_id=COALESCE(EXCLUDED.client_id,ai_voice_call_records.client_id),
              ai_session_id=COALESCE(EXCLUDED.ai_session_id,ai_voice_call_records.ai_session_id),
              ai_summary=COALESCE(NULLIF(EXCLUDED.ai_summary,''),ai_voice_call_records.ai_summary),
              ai_intent=COALESCE(NULLIF(EXCLUDED.ai_intent,''),ai_voice_call_records.ai_intent),
              ai_action_type=COALESCE(NULLIF(EXCLUDED.ai_action_type,''),ai_voice_call_records.ai_action_type),
              callback_required=ai_voice_call_records.callback_required OR EXCLUDED.callback_required,
              callback_due_at=COALESCE(EXCLUDED.callback_due_at,ai_voice_call_records.callback_due_at),
              lost_reason=COALESCE(NULLIF(EXCLUDED.lost_reason,''),ai_voice_call_records.lost_reason),
              metadata_json=ai_voice_call_records.metadata_json || EXCLUDED.metadata_json,
              updated_at=NOW()
            RETURNING id,provider,provider_call_id,direction,caller_phone,salon_phone,staff_phone,status,
              started_at,answered_at,ended_at,ring_duration_seconds,conversation_duration_seconds,
              recording_url,transcript_available,ai_session_id,client_id,lead_id,appointment_id,pos_sale_id,
              ai_summary,ai_intent,ai_action_type,callback_required,callback_due_at,lost_reason,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(provider)
    .bind(provider_call_id)
    .bind(provider_event_id)
    .bind(direction)
    .bind(caller_phone)
    .bind(normalized_caller_phone)
    .bind(salon_phone)
    .bind(staff_phone)
    .bind(status)
    .bind(started_at)
    .bind(answered_at)
    .bind(ended_at)
    .bind(ring_duration_seconds)
    .bind(conversation_duration_seconds)
    .bind(recording_url)
    .bind(transcript_available)
    .bind(client_id)
    .bind(ai_session_id)
    .bind(ai_summary)
    .bind(ai_intent)
    .bind(ai_action_type)
    .bind(callback_required)
    .bind(callback_due_at)
    .bind(lost_reason)
    .bind(metadata)
    .fetch_one(db)
    .await
}

pub async fn voice_call_report_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> Result<AiVoiceCallReportSummary, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped AS (
             SELECT * FROM ai_voice_call_records
              WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(started_at,created_at) >= $3 AND COALESCE(started_at,created_at) < $4
           ), repeaters AS (
             SELECT normalized_caller_phone FROM scoped WHERE normalized_caller_phone <> ''
              GROUP BY normalized_caller_phone HAVING COUNT(*) >= 2
           )
           SELECT
             COUNT(*)::BIGINT AS total_calls,
             COUNT(*) FILTER (WHERE status IN ('answered','completed'))::BIGINT AS answered_calls,
             COUNT(*) FILTER (WHERE status IN ('missed','abandoned','busy','failed'))::BIGINT AS missed_calls,
             COUNT(DISTINCT NULLIF(normalized_caller_phone,''))::BIGINT AS unique_callers,
             (SELECT COUNT(*) FROM repeaters)::BIGINT AS repeat_callers,
             COUNT(*) FILTER (WHERE ai_action_type='booking_draft')::BIGINT AS booking_drafts,
             COUNT(*) FILTER (WHERE ai_action_type='human_handoff')::BIGINT AS human_handoffs,
             COUNT(*) FILTER (WHERE callback_required=TRUE)::BIGINT AS callback_required,
             COUNT(*) FILTER (WHERE recording_url <> '')::BIGINT AS recordings,
             COUNT(*) FILTER (WHERE transcript_available=TRUE)::BIGINT AS transcript_calls,
             COUNT(*) FILTER (WHERE appointment_id IS NOT NULL)::BIGINT AS linked_appointments,
             COUNT(*) FILTER (WHERE pos_sale_id IS NOT NULL)::BIGINT AS linked_sales,
             AVG(NULLIF(ring_duration_seconds,0))::FLOAT8 AS avg_ring_seconds,
             AVG(NULLIF(conversation_duration_seconds,0))::FLOAT8 AS avg_conversation_seconds
           FROM scoped"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_one(db)
    .await
}

pub async fn voice_call_opportunities(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> Result<Vec<AiVoiceCallOpportunity>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped AS (
             SELECT *, COALESCE(started_at,created_at) AS call_at
               FROM ai_voice_call_records
              WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(started_at,created_at) >= $3 AND COALESCE(started_at,created_at) < $4
                AND normalized_caller_phone <> ''
           ), ranked AS (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY normalized_caller_phone ORDER BY call_at DESC,id DESC) AS rn
               FROM scoped
           )
           SELECT normalized_caller_phone,
                  COALESCE(MAX(caller_phone) FILTER (WHERE rn=1),'') AS caller_phone,
                  COUNT(*)::BIGINT AS call_count,
                  COUNT(*) FILTER (WHERE status IN ('missed','abandoned','busy','failed'))::BIGINT AS missed_calls,
                  COALESCE(MAX(status) FILTER (WHERE rn=1),'received') AS last_status,
                  MAX(call_at) AS last_call_at,
                  MAX(client_id) FILTER (WHERE rn=1) AS client_id
             FROM ranked
            GROUP BY normalized_caller_phone
           HAVING COUNT(*) >= 2 OR COUNT(*) FILTER (WHERE status IN ('missed','abandoned','busy','failed')) > 0
            ORDER BY missed_calls DESC, call_count DESC, last_call_at DESC
            LIMIT 25"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_all(db)
    .await
}

pub async fn recent_voice_calls(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<AiVoiceCallRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,provider,provider_call_id,direction,caller_phone,salon_phone,staff_phone,status,
              started_at,answered_at,ended_at,ring_duration_seconds,conversation_duration_seconds,
              recording_url,transcript_available,ai_session_id,client_id,lead_id,appointment_id,pos_sale_id,
              ai_summary,ai_intent,ai_action_type,callback_required,callback_due_at,lost_reason,created_at,updated_at
             FROM ai_voice_call_records
            WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(started_at,created_at) >= $3 AND COALESCE(started_at,created_at) < $4
            ORDER BY COALESCE(started_at,created_at) DESC,id DESC
            LIMIT $5"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(start_at)
    .bind(end_at)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Records one copilot tool call. Called for every attempt, allowed or refused,
/// so the audit trail shows what was asked as well as what was answered.
#[allow(clippy::too_many_arguments)]
pub async fn record_tool_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    user_role: &str,
    session_id: &str,
    tool: &str,
    outcome: &str,
    redacted_question: &str,
    row_count: i32,
    duration_ms: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ai_copilot_tool_audit(tenant_id,branch_id,user_id,user_role,session_id,tool,outcome,redacted_question,row_count,duration_ms) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(user_role)
    .bind(session_id)
    .bind(tool)
    .bind(outcome)
    .bind(redacted_question)
    .bind(row_count)
    .bind(duration_ms)
    .execute(db)
    .await
    .map(|_| ())
}

/// Stores whether an answer was useful. A second vote by the same user on the
/// same message replaces the first rather than stacking.
#[allow(clippy::too_many_arguments)]
pub async fn save_feedback(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    message_id: &str,
    user_id: &str,
    helpful: bool,
    note: &str,
    tool: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ai_copilot_feedback(tenant_id,branch_id,session_id,message_id,user_id,helpful,note,tool) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         ON CONFLICT (message_id,user_id) DO UPDATE \
           SET helpful=EXCLUDED.helpful, note=EXCLUDED.note, updated_at=NOW()",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(message_id)
    .bind(user_id)
    .bind(helpful)
    .bind(note)
    .bind(tool)
    .execute(db)
    .await
    .map(|_| ())
}

/// Confirms an assistant message belongs to this tenant, branch and session
/// before feedback is attached to it.
pub async fn message_belongs_to_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    message_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM ai_concierge_messages \
          WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3 AND id=$4 AND role='assistant')",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(message_id)
    .fetch_one(db)
    .await
}
