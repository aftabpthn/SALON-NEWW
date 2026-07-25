use crate::{
    config::is_local_env,
    models::common::AppError,
    repositories::auth_repository,
    services::auth_service::{self, AuthClaims},
    state::{AppState, PosEvent, TeamChatEvent},
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::HeaderMap,
    response::Response,
    routing::get,
    Router,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/realtime/appointments", get(appointment_stream))
        .route("/realtime/pos", get(pos_stream))
        .route("/realtime/team-chat", get(team_chat_stream))
        .route("/realtime/clients/:client_id", get(client_timeline_stream))
}

async fn realtime_claims(state: &AppState, headers: &HeaderMap) -> Result<AuthClaims, AppError> {
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
    Ok(claims)
}

async fn appointment_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claims = realtime_claims(&state, &headers).await?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id.unwrap_or_default();
    let receiver = state.appointment_events.subscribe();
    Ok(ws
        .protocols(["aurashine-v1"])
        .on_upgrade(move |socket| async move {
            send_events(socket, receiver, tenant_id, branch_id, None).await;
        }))
}

async fn pos_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claims = realtime_claims(&state, &headers).await?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id.unwrap_or_default();
    let receiver = state.pos_events.subscribe();
    Ok(ws
        .protocols(["aurashine-v1"])
        .on_upgrade(move |socket| send_pos_events(socket, receiver, tenant_id, branch_id)))
}

async fn client_timeline_stream(
    State(state): State<AppState>,
    Path(client_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claims = realtime_claims(&state, &headers).await?;
    if !matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        && !claims
            .permissions
            .iter()
            .any(|value| value == "clients.read")
    {
        return Err(AppError::forbidden("client permission is required"));
    }
    let assigned_branch = claims.branch_id.unwrap_or_default();
    let client_branch = sqlx::query_scalar::<_, String>(
        "SELECT branch_id FROM clients WHERE tenant_id=$1 AND id=$2 AND merged_into_client_id IS NULL",
    )
    .bind(&claims.tenant_id)
    .bind(&client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate realtime client"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    if !assigned_branch.is_empty() && assigned_branch != client_branch {
        return Err(AppError::not_found("client was not found"));
    }
    let receiver = state.appointment_events.subscribe();
    Ok(ws
        .protocols(["aurashine-v1"])
        .on_upgrade(move |socket| async move {
            send_events(
                socket,
                receiver,
                claims.tenant_id,
                client_branch,
                Some(client_id),
            )
            .await;
        }))
}

async fn team_chat_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claims = realtime_claims(&state, &headers).await?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id.unwrap_or_default();
    let receiver = state.team_chat_events.subscribe();
    Ok(ws
        .protocols(["aurashine-v1"])
        .on_upgrade(move |socket| send_team_chat_events(socket, receiver, tenant_id, branch_id)))
}

fn team_chat_event_visible(event: &TeamChatEvent, tenant_id: &str, branch_id: &str) -> bool {
    event.tenant_id == tenant_id && (branch_id.is_empty() || event.branch_id == branch_id)
}

async fn send_team_chat_events(
    mut socket: WebSocket,
    mut receiver: tokio::sync::broadcast::Receiver<TeamChatEvent>,
    tenant_id: String,
    branch_id: String,
) {
    while let Ok(event) = receiver.recv().await {
        if !team_chat_event_visible(&event, &tenant_id, &branch_id) {
            continue;
        }
        let body = serde_json::json!({
            "type": "team_chat.created",
            "messageId": event.message_id,
            "senderUserId": event.sender_user_id,
        });
        if socket.send(Message::Text(body.to_string())).await.is_err() {
            break;
        }
    }
}

fn pos_event_visible(event: &PosEvent, tenant_id: &str, branch_id: &str) -> bool {
    event.tenant_id == tenant_id && (branch_id.is_empty() || event.branch_id == branch_id)
}

async fn send_pos_events(
    mut socket: WebSocket,
    mut receiver: tokio::sync::broadcast::Receiver<PosEvent>,
    tenant_id: String,
    branch_id: String,
) {
    loop {
        let event = match receiver.recv().await {
            Ok(event) => event,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        };
        if !pos_event_visible(&event, &tenant_id, &branch_id) {
            continue;
        }
        let body = serde_json::json!({
            "type": "pos.updated",
            "entityType": event.entity_type,
            "entityId": event.entity_id,
            "action": event.action,
        });
        if socket.send(Message::Text(body.to_string())).await.is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{pos_event_visible, team_chat_event_visible, PosEvent, TeamChatEvent};

    #[test]
    fn pos_events_are_tenant_and_branch_scoped() {
        let event = PosEvent {
            tenant_id: "tenant-a".into(),
            branch_id: "branch-a".into(),
            entity_type: "cash_drawer".into(),
            entity_id: "invoice-a".into(),
            action: "invoice.updated".into(),
        };
        assert!(pos_event_visible(&event, "tenant-a", "branch-a"));
        assert!(!pos_event_visible(&event, "tenant-a", "branch-b"));
        assert!(!pos_event_visible(&event, "tenant-b", "branch-a"));
    }

    #[test]
    fn team_chat_events_are_tenant_and_branch_scoped() {
        let event = TeamChatEvent {
            tenant_id: "tenant-a".into(),
            branch_id: "branch-a".into(),
            message_id: "message-a".into(),
            sender_user_id: "user-a".into(),
        };
        assert!(team_chat_event_visible(&event, "tenant-a", "branch-a"));
        assert!(!team_chat_event_visible(&event, "tenant-a", "branch-b"));
        assert!(!team_chat_event_visible(&event, "tenant-b", "branch-a"));
    }
}

async fn send_events(
    mut socket: WebSocket,
    mut receiver: tokio::sync::broadcast::Receiver<crate::state::AppointmentEvent>,
    tenant_id: String,
    branch_id: String,
    client_id: Option<String>,
) {
    while let Ok(event) = receiver.recv().await {
        if event.tenant_id != tenant_id || (!branch_id.is_empty() && event.branch_id != branch_id) {
            continue;
        }
        if client_id.as_deref().is_some_and(|id| id != event.client_id) {
            continue;
        }
        if client_id.is_none() && event.entity_type != "appointment" {
            continue;
        }
        let body = if client_id.is_some() {
            serde_json::json!({"type":"client.timeline.updated","clientId":event.client_id,"entityType":event.entity_type,"entityId":event.entity_id,"action":event.action})
        } else {
            serde_json::json!({"type":"appointment.updated","clientId":event.client_id,"appointmentId":event.entity_id,"action":event.action})
        };
        if socket.send(Message::Text(body.to_string())).await.is_err() {
            break;
        }
    }
}
