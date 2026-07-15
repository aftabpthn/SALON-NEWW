use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

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
            &claims.sub,
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
struct VoiceWebhookRequest {
    tenant_id: String,
    branch_id: String,
    call_id: String,
    event_id: String,
    from: String,
    transcript: String,
    locale: Option<String>,
}

async fn voice_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VoiceWebhookRequest>,
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
    let response = ai_concierge_service::process_external_message(
        &state.db,
        &state.settings,
        &payload.tenant_id,
        &payload.branch_id,
        client_id.as_deref(),
        "voice",
        &payload.call_id,
        payload.locale.as_deref().unwrap_or("en-IN"),
        &payload.transcript,
        Some(&payload.event_id),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"sessionId":response.session.id,"replyText":response.assistant_message.body,"actionType":response.action_type,"action":response.action_payload}),
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
    if matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "staff" | "frontdesk" | "receptionist"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden("AI concierge access is restricted"))
    }
}

fn require_ai_manage(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden("AI governance access is restricted"))
    }
}
