use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
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
    services::{auth_service::AuthClaims, client_service, team_chat_service},
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
            "/notifications/:id",
            axum::routing::get(get_notification).patch(mark_notification_read),
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
pub struct NotificationReadPayload {
    pub is_read: Option<bool>,
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
        message_id: row.id.clone(),
        sender_user_id: row.sender_user_id.clone(),
    });
    Ok(Json(ApiResponse::ok(row)))
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
            resource_type, resource_id, is_read, metadata_json, created_at, updated_at
        FROM notifications
        WHERE tenant_id = $1
          AND branch_id = $2
          AND ($3 = '' OR notification_type = $3)
          AND ($4 = false OR is_read = false)
          AND ($5 = '' OR LOWER(title) LIKE '%' || $5 || '%' OR LOWER(body) LIKE '%' || $5 || '%')
        ORDER BY created_at DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(notification_type)
    .bind(unread_only)
    .bind(q)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list notifications"))?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let unread = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND is_read = false",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
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
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<NotificationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_as::<_, NotificationRow>(
        "SELECT id, tenant_id, branch_id, user_id, created_by, notification_type, title, body, resource_type, resource_id, is_read, metadata_json, created_at, updated_at FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
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
    let created_by = claims.sub;
    let metadata = payload.metadata.unwrap_or_else(|| json!({}));
    if notification_type == "marketing_campaign" {
        validate_campaign_metadata(&metadata)?;
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

async fn mark_notification_read(
    State(state): State<AppState>,
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
         WHERE id = $1 AND tenant_id = $2 AND branch_id = $3
        RETURNING id, tenant_id, branch_id, user_id, created_by, notification_type, title, body,
                  resource_type, resource_id, is_read, COALESCE(metadata_json::text, '{}') AS metadata_json, created_at, updated_at
        "#,
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(is_read)
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

async fn count_unread_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<NotificationCount> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let unread = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND is_read=false",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
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
    let channel = metadata
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or("");
    let audience = metadata
        .get("audience")
        .and_then(Value::as_str)
        .unwrap_or("");
    let status = metadata.get("status").and_then(Value::as_str).unwrap_or("");
    if !matches!(channel, "whatsapp" | "sms" | "email") {
        return Err(AppError::validation("campaign channel is invalid"));
    }
    if !matches!(audience, "all" | "active" | "at-risk") {
        return Err(AppError::validation("campaign audience is invalid"));
    }
    if !matches!(status, "draft" | "scheduled") {
        return Err(AppError::validation("campaign status is invalid"));
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
