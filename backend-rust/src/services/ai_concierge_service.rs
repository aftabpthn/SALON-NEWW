use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::ai_concierge_repository::{
        self as repository, AiGovernanceRecord, AiMessageRecord, AiSessionRecord,
    },
};

const CHANNELS: &[&str] = &["web", "whatsapp", "voice"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceRequest {
    pub enabled: bool,
    pub allowed_channels: Vec<String>,
    pub require_booking_confirmation: bool,
    pub redact_sensitive_data: bool,
    pub transcript_retention_days: i32,
    pub prompt_version: String,
    pub booking_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionRequest {
    pub locale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergeMessageRequest {
    pub body: String,
    pub provider_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergeResponse {
    pub session: AiSessionRecord,
    pub user_message: AiMessageRecord,
    pub assistant_message: AiMessageRecord,
    pub action_type: String,
    pub action_payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderResponse {
    source: String,
    model: String,
    prompt_version: String,
    reply_text: String,
    intent: String,
    service_id: String,
    handoff_required: bool,
    safety_flags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderEnvelope<T> {
    success: bool,
    data: Option<T>,
}

pub fn default_governance() -> AiGovernanceRecord {
    AiGovernanceRecord {
        enabled: true,
        allowed_channels: json!(["web"]),
        require_booking_confirmation: true,
        redact_sensitive_data: true,
        transcript_retention_days: 90,
        prompt_version: "receptionist-v1".into(),
        booking_url: String::new(),
        updated_by: String::new(),
        created_at: chrono::Utc::now(),
        updated_at: None,
    }
}

pub async fn governance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<AiGovernanceRecord, AppError> {
    repository::governance(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load AI governance"))
        .map(|row| row.unwrap_or_else(default_governance))
}

pub async fn save_governance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    request: GovernanceRequest,
) -> Result<AiGovernanceRecord, AppError> {
    if !(1..=3650).contains(&request.transcript_retention_days) {
        return Err(AppError::validation(
            "AI transcript retention must be between 1 and 3650 days",
        ));
    }
    if !request.require_booking_confirmation {
        return Err(AppError::validation(
            "AI booking confirmation cannot be disabled",
        ));
    }
    let mut channels = request
        .allowed_channels
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| CHANNELS.contains(&value.as_str()))
        .collect::<Vec<_>>();
    channels.sort();
    channels.dedup();
    if channels.is_empty() {
        return Err(AppError::validation("at least one AI channel is required"));
    }
    let prompt_version = limited(&request.prompt_version, 80, "AI prompt version")?;
    let booking_url = request.booking_url.unwrap_or_default().trim().to_string();
    if !booking_url.is_empty() && !booking_url.starts_with("https://") {
        return Err(AppError::validation("AI booking URL must use HTTPS"));
    }
    repository::save_governance(
        db,
        tenant_id,
        branch_id,
        request.enabled,
        &json!(channels),
        request.require_booking_confirmation,
        request.redact_sensitive_data,
        request.transcript_retention_days,
        &prompt_version,
        &booking_url,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save AI governance"))
}

pub async fn open_web_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    request: OpenSessionRequest,
) -> Result<AiSessionRecord, AppError> {
    let locale = limited(request.locale.as_deref().unwrap_or("en-IN"), 20, "locale")?;
    repository::open_session(
        db,
        tenant_id,
        branch_id,
        "web",
        &format!("user:{user_id}"),
        None,
        Some(user_id),
        &locale,
    )
    .await
    .map_err(|_| AppError::internal("failed to open AI session"))?
    .ok_or_else(|| AppError::validation("AI session could not be opened"))
}

pub async fn purge_expired_transcripts(db: &PgPool) -> Result<u64, AppError> {
    repository::purge_expired_transcripts(db)
        .await
        .map_err(|_| AppError::internal("failed to apply AI transcript retention"))
}

pub async fn transcript(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Result<Vec<AiMessageRecord>, AppError> {
    repository::session(db, tenant_id, branch_id, session_id)
        .await
        .map_err(|_| AppError::internal("failed to validate AI session"))?
        .ok_or_else(|| AppError::not_found("AI session was not found"))?;
    repository::messages(db, tenant_id, branch_id, session_id, 200)
        .await
        .map_err(|_| AppError::internal("failed to load AI transcript"))
}

pub async fn process_web_message(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    request: ConciergeMessageRequest,
) -> Result<ConciergeResponse, AppError> {
    let session = repository::session(db, tenant_id, branch_id, session_id)
        .await
        .map_err(|_| AppError::internal("failed to validate AI session"))?
        .filter(|row| row.user_id.as_deref() == Some(user_id) || row.user_id.is_none())
        .ok_or_else(|| AppError::not_found("AI session was not found"))?;
    process_message(db, settings, tenant_id, branch_id, session, request).await
}

#[allow(clippy::too_many_arguments)]
pub async fn process_external_message(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    channel: &str,
    external_thread_id: &str,
    locale: &str,
    body: &str,
    provider_message_id: Option<&str>,
) -> Result<ConciergeResponse, AppError> {
    let external_thread_id = sha256_text(external_thread_id);
    let session = repository::open_session(
        db,
        tenant_id,
        branch_id,
        channel,
        &external_thread_id,
        client_id,
        None,
        locale,
    )
    .await
    .map_err(|_| AppError::internal("failed to open external AI session"))?
    .ok_or_else(|| AppError::validation("external AI session could not be opened"))?;
    process_message(
        db,
        settings,
        tenant_id,
        branch_id,
        session,
        ConciergeMessageRequest {
            body: body.to_string(),
            provider_message_id: provider_message_id.map(str::to_string),
        },
    )
    .await
}

async fn process_message(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    session: AiSessionRecord,
    request: ConciergeMessageRequest,
) -> Result<ConciergeResponse, AppError> {
    let governance = governance(db, tenant_id, branch_id).await?;
    ensure_channel(&governance, &session.channel)?;
    let raw_body = limited(&request.body, 4_000, "AI message")?;
    let stored_body = if governance.redact_sensitive_data {
        redact(&raw_body)
    } else {
        raw_body.clone()
    };
    let user_message = repository::add_message(
        db,
        tenant_id,
        branch_id,
        &session.id,
        "user",
        &stored_body,
        "",
        "",
        &governance.prompt_version,
        "",
        &json!([]),
        request.provider_message_id.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to store AI message"))?
    .ok_or_else(|| AppError::conflict("AI provider message was already processed"))?;
    let history = repository::messages(db, tenant_id, branch_id, &session.id, 20)
        .await
        .map_err(|_| AppError::internal("failed to load AI context"))?;
    let services = repository::services(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load AI service catalog"))?;
    let provider = call_provider(
        settings,
        tenant_id,
        branch_id,
        &session,
        &raw_body,
        &history,
        &services,
        &governance,
    )
    .await;
    let safe_service = services.iter().find(|item| item.id == provider.service_id);
    let (action_type, action_payload) = if provider.handoff_required || provider.intent == "handoff"
    {
        (
            "human_handoff",
            json!({"reason":"ai_handoff","safetyFlags":provider.safety_flags}),
        )
    } else if provider.intent == "booking" {
        let service_id = safe_service.map(|item| item.id.as_str()).unwrap_or("");
        let separator = if governance.booking_url.contains('?') {
            '&'
        } else {
            '?'
        };
        let booking_url = if governance.booking_url.is_empty() {
            String::new()
        } else {
            format!(
                "{}{separator}serviceId={service_id}&source={}",
                governance.booking_url, session.channel
            )
        };
        (
            "booking_draft",
            json!({"serviceId":service_id,"bookingUrl":booking_url,"requiresConfirmation":true}),
        )
    } else {
        ("", json!({}))
    };
    let assistant_message = repository::add_message(
        db,
        tenant_id,
        branch_id,
        &session.id,
        "assistant",
        &provider.reply_text,
        &provider.source,
        &provider.model,
        &provider.prompt_version,
        &provider.intent,
        &json!(provider.safety_flags),
        None,
    )
    .await
    .map_err(|_| AppError::internal("failed to store AI response"))?
    .ok_or_else(|| AppError::internal("AI response was not stored"))?;
    if !action_type.is_empty() {
        repository::add_action(
            db,
            tenant_id,
            branch_id,
            &session.id,
            &assistant_message.id,
            action_type,
            &action_payload,
        )
        .await
        .map_err(|_| AppError::internal("failed to store AI action"))?;
    }
    if action_type == "human_handoff" {
        repository::set_session_status(db, tenant_id, branch_id, &session.id, "handoff")
            .await
            .map_err(|_| AppError::internal("failed to hand off AI session"))?;
    }
    Ok(ConciergeResponse {
        session,
        user_message,
        assistant_message,
        action_type: action_type.into(),
        action_payload,
    })
}

async fn call_provider(
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    session: &AiSessionRecord,
    message: &str,
    history: &[AiMessageRecord],
    services: &[repository::AiServiceCandidate],
    governance: &AiGovernanceRecord,
) -> ProviderResponse {
    let fallback = local_response(message, services, &governance.prompt_version);
    let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) else {
        return fallback;
    };
    let payload = json!({
        "tenant_id":tenant_id,"branch_id":branch_id,"channel":session.channel,"locale":session.locale,"message":message,
        "recent_messages":history.iter().filter(|item| item.role=="user" || item.role=="assistant").map(|item|json!({"role":item.role,"text":item.body})).collect::<Vec<_>>(),
        "candidate_services":services,
        "governance":{"prompt_version":governance.prompt_version,"allowed_intents":["general","booking","handoff"],"require_booking_confirmation":true,"redact_sensitive_data":governance.redact_sensitive_data}
    });
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(14))
        .build()
    else {
        return fallback;
    };
    let Ok(response) = client
        .post(format!("{url}/api/v1/concierge/respond"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
    else {
        return fallback;
    };
    if !response.status().is_success() {
        return fallback;
    }
    response
        .json::<ProviderEnvelope<ProviderResponse>>()
        .await
        .ok()
        .filter(|value| value.success)
        .and_then(|value| value.data)
        .unwrap_or(fallback)
}

fn local_response(
    message: &str,
    services: &[repository::AiServiceCandidate],
    prompt_version: &str,
) -> ProviderResponse {
    let normalized = message.to_ascii_lowercase();
    let handoff = [
        "complaint",
        "refund",
        "cancel",
        "allergy",
        "medical",
        "doctor",
        "payment",
    ]
    .iter()
    .any(|word| normalized.contains(word));
    let booking = ["book", "appointment", "slot", "schedule"]
        .iter()
        .any(|word| normalized.contains(word));
    let matched = services
        .iter()
        .find(|item| normalized.contains(&item.name.to_ascii_lowercase()));
    let (reply, intent) = if handoff {
        (
            "I will hand this request to the salon team for a safe follow-up.".into(),
            "handoff",
        )
    } else if booking && matched.is_some() {
        (format!("I found {}. Continue to the secure booking flow to choose and confirm an available time.", matched.unwrap().name), "booking")
    } else if booking {
        (
            "Which service would you like to book? I will use the salon's current service list."
                .into(),
            "booking",
        )
    } else {
        (
            "I can help with services and booking, or hand your request to the salon team.".into(),
            "general",
        )
    };
    ProviderResponse {
        source: "rust_deterministic".into(),
        model: "local-reception-policy-v1".into(),
        prompt_version: prompt_version.into(),
        reply_text: reply,
        intent: intent.into(),
        service_id: matched.map(|item| item.id.clone()).unwrap_or_default(),
        handoff_required: handoff,
        safety_flags: if handoff {
            vec!["human_handoff".into()]
        } else {
            vec![]
        },
    }
}

fn ensure_channel(governance: &AiGovernanceRecord, channel: &str) -> Result<(), AppError> {
    let allowed = governance
        .allowed_channels
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(channel)));
    if governance.enabled && allowed {
        Ok(())
    } else {
        Err(AppError::service_unavailable(
            "AI_CHANNEL_DISABLED",
            "AI concierge is disabled for this channel",
        ))
    }
}

fn limited(value: &str, max: usize, label: &'static str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        Err(AppError::validation(format!("{label} is invalid")))
    } else {
        Ok(value.into())
    }
}

fn redact(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            let digits = token.chars().filter(char::is_ascii_digit).count();
            if token.contains('@') || digits >= 8 {
                "[redacted]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn sha256_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{default_governance, local_response, redact};
    use crate::repositories::ai_concierge_repository::AiServiceCandidate;

    #[test]
    fn local_receptionist_never_confirms_a_booking() {
        let services = vec![AiServiceCandidate {
            id: "s1".into(),
            name: "Hair Spa".into(),
            duration_minutes: 60,
            price_paise: 150000,
        }];
        let reply = local_response(
            "Book Hair Spa",
            &services,
            &default_governance().prompt_version,
        );
        assert_eq!(reply.intent, "booking");
        assert!(!reply.reply_text.to_ascii_lowercase().contains("confirmed"));
    }

    #[test]
    fn transcript_redaction_masks_contact_data() {
        assert_eq!(
            redact("call 9876543210 at me@example.com"),
            "call [redacted] at [redacted]"
        );
    }
}
