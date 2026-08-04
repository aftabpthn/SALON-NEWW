use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::ai_concierge_repository::{
        self as repository, AiGovernanceRecord, AiMessageRecord, AiOperationalContext,
        AiSessionRecord, AiVoiceCallOpportunity, AiVoiceCallRecord, AiVoiceCallReportSummary,
    },
    services::{
        ai_channel_service,
        ai_copilot_tools::{self, CopilotAnswer},
        ai_scope_service::{self, ScopeRequest},
        ai_semantic_service, ai_tool_dispatcher,
        auth_service::AuthClaims,
    },
};

const CHANNELS: &[&str] = &["web", "whatsapp", "voice"];

/// The AI provider answered.
const PROVIDER_LIVE: &str = "live";
/// No AI service URL/token is configured, so the CRM fallback answered.
const PROVIDER_NOT_CONFIGURED: &str = "not_configured";
/// The AI service could not be reached (DNS, connection refused, timeout).
const PROVIDER_UNREACHABLE: &str = "unreachable";
/// The AI service replied with a non-success status.
const PROVIDER_HTTP_ERROR: &str = "http_error";
/// The AI service replied with a body this service could not use.
const PROVIDER_INVALID_RESPONSE: &str = "invalid_response";

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
    #[serde(default)]
    pub default_action_owner_user_id: String,
    #[serde(default = "default_max_requests_per_minute")]
    pub max_requests_per_minute: i32,
    #[serde(default = "default_max_latency_ms")]
    pub max_latency_ms: i32,
    #[serde(default)]
    pub monthly_cost_budget_paise: i64,
    #[serde(default = "default_evaluation_retention_days")]
    pub evaluation_retention_days: i32,
    #[serde(default)]
    pub model_allowlist: Vec<String>,
}

