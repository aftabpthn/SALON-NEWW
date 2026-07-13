use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::auth_service::AuthClaims,
    state::AppState,
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
