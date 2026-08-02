use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{header, HeaderMap, Response},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::benefit_notification_repository::{self, NewBenefitDelivery},
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        client_service, migration_file_service, security_service, sms_center_service,
        staff_notification_service, team_chat_service,
    },
    state::{AppState, TeamChatEvent},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/notifications",
            axum::routing::get(list_notifications).post(create_notification),
        )
        .route(
            "/notifications/unread-count",
            axum::routing::get(count_unread_notifications),
        )
        .route("/notifications/inbox", axum::routing::get(list_inbox))
        .route(
            "/notifications/team-chat",
            axum::routing::get(list_team_chat).post(send_team_chat),
        )
        .route(
            "/team-chat/conversations",
            axum::routing::get(list_staff_chat_conversations).post(create_staff_chat_conversation),
        )
        .route(
            "/team-chat/participants",
            axum::routing::get(list_staff_chat_participants),
        )
        .route(
            "/team-chat/private-owner",
            axum::routing::post(start_private_owner_chat),
        )
        .route(
            "/team-chat/conversations/:id/messages",
            axum::routing::get(list_staff_conversation_messages)
                .post(send_staff_conversation_message),
        )
        .route(
            "/team-chat/conversations/:id/read",
            axum::routing::post(mark_staff_conversation_read),
        )
        .route(
            "/team-chat/attachments",
            axum::routing::post(upload_staff_chat_attachment),
        )
        .route(
            "/team-chat/attachments/:id/content",
            axum::routing::get(get_staff_chat_attachment),
        )
        .route(
            "/team-chat/share/:share_type/:share_id",
            axum::routing::get(resolve_staff_chat_share),
        )
        .route(
            "/notifications/inbox/:client_id/reply",
            axum::routing::post(reply_to_client),
        )
        .route(
            "/notifications/provider-status",
            axum::routing::get(provider_status),
        )
        .route(
            "/notifications/marketing-insights",
            axum::routing::get(marketing_insights),
        )
        .route(
            "/notifications/marketing-coverage",
            axum::routing::get(marketing_coverage),
        )
        .route(
            "/notifications/marketing-test",
            axum::routing::post(marketing_test),
        )
        .route(
            "/notifications/marketing-events",
            axum::routing::post(marketing_event),
        )
        .route(
            "/notifications/:id/campaign-approval",
            axum::routing::post(approve_campaign),
        )
        .route(
            "/notifications/:id/campaign-send",
            axum::routing::post(send_campaign),
        )
        .route(
            "/notifications/sms-center",
            axum::routing::get(sms_center_summary),
        )
        .route(
            "/notifications/sms-center/campaigns",
            axum::routing::post(create_sms_center_campaign),
        )
        .route(
            "/notifications/:id",
            axum::routing::get(get_notification).patch(mark_notification_read),
        )
        .route(
            "/staff-self/notifications/:id",
            axum::routing::patch(update_self_notification),
        )
        .route(
            "/staff-self/notification-center",
            axum::routing::get(self_notification_center),
        )
        .route(
            "/staff-self/notification-preferences",
            axum::routing::put(save_self_notification_preferences),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListQuery {
    pub q: Option<String>,
    pub unread_only: Option<bool>,
    pub notification_type: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationWriteRequest {
    pub notification_type: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub user_id: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketingCoverageQuery {
    audience: String,
    channels: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingTestRequest {
    client_id: String,
    channel: String,
    subject: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingEventRequest {
    campaign_id: String,
    client_id: String,
    channel: String,
    event_type: String,
    provider_event_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationReadPayload {
    pub is_read: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SelfNotificationStatusPayload {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxQuery {
    client_id: Option<String>,
    channel: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxReplyRequest {
    channel: String,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamChatQuery {
    before: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffConversationMessageRequest {
    body: String,
    share_type: Option<String>,
    share_id: Option<String>,
    attachment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffChatAttachmentQuery {
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmsCenterQuery {
    audience: Option<String>,
    channel: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct InboxMessage {
    id: String,
    client_id: String,
    client_name: String,
    channel: String,
    direction: String,
    status: String,
    subject: String,
    body: String,
    occurred_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ReputationReview {
    id: String,
    client_id: String,
    client_name: String,
    platform: String,
    rating: Option<i16>,
    review_text: String,
    reviewed_at: DateTime<Utc>,
}

async fn list_team_chat(
    State(state): State<AppState>,
    Extension(_claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<TeamChatQuery>,
) -> ApiResult<Vec<team_chat_service::TeamChatMessage>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = team_chat_service::list(&state.db, &tenant_id, &branch_id, query.before).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn send_team_chat(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<team_chat_service::TeamChatRequest>,
) -> ApiResult<team_chat_service::TeamChatMessage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        team_chat_service::send(&state.db, &tenant_id, &branch_id, &claims.sub, payload).await?;
    let _ = state.team_chat_events.send(TeamChatEvent {
        tenant_id,
        branch_id,
        event_type: "team_chat.created".into(),
        message_id: row.id.clone(),
        sender_user_id: row.sender_user_id.clone(),
    });
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_staff_chat_conversations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<team_chat_service::StaffChatConversation>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        team_chat_service::conversations(&state.db, &tenant_id, &branch_id, &claims.sub).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_staff_chat_participants(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<team_chat_service::StaffChatParticipant>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        team_chat_service::participants(&state.db, &tenant_id, &branch_id, &claims.sub).await?,
    )))
}

async fn create_staff_chat_conversation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<team_chat_service::ConversationCreateRequest>,
) -> ApiResult<team_chat_service::StaffChatConversation> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if payload.conversation_type.eq_ignore_ascii_case("broadcast")
        && !auth_service::staff_app_permission_allowed(
            &claims,
            "staff.app.chat.manage",
            &["owner", "admin", "manager"],
            &["staff.manage", "management.write"],
        )
    {
        return Err(AppError::forbidden(
            "manager broadcast permission is required",
        ));
    }
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok());
    let row = team_chat_service::create_conversation(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
        idempotency_key,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn start_private_owner_chat(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<team_chat_service::StaffChatConversation> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        team_chat_service::start_private_owner(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_staff_conversation_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
) -> ApiResult<Vec<team_chat_service::StaffConversationMessage>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = team_chat_service::conversation_messages(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &conversation_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn send_staff_conversation_message(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
    Json(payload): Json<StaffConversationMessageRequest>,
) -> ApiResult<team_chat_service::StaffConversationMessage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok());
    let row = team_chat_service::send_conversation_message(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &conversation_id,
        &payload.body,
        payload.share_type.as_deref(),
        payload.share_id.as_deref(),
        payload.attachment_id.as_deref(),
        idempotency_key,
    )
    .await?;
    let _ = state.team_chat_events.send(TeamChatEvent {
        tenant_id,
        branch_id,
        event_type: "team_chat.created".into(),
        message_id: row.id.clone(),
        sender_user_id: row.sender_user_id.clone(),
    });
    Ok(Json(ApiResponse::ok(row)))
}

async fn mark_staff_conversation_read(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(conversation_id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    team_chat_service::mark_read(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &conversation_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({"read":true}))))
}

async fn upload_staff_chat_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffChatAttachmentQuery>,
    bytes: Bytes,
) -> ApiResult<team_chat_service::StaffChatAttachment> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let file_name = query.file_name.trim();
    if !team_chat_service::valid_attachment(file_name, &content_type, &bytes) {
        return Err(AppError::validation(
            "attachment must be a valid image, PDF, Word, or Excel file up to 10 MB",
        ));
    }
    let scanner_required = !matches!(
        state.settings.app_env.trim().to_ascii_lowercase().as_str(),
        "local" | "development" | "test"
    );
    migration_file_service::scan_upload_bytes(&bytes, scanner_required).await?;
    let row = team_chat_service::save_attachment(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        file_name,
        &content_type,
        bytes.to_vec(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_staff_chat_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(attachment_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = team_chat_service::attachment_content(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &attachment_id,
    )
    .await?;
    Response::builder()
        .header(header::CONTENT_TYPE, row.content_type)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::CONTENT_DISPOSITION, "attachment")
        .body(Body::from(row.content))
        .map_err(|_| AppError::internal("failed to stream chat attachment"))
}

async fn resolve_staff_chat_share(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((share_type, share_id)): Path<(String, String)>,
) -> ApiResult<Value> {
    let (permission, legacy) = match share_type.as_str() {
        "appointment" => (
            "staff.app.appointments.read",
            &["appointments.read", "read:appointments"][..],
        ),
        "invoice" => ("staff.app.pos.read", &["pos.read", "read:pos"][..]),
        "guest" => (
            "staff.app.guest.read",
            &["clients.read", "read:clients"][..],
        ),
        _ => return Err(AppError::validation("Smart Share record type is invalid")),
    };
    if !auth_service::staff_app_permission_allowed(
        &claims,
        permission,
        &["owner", "admin", "manager", "staff"],
        legacy,
    ) {
        return Err(AppError::forbidden(format!(
            "Missing permission: {permission}"
        )));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let unrestricted = ["owner", "admin", "manager", "superadmin"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    Ok(Json(ApiResponse::ok(
        team_chat_service::resolve_share(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            unrestricted,
            &share_type,
            &share_id,
        )
        .await?,
    )))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub user_id: String,
    pub created_by: String,
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub resource_type: String,
    pub resource_id: String,
    pub is_read: bool,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSummary {
    pub total: i64,
    pub unread: i64,
    pub data: Vec<NotificationResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationCount {
    pub tenant_id: String,
    pub branch_id: String,
    pub total: i64,
    pub unread: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct NotificationRow {
    id: String,
    tenant_id: String,
    branch_id: String,
    user_id: String,
    created_by: String,
    notification_type: String,
    title: String,
    body: String,
    resource_type: String,
    resource_id: String,
    is_read: bool,
    metadata_json: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: Option<DateTime<Utc>>,
}

async fn list_inbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InboxQuery>,
) -> ApiResult<Vec<InboxMessage>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let client_id = query.client_id.unwrap_or_default();
    let channel = query.channel.unwrap_or_default();
    if !channel.is_empty() && !matches!(channel.as_str(), "whatsapp" | "sms" | "email") {
        return Err(AppError::validation("inbox channel is invalid"));
    }
    let rows = sqlx::query_as::<_, InboxMessage>(
        r#"SELECT communication.id,communication.client_id,
                  TRIM(CONCAT_WS(' ',client.first_name,client.last_name)) AS client_name,
                  communication.channel,communication.direction,communication.status,
                  communication.subject,communication.body,communication.occurred_at
             FROM client_communications communication
             JOIN clients client ON client.tenant_id=communication.tenant_id
                                AND client.branch_id=communication.branch_id
                                AND client.id=communication.client_id
            WHERE communication.tenant_id=$1 AND communication.branch_id=$2
              AND ($3='' OR communication.client_id=$3)
              AND ($4='' OR communication.channel=$4)
            ORDER BY communication.occurred_at DESC,communication.id DESC
            LIMIT 500"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(client_id)
    .bind(channel)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load message inbox"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn reply_to_client(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<InboxReplyRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let channel = payload.channel.trim().to_ascii_lowercase();
    let body = payload.body.trim();
    if !matches!(channel.as_str(), "whatsapp" | "sms") {
        return Err(AppError::validation(
            "reply channel must be WhatsApp or SMS",
        ));
    }
    if body.is_empty() || body.chars().count() > 4_000 {
        return Err(AppError::validation("reply message is invalid"));
    }
    if channel == "whatsapp"
        && !(state.settings.whatsapp_cloud_enabled()
            || state.settings.invoice_delivery_webhook_url.is_some())
    {
        return Err(AppError::service_unavailable(
            "WHATSAPP_NOT_CONFIGURED",
            "WhatsApp delivery provider is not configured",
        ));
    }
    if channel == "sms" && state.settings.invoice_delivery_webhook_url.is_none() {
        return Err(AppError::service_unavailable(
            "SMS_NOT_CONFIGURED",
            "SMS delivery provider is not configured",
        ));
    }
    let recipient = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(phone,'') FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load reply recipient"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    if recipient.trim().is_empty()
        || !client_service::communication_allowed(
            &state.db, &tenant_id, &branch_id, &client_id, &channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to verify communication consent"))?
    {
        return Err(AppError::conflict(
            "client phone or communication consent is missing",
        ));
    }
    let source_id = format!("conversation:{}", Uuid::new_v4());
    let delivery = json!({
        "channel": channel,
        "recipient": recipient,
        "message": body,
        "subject": "Conversation reply",
        "templateKind": "conversation"
    });
    benefit_notification_repository::enqueue(
        &state.db,
        NewBenefitDelivery {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            source_type: "marketing_campaign",
            source_id: &source_id,
            client_id: &client_id,
            channel: delivery["channel"].as_str().unwrap_or_default(),
            recipient: delivery["recipient"].as_str().unwrap_or_default(),
            payload: &delivery,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to queue inbox reply"))?;
    Ok(Json(ApiResponse::ok(json!({
        "queued": true,
        "sourceId": source_id
    }))))
}

async fn provider_status(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(json!({
        "whatsappDelivery": state.settings.whatsapp_cloud_enabled() || state.settings.invoice_delivery_webhook_url.is_some(),
        "whatsappWebhook": state.settings.whatsapp_cloud_webhook_configured(),
        "smsDelivery": state.settings.invoice_delivery_webhook_url.is_some(),
        "emailDelivery": state.settings.invoice_delivery_webhook_url.is_some()
    }))))
}

async fn marketing_coverage(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<MarketingCoverageQuery>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        && !claims
            .permissions
            .iter()
            .any(|p| matches!(p.as_str(), "marketing.read" | "marketing.manage"))
    {
        return Err(AppError::forbidden("marketing permission is required"));
    }
    let channels = query
        .channels
        .split(',')
        .map(str::trim)
        .filter(|c| matches!(*c, "whatsapp" | "sms" | "email"))
        .collect::<Vec<_>>();
    if channels.is_empty() {
        return Err(AppError::validation("campaign channel is required"));
    }
    let clients = crate::repositories::marketing_leads_repository::client_intelligence(
        &state.db, &tenant_id, &branch_id, "", 500,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate consent coverage"))?;
    let audience = query.audience.trim();
    let selected = clients
        .into_iter()
        .filter(|client| audience == "all" || client.segment_keys.iter().any(|key| key == audience))
        .collect::<Vec<_>>();
    let channel_count = |channel: &str| {
        selected
            .iter()
            .filter(|client| client.consent_status.to_ascii_lowercase().contains(channel))
            .count()
    };
    Ok(Json(ApiResponse::ok(json!({
        "audienceCount": selected.len(),
        "whatsapp": if channels.contains(&"whatsapp") { channel_count("whatsapp") } else { 0 },
        "sms": if channels.contains(&"sms") { channel_count("sms") } else { 0 },
        "email": if channels.contains(&"email") { channel_count("email") } else { 0 }
    }))))
}

async fn marketing_test(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingTestRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    require_marketing_permission(&claims, "marketing.send")?;
    let channel = body.channel.trim().to_ascii_lowercase();
    if !matches!(channel.as_str(), "whatsapp" | "sms" | "email") || body.message.trim().is_empty() {
        return Err(AppError::validation(
            "test message channel or content is invalid",
        ));
    }
    let recipient = sqlx::query_as::<_, (String,String)>("SELECT CASE $4 WHEN 'email' THEN COALESCE(email,'') ELSE COALESCE(phone,'') END,CONCAT_WS(' ',first_name,last_name) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL")
        .bind(&tenant_id).bind(&branch_id).bind(body.client_id.trim()).bind(&channel).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load test recipient"))?.ok_or_else(|| AppError::not_found("test client was not found"))?;
    if recipient.0.trim().is_empty()
        || !client_service::communication_allowed(
            &state.db,
            &tenant_id,
            &branch_id,
            body.client_id.trim(),
            &channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to verify test consent"))?
    {
        return Err(AppError::conflict(
            "test client contact or consent is missing",
        ));
    }
    let source_id = format!("marketing-test:{}", Uuid::new_v4());
    let payload = json!({"channel":channel,"recipient":recipient.0,"message":body.message.trim(),"subject":body.subject.trim(),"clientName":recipient.1,"templateKind":"marketing_test"});
    benefit_notification_repository::enqueue(
        &state.db,
        NewBenefitDelivery {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            source_type: "marketing_test",
            source_id: &source_id,
            client_id: body.client_id.trim(),
            channel: &channel,
            recipient: payload["recipient"].as_str().unwrap_or_default(),
            payload: &payload,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to queue test message"))?;
    Ok(Json(ApiResponse::ok(
        json!({"queued":true,"sourceId":source_id}),
    )))
}

async fn marketing_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MarketingEventRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let channel = body.channel.trim().to_ascii_lowercase();
    let event_type = body.event_type.trim().to_ascii_lowercase();
    if !matches!(channel.as_str(), "whatsapp" | "sms" | "email")
        || !matches!(event_type.as_str(), "opened" | "clicked" | "opted_out")
        || body.campaign_id.trim().is_empty()
        || body.client_id.trim().is_empty()
    {
        return Err(AppError::validation("campaign event is invalid"));
    }
    let valid = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND channel=$4 AND source_type='marketing_campaign' AND payload_json->>'campaignId'=$5)")
        .bind(&tenant_id).bind(&branch_id).bind(body.client_id.trim()).bind(&channel).bind(body.campaign_id.trim()).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate campaign event"))?;
    if !valid {
        return Err(AppError::not_found("campaign recipient was not found"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to record campaign event"))?;
    sqlx::query("INSERT INTO marketing_campaign_events(tenant_id,branch_id,campaign_id,client_id,channel,event_type,provider_event_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING")
        .bind(&tenant_id).bind(&branch_id).bind(body.campaign_id.trim()).bind(body.client_id.trim()).bind(&channel).bind(&event_type).bind(body.provider_event_id.as_deref().unwrap_or("").trim()).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save campaign event"))?;
    if event_type == "opted_out" {
        let column = match channel.as_str() {
            "whatsapp" => "whatsapp_opt_in",
            "sms" => "sms_opt_in",
            _ => "email_opt_in",
        };
        sqlx::query(&format!("UPDATE clients SET {column}=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")).bind(&tenant_id).bind(&branch_id).bind(body.client_id.trim()).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to apply campaign opt-out"))?;
        sqlx::query("INSERT INTO client_consent_events(tenant_id,branch_id,client_id,channel,opted_in,source,reason,recorded_by) VALUES($1,$2,$3,$4,FALSE,'provider','marketing unsubscribe','provider')")
            .bind(&tenant_id).bind(&branch_id).bind(body.client_id.trim()).bind(&channel).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to record campaign opt-out"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to record campaign event"))?;
    Ok(Json(ApiResponse::ok(json!({"recorded":true}))))
}

async fn approve_campaign(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_marketing_permission(&claims, "marketing.approve")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let updated = sqlx::query_scalar::<_, Value>(r#"UPDATE notifications SET metadata_json=jsonb_set(jsonb_set(metadata_json,'{approvalStatus}','\"approved\"'::JSONB,TRUE),'{status}','\"approved\"'::JSONB,TRUE),updated_at=NOW()
      WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND notification_type='marketing_campaign' AND metadata_json->>'approvalStatus'='pending' AND COALESCE(metadata_json->>'scheduledAt','')<>''
        AND (COALESCE(metadata_json->>'offerId','')='' OR EXISTS(SELECT 1 FROM pos_coupons offer WHERE offer.tenant_id=$2 AND offer.branch_id=$3 AND offer.id=metadata_json->>'offerId' AND offer.active=TRUE AND offer.approval_status='approved' AND (offer.ends_at IS NULL OR offer.ends_at>=NOW()))) RETURNING metadata_json"#)
      .bind(id.trim()).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to approve campaign"))?.ok_or_else(|| AppError::validation("pending campaign with a schedule was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.campaign.approved",
        json!({"campaignId":id.trim()}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(updated)))
}

async fn send_campaign(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_marketing_permission(&claims, "marketing.send")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !state.settings.benefit_delivery_configured() {
        return Err(AppError::service_unavailable(
            "DELIVERY_NOT_CONFIGURED",
            "marketing delivery provider is not configured",
        ));
    }
    let updated = sqlx::query_scalar::<_, Value>(r#"UPDATE notifications SET metadata_json=jsonb_set(metadata_json,'{status}','\"scheduled\"'::JSONB,TRUE),updated_at=NOW()
      WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND notification_type='marketing_campaign' AND metadata_json->>'approvalStatus'='approved' AND metadata_json->>'status'='approved' AND COALESCE(metadata_json->>'scheduledAt','')<>'' RETURNING metadata_json"#)
        .bind(id.trim()).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to schedule campaign delivery"))?.ok_or_else(|| AppError::validation("approved campaign was not found or already scheduled"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.campaign.sent",
        json!({"campaignId":id.trim()}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(updated)))
}

async fn sms_center_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SmsCenterQuery>,
) -> ApiResult<sms_center_service::SmsCenterSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let audience = query
        .audience
        .as_deref()
        .unwrap_or("clients_all")
        .trim()
        .to_ascii_lowercase();
    let channel = query
        .channel
        .as_deref()
        .unwrap_or("sms")
        .trim()
        .to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        sms_center_service::summary(&state.db, &tenant_id, &branch_id, &audience, &channel).await?,
    )))
}

async fn create_sms_center_campaign(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<sms_center_service::SmsCenterCampaignRequest>,
) -> ApiResult<crate::repositories::sms_center_repository::SmsCenterHistoryRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if state.settings.invoice_delivery_webhook_url.is_none() {
        return Err(AppError::service_unavailable(
            "DELIVERY_NOT_CONFIGURED",
            "SMS and email delivery provider is not configured",
        ));
    }
    let row =
        sms_center_service::create_campaign(&state.db, &tenant_id, &branch_id, &claims, payload)
            .await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "sms-center.campaign.created",
        json!({"campaignId":row.id}),
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn marketing_insights(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let consent = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        r#"SELECT COUNT(*) FILTER (WHERE active=TRUE AND merged_into_client_id IS NULL),
                  COUNT(*) FILTER (WHERE active=TRUE AND merged_into_client_id IS NULL AND whatsapp_opt_in IS TRUE),
                  COUNT(*) FILTER (WHERE active=TRUE AND merged_into_client_id IS NULL AND sms_opt_in IS TRUE),
                  COUNT(*) FILTER (WHERE active=TRUE AND merged_into_client_id IS NULL AND email_opt_in IS TRUE)
             FROM clients WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load marketing consent"))?;
    let attribution = sqlx::query_as::<_, (String, i64)>(
        r#"SELECT COALESCE(NULLIF(source_channel,''),'manual'),COUNT(*)::BIGINT
             FROM appointments WHERE tenant_id=$1 AND branch_id=$2
            GROUP BY COALESCE(NULLIF(source_channel,''),'manual') ORDER BY COUNT(*) DESC"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load booking attribution"))?;
    let reviews = sqlx::query_as::<_, ReputationReview>(
        r#"SELECT review.id,review.client_id,
                  TRIM(CONCAT_WS(' ',client.first_name,client.last_name)) AS client_name,
                  review.platform,review.rating,review.review_text,
                  COALESCE(review.reviewed_at,review.created_at) AS reviewed_at
             FROM client_review_links review
             JOIN clients client ON client.tenant_id=review.tenant_id
                                AND client.branch_id=review.branch_id
                                AND client.id=review.client_id
            WHERE review.tenant_id=$1 AND review.branch_id=$2
            ORDER BY COALESCE(review.reviewed_at,review.created_at) DESC LIMIT 50"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load reputation monitoring"))?;
    let average_rating = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT AVG(rating::DOUBLE PRECISION) FROM client_review_links WHERE tenant_id=$1 AND branch_id=$2 AND rating IS NOT NULL",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load reputation score"))?;
    Ok(Json(ApiResponse::ok(json!({
        "consent": { "total": consent.0, "whatsapp": consent.1, "sms": consent.2, "email": consent.3 },
        "attribution": attribution.into_iter().map(|(source,count)| json!({"source":source,"count":count})).collect::<Vec<_>>(),
        "reputation": { "averageRating": average_rating, "reviewCount": reviews.len(), "reviews": reviews }
    }))))
}

async fn list_notifications(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<NotificationListQuery>,
) -> ApiResult<NotificationSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let q = query.q.unwrap_or_default().to_lowercase();
    let unread_only = query.unread_only.unwrap_or(false);
    let notification_type = query.notification_type.unwrap_or_default();

    let rows = sqlx::query_as::<_, NotificationRow>(
        r#"
        SELECT
            id, tenant_id, branch_id, user_id, created_by, notification_type, title, body,
            resource_type, resource_id, is_read, COALESCE(metadata_json::text, '{}') AS metadata_json, created_at, updated_at
        FROM notifications
        WHERE tenant_id = $1
          AND branch_id = $2
          AND archived_at IS NULL
          AND ($3 = '' OR notification_type = $3)
          AND ($4 = false OR is_read = false)
          AND ($5 = '' OR LOWER(title) LIKE '%' || $5 || '%' OR LOWER(body) LIKE '%' || $5 || '%')
          AND (user_id = '' OR user_id = $6)
        ORDER BY created_at DESC
        LIMIT $7 OFFSET $8
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(notification_type)
    .bind(unread_only)
    .bind(q)
    .bind(&claims.sub)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list notifications"))?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND archived_at IS NULL AND (user_id='' OR user_id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let unread = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND archived_at IS NULL AND is_read = false AND (user_id='' OR user_id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let data = rows
        .into_iter()
        .map(|row| {
            let metadata = row
                .metadata_json
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .unwrap_or(json!({}));
            NotificationResponse {
                id: row.id,
                tenant_id: row.tenant_id,
                branch_id: row.branch_id,
                user_id: row.user_id,
                created_by: row.created_by,
                notification_type: row.notification_type,
                title: row.title,
                body: row.body,
                resource_type: row.resource_type,
                resource_id: row.resource_id,
                is_read: row.is_read,
                metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
            }
        })
        .collect();

    Ok(Json(ApiResponse::ok(NotificationSummary {
        total,
        unread,
        data,
    })))
}

async fn get_notification(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<NotificationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_as::<_, NotificationRow>(
        "SELECT id, tenant_id, branch_id, user_id, created_by, notification_type, title, body, resource_type, resource_id, is_read, COALESCE(metadata_json::text, '{}') AS metadata_json, created_at, updated_at FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND (user_id='' OR user_id=$4)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load notification"))?
    .ok_or_else(|| AppError::not_found("notification was not found"))?;

    let metadata = row
        .metadata_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or(json!({}));

    Ok(Json(ApiResponse::ok(NotificationResponse {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        user_id: row.user_id,
        created_by: row.created_by,
        notification_type: row.notification_type,
        title: row.title,
        body: row.body,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        is_read: row.is_read,
        metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })))
}

async fn create_notification(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<NotificationWriteRequest>,
) -> ApiResult<NotificationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let title = required_text(payload.title.as_deref(), "title is required")?;
    let body = required_text(payload.body.as_deref(), "body is required")?;

    let notification_type = payload
        .notification_type
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "system".to_string());
    let user_id = payload.user_id.unwrap_or_default();
    let resource_type = payload.resource_type.unwrap_or_default();
    let resource_id = payload.resource_id.unwrap_or_default();
    let created_by = claims.sub.clone();
    let metadata = payload.metadata.unwrap_or_else(|| json!({}));
    if notification_type == "marketing_campaign" {
        require_marketing_permission(&claims, "marketing.manage")?;
        validate_campaign_metadata(&metadata)?;
        if let Some(offer_id) = metadata
            .get("offerId")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
        {
            let approved = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND approval_status='approved' AND (ends_at IS NULL OR ends_at>=NOW()))")
                .bind(&tenant_id).bind(&branch_id).bind(offer_id.trim()).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate campaign offer"))?;
            if !approved {
                return Err(AppError::validation(
                    "campaign offer is not approved or has expired",
                ));
            }
        }
    }

    let row = sqlx::query_as::<_, NotificationRow>(
        r#"
        INSERT INTO notifications (
            id, tenant_id, branch_id, user_id, created_by, notification_type, title, body,
            resource_type, resource_id, metadata_json, is_read, created_at, updated_at
        )
        VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, false, NOW(), NOW()
        )
        RETURNING id, tenant_id, branch_id, user_id, created_by, notification_type, title, body,
                  resource_type, resource_id, is_read, COALESCE(metadata_json::text, '{}') AS metadata_json, created_at, updated_at
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&user_id)
    .bind(&created_by)
    .bind(&notification_type)
    .bind(title)
    .bind(body)
    .bind(&resource_type)
    .bind(&resource_id)
    .bind(metadata.to_string())
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to create notification"))?;

    let metadata = serde_json::from_str(row.metadata_json.as_deref().unwrap_or("{}"))
        .map_err(|_| AppError::internal("invalid notification metadata"))?;
    if notification_type == "marketing_campaign" {
        security_service::record_audit(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            "marketing.campaign.created",
            json!({"campaignId":&row.id}),
        )
        .await?;
    }

    Ok(Json(ApiResponse::ok(NotificationResponse {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        user_id: row.user_id,
        created_by: row.created_by,
        notification_type: row.notification_type,
        title: row.title,
        body: row.body,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        is_read: row.is_read,
        metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })))
}

fn require_marketing_permission(claims: &AuthClaims, permission: &str) -> Result<(), AppError> {
    if matches!(claims.role.as_str(), "owner" | "admin")
        || claims.permissions.iter().any(|value| value == permission)
    {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "{permission} permission is required"
        )))
    }
}

async fn mark_notification_read(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<NotificationReadPayload>,
) -> ApiResult<NotificationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let is_read = payload.is_read.unwrap_or(true);

    let row = sqlx::query_as::<_, NotificationRow>(
        r#"
        UPDATE notifications
           SET is_read = $4, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND branch_id = $3 AND (user_id='' OR user_id=$5)
        RETURNING id, tenant_id, branch_id, user_id, created_by, notification_type, title, body,
                  resource_type, resource_id, is_read, COALESCE(metadata_json::text, '{}') AS metadata_json, created_at, updated_at
        "#,
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(is_read)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to update notification"))?
    .ok_or_else(|| AppError::not_found("notification was not found"))?;

    let metadata = serde_json::from_str(row.metadata_json.as_deref().unwrap_or("{}"))
        .map_err(|_| AppError::internal("invalid notification metadata"))?;

    Ok(Json(ApiResponse::ok(NotificationResponse {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        user_id: row.user_id,
        created_by: row.created_by,
        notification_type: row.notification_type,
        title: row.title,
        body: row.body,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        is_read: row.is_read,
        metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })))
}

async fn update_self_notification(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SelfNotificationStatusPayload>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = payload.status.trim();
    if !matches!(status, "read" | "unread" | "archived") {
        return Err(AppError::validation("notification status is invalid"));
    }
    let updated = sqlx::query_scalar::<_, String>(
        r#"UPDATE notifications SET is_read=$5,archived_at=CASE WHEN $6 THEN NOW() ELSE NULL END,updated_at=NOW()
            WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND (user_id='' OR user_id=$4)
            RETURNING id"#,
    )
    .bind(id.trim())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&claims.sub)
    .bind(status != "unread")
    .bind(status == "archived")
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to update staff notification"))?
    .ok_or_else(|| AppError::not_found("notification was not found"))?;
    Ok(Json(ApiResponse::ok(json!({"id":updated,"status":status}))))
}

async fn self_notification_center(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_self_notification_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_notification_service::center(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            state.settings.mobile_push_provider_enabled(),
        )
        .await?,
    )))
}

