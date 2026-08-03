//! AI Scribe endpoints for the Staff App.
//!
//! Reads and writes are gated separately: seeing that a recording happened is
//! not the same authority as starting one, and revoking consent must stay
//! available to anyone who can manage the session.

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, staff_ai_scribe_service as scribe},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-scribe/sessions", post(start_session))
        .route("/staff-scribe/sessions/:id", get(get_session))
        .route("/staff-scribe/sessions/:id/events", get(session_events))
        .route(
            "/staff-scribe/sessions/:id/transcribe",
            // The schema caps a recording at 25 MB; base64 inflates by about a
            // third, so the body limit has to allow for that or a legal
            // recording is rejected by the transport rather than by validation.
            post(transcribe).layer(DefaultBodyLimit::max(36 * 1024 * 1024)),
        )
        .route("/staff-scribe/sessions/:id/approve", post(approve))
        .route("/staff-scribe/sessions/:id/revoke", post(revoke))
        .route(
            "/staff-scribe/appointments/:appointment_id/sessions",
            get(list_for_appointment),
        )
}

fn require_scribe(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    let allowed = if matches!(claims.role.as_str(), "owner" | "admin" | "manager") {
        true
    } else if write {
        claims
            .permissions
            .iter()
            .any(|permission| matches!(permission.as_str(), "staff.app.scribe.manage"))
    } else {
        claims.permissions.iter().any(|permission| {
            matches!(
                permission.as_str(),
                "staff.app.scribe.read" | "staff.app.scribe.manage"
            )
        })
    };
    if allowed {
        Ok(())
    } else {
        Err(AppError::forbidden("AI Scribe permission is required"))
    }
}

async fn start_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<scribe::StartSessionInput>,
) -> ApiResult<scribe::ScribeSession> {
    require_scribe(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = scribe::start_session(&state, &tenant_id, &branch_id, &claims, &input).await?;
    Ok(Json(ApiResponse::ok(session)))
}

async fn get_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<scribe::ScribeSession> {
    require_scribe(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = scribe::get(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(session)))
}

async fn session_events(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    require_scribe(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let events = scribe::events(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(events)))
}

async fn list_for_appointment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
) -> ApiResult<Vec<scribe::ScribeSession>> {
    require_scribe(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sessions =
        scribe::list_for_appointment(&state.db, &tenant_id, &branch_id, &appointment_id).await?;
    Ok(Json(ApiResponse::ok(sessions)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeQuery {
    #[serde(default)]
    duration_seconds: i32,
}

/// Accepts the recording as a raw body so the audio is never buffered into a
/// string or written anywhere on the way through.
async fn transcribe(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<TranscribeQuery>,
    audio: axum::body::Bytes,
) -> ApiResult<scribe::ScribeSession> {
    require_scribe(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let session = scribe::transcribe(
        &state,
        &tenant_id,
        &branch_id,
        &claims,
        &id,
        audio.to_vec(),
        &content_type,
        query.duration_seconds,
    )
    .await?;
    Ok(Json(ApiResponse::ok(session)))
}

async fn approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<scribe::ApproveInput>,
) -> ApiResult<scribe::ScribeSession> {
    require_scribe(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = scribe::approve(&state, &tenant_id, &branch_id, &claims, &id, &input).await?;
    Ok(Json(ApiResponse::ok(session)))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RevokeRequest {
    #[serde(default)]
    reason: String,
}

async fn revoke(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Option<Json<RevokeRequest>>,
) -> ApiResult<Value> {
    require_scribe(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reason = body.map(|Json(value)| value.reason).unwrap_or_default();
    let session = scribe::revoke(&state, &tenant_id, &branch_id, &claims, &id, &reason).await?;
    Ok(Json(ApiResponse::ok(json!({
        "id": session.id,
        "status": session.status,
        "consentStatus": session.consent_status,
        "transcriptCleared": session.transcript.is_empty(),
    }))))
}
