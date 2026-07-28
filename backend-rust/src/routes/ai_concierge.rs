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
        .route("/ai/concierge/calls/report", get(call_report))
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
            &claims.role,
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
    if matches!(
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