async fn save_self_notification_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_notification_service::SelfNotificationPreferenceRequest>,
) -> ApiResult<Value> {
    require_self_notification_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let value = staff_notification_service::save_preferences(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "staff.notification.preferences.updated",
        json!({}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(value)))
}

fn require_self_notification_permission(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    let permission = if write {
        "staff.app.notifications.manage"
    } else {
        "staff.app.notifications.read"
    };
    let legacy = if write {
        &[
            "notifications.manage",
            "staff.self_manage",
            "staff_self.write",
        ][..]
    } else {
        &["notifications.read", "staff.self_manage", "read:staff"][..]
    };
    if auth_service::staff_app_permission_allowed(
        claims,
        permission,
        &["owner", "admin", "manager", "staff"],
        legacy,
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "Missing permission: {permission}"
        )))
    }
}

async fn count_unread_notifications(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<NotificationCount> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND archived_at IS NULL AND (user_id='' OR user_id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let unread = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND archived_at IS NULL AND is_read=false AND (user_id='' OR user_id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::ok(NotificationCount {
        tenant_id,
        branch_id,
        total,
        unread,
    })))
}

fn required_text(value: Option<&str>, message: &'static str) -> Result<String, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| AppError::validation(message))
}

fn validate_campaign_metadata(metadata: &Value) -> Result<(), AppError> {
    let channels = metadata
        .get("channels")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_else(|| {
            metadata
                .get("channel")
                .and_then(Value::as_str)
                .map(|channel| vec![channel])
                .unwrap_or_default()
        });
    let audience = metadata
        .get("audience")
        .and_then(Value::as_str)
        .unwrap_or("");
    let status = metadata.get("status").and_then(Value::as_str).unwrap_or("");
    if channels.is_empty()
        || channels
            .iter()
            .any(|channel| !matches!(*channel, "whatsapp" | "sms" | "email"))
    {
        return Err(AppError::validation("campaign channel is invalid"));
    }
    if audience.is_empty() {
        return Err(AppError::validation("campaign audience is invalid"));
    }
    if !matches!(status, "draft" | "scheduled") {
        return Err(AppError::validation("campaign status is invalid"));
    }
    if !matches!(
        metadata
            .get("deliveryMode")
            .and_then(Value::as_str)
            .unwrap_or("or"),
        "and" | "or"
    ) {
        return Err(AppError::validation("campaign delivery mode is invalid"));
    }
    if !matches!(
        metadata
            .get("recurrence")
            .and_then(Value::as_str)
            .unwrap_or("once"),
        "once" | "daily" | "weekly" | "monthly"
    ) {
        return Err(AppError::validation("campaign recurrence is invalid"));
    }
    if status == "scheduled" {
        let scheduled_at = metadata
            .get("scheduledAt")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::validation("campaign schedule is required"))?;
        DateTime::parse_from_rfc3339(scheduled_at)
            .map_err(|_| AppError::validation("campaign schedule is invalid"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_campaign_metadata;
    use serde_json::json;

    #[test]
    fn campaign_schedule_requires_valid_channel_audience_and_time() {
        assert!(validate_campaign_metadata(&json!({
            "channel":"sms","audience":"all","status":"scheduled",
            "scheduledAt":"2026-07-14T10:30:00Z"
        }))
        .is_ok());
        assert!(validate_campaign_metadata(&json!({
            "channel":"push","audience":"all","status":"scheduled",
            "scheduledAt":"2026-07-14T10:30:00Z"
        }))
        .is_err());
        assert!(validate_campaign_metadata(&json!({
            "channel":"email","audience":"at-risk","status":"scheduled"
        }))
        .is_err());
    }
}
