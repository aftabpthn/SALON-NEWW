use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::ai_concierge_repository::{
        self, AiGovernanceRecord, AiMessageRecord, AiSessionRecord,
    },
    routes::context::tenant_branch,
    services::{
        ai_concierge_service::{
            self, ConciergeMessageRequest, ConciergeResponse, GovernanceRequest, OpenSessionRequest,
        },
        ai_copilot_tools,
        ai_prediction_service::{self, PredictionKind, PredictionRun},
        ai_scope_service::ScopeRequest,
        ai_action_service::{self, ActionDraft, ConfirmDraftRequest, CreateDraftRequest},
        ai_briefing_service::{
            self, BranchComparisonRow, Briefing, Cadence, Signal, SignalDecision,
            SignalDecisionRequest,
        },
        ai_what_if_service::{self, WhatIf, WhatIfResult},
        auth_service::AuthClaims,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ai/governance", get(get_governance).put(save_governance))
        .route("/ai/concierge/sessions", post(open_session))
        .route("/ai/concierge/sessions/:id/messages", post(send_message))
        .route("/ai/concierge/sessions/:id/transcript", get(get_transcript))
        .route("/ai/concierge/suggestions", get(get_suggestions))
        .route("/ai/concierge/sessions/:id/feedback", post(save_feedback))
        .route("/ai/concierge/calls/report", get(call_report))
        .route("/ai/predictions/:kind", post(run_prediction))
        .route("/ai/predictions/:kind/latest", get(get_latest_prediction))
        .route("/ai/what-if", post(run_what_if))
        .route("/ai/briefing/:cadence", get(get_briefing))
        .route("/ai/briefing/compare/:signal", get(compare_branches))
        .route("/ai/briefing/signals/:signal/decision", post(decide_signal))
        .route("/ai/actions/drafts", post(create_action_draft))
        .route("/ai/actions/drafts/:id/confirm", post(confirm_action_draft))
        .route("/ai/actions/drafts/:id/cancel", post(cancel_action_draft))
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/webhooks/voice/concierge", post(voice_webhook))
}

async fn get_governance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<AiGovernanceRecord> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::governance(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_governance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<GovernanceRequest>,
) -> ApiResult<AiGovernanceRecord> {
    require_ai_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::save_governance(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

async fn open_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OpenSessionRequest>,
) -> ApiResult<AiSessionRecord> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::open_web_session(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

async fn send_message(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(payload): Json<ConciergeMessageRequest>,
) -> ApiResult<ConciergeResponse> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::process_web_message(
            &state.db,
            &state.settings,
            &tenant_id,
            &branch_id,
            &claims,
            &session_id,
            payload,
        )
        .await?,
    )))
}

async fn get_transcript(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> ApiResult<Vec<AiMessageRecord>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::transcript(&state.db, &tenant_id, &branch_id, &session_id).await?,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestionsQuery {
    locale: Option<String>,
}

/// Starter questions this role may actually have answered.
async fn get_suggestions(
    Extension(claims): Extension<AuthClaims>,
    Query(query): Query<SuggestionsQuery>,
) -> ApiResult<Vec<ai_copilot_tools::SuggestedQuestion>> {
    require_ai_read(&claims)?;
    let actor = ai_copilot_tools::ToolActor::new(&claims.sub, &claims.role);
    Ok(Json(ApiResponse::ok(
        ai_copilot_tools::suggested_questions(&actor, query.locale.as_deref().unwrap_or("en-IN")),
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackRequest {
    message_id: String,
    helpful: bool,
    note: Option<String>,
    tool: Option<String>,
}

/// Records whether an answer was useful. Voting twice replaces the first vote.
async fn save_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(payload): Json<FeedbackRequest>,
) -> ApiResult<Value> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ai_concierge_service::record_feedback(
        &state.db,
        &tenant_id,
        &branch_id,
        &session_id,
        &claims.sub,
        ai_concierge_service::FeedbackRequest {
            message_id: payload.message_id,
            helpful: payload.helpful,
            note: payload.note,
            tool: payload.tool,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"recorded": true}))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallReportQuery {
    start_date: Option<String>,
    end_date: Option<String>,
}

async fn call_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<CallReportQuery>,
) -> ApiResult<ai_concierge_service::VoiceCallReport> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_concierge_service::voice_call_report(
            &state.db,
            &tenant_id,
            &branch_id,
            query.start_date.as_deref(),
            query.end_date.as_deref(),
        )
        .await?,
    )))
}

/// Runs a prediction over this branch's history.
///
/// The kind is matched against the allow-list rather than passed through, so a
/// caller cannot name an arbitrary computation.
async fn run_prediction(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> ApiResult<PredictionRun> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let kind = PredictionKind::from_name(&kind)
        .ok_or_else(|| AppError::not_found("that prediction is not available"))?;
    Ok(Json(ApiResponse::ok(
        ai_prediction_service::predict(
            &state.db,
            ai_prediction_service::ProviderConfig::from_settings(&state.settings),
            &tenant_id,
            &claims,
            kind,
            &ScopeRequest::default(),
        )
        .await?,
    )))
}

/// The last stored run for this branch, for audit and for reuse without
/// recomputing.
async fn get_latest_prediction(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> ApiResult<Option<PredictionRun>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let kind = PredictionKind::from_name(&kind)
        .ok_or_else(|| AppError::not_found("that prediction is not available"))?;
    Ok(Json(ApiResponse::ok(
        ai_prediction_service::latest_run(
            &state.db,
            &tenant_id,
            &claims,
            kind,
            &ScopeRequest::default(),
        )
        .await?,
    )))
}

