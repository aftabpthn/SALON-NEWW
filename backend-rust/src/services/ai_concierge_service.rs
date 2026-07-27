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
    services::ai_copilot_tools::{self, CopilotAnswer},
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

/// Detects the intent, checks the role, and runs the one matching read tool.
#[allow(clippy::too_many_arguments)]
async fn run_copilot_tool(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    role: &str,
    session_id: &str,
    message: &str,
) -> CopilotOutcome {
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
    let outcome = ai_copilot_tools::run(db, tenant_id, branch_id, &actor, &matched).await;
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
    user_role: &str,
    session_id: &str,
    request: ConciergeMessageRequest,
) -> Result<ConciergeResponse, AppError> {
    let session = repository::session(db, tenant_id, branch_id, session_id)
        .await
        .map_err(|_| AppError::internal("failed to validate AI session"))?
        .filter(|row| row.user_id.as_deref() == Some(user_id) || row.user_id.is_none())
        .ok_or_else(|| AppError::not_found("AI session was not found"))?;
    process_message(
        db,
        settings,
        tenant_id,
        branch_id,
        session,
        request,
        Some(user_role),
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
        None,
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
    web_role: Option<&str>,
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
    let copilot = match web_role {
        Some(role) => {
            run_copilot_tool(
                db,
                tenant_id,
                branch_id,
                session.user_id.as_deref().unwrap_or_default(),
                role,
                &session.id,
                &raw_body,
            )
            .await
        }
        None => CopilotOutcome::NotApplicable,
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
            settings,
            tenant_id,
            branch_id,
            &session,
            &raw_body,
            &history,
            &services,
            operational_context.as_ref(),
            web_role,
            &governance,
            copilot.answer(),
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
    })
}

pub async fn record_voice_call_event(
    db: &PgPool,
    settings: &Settings,
    request: VoiceWebhookRequest,
    client_id: Option<String>,
) -> Result<VoiceWebhookResponse, AppError> {
    let provider = normalize_provider(request.provider.as_deref())?;
    let call_id = limited(&request.call_id, 120, "voice call id")?;
    let event_id = request.event_id.unwrap_or_default();
    let direction = normalize_direction(request.direction.as_deref());
    let status = normalize_call_status(request.status.as_deref(), request.transcript.as_deref());
    let caller_phone = limited(&request.from, 40, "caller phone")?;
    let normalized_phone = normalize_phone(&caller_phone);
    let transcript = request.transcript.unwrap_or_default().trim().to_string();
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
        request.recording_url.as_deref().unwrap_or(""),
        transcript_available,
        client_id.as_deref(),
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
        &json!({"source":"voice_webhook"}),
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
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    session: &AiSessionRecord,
    message: &str,
    history: &[AiMessageRecord],
    services: &[repository::AiServiceCandidate],
    operational_context: Option<&AiOperationalContext>,
    web_role: Option<&str>,
    governance: &AiGovernanceRecord,
    copilot: Option<&CopilotAnswer>,
) -> (ProviderResponse, &'static str) {
    let financials_visible = web_role.is_some_and(can_view_financials);
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
    let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) else {
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
            "active_services":context.active_services,
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
        "governance":{"prompt_version":governance.prompt_version,"allowed_intents":["general","booking","handoff"],"require_booking_confirmation":true,"redact_sensitive_data":governance.redact_sensitive_data}
    });
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(14))
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
            "Branch overview for {}:\nAppointments today: {} | Open: {}\nActive clients: {} | Active services: {}\nCompleted in last 7 days: {} | Low-stock items: {}{}",
            context.business_date,
            context.today_appointments,
            context.open_appointments,
            context.active_clients,
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
    "I can use live branch data for appointments, sales, clients, services and low-stock counts. I can also explain service price/duration and prepare a booking draft. Ask for an overview or name the metric you need.".into()
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

fn can_view_financials(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "accountant" | "analyst"
    )
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
mod tests {
    use super::{
        default_governance, local_response, provider_payload, redact, ProviderEnvelope,
        ProviderResponse,
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
    fn local_copilot_answers_from_authorized_operational_context() {
        let context = AiOperationalContext {
            business_date: "2026-07-15".into(),
            today_appointments: 6,
            open_appointments: 2,
            active_clients: 48,
            active_services: 12,
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
