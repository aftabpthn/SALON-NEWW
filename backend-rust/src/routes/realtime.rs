use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::HeaderMap,
    response::Response,
    routing::get,
    Router,
};
use futures_util::SinkExt;

use crate::{
    config::is_local_env, models::common::AppError, repositories::auth_repository,
    services::auth_service, state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/realtime/appointments", get(appointment_stream))
}

async fn appointment_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let token = headers
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|item| item.starts_with("eyJ"))
        })
        .ok_or_else(|| AppError::unauthenticated("missing realtime access token"))?;
    let mut claims = auth_service::decode_access_token(token, &state.settings.jwt_access_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired realtime access token"))?;
    if claims.token_type != "access" {
        return Err(AppError::unauthenticated("invalid realtime token type"));
    }
    if !(is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin")
    {
        let user = auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to validate realtime session"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
        claims.tenant_id = user.tenant_id;
        claims.branch_id = user.branch_id;
    }
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id.unwrap_or_default();
    let receiver = state.appointment_events.subscribe();
    Ok(ws
        .protocols(["aurashine-v1"])
        .on_upgrade(move |socket| async move {
            send_events(socket, receiver, tenant_id, branch_id).await;
        }))
}

async fn send_events(
    mut socket: WebSocket,
    mut receiver: tokio::sync::broadcast::Receiver<crate::state::AppointmentEvent>,
    tenant_id: String,
    branch_id: String,
) {
    while let Ok(event) = receiver.recv().await {
        if event.tenant_id != tenant_id || (!branch_id.is_empty() && event.branch_id != branch_id) {
            continue;
        }
        let body = serde_json::json!({"type":"appointment.updated","appointmentId":event.appointment_id,"action":event.action});
        if socket.send(Message::Text(body.to_string())).await.is_err() {
            break;
        }
    }
}
