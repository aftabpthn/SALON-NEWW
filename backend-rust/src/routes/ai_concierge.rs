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
    repositories::{
        ai_concierge_repository::{self, AiGovernanceRecord, AiMessageRecord, AiSessionRecord},
        communication_repository,
    },
    routes::context::tenant_branch,
    services::{
        ai_action_autonomy_service::{self, AutonomyGrantRequest, AutonomyStatus},
        ai_action_service::{self, ActionDraft, ConfirmDraftRequest, CreateDraftRequest},
        ai_briefing_service::{
            self, BranchComparisonRow, Briefing, Cadence, Signal, SignalDecision,
            SignalDecisionRequest,
        },
        ai_concierge_service::{
            self, ConciergeMessageRequest, ConciergeResponse, GovernanceRequest, OpenSessionRequest,
        },
        ai_copilot_tools,
        ai_memory_service::{self, RecordNoteRequest, RecordedNote, ResolveDisputeRequest},
        ai_prediction_outcome_service::{self, PredictionAccuracy},
        ai_prediction_service::{self, PredictionKind, PredictionRun},
        ai_scope_service::ScopeRequest,
        ai_what_if_service::{self, WhatIf, WhatIfResult},
        ai_workforce_service::{self, EvaluationRequest, WorkforceSummary},
        auth_service::AuthClaims,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ai/governance", get(get_governance).put(save_governance))
        .route("/ai/workforce", get(get_workforce))
        .route(
            "/ai/workforce/evaluations",
            post(record_workforce_evaluation),
        )
        .route("/ai/concierge/sessions", post(open_session))
        .route("/ai/concierge/sessions/:id/messages", post(send_message))
        .route("/ai/concierge/sessions/:id/transcript", get(get_transcript))
        .route("/ai/concierge/suggestions", get(get_suggestions))
        .route("/ai/concierge/sessions/:id/feedback", post(save_feedback))
        .route("/ai/concierge/calls/report", get(call_report))
        .route("/ai/predictions/:kind", post(run_prediction))
        .route("/ai/predictions/:kind/latest", get(get_latest_prediction))
        .route(
            "/ai/predictions/:kind/accuracy",
            get(get_prediction_accuracy),
        )
        .route("/ai/what-if", post(run_what_if))
        .route("/ai/briefing/:cadence", get(get_briefing))
        .route("/ai/briefing/compare/:signal", get(compare_branches))
        .route("/ai/briefing/signals/:signal/decision", post(decide_signal))
        .route("/ai/actions/drafts", post(create_action_draft))
        .route("/ai/actions/drafts/:id/confirm", post(confirm_action_draft))
        .route("/ai/actions/drafts/:id/cancel", post(cancel_action_draft))
        .route("/ai/actions/drafts/:id/undo", post(undo_action_draft))
        .route(
            "/ai/actions/autonomy",
            get(get_action_autonomy).put(set_action_autonomy),
        )
        .route("/ai/actions/autonomy/undoable", get(list_undoable_runs))
        .route("/ai/memory", post(record_memory))
        .route("/ai/memory/:subjectKind/:subjectId", get(recall_memory))
        .route("/ai/memory/notes/:id", axum::routing::delete(forget_memory))
        .route("/ai/memory/disputes", get(list_memory_disputes))
        .route("/ai/memory/notes/:id/dispute", post(resolve_memory_dispute))
        .route(
            "/ai/memory/clients/:id",
            axum::routing::delete(forget_client_memory),
        )
}

async fn get_workforce(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<WorkforceSummary> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_workforce_service::summary(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn record_workforce_evaluation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<EvaluationRequest>,
) -> ApiResult<ai_concierge_repository::AiWorkforceEvaluationRecord> {
    require_ai_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_workforce_service::record_evaluation(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
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
    let mut report = ai_concierge_service::voice_call_report(
        &state.db,
        &tenant_id,
        &branch_id,
        query.start_date.as_deref(),
        query.end_date.as_deref(),
    )
    .await?;
    let contact_allowed =
        !claims.denied_permissions.iter().any(|permission| {
            matches!(permission.as_str(), "clients.read" | "clients.contact.read")
        }) && (matches!(
            claims.role.to_ascii_lowercase().as_str(),
            "owner" | "admin" | "manager" | "frontdesk" | "receptionist"
        ) || claims.permissions.iter().any(|permission| {
            matches!(permission.as_str(), "clients.read" | "clients.contact.read")
        }));
    if !contact_allowed {
        for call in &mut report.recent_calls {
            call.caller_phone = mask_phone(&call.caller_phone);
            call.salon_phone.clear();
            call.staff_phone.clear();
            call.ai_summary.clear();
        }
        for opportunity in &mut report.opportunities {
            opportunity.caller_phone = mask_phone(&opportunity.caller_phone);
            opportunity.normalized_caller_phone.clear();
        }
    }
    Ok(Json(ApiResponse::ok(report)))
}

fn mask_phone(value: &str) -> String {
    let digits = value
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    format!(
        "****{}",
        digits
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
    )
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
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
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
    let (tenant_id, _) = tenant_branch(&headers)?;
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

/// Records something the client said, or that staff want remembered.
///
/// Deliberately a human-driven endpoint. There is no path by which the
/// assistant writes here: a note it inferred would be recalled as fact
/// indefinitely with nobody able to say where it came from.
async fn record_memory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RecordNoteRequest>,
) -> ApiResult<RecordedNote> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_memory_service::record(&state.db, &tenant_id, &branch_id, &claims, payload).await?,
    )))
}