fn default_max_requests_per_minute() -> i32 {
    60
}
fn default_max_latency_ms() -> i32 {
    15_000
}
fn default_evaluation_retention_days() -> i32 {
    90
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
    /// Which engine produced the reply: `live` when the AI provider answered,
    /// otherwise the reason the deterministic CRM fallback was used.
    pub provider_status: String,
    /// Evidence from the CRM tool that answered, when one did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copilot: Option<CopilotAnswer>,
    /// Set when a tool matched the question but the caller's role may not run it.
    #[serde(skip_serializing_if = "str::is_empty")]
    pub restricted_tool: String,
    /// CRM text retrieved because no tool matched. Returned so the reply can be
    /// traced back to the rows it was written from — a passage without its
    /// source is indistinguishable from something the model made up.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub retrieved: Vec<ai_semantic_service::SemanticPassage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceWebhookRequest {
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: Option<String>,
    pub call_id: String,
    pub event_id: Option<String>,
    pub direction: Option<String>,
    pub status: Option<String>,
    pub from: String,
    pub to: Option<String>,
    pub staff_phone: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub answered_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub ring_duration_seconds: Option<i32>,
    pub conversation_duration_seconds: Option<i32>,
    pub recording_url: Option<String>,
    pub recording_consent_status: Option<String>,
    pub call_queue: Option<String>,
    pub extension: Option<String>,
    pub voicemail: Option<bool>,
    pub transcript: Option<String>,
    pub locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceWebhookResponse {
    pub call_record: AiVoiceCallRecord,
    pub session_id: String,
    pub reply_text: String,
    pub action_type: String,
    pub action: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCallReport {
    pub period_start: String,
    pub period_end: String,
    pub summary: AiVoiceCallReportSummary,
    pub opportunities: Vec<AiVoiceCallOpportunity>,
    pub recent_calls: Vec<AiVoiceCallRecord>,
    pub ai_insights: Vec<String>,
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

/// What the CRM tool layer produced for this message.
#[derive(Debug)]
enum CopilotOutcome {
    /// A tool ran and produced grounded evidence.
    Answered(Box<CopilotAnswer>),
    /// A tool matched but the caller's role may not run it.
    Forbidden(&'static str),
    /// No tool matched the question, or the channel has no signed-in role.
    NotApplicable,
}

impl CopilotOutcome {
    fn answer(&self) -> Option<&CopilotAnswer> {
        match self {
            Self::Answered(answer) => Some(answer),
            _ => None,
        }
    }
}

/// Detects the intent and runs the one matching read tool through the shared
/// dispatcher.
///
/// Access is not decided here. `ai_tool_dispatcher::dispatch` resolves the
/// login's branch scope and checks the domain permission, so the header
/// concierge and `/ai/copilot/ask` cannot drift apart on who may read what.
#[allow(clippy::too_many_arguments)]
async fn run_copilot_tool(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    session_id: &str,
    message: &str,
) -> CopilotOutcome {
    let user_id = claims.sub.as_str();
    let role = claims.role.as_str();
    // A bare "why?" continues the previous answer instead of matching nothing.
    let matched = match ai_copilot_tools::detect(message) {
        Some(matched) => matched,
        None if ai_copilot_tools::is_follow_up(message) => {
            match previous_tool(db, tenant_id, branch_id, session_id).await {
                Some((tool, subject)) => ai_copilot_tools::continue_tool(tool, subject),
                None => return CopilotOutcome::NotApplicable,
            }
        }
        None => return CopilotOutcome::NotApplicable,
    };
    let actor = ai_copilot_tools::ToolActor::new(user_id, role);
    let started = std::time::Instant::now();
    // The branch scope comes from the login's grants, never from the request
    // header, so a header branch cannot widen what this answer reads.
    let outcome = ai_tool_dispatcher::dispatch(
        db,
        tenant_id,
        claims,
        &actor,
        &matched,
        &ScopeRequest::default(),
    )
    .await;
    let elapsed_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;

    // Every tool call is audited, allowed or not. The question is stored with
    // contact details stripped so the audit trail does not become a second
    // store of client PII.
    let (audit_outcome, row_count) = match &outcome {
        Ok(answer) => ("allowed", answer.data_row_count()),
        Err(ai_copilot_tools::ToolRefusal::Forbidden(_)) => ("forbidden", 0),
        Err(ai_copilot_tools::ToolRefusal::NoMatch) => ("failed", 0),
    };
    if let Err(error) = repository::record_tool_audit(
        db,
        tenant_id,
        branch_id,
        user_id,
        role,
        session_id,
        matched.tool.name(),
        audit_outcome,
        &redact(message),
        row_count,
        elapsed_ms,
    )
    .await
    {
        // An audit failure must be visible, but must not deny the user an answer
        // they are entitled to.
        tracing::error!(%error, tool = matched.tool.name(), "failed to write copilot tool audit");
    }

    match outcome {
        Ok(answer) => CopilotOutcome::Answered(Box::new(answer)),
        Err(ai_copilot_tools::ToolRefusal::Forbidden(tool)) => {
            tracing::info!(
                tool = tool.name(),
                role,
                "copilot tool refused for this role"
            );
            CopilotOutcome::Forbidden(tool.name())
        }
        Err(ai_copilot_tools::ToolRefusal::NoMatch) => CopilotOutcome::NotApplicable,
    }
}

/// Finds the tool that produced the most recent answer in this session, and the
/// subject the question before it was about, so a follow-up stays on topic.
async fn previous_tool(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Option<(ai_copilot_tools::CopilotTool, Vec<String>)> {
    let history = repository::messages(db, tenant_id, branch_id, session_id, 20)
        .await
        .ok()?;
    // Walk backwards to the last answer a CRM tool produced.
    let position = history.iter().rposition(|message| {
        message.role == "assistant" && message.model_name.starts_with("crm-tool:")
    })?;
    let tool = ai_copilot_tools::tool_from_model_name(&history[position].model_name)?;
    // The user turn before it carries the subject, e.g. which client was named.
    let subject = history[..position]
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| ai_copilot_tools::detect(&message.body))
        .map(|matched| matched.subject_candidates)
        .unwrap_or_default();
    Some((tool, subject))
}

pub fn default_governance() -> AiGovernanceRecord {
    AiGovernanceRecord {
        enabled: false,
        allowed_channels: json!(["web"]),
        require_booking_confirmation: true,
        redact_sensitive_data: true,
        transcript_retention_days: 90,
        prompt_version: "receptionist-v1".into(),
        booking_url: String::new(),
        default_action_owner_user_id: String::new(),
        max_requests_per_minute: default_max_requests_per_minute(),
        max_latency_ms: default_max_latency_ms(),
        monthly_cost_budget_paise: 0,
        evaluation_retention_days: default_evaluation_retention_days(),
        model_allowlist: json!([]),
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
    if !(1..=600).contains(&request.max_requests_per_minute) {
        return Err(AppError::validation(
            "AI request limit must be between 1 and 600 per minute",
        ));
    }
    if !(500..=60_000).contains(&request.max_latency_ms) {
        return Err(AppError::validation(
            "AI latency limit must be between 500 and 60000 ms",
        ));
    }
    if request.monthly_cost_budget_paise < 0 {
        return Err(AppError::validation(
            "AI monthly cost budget cannot be negative",
        ));
    }
    if !(1..=3650).contains(&request.evaluation_retention_days) {
        return Err(AppError::validation(
            "AI evaluation retention must be between 1 and 3650 days",
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
    let action_owner = if request.enabled && request.default_action_owner_user_id.trim().is_empty()
    {
        actor_id
    } else {
        request.default_action_owner_user_id.trim()
    };
    let mut models = request
        .model_allowlist
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    if models.len() > 20 || models.iter().any(|value| value.chars().count() > 120) {
        return Err(AppError::validation("AI model allowlist is invalid"));
    }
    let before = governance(db, tenant_id, branch_id).await?;
    let saved = repository::save_governance(
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
        action_owner,
        request.max_requests_per_minute,
        request.max_latency_ms,
        request.monthly_cost_budget_paise,
        request.evaluation_retention_days,
        &json!(models),
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save AI governance"))?;
    repository::record_workforce_policy_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &serde_json::to_value(before).unwrap_or_else(|_| json!({})),
        &serde_json::to_value(&saved).unwrap_or_else(|_| json!({})),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit AI governance"))?;
    Ok(saved)
}

pub async fn open_web_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    request: OpenSessionRequest,
) -> Result<AiSessionRecord, AppError> {
    let governance = governance(db, tenant_id, branch_id).await?;
    ensure_channel(&governance, "web")?;
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
    claims: &AuthClaims,
    session_id: &str,
    request: ConciergeMessageRequest,
) -> Result<ConciergeResponse, AppError> {
    let user_id = claims.sub.as_str();
    let session = repository::session(db, tenant_id, branch_id, session_id)
        .await
        .map_err(|_| AppError::internal("failed to validate AI session"))?
        .filter(|row| row.user_id.as_deref() == Some(user_id) || row.user_id.is_none())
        .ok_or_else(|| AppError::not_found("AI session was not found"))?;
    process_message(
        db,
        ProviderEndpoint::from_settings(settings),
        tenant_id,
        branch_id,
        session,
        request,
        Some(claims),
    )
    .await
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
    // `from_phone` is used only to resolve a CRM identity, never stored raw.
    from_phone: &str,
    locale: &str,
    body: &str,
    provider_message_id: Option<&str>,
) -> Result<ConciergeResponse, AppError> {
    // Resolve who is on the other end before anything is read. A recognised
    // staff phone carries the same grants and denials that login has in the
    // browser; anything else stays anonymous and reaches no CRM tool. The
    // resolution happens here rather than at each webhook so WhatsApp and voice
    // cannot drift apart on who is allowed to ask what.
    let caller = ai_channel_service::resolve_caller(db, tenant_id, branch_id, from_phone).await?;
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
        ProviderEndpoint::from_settings(settings),
        tenant_id,
        branch_id,
        session,
        ConciergeMessageRequest {
            body: body.to_string(),
            provider_message_id: provider_message_id.map(str::to_string),
        },
        caller.claims.as_ref(),
    )
    .await
}

/// The only two settings the message pipeline needs to reach the AI provider.
///
/// Taking these instead of the whole `Settings` keeps the pipeline callable from
/// a test, which is what lets the provider-unavailable path be verified against a
/// real database rather than reasoned about.
#[derive(Clone, Copy)]
struct ProviderEndpoint<'a> {
    url: Option<&'a str>,
    token: Option<&'a str>,
}

impl<'a> ProviderEndpoint<'a> {
    fn from_settings(settings: &'a Settings) -> Self {
        Self {
            url: settings.ai_service_url.as_deref(),
            token: settings.ai_service_token.as_deref(),
        }
    }

    /// No provider configured: every caller must fall back to CRM data.
    #[cfg(test)]
    fn unconfigured() -> Self {
        Self {
            url: None,
            token: None,
        }
    }

    /// A configured provider, used by tests to exercise the unreachable path.
    #[cfg(test)]
    fn at(url: &'a str, token: &'a str) -> Self {
        Self {
            url: Some(url),
            token: Some(token),
        }
    }
}

async fn process_message(
    db: &PgPool,
    provider_endpoint: ProviderEndpoint<'_>,
    tenant_id: &str,
    branch_id: &str,
    session: AiSessionRecord,
    request: ConciergeMessageRequest,
    web_claims: Option<&AuthClaims>,
) -> Result<ConciergeResponse, AppError> {
    let governance = governance(db, tenant_id, branch_id).await?;
    ensure_channel(&governance, &session.channel)?;
    let request_count = repository::consume_workforce_request(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to enforce AI request limit"))?;
    if request_count > i64::from(governance.max_requests_per_minute) {
        return Err(AppError::rate_limited("AI request limit exceeded"));
    }
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
    let operational_context = if session.channel == "web" {
        Some(
            repository::operational_context(db, tenant_id, branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load AI operational context"))?,
        )
    } else {
        None
    };
    // CRM tools only run for signed-in web users, because every tool is
    // permission-checked against the caller's role.
    let copilot = match web_claims {
        Some(claims) => {
            run_copilot_tool(db, tenant_id, branch_id, claims, &session.id, &raw_body).await
        }
        None => CopilotOutcome::NotApplicable,
    };
    // Retrieval is consulted only where the tools produced nothing at all. A
    // question a tool answered is already grounded in a query someone can
    // audit, and putting quoted text next to that would invite the provider to
    // blend the two. A refusal is likewise final — retrieving around a
    // permission the caller does not hold is exactly what must not happen.
    let retrieved = match (&copilot, web_claims) {
        (CopilotOutcome::NotApplicable, Some(claims)) => {
            ai_semantic_service::search(
                db,
                ai_semantic_service::EmbeddingProvider::new(
                    provider_endpoint.url,
                    provider_endpoint.token,
                ),
                tenant_id,
                claims,
                &raw_body,
                &ScopeRequest::default(),
            )
            .await
        }
        _ => Vec::new(),
    };
    // A refusal is a final answer: sending it to the provider would invite a
    // generic reply about data this role is not allowed to see.
    let (provider, provider_status) = if let CopilotOutcome::Forbidden(tool) = copilot {
        (
            restricted_response(tool, &governance.prompt_version),
            "restricted",
        )
    } else {
        call_provider(
            provider_endpoint,
            tenant_id,
            branch_id,
            &session,
            &raw_body,
            &history,
            &services,
            operational_context.as_ref(),
            web_claims,
            &governance,
            copilot.answer(),
            &retrieved,
        )
        .await
    };
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
    // Record every proposal that would change business data as pending, so there
    // is an audit trail of what the copilot suggested and what a person then did
    // with it. Recording a proposal performs nothing.
    if let Some(answer) = copilot.answer() {
        for proposal in answer
            .proposals
            .iter()
            .filter(|proposal| proposal.requires_approval)
        {
            repository::add_action(
                db,
                tenant_id,
                branch_id,
                &session.id,
                &assistant_message.id,
                &proposal.kind,
                &json!({
                    "route": proposal.route,
                    "params": proposal.params,
                    "tool": answer.tool,
                    "requiresApproval": true,
                }),
            )
            .await
            .map_err(|_| AppError::internal("failed to store AI proposal"))?;
        }
    }
    if action_type == "human_handoff" {
        repository::set_session_status(db, tenant_id, branch_id, &session.id, "handoff")
            .await
            .map_err(|_| AppError::internal("failed to hand off AI session"))?;
    }
    let (copilot_answer, restricted_tool) = match copilot {
        CopilotOutcome::Answered(answer) => (Some(*answer), String::new()),
        CopilotOutcome::Forbidden(tool) => (None, tool.to_string()),
        CopilotOutcome::NotApplicable => (None, String::new()),
    };
    Ok(ConciergeResponse {
        session,
        user_message,
        assistant_message,
        action_type: action_type.into(),
        action_payload,
        provider_status: provider_status.into(),
        copilot: copilot_answer,
        restricted_tool,
        retrieved,
    })
}

pub async fn record_voice_call_event(
    db: &PgPool,
    settings: &Settings,
    request: VoiceWebhookRequest,
    client_id: Option<String>,
    lead_id: Option<String>,
) -> Result<VoiceWebhookResponse, AppError> {
    let provider = normalize_provider(request.provider.as_deref())?;
    let call_id = limited(&request.call_id, 120, "voice call id")?;
    let event_id = request.event_id.unwrap_or_default();
    let direction = normalize_direction(request.direction.as_deref());
    let status = normalize_call_status(request.status.as_deref(), request.transcript.as_deref());
    let caller_phone = limited(&request.from, 40, "caller phone")?;
    let normalized_phone = normalize_phone(&caller_phone);
    let recording_consent_status =
        normalize_recording_consent(request.recording_consent_status.as_deref())?;
    let sensitive_allowed = matches!(
        recording_consent_status.as_str(),
        "granted" | "legal_notice"
    );
    let raw_transcript = request.transcript.unwrap_or_default().trim().to_string();
    let raw_recording_url = request.recording_url.unwrap_or_default().trim().to_string();
    if sensitive_allowed
        && !raw_recording_url.is_empty()
        && !raw_recording_url.starts_with("https://")
    {
        return Err(AppError::validation("voice recording URL must use HTTPS"));
    }
    let sensitive_payload_discarded =
        !sensitive_allowed && (!raw_transcript.is_empty() || !raw_recording_url.is_empty());
    let transcript = if sensitive_allowed {
        raw_transcript
    } else {
        String::new()
    };
    let recording_url = if sensitive_allowed {
        raw_recording_url
    } else {
        String::new()
    };
    let recording_retention_until = if transcript.is_empty() && recording_url.is_empty() {
        None
    } else {
        let days =
            repository::transcript_retention_days(db, &request.tenant_id, &request.branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load voice retention policy"))?
                .clamp(1, 3650);
        Some(Utc::now() + Duration::days(i64::from(days)))
    };
    let call_queue = optional_limited(request.call_queue.as_deref(), 120, "voice queue")?;
    let extension = optional_limited(request.extension.as_deref(), 40, "voice extension")?;
    let voicemail = request.voicemail.unwrap_or(false);
    let transcript_available = !transcript.is_empty();
    let mut session_id = String::new();
    let mut reply_text = String::new();
    let mut action_type = String::new();
    let mut action = json!({});
    let mut ai_intent = String::new();

    if transcript_available {
        let response = process_external_message(
            db,
            settings,
            &request.tenant_id,
            &request.branch_id,
            client_id.as_deref(),
            "voice",
            &call_id,
            // The caller's number is what identifies them on this channel.
            &request.from,
            request.locale.as_deref().unwrap_or("en-IN"),
            &transcript,
            Some(if event_id.is_empty() {
                &call_id
            } else {
                &event_id
            }),
        )
        .await?;
        session_id = response.session.id;
        reply_text = response.assistant_message.body;
        ai_intent = response.assistant_message.intent;
        action_type = response.action_type;
        action = response.action_payload;
    }

    let callback_required = matches!(status.as_str(), "missed" | "busy" | "failed" | "abandoned")
        || action_type == "human_handoff";
    let callback_due_at = callback_required.then(|| Utc::now() + Duration::minutes(30));
    let lost_reason = if callback_required && !transcript_available {
        "call_not_completed"
    } else {
        ""
    };
    let call_record = repository::upsert_voice_call_record(
        db,
        &request.tenant_id,
        &request.branch_id,
        &provider,
        &call_id,
        &event_id,
        &direction,
        &caller_phone,
        &normalized_phone,
        request.to.as_deref().unwrap_or(""),
        request.staff_phone.as_deref().unwrap_or(""),
        &status,
        request.started_at,
        request.answered_at,
        request.ended_at,
        request.ring_duration_seconds.unwrap_or_default().max(0),
        request
            .conversation_duration_seconds
            .unwrap_or_default()
            .max(0),
        &recording_url,
        &recording_consent_status,
        recording_retention_until,
        &call_queue,
        &extension,
        voicemail,
        transcript_available,
        client_id.as_deref(),
        lead_id.as_deref(),
        if session_id.is_empty() {
            None
        } else {
            Some(session_id.as_str())
        },
        &reply_text,
        &ai_intent,
        &action_type,
        callback_required,
        callback_due_at,
        lost_reason,
        &json!({"source":"voice_webhook","sensitivePayloadDiscarded":sensitive_payload_discarded}),
    )
    .await
    .map_err(|_| AppError::internal("failed to store voice call record"))?;

    Ok(VoiceWebhookResponse {
        call_record,
        session_id,
        reply_text,
        action_type,
        action,
    })
}

pub async fn voice_call_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<VoiceCallReport, AppError> {
    let now = Utc::now();
    let start_at = match start_date {
        Some(raw) => parse_report_day(raw, false)?,
        None => now - Duration::days(30),
    };
    let end_at = match end_date {
        Some(raw) => parse_report_day(raw, true)?,
        None => now + Duration::seconds(1),
    };
    if end_at <= start_at {
        return Err(AppError::validation(
            "report endDate must be after startDate",
        ));
    }
    let summary = repository::voice_call_report_summary(db, tenant_id, branch_id, start_at, end_at)
        .await
        .map_err(|_| AppError::internal("failed to load voice call report"))?;
    let opportunities =
        repository::voice_call_opportunities(db, tenant_id, branch_id, start_at, end_at)
            .await
            .map_err(|_| AppError::internal("failed to load voice call opportunities"))?;
    let recent_calls =
        repository::recent_voice_calls(db, tenant_id, branch_id, start_at, end_at, 50)
            .await
            .map_err(|_| AppError::internal("failed to load recent voice calls"))?;
    let insights = call_report_insights(&summary, &opportunities);
    Ok(VoiceCallReport {
        period_start: start_at.to_rfc3339(),
        period_end: end_at.to_rfc3339(),
        summary,
        opportunities,
        recent_calls,
        ai_insights: insights,
    })
}
async fn call_provider(
    provider_endpoint: ProviderEndpoint<'_>,
    tenant_id: &str,
    branch_id: &str,
    session: &AiSessionRecord,
    message: &str,
    history: &[AiMessageRecord],
    services: &[repository::AiServiceCandidate],
    operational_context: Option<&AiOperationalContext>,
    web_claims: Option<&AuthClaims>,
    governance: &AiGovernanceRecord,
    copilot: Option<&CopilotAnswer>,
    retrieved: &[ai_semantic_service::SemanticPassage],
) -> (ProviderResponse, &'static str) {
    let financials_visible = web_claims.is_some_and(|claims| {
        ai_scope_service::domain_allowed(claims, ai_scope_service::AiDomain::Finance)
    });
    // A tool answer is already grounded in CRM data, so it is the fallback reply
    // whenever the provider cannot be reached.
    let fallback = match copilot {
        Some(answer) => copilot_response(answer, &governance.prompt_version),
        None => local_response(
            message,
            services,
            operational_context,
            financials_visible,
            &governance.prompt_version,
        ),
    };
    let (Some(url), Some(token)) = (provider_endpoint.url, provider_endpoint.token) else {
        tracing::info!(
            tenant_id,
            branch_id,
            channel = %session.channel,
            "AI service is not configured; answering from CRM data"
        );
        return (fallback, PROVIDER_NOT_CONFIGURED);
    };
    let payload = json!({
        "tenant_id":tenant_id,"branch_id":branch_id,"channel":session.channel,"locale":session.locale,"message":message,
        "recent_messages":history.iter().filter(|item| item.role=="user" || item.role=="assistant").map(|item|json!({"role":item.role,"text":item.body})).collect::<Vec<_>>(),
        "candidate_services":services.iter().map(|item|json!({
            "id":item.id,"name":item.name,"duration_minutes":item.duration_minutes,"price_paise":item.price_paise
        })).collect::<Vec<_>>(),
        "operational_context":operational_context.map(|context|json!({
            "business_date":context.business_date,
            "today_appointments":context.today_appointments,
            "open_appointments":context.open_appointments,
            "active_clients":context.active_clients,
            "active_staff":context.active_staff,
            "active_services":context.active_services,
            "top_service_name":context.top_service_name.as_deref(),
            "top_service_quantity":context.top_service_quantity,
            "top_service_sales_paise":financials_visible.then_some(context.top_service_sales_paise),
            "today_sales_paise":financials_visible.then_some(context.today_sales_paise),
            "open_sales":financials_visible.then_some(context.open_sales),
            "recent_completed_appointments":context.recent_completed_appointments,
            "low_stock_items":context.low_stock_items,
            "financials_visible":financials_visible
        })),
        // Verified CRM figures. The provider must explain these, never replace them.
        "crm_evidence":copilot.map(|answer|json!({
            "tool":answer.tool,
            "headline":answer.headline,
            "branch":answer.branch_name,
            "period":answer.period,
            "metrics":answer.metrics,
            "reason":answer.reason,
            "evidence":answer.evidence,
            "recommended_action":answer.recommended_action,
            "confidence":answer.confidence,
            "instruction":"These figures come from the CRM database and are authoritative. Explain and summarise them, keeping the branch, the date period, the current-vs-previous values, the stated reason, the confidence level and the recommended action. Never invent numbers, names, dates or causes that are not present here, and never state a cause more strongly than the stated confidence supports."
        })),
        // Quoted CRM text, retrieved only because no tool matched. Unlike
        // `crm_evidence` these are passages, not computed figures, so the
        // instruction is the opposite one: summarise what is written here and
        // say where it came from, but do not turn prose into a statistic.
        "retrieved_passages":(!retrieved.is_empty()).then(||json!({
            "passages":retrieved.iter().map(|passage|json!({
                "source":passage.source_kind,
                "title":passage.title,
                "text":passage.content,
                "similarity":passage.similarity
            })).collect::<Vec<_>>(),
            "instruction":"This is text stored in the CRM, retrieved because no report answered the question. Answer only from what it says and name the source you used. Do not compute totals, counts, trends or money from it, and do not treat it as current if it does not say so — if the question needs a figure, say the reports do not cover it rather than deriving one from this text."
        })),
        "governance":{"prompt_version":governance.prompt_version,"allowed_intents":["general","booking","handoff"],"require_booking_confirmation":true,"redact_sensitive_data":governance.redact_sensitive_data}
    });
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            governance.max_latency_ms as u64,
        ))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(%error, tenant_id, branch_id, "AI provider client could not be built");
            return (fallback, PROVIDER_UNREACHABLE);
        }
    };
    let response = match client
        .post(format!("{url}/api/v1/concierge/respond"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(
                %error,
                tenant_id,
                branch_id,
                channel = %session.channel,
                "AI provider is unreachable; answering from CRM data"
            );
            return (fallback, PROVIDER_UNREACHABLE);
        }
    };
    let status = response.status();
    if !status.is_success() {
        tracing::warn!(
            status = status.as_u16(),
            tenant_id,
            branch_id,
            channel = %session.channel,
            "AI provider returned an error status; answering from CRM data"
        );
        return (fallback, PROVIDER_HTTP_ERROR);
    }
    match response
        .json::<ProviderEnvelope<ProviderResponse>>()
        .await
        .map(provider_payload)
    {
        Ok(Some(data)) => (data, PROVIDER_LIVE),
        Ok(None) => {
            tracing::warn!(
                tenant_id,
                branch_id,
                "AI provider reported failure or sent no payload; answering from CRM data"
            );
            (fallback, PROVIDER_INVALID_RESPONSE)
        }
        Err(error) => {
            tracing::warn!(
                %error,
                tenant_id,
                branch_id,
                "AI provider response could not be parsed; answering from CRM data"
            );
            (fallback, PROVIDER_INVALID_RESPONSE)
        }
    }
}

/// A provider payload is only usable when the envelope reports success and carries data.
fn provider_payload(envelope: ProviderEnvelope<ProviderResponse>) -> Option<ProviderResponse> {
    envelope.success.then_some(envelope.data).flatten()
}

/// States plainly that the answer exists but this role may not see it, rather
/// than pretending the data is unavailable.
fn restricted_response(tool: &'static str, prompt_version: &str) -> ProviderResponse {
    ProviderResponse {
        source: "crm_tool".into(),
        model: format!("crm-tool:{tool}"),
        prompt_version: prompt_version.into(),
        reply_text:
            "Your role does not have access to this report. Ask an owner, admin or manager to run it."
                .into(),
        intent: "general".into(),
        service_id: String::new(),
        handoff_required: false,
        safety_flags: vec!["role_restricted".into()],
    }
}

/// Turns a CRM tool answer into a provider-shaped reply, so a tool result reads
/// the same whether or not the AI provider was reachable.
fn copilot_response(answer: &CopilotAnswer, prompt_version: &str) -> ProviderResponse {
    ProviderResponse {
        source: "crm_tool".into(),
        model: format!("crm-tool:{}", answer.tool),
        prompt_version: prompt_version.into(),
        reply_text: answer.to_reply(),
        intent: "general".into(),
        service_id: String::new(),
        handoff_required: false,
        safety_flags: vec![],
    }
}

fn local_response(
    message: &str,
    services: &[repository::AiServiceCandidate],
    operational_context: Option<&AiOperationalContext>,
    financials_visible: bool,
    prompt_version: &str,
) -> ProviderResponse {
    let normalized = message.to_ascii_lowercase();
    let handoff = contains_any(
        &normalized,
        &[
            "complaint",
            "refund",
            "cancel",
            "allergy",
            "medical",
            "doctor",
        ],
    ) || (operational_context.is_none() && normalized.contains("payment"));
    let booking = normalized == "book"
        || contains_any(
            &normalized,
            &[
                "book ",
                "want to book",
                "schedule ",
                "available slot",
                "new appointment",
            ],
        );
    let matched = services
        .iter()
        .find(|item| normalized.contains(&item.name.to_ascii_lowercase()));
    let (reply, intent) = if handoff {
        (
            "I will hand this request to the salon team for a safe follow-up.".into(),
            "handoff",
        )
    } else if booking && matched.is_some() {
        let service = matched.unwrap();
        (
            format!(
                "{} is available in the current catalog: {} minutes at {}. Continue to the secure booking flow to choose an available time; the booking remains a draft and requires CRM confirmation.",
                service.name,
                service.duration_minutes,
                rupees(service.price_paise)
            ),
            "booking",
        )
    } else if booking {
        let names = services
            .iter()
            .take(8)
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        (
            if names.is_empty() {
                "No active services are available in this branch yet.".into()
            } else {
                format!("Which service would you like to book? Current options include: {names}.")
            },
            "booking",
        )
    } else if let Some(context) = operational_context {
        (
            operational_reply(&normalized, services, matched, context, financials_visible),
            "general",
        )
    } else if let Some(service) = matched {
        (
            format!(
                "{} takes {} minutes and currently costs {}. Availability must be checked in the secure booking flow.",
                service.name,
                service.duration_minutes,
                rupees(service.price_paise)
            ),
            "general",
        )
    } else if contains_any(&normalized, &["service", "menu", "price", "cost"]) {
        let catalog = services
            .iter()
            .take(8)
            .map(service_summary)
            .collect::<Vec<_>>()
            .join("\n");
        (
            if catalog.is_empty() {
                "No active services are available in this branch yet.".into()
            } else {
                format!("Current services:\n{catalog}")
            },
            "general",
        )
    } else {
        (
            "I can answer from the current service catalog, explain prices and duration, prepare a booking draft, or hand sensitive requests to the salon team. Ask a specific question for a detailed answer.".into(),
            "general",
        )
    };
    ProviderResponse {
        source: "rust_deterministic".into(),
        model: if operational_context.is_some() {
            "local-operations-policy-v2"
        } else {
            "local-reception-policy-v2"
        }
        .into(),
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

fn operational_reply(
    message: &str,
    services: &[repository::AiServiceCandidate],
    matched: Option<&repository::AiServiceCandidate>,
    context: &AiOperationalContext,
    financials_visible: bool,
) -> String {
    if contains_any(
        message,
        &[
            "overview",
            "summary",
            "dashboard",
            "how are we",
            "business status",
        ],
    ) {
        let sales = if financials_visible {
            format!(
                "\nToday sales: {} | Open sales: {}",
                rupees(context.today_sales_paise),
                context.open_sales
            )
        } else {
            String::new()
        };
        return format!(
            "Branch overview for {}:\nAppointments today: {} | Open: {}\nActive clients: {} | Active staff: {} | Active services: {}\nCompleted in last 7 days: {} | Low-stock items: {}{}",
            context.business_date,
            context.today_appointments,
            context.open_appointments,
            context.active_clients,
            context.active_staff,
            context.active_services,
            context.recent_completed_appointments,
            context.low_stock_items,
            sales
        );
    }
    if contains_any(message, &["appointment", "booking today", "bookings today"]) {
        return format!(
            "For {} there are {} appointments, with {} currently open. {} appointments were completed in the last 7 days.",
            context.business_date,
            context.today_appointments,
            context.open_appointments,
            context.recent_completed_appointments
        );
    }
    if contains_any(
        message,
        &[
            "top service",
            "best service",
            "most sold",
            "highest sold",
            "sabse j",
            "sabse z",
            "sabse jyada",
            "sabse zyada",
            "sabse jaha",
            "jaha seal",
            "jyada sale",
            "zyada sale",
        ],
    ) {
        if let Some(name) = context.top_service_name.as_deref() {
            let quantity = context.top_service_quantity.unwrap_or_default();
            return if financials_visible {
                format!(
                    "Most sold service is {name}: {quantity} sold, total {}.",
                    rupees(context.top_service_sales_paise.unwrap_or_default())
                )
            } else {
                format!("Most sold service is {name}: {quantity} sold.")
            };
        }
        return "No completed service sales are recorded for this branch yet.".into();
    }
    if contains_any(message, &["sale", "revenue", "payment", "collection"]) {
        return if financials_visible {
            format!(
                "Today's recorded sales are {} across the branch, with {} open or partially paid sales.",
                rupees(context.today_sales_paise),
                context.open_sales
            )
        } else {
            "Financial figures are not available for your current role.".into()
        };
    }
    if contains_any(
        message,
        &["staff", "team", "employee", "kitne staff", "staff kitne"],
    ) {
        return format!(
            "This branch currently has {} active staff.",
            context.active_staff
        );
    }
    if contains_any(message, &["client", "customer"]) {
        return format!(
            "This branch currently has {} active clients.",
            context.active_clients
        );
    }
    if contains_any(message, &["inventory", "stock", "reorder"]) {
        return format!(
            "{} active inventory items are at or below their reorder point.",
            context.low_stock_items
        );
    }
    if let Some(service) = matched {
        return format!(
            "{} takes {} minutes and currently costs {}. I can prepare a booking draft if you want.",
            service.name,
            service.duration_minutes,
            rupees(service.price_paise)
        );
    }
    if contains_any(message, &["service", "menu", "price", "cost"]) {
        let catalog = services
            .iter()
            .take(8)
            .map(service_summary)
            .collect::<Vec<_>>()
            .join("\n");
        return if catalog.is_empty() {
            "No active services are available in this branch yet.".into()
        } else {
            format!("Current services:\n{catalog}")
        };
    }
    "I can use live branch data for appointments, sales, clients, staff, services, top sold service and low-stock counts. I can also explain service price/duration and prepare a booking draft. Ask for an overview or name the metric you need.".into()
}

fn service_summary(service: &repository::AiServiceCandidate) -> String {
    format!(
        "• {} — {} min — {}",
        service.name,
        service.duration_minutes,
        rupees(service.price_paise)
    )
}

fn rupees(paise: i64) -> String {
    format!("₹{}.{:02}", paise / 100, (paise % 100).abs())
}

fn contains_any(value: &str, words: &[&str]) -> bool {
    words.iter().any(|word| value.contains(word))
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

fn optional_limited(
    value: Option<&str>,
    max: usize,
    label: &'static str,
) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim();
    if value.chars().count() > max {
        Err(AppError::validation(format!("{label} is invalid")))
    } else {
        Ok(value.into())
    }
}

fn normalize_recording_consent(value: Option<&str>) -> Result<String, AppError> {
    match value
        .unwrap_or("unknown")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "unknown" => Ok("unknown".into()),
        "granted" => Ok("granted".into()),
        "declined" | "denied" => Ok("declined".into()),
        "legal_notice" | "legal-notice" => Ok("legal_notice".into()),
        _ => Err(AppError::validation("recording consent status is invalid")),
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
fn normalize_provider(value: Option<&str>) -> Result<String, AppError> {
    let provider = value.unwrap_or("voice").trim().to_ascii_lowercase();
    if provider.is_empty() || provider.chars().count() > 40 {
        Err(AppError::validation("voice provider is invalid"))
    } else {
        Ok(provider)
    }
}

fn normalize_direction(value: Option<&str>) -> String {
    match value
        .unwrap_or("inbound")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "outbound" | "outgoing" => "outbound".into(),
        _ => "inbound".into(),
    }
}

fn normalize_call_status(value: Option<&str>, transcript: Option<&str>) -> String {
    match value.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "ringing" | "answered" | "completed" | "missed" | "busy" | "failed" | "abandoned" => {
            value.unwrap().trim().to_ascii_lowercase()
        }
        "no-answer" | "no_answer" | "unanswered" => "missed".into(),
        "in-progress" | "in_progress" => "answered".into(),
        _ if transcript.is_some_and(|body| !body.trim().is_empty()) => "completed".into(),
        _ => "received".into(),
    }
}

fn normalize_phone(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}

fn parse_report_day(raw: &str, inclusive_end: bool) -> Result<DateTime<Utc>, AppError> {
    let date = NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("date must use YYYY-MM-DD"))?;
    let start = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::validation("date is invalid"))?;
    let value = Utc.from_utc_datetime(&start);
    Ok(if inclusive_end {
        value + Duration::days(1)
    } else {
        value
    })
}

fn call_report_insights(
    summary: &AiVoiceCallReportSummary,
    opportunities: &[AiVoiceCallOpportunity],
) -> Vec<String> {
    let mut insights = Vec::new();
    if summary.total_calls == 0 {
        insights.push("No phone calls recorded in this period.".into());
        return insights;
    }
    let missed_rate = (summary.missed_calls * 100) / summary.total_calls.max(1);
    if missed_rate > 20 {
        insights.push(format!(
            "Missed-call rate is {missed_rate}%; tighten receptionist pickup or overflow routing."
        ));
    }
    if summary.repeat_callers > 0 {
        insights.push(format!(
            "{} callers contacted more than once; review follow-up before they drop off.",
            summary.repeat_callers
        ));
    }
    if summary.booking_drafts == 0 && summary.transcript_calls > 0 {
        insights.push("Calls have transcripts but no booking drafts; check service intent detection and booking handoff.".into());
    }
    if let Some(top) = opportunities.first() {
        insights.push(format!(
            "Top recovery opportunity: {} had {} calls and {} missed attempts.",
            top.caller_phone, top.call_count, top.missed_calls
        ));
    }
    if insights.is_empty() {
        insights.push("Call handling looks stable for this period.".into());
    }
    insights
}

#[cfg(test)]
/// An owner login for concierge tests. Concierge access is now decided from
/// permissions, so tests supply claims rather than a role string.
fn owner_claims() -> AuthClaims {
    AuthClaims {
        sub: "user1".into(),
        tenant_id: "tenant1".into(),
        branch_id: Some("branch1".into()),
        role: "owner".into(),
        role_id: None,
        permissions: Vec::new(),
        denied_permissions: Vec::new(),
        masked_fields: Vec::new(),
        max_discount_paise: None,
        max_refund_paise: None,
        max_cash_movement_paise: None,
        permission_version: 1,
        session_id: String::new(),
        mfa_enrollment_required: false,
        token_type: "access".into(),
        jti: "jti".into(),
        iat: 0,
        exp: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_governance, local_response, normalize_recording_consent, provider_payload, redact,
        ProviderEnvelope, ProviderResponse,
    };

    use crate::repositories::ai_concierge_repository::{AiOperationalContext, AiServiceCandidate};

    fn provider_reply() -> ProviderResponse {
        ProviderResponse {
            source: "ai_service".into(),
            model: "test-model".into(),
            prompt_version: "receptionist-v1".into(),
            reply_text: "hello".into(),
            intent: "general".into(),
            service_id: String::new(),
            handoff_required: false,
            safety_flags: vec![],
        }
    }

    #[test]
    fn provider_payload_is_used_only_when_the_envelope_succeeds() {
        assert!(provider_payload(ProviderEnvelope {
            success: true,
            data: Some(provider_reply()),
        })
        .is_some());
        // A failed envelope must fall back to CRM data even when it carries a reply.
        assert!(provider_payload(ProviderEnvelope {
            success: false,
            data: Some(provider_reply()),
        })
        .is_none());
        assert!(provider_payload(ProviderEnvelope::<ProviderResponse> {
            success: true,
            data: None,
        })
        .is_none());
    }

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
            None,
            false,
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

    #[test]
    fn recording_consent_accepts_only_known_states() {
        assert_eq!(
            normalize_recording_consent(Some("GRANTED")).unwrap(),
            "granted"
        );
        assert_eq!(normalize_recording_consent(None).unwrap(), "unknown");
        assert!(normalize_recording_consent(Some("assumed")).is_err());
    }

    #[test]
    fn local_copilot_answers_from_authorized_operational_context() {
        let context = AiOperationalContext {
            business_date: "2026-07-15".into(),
            today_appointments: 6,
            open_appointments: 2,
            active_clients: 48,
            active_staff: 9,
            active_services: 12,
            top_service_name: Some("Hair Cut".into()),
            top_service_quantity: Some(14),
            top_service_sales_paise: Some(560_000),
            today_sales_paise: 125_050,
            open_sales: 1,
            recent_completed_appointments: 17,
            low_stock_items: 3,
        };
        let reply = local_response(
            "Give me today's sales overview",
            &[],
            Some(&context),
            true,
            &default_governance().prompt_version,
        );
        assert!(reply.reply_text.contains("₹1250.50"));
        assert!(reply.reply_text.contains("Open sales: 1"));
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    pub message_id: String,
    pub helpful: bool,
    pub note: Option<String>,
    pub tool: Option<String>,
}

/// Records whether an answer was useful.
///
/// The message is verified to belong to this tenant, branch and session before
/// anything is stored, so feedback cannot be attached to another tenant's
/// conversation by guessing an id. Any free-text note is redacted first.
pub async fn record_feedback(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    user_id: &str,
    request: FeedbackRequest,
) -> Result<(), AppError> {
    let message_id = limited(&request.message_id, 80, "message id")?;
    if !repository::message_belongs_to_session(db, tenant_id, branch_id, session_id, &message_id)
        .await
        .map_err(|_| AppError::internal("failed to validate AI message"))?
    {
        return Err(AppError::not_found("AI message was not found"));
    }
    let note = request.note.unwrap_or_default();
    let note = redact(note.trim());
    if note.chars().count() > 1_000 {
        return Err(AppError::validation("feedback note is too long"));
    }
    let tool = request.tool.unwrap_or_default();
    let tool = tool.trim();
    if tool.chars().count() > 80 {
        return Err(AppError::validation("feedback tool is invalid"));
    }
    repository::save_feedback(
        db,
        tenant_id,
        branch_id,
        session_id,
        &message_id,
        user_id,
        request.helpful,
        &note,
        tool,
    )
    .await
    .map_err(|_| AppError::internal("failed to store AI feedback"))
}

/// Phase 0 — the header drawer's basic conversation, proven against a real
/// database instead of reasoned about.
///
/// These cover the flow the drawer actually performs: open a session, send a
/// message, reload the transcript, and come back after a browser refresh. They
/// run only when DATABASE_URL points at a migrated schema.
#[cfg(test)]
mod phase0_flow_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    struct Scope {
        tenant: String,
        branch: String,
        user: String,
    }

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    /// `users` is keyed to real tenant and branch rows, so the whole chain is
    /// seeded rather than faked with loose text ids.
    async fn seed(db: &PgPool) -> Scope {
        let tenant = Uuid::new_v4().to_string();
        let branch = Uuid::new_v4().to_string();
        let user = format!("aiuser_{}", Uuid::new_v4().simple());
        sqlx::query(
            "INSERT INTO tenants(id,name,status) VALUES ($1::UUID,'Aura Salon Group','active')",
        )
        .bind(&tenant)
        .execute(db)
        .await
        .expect("tenant seeded");
        sqlx::query(
            "INSERT INTO branches(id,tenant_id,name,scope_id,active) VALUES ($2::UUID,$1::UUID,'Andheri West','andheri-west',TRUE)",
        )
        .bind(&tenant)
        .bind(&branch)
        .execute(db)
        .await
        .expect("branch seeded");
        sqlx::query(
            "INSERT INTO users(id,tenant_id,branch_id,role_name,email,password_hash,full_name,active)
             VALUES ($1,$2,$3,'owner',$1||'@example.com','x','Reception Owner',TRUE)",
        )
        .bind(&user)
        .bind(&tenant)
        .bind(&branch)
        .execute(db)
        .await
        .expect("user seeded");
        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ($1||'svc',$1,$2,'Hair Spa','Hair',60,150000,TRUE)",
        )
        .bind(&tenant)
        .bind(&branch)
        .execute(db)
        .await
        .expect("service seeded");
        Scope {
            tenant,
            branch,
            user,
        }
    }

    async fn cleanup(db: &PgPool, scope: &Scope) {
        // Messages and actions cascade from the session.
        let _ = sqlx::query("DELETE FROM ai_concierge_sessions WHERE tenant_id=$1")
            .bind(&scope.tenant)
            .execute(db)
            .await;
        for table in ["services", "users"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(&scope.tenant)
                .execute(db)
                .await;
        }
        let _ = sqlx::query("DELETE FROM branches WHERE tenant_id::TEXT=$1")
            .bind(&scope.tenant)
            .execute(db)
            .await;
        let _ = sqlx::query("DELETE FROM tenants WHERE id::TEXT=$1")
            .bind(&scope.tenant)
            .execute(db)
            .await;
    }

    /// The whole Phase 0 acceptance path in the order the drawer performs it.
    #[tokio::test]
    async fn hi_is_answered_stored_and_still_there_after_a_reload() {
        let Some(db) = connect().await else { return };
        let scope = seed(&db).await;

        let session = open_web_session(
            &db,
            &scope.tenant,
            &scope.branch,
            &scope.user,
            OpenSessionRequest { locale: None },
        )
        .await
        .expect("session opens");

        let reply = process_message(
            &db,
            ProviderEndpoint::unconfigured(),
            &scope.tenant,
            &scope.branch,
            session.clone(),
            ConciergeMessageRequest {
                body: "Hi".into(),
                provider_message_id: None,
            },
            Some(&owner_claims()),
        )
        .await
        .expect("a message is answered even with no AI provider configured");

        // With no provider configured the deterministic CRM answer stands in,
        // and the drawer is told which one replied.
        assert_eq!(reply.provider_status, PROVIDER_NOT_CONFIGURED);
        assert_eq!(reply.assistant_message.provider, "rust_deterministic");
        assert!(
            !reply.assistant_message.body.trim().is_empty(),
            "a fallback answer must still say something"
        );

        // Both sides of the exchange are persisted, not just the reply.
        let stored = transcript(&db, &scope.tenant, &scope.branch, &session.id)
            .await
            .expect("transcript loads");
        assert_eq!(
            stored.len(),
            2,
            "user message and assistant reply are stored"
        );
        assert_eq!(stored[0].role, "user");
        assert_eq!(stored[0].body, "Hi");
        assert_eq!(stored[1].role, "assistant");

        // A browser reload re-opens by the same deterministic thread id, so the
        // conversation comes back instead of starting empty.
        let after_reload = open_web_session(
            &db,
            &scope.tenant,
            &scope.branch,
            &scope.user,
            OpenSessionRequest { locale: None },
        )
        .await
        .expect("session re-opens after a reload");
        assert_eq!(
            after_reload.id, session.id,
            "a reload must resume the same session, not start a new one"
        );
        let resumed = transcript(&db, &scope.tenant, &scope.branch, &after_reload.id)
            .await
            .expect("transcript loads after reload");
        assert_eq!(resumed.len(), 2, "the earlier conversation is still there");

        cleanup(&db, &scope).await;
    }

    /// A failure has to arrive as a typed, quotable error rather than a blank
    /// one, and must not carry SQL, secrets or internals to the browser.
    #[tokio::test]
    async fn an_unknown_session_fails_safely_and_says_nothing_internal() {
        let Some(db) = connect().await else { return };
        let scope = seed(&db).await;

        // The drawer loads a transcript on every open, so this is the lookup a
        // stale or foreign session id actually hits first.
        let error = transcript(&db, &scope.tenant, &scope.branch, "no-such-session")
            .await
            .expect_err("an unknown session is rejected");

        let rendered = format!("{error:?}").to_ascii_lowercase();
        assert!(
            rendered.contains("not_found") || rendered.contains("notfound"),
            "the drawer needs a typed code to translate, got: {rendered}"
        );
        for leak in ["select ", "insert ", "postgres://", "panicked", "sqlx::"] {
            assert!(
                !rendered.contains(leak),
                "error must not expose {leak:?}: {rendered}"
            );
        }

        cleanup(&db, &scope).await;
    }

    /// Phase 0 must not disturb the two actions the receptionist already had.
    #[tokio::test]
    async fn booking_draft_and_human_handoff_still_behave_as_before() {
        let Some(db) = connect().await else { return };
        let scope = seed(&db).await;

        let session = open_web_session(
            &db,
            &scope.tenant,
            &scope.branch,
            &scope.user,
            OpenSessionRequest { locale: None },
        )
        .await
        .expect("session opens");

        let booking = process_message(
            &db,
            ProviderEndpoint::unconfigured(),
            &scope.tenant,
            &scope.branch,
            session.clone(),
            ConciergeMessageRequest {
                body: "I want to book Hair Spa".into(),
                provider_message_id: None,
            },
            Some(&owner_claims()),
        )
        .await
        .expect("booking intent is answered");
        assert_eq!(booking.action_type, "booking_draft");
        assert_eq!(
            booking.action_payload["requiresConfirmation"], true,
            "a draft must still require explicit confirmation"
        );
        assert!(
            !booking
                .assistant_message
                .body
                .to_ascii_lowercase()
                .contains("confirmed"),
            "the copilot must never claim a booking is confirmed"
        );

        let handoff = process_message(
            &db,
            ProviderEndpoint::unconfigured(),
            &scope.tenant,
            &scope.branch,
            session.clone(),
            ConciergeMessageRequest {
                body: "I need a refund for my treatment".into(),
                provider_message_id: None,
            },
            Some(&owner_claims()),
        )
        .await
        .expect("a sensitive request is answered");
        assert_eq!(handoff.action_type, "human_handoff");

        // A handoff parks the session for a person to pick up.
        let parked = repository::session(&db, &scope.tenant, &scope.branch, &session.id)
            .await
            .expect("session reloads")
            .expect("session exists");
        assert_eq!(parked.status, "handoff");

        cleanup(&db, &scope).await;
    }

    /// A resubmitted message must not become a second entry in the transcript.
    #[tokio::test]
    async fn the_same_submission_sent_twice_is_stored_once() {
        let Some(db) = connect().await else { return };
        let scope = seed(&db).await;

        let session = open_web_session(
            &db,
            &scope.tenant,
            &scope.branch,
            &scope.user,
            OpenSessionRequest { locale: None },
        )
        .await
        .expect("session opens");

        let submission = format!("submit_{}", Uuid::new_v4().simple());
        let claims = owner_claims();
        let send_once = || {
            process_message(
                &db,
                ProviderEndpoint::unconfigured(),
                &scope.tenant,
                &scope.branch,
                session.clone(),
                ConciergeMessageRequest {
                    body: "Hi".into(),
                    provider_message_id: Some(submission.clone()),
                },
                Some(&claims),
            )
        };

        send_once().await.expect("the first submission is answered");
        let repeat = send_once()
            .await
            .expect_err("the same submission id must not be stored twice");
        assert!(
            format!("{repeat:?}")
                .to_ascii_lowercase()
                .contains("conflict"),
            "a repeat submission is a conflict the drawer can ignore, got: {repeat:?}"
        );

        let stored = transcript(&db, &scope.tenant, &scope.branch, &session.id)
            .await
            .expect("transcript loads");
        assert_eq!(
            stored.len(),
            2,
            "a double submission leaves one question and one answer, not two of each"
        );

        cleanup(&db, &scope).await;
    }

    /// A provider that cannot be reached must degrade to the CRM answer, not
    /// surface an error to the user.
    #[tokio::test]
    async fn an_unreachable_provider_still_answers_from_crm_data() {
        let Some(db) = connect().await else { return };
        let scope = seed(&db).await;

        let session = open_web_session(
            &db,
            &scope.tenant,
            &scope.branch,
            &scope.user,
            OpenSessionRequest { locale: None },
        )
        .await
        .expect("session opens");

        // Port 1 is reserved and never listening, so the send fails the same way
        // a timeout or a stopped Python service would.
        let reply = process_message(
            &db,
            ProviderEndpoint::at("http://127.0.0.1:1", "test-token"),
            &scope.tenant,
            &scope.branch,
            session.clone(),
            ConciergeMessageRequest {
                body: "Hi".into(),
                provider_message_id: None,
            },
            Some(&owner_claims()),
        )
        .await
        .expect("an unreachable provider must not fail the request");

        assert_eq!(reply.provider_status, PROVIDER_UNREACHABLE);
        assert_eq!(reply.assistant_message.provider, "rust_deterministic");
        assert!(!reply.assistant_message.body.trim().is_empty());

        cleanup(&db, &scope).await;
    }
}

/// Phase 7 — language and channel parity.
///
/// The drawer, WhatsApp and voice all go through the same governance and the
/// same tool permissions. These check the properties that would break quietly.
#[cfg(test)]
mod phase7_channel_language_tests {
    use super::*;
    use crate::services::ai_copilot_tools;

    /// All three supported languages resolve, and Hinglish is treated as Hindi
    /// so it gets the Latin-script Hindi chips rather than English ones.
    #[test]
    fn hinglish_is_recognised_as_hindi() {
        assert!(ai_copilot_tools::is_hindi("hi-IN"));
        assert!(
            ai_copilot_tools::is_hindi("hi-Latn-IN"),
            "Hinglish must get Hindi chips, not English ones"
        );
        assert!(!ai_copilot_tools::is_hindi("en-IN"));
    }

    /// A Hinglish chip must still route to the tool it claims, or tapping it
    /// would produce a different answer than the label promised.
    #[test]
    fn hinglish_chips_route_to_the_tool_they_name() {
        let actor = ai_copilot_tools::ToolActor::new("user1", "owner");
        let chips = ai_copilot_tools::suggested_questions(&actor, "hi-Latn-IN");
        assert!(!chips.is_empty(), "Hinglish must offer chips");
        for chip in chips {
            let matched = ai_copilot_tools::detect(&chip.question)
                .unwrap_or_else(|| panic!("Hinglish chip {:?} matches no tool", chip.question));
            assert_eq!(
                matched.tool.name(),
                chip.tool,
                "Hinglish chip {:?} routes elsewhere",
                chip.question
            );
        }
    }

    /// Governance decides the channel, and the default is web only. An operator
    /// has to turn WhatsApp or voice on deliberately.
    #[test]
    fn every_channel_is_governed_by_the_same_switch() {
        let mut governance = default_governance();
        assert!(ensure_channel(&governance, "web").is_ok());
        for channel in ["whatsapp", "voice"] {
            assert!(
                ensure_channel(&governance, channel).is_err(),
                "{channel} must be off until it is enabled"
            );
        }

        // Enabled explicitly, the same check now passes for all three.
        governance.allowed_channels = json!(["web", "whatsapp", "voice"]);
        for channel in CHANNELS {
            assert!(ensure_channel(&governance, channel).is_ok());
        }

        // Turning the assistant off closes every channel at once, not just web.
        governance.enabled = false;
        for channel in CHANNELS {
            assert!(
                ensure_channel(&governance, channel).is_err(),
                "{channel} must close when the assistant is disabled"
            );
        }
    }

    /// Redaction is applied to the stored transcript on every channel, because
    /// it is applied before the channel is considered at all.
    #[test]
    fn contact_details_are_redacted_whatever_the_channel() {
        let governance = default_governance();
        assert!(governance.redact_sensitive_data);
        assert_eq!(
            redact("call 9876543210 or mail me@example.com"),
            "call [redacted] or mail [redacted]"
        );
    }
}

#[cfg(test)]
mod header_path_scope_tests {
    use super::{run_copilot_tool, CopilotOutcome};
    use crate::services::ai_tool_dispatcher::tests_support::claims;
    use sqlx::PgPool;

    /// Proves the header drawer's own code path is scope-enforced.
    ///
    /// `run_copilot_tool` is what `process_web_message` calls for every message
    /// typed into the header drawer. Driving it directly with a login that holds
    /// one of two branches shows the answer is built from the grants, not from
    /// the branch id the client happened to send.
    #[sqlx::test]
    async fn a_header_message_is_answered_through_the_scoped_dispatcher(pool: PgPool) {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let mut branches = Vec::new();
        for name in ["Banjara Hills", "Andheri West"] {
            let id: String = sqlx::query_scalar(
                r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
                   VALUES((SELECT id FROM tenants WHERE scope_id=$1),$2,'','South','Hyderabad','Central',TRUE)
                   RETURNING scope_id"#,
            )
            .bind(&tenant_id)
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap();
            branches.push((id, name.to_string()));
        }

        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'manager','asha.rao@aurasalon.in','x','Asha Rao') RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branches[0].0)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active)
               VALUES($1,$2,$3,'manager',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&branches[0].0)
        .execute(&pool)
        .await
        .unwrap();

        for (branch_id, _) in &branches {
            sqlx::query(
                r#"INSERT INTO services(tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
                   VALUES($1,$2,'Hair Colour','Hair',60,250000,TRUE)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .execute(&pool)
            .await
            .unwrap();
        }

        let mut header_claims = claims("manager", &[], &[]);
        header_claims.sub = user_id.clone();
        header_claims.tenant_id = tenant_id.clone();
        header_claims.branch_id = Some(branches[0].0.clone());

        // The second branch is passed as the request's branch context. The
        // dispatcher must still answer from the grants, not from this value.
        let outcome = run_copilot_tool(
            &pool,
            &tenant_id,
            &branches[1].0,
            &header_claims,
            "session-1",
            "which services are declining",
        )
        .await;

        let CopilotOutcome::Answered(answer) = outcome else {
            panic!("the header path must produce a grounded answer: {outcome:?}");
        };
        assert_eq!(
            answer.branch_id, branches[0].0,
            "the answer must read the granted branch, not the requested one"
        );
        assert_eq!(answer.scope.branches_read, vec![branches[0].1.clone()]);
        assert!(
            !answer.scope.branches_read.contains(&branches[1].1),
            "an ungranted branch must never appear in a header answer"
        );
    }
}