/// Projects a scenario without performing it.
///
/// This is a POST because the scenario is a body, not because anything is
/// created: the handler writes nothing, publishes no offer and sends no
/// campaign.
async fn run_what_if(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(scenario): Json<WhatIf>,
) -> ApiResult<WhatIfResult> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_what_if_service::simulate(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            scenario,
        )
        .await?,
    )))
}

/// Raises an action draft. Creates no business record.
async fn create_action_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CreateDraftRequest>,
) -> ApiResult<ActionDraft> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_service::create_draft(
            &state.db, &tenant_id, &branch_id, &claims.role, &claims.sub, payload,
        )
        .await?,
    )))
}

/// Records approval for a draft the user has explicitly confirmed.
async fn confirm_action_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(draft_id): Path<String>,
    Json(payload): Json<ConfirmDraftRequest>,
) -> ApiResult<ActionDraft> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_service::confirm_draft(
            &state.db, &tenant_id, &branch_id, &claims.role, &claims.sub, &draft_id, payload,
        )
        .await?,
    )))
}

async fn cancel_action_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(draft_id): Path<String>,
) -> ApiResult<ActionDraft> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_service::cancel_draft(
            &state.db, &tenant_id, &branch_id, &claims.role, &claims.sub, &draft_id,
        )
        .await?,
    )))
}

/// The briefing for this branch, on demand.
///
/// A preview: it does not record the signals as raised, so reading it cannot
/// suppress the scheduled run that follows.
async fn get_briefing(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(cadence): Path<String>,
) -> ApiResult<Briefing> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let cadence = Cadence::from_name(&cadence)
        .ok_or_else(|| AppError::not_found("that briefing cadence is not available"))?;
    Ok(Json(ApiResponse::ok(
        ai_briefing_service::build_briefing(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            cadence,
            false,
        )
        .await?,
    )))
}

/// Compares one signal across the branches this user is actually allowed to see.
///
/// The branch list comes from the user's own access grants, so a comparison can
/// never widen past what they could open directly.
async fn compare_branches(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(signal): Path<String>,
) -> ApiResult<Vec<BranchComparisonRow>> {
    require_ai_read(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let signal = Signal::from_key(&signal)
        .ok_or_else(|| AppError::not_found("that comparison is not available"))?;
    let user = crate::repositories::auth_repository::find_user_by_id(
        &state.db, &tenant_id, &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch access"))?
    .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
    let branches = crate::repositories::auth_repository::list_branch_access(&state.db, &user)
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?
        .into_iter()
        .map(|access| (access.branch_id, access.branch_name))
        .collect::<Vec<_>>();
    Ok(Json(ApiResponse::ok(
        ai_briefing_service::compare_branches(
            &state.db, &tenant_id, &claims.role, &claims.sub, &branches, signal,
        )
        .await?,
    )))
}

async fn voice_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ai_concierge_service::VoiceWebhookRequest>,
) -> ApiResult<Value> {
    verify_voice_provider(&state, &headers)?;
    if !ai_concierge_repository::active_branch_exists(
        &state.db,
        &payload.tenant_id,
        &payload.branch_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate voice branch"))?
    {
        return Err(AppError::not_found("voice branch was not found"));
    }
    let client_id = ai_concierge_repository::resolve_client_by_phone(
        &state.db,
        &payload.tenant_id,
        &payload.branch_id,
        &payload.from,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve voice caller"))?;
    let response = ai_concierge_service::record_voice_call_event(
        &state.db,
        &state.settings,
        payload,
        client_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::to_value(response).unwrap_or_default(),
    )))
}

fn verify_voice_provider(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let expected = state
        .settings
        .voice_provider_token
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "VOICE_PROVIDER_NOT_CONFIGURED",
                "voice provider is not configured",
            )
        })?;
    let supplied = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if supplied.is_empty() || supplied != expected {
        return Err(AppError::forbidden("voice provider authorization failed"));
    }
    Ok(())
}

fn require_ai_read(claims: &AuthClaims) -> Result<(), AppError> {
    let denied = claims
        .denied_permissions
        .iter()
        .any(|permission| permission == "ai.concierge.read");
    let default_role = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner"
            | "admin"
            | "manager"
            | "staff"
            | "frontdesk"
            | "receptionist"
            | "accountant"
            | "analyst"
            | "inventorymanager"
    );
    let granted = claims.permissions.iter().any(|permission| {
        matches!(
            permission.as_str(),
            "ai.concierge.read"
                | "reports.read"
                | "clients.read"
                | "staff.analytics.read"
                | "memberships.read"
                | "pos.read"
        )
    });
    if !denied && (default_role || granted) {
        Ok(())
    } else {
        Err(AppError::forbidden("AI concierge access is restricted"))
    }
}

fn require_ai_manage(claims: &AuthClaims) -> Result<(), AppError> {
    let denied = claims
        .denied_permissions
        .iter()
        .any(|permission| permission == "ai.concierge.manage");
    let allowed = matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager"
    ) || claims
        .permissions
        .iter()
        .any(|permission| permission == "ai.concierge.manage");
    if !denied && allowed {
        Ok(())
    } else {
        Err(AppError::forbidden("AI governance access is restricted"))
    }
}

/// Records acknowledge, snooze or dismiss for a briefing signal.
///
/// Nothing about the business changes here: this only decides whether the
/// briefing raises the same finding again.
async fn decide_signal(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(signal): Path<String>,
    Json(payload): Json<SignalDecisionRequest>,
) -> ApiResult<SignalDecision> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let signal = Signal::from_key(&signal)
        .ok_or_else(|| AppError::not_found("that briefing signal is not available"))?;
    Ok(Json(ApiResponse::ok(
        ai_briefing_service::decide_signal(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            signal,
            &payload,
        )
        .await?,
    )))
}