/// One subject's live notes.
async fn recall_memory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((subject_kind, subject_id)): Path<(String, String)>,
) -> ApiResult<Vec<crate::repositories::ai_memory_repository::MemoryNote>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_memory_service::recall(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims,
            &subject_kind,
            &subject_id,
        )
        .await?,
    )))
}

/// Forgets one note.
async fn forget_memory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(note_id): Path<String>,
) -> ApiResult<Value> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ai_memory_service::forget(&state.db, &tenant_id, &branch_id, &claims, &note_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"forgotten": true}),
    )))
}

/// Forgets everything remembered about one client.
async fn forget_client_memory(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<Value> {
    require_ai_read(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let removed =
        ai_memory_service::forget_client(&state.db, &tenant_id, &claims, &client_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"forgotten": removed}),
    )))
}

/// What clients have said is wrong and nobody has reviewed yet.
async fn list_memory_disputes(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::ai_memory_repository::MemoryNote>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_memory_service::open_disputes(&state.db, &tenant_id, &branch_id, &claims).await?,
    )))
}

/// Closes a dispute: `corrected` removes the note, `upheld` returns it to use
/// while leaving the dispute on the record.
async fn resolve_memory_dispute(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(note_id): Path<String>,
    Json(payload): Json<ResolveDisputeRequest>,
) -> ApiResult<Value> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ai_memory_service::resolve_dispute(
        &state.db, &tenant_id, &branch_id, &claims, &note_id, payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({"resolved": true}))))
}

/// Where each action kind stands on running without confirmation.
///
/// Readable by anyone who may use the copilot: someone about to be told an
/// action already ran is entitled to see why it was allowed to.
async fn get_action_autonomy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<AutonomyStatus>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_autonomy_service::statuses(&state.db, &tenant_id, &branch_id).await?,
    )))
}

/// Grants or withdraws autonomy for one action kind.
///
/// Owner and admin only, and narrower than the roles that may confirm these
/// actions by hand: approving one task is operational, deciding a whole class
/// no longer needs approving is policy.
async fn set_action_autonomy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<AutonomyGrantRequest>,
) -> ApiResult<AutonomyStatus> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_autonomy_service::set_grant(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

/// Runs the copilot completed on its own that can still be taken back.
async fn list_undoable_runs(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::ai_action_autonomy_repository::AutonomousRun>> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_action_autonomy_service::undoable(&state.db, &tenant_id, &branch_id).await?,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRequest {
    #[serde(default)]
    reason: String,
}

/// Reverses an autonomous run and withdraws the grant that allowed it.
async fn undo_action_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(draft_id): Path<String>,
    Json(payload): Json<UndoRequest>,
) -> ApiResult<ActionDraft> {
    require_ai_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reason = payload.reason.trim().chars().take(500).collect::<String>();
    Ok(Json(ApiResponse::ok(
        ai_action_service::undo_draft(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            &draft_id,
            &reason,
        )
        .await?,
    )))
}

/// How this prediction kind has actually performed.
///
/// Reads only resolved outcomes, so it says nothing about predictions still
/// inside their horizon beyond how many there are. Same scope chain as the
/// prediction itself: a login sees the track record for the branches whose
/// predictions it could have read.
async fn get_prediction_accuracy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> ApiResult<PredictionAccuracy> {
    require_ai_read(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let kind = PredictionKind::from_name(&kind)
        .ok_or_else(|| AppError::not_found("that prediction is not available"))?;
    Ok(Json(ApiResponse::ok(
        ai_prediction_outcome_service::accuracy(
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
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        ai_what_if_service::simulate(&state.db, &tenant_id, &branch_id, &claims.role, scenario)
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
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        ai_action_service::create_draft(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            payload,
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
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        ai_action_service::confirm_draft(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            &draft_id,
            payload,
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
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.role,
            &claims.sub,
            &draft_id,
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
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
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
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ai_workforce_service::require_enabled_and_consume(&state.db, &tenant_id, &branch_id).await?;
    let signal = Signal::from_key(&signal)
        .ok_or_else(|| AppError::not_found("that comparison is not available"))?;
    let user =
        crate::repositories::auth_repository::find_user_by_id(&state.db, &tenant_id, &claims.sub)
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
            &state.db,
            &tenant_id,
            &claims.role,
            &claims.sub,
            &branches,
            signal,
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
    let inbound = !matches!(
        payload
            .direction
            .as_deref()
            .unwrap_or("inbound")
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "outbound" | "outgoing"
    );
    let identity = if inbound {
        communication_repository::resolve_or_create_inbound_identity(
            &state.db,
            &payload.tenant_id,
            &payload.branch_id,
            "voice",
            &payload.from,
        )
        .await
        .map_err(|_| AppError::internal("failed to resolve voice caller"))?
    } else {
        communication_repository::InboundIdentity {
            client_id: ai_concierge_repository::resolve_client_by_phone(
                &state.db,
                &payload.tenant_id,
                &payload.branch_id,
                &payload.from,
            )
            .await
            .map_err(|_| AppError::internal("failed to resolve voice caller"))?,
            lead_id: None,
        }
    };
    let response = ai_concierge_service::record_voice_call_event(
        &state.db,
        &state.settings,
        payload,
        identity.client_id,
        identity.lead_id,
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
