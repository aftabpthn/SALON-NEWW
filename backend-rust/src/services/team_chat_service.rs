use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

use crate::models::common::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamChatRequest {
    pub body: String,
    pub reply_to_message_id: Option<String>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamChatMessage {
    pub id: String,
    pub sender_user_id: String,
    pub sender_name: String,
    pub body: String,
    pub reply_to_message_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    before: Option<DateTime<Utc>>,
) -> Result<Vec<TeamChatMessage>, AppError> {
    let mut rows = sqlx::query_as::<_, TeamChatMessage>(
        r#"SELECT id,sender_user_id,sender_name,body,reply_to_message_id,created_at
             FROM team_chat_messages
            WHERE tenant_id=$1 AND branch_id=$2 AND deleted_at IS NULL
              AND ($3::timestamptz IS NULL OR created_at < $3)
            ORDER BY created_at DESC,id DESC LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(before)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load team chat"))?;
    rows.reverse();
    Ok(rows)
}

pub async fn send(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    sender_user_id: &str,
    request: TeamChatRequest,
) -> Result<TeamChatMessage, AppError> {
    let body = validate_body(&request.body)?;
    let idempotency_key = optional_limited(request.idempotency_key.as_deref(), 200)?;
    let reply_to = optional_limited(request.reply_to_message_id.as_deref(), 120)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start team chat transaction"))?;
    let row = sqlx::query_as::<_, TeamChatMessage>(
        r#"WITH sender AS (
              SELECT id,COALESCE(NULLIF(full_name,''),email) AS sender_name
                FROM users WHERE tenant_id=$1 AND id=$3 AND active=TRUE
            ), inserted AS (
              INSERT INTO team_chat_messages(
                tenant_id,branch_id,sender_user_id,sender_name,body,reply_to_message_id,idempotency_key
              )
              SELECT $1,$2,sender.id,sender.sender_name,$4,$5,$6 FROM sender
              WHERE $5 IS NULL OR EXISTS(
                SELECT 1 FROM team_chat_messages parent
                 WHERE parent.tenant_id=$1 AND parent.branch_id=$2 AND parent.id=$5 AND parent.deleted_at IS NULL
              )
              ON CONFLICT(tenant_id,branch_id,sender_user_id,idempotency_key)
                WHERE idempotency_key IS NOT NULL DO NOTHING
              RETURNING id,sender_user_id,sender_name,body,reply_to_message_id,created_at
            )
            SELECT * FROM inserted
            UNION ALL
            SELECT id,sender_user_id,sender_name,body,reply_to_message_id,created_at
              FROM team_chat_messages
             WHERE tenant_id=$1 AND branch_id=$2 AND sender_user_id=$3 AND idempotency_key=$6
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sender_user_id)
    .bind(body)
    .bind(reply_to)
    .bind(idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to send team message"))?
    .ok_or_else(|| AppError::validation("team message sender or reply is invalid"))?;

    sqlx::query(
        r#"INSERT INTO mobile_push_deliveries(
              tenant_id,branch_id,device_id,source_type,source_id,payload_json
            )
            SELECT $1,$2,device.id,'team_chat',$3,$4
              FROM staff_mobile_devices device
             WHERE device.tenant_id=$1 AND device.branch_id=$2 AND device.active=TRUE
               AND device.push_enabled=TRUE AND device.push_token_ciphertext IS NOT NULL
               AND device.staff_id <> COALESCE((SELECT staff_id FROM staff WHERE tenant_id=$1 AND user_id=$5 LIMIT 1),'')
            ON CONFLICT(tenant_id,device_id,source_type,source_id) DO NOTHING"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&row.id)
    .bind(json!({"type":"team_chat","messageId":row.id,"senderName":row.sender_name,"body":row.body}))
    .bind(sender_user_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to queue team chat push"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit team message"))?;
    Ok(row)
}

fn validate_body(value: &str) -> Result<&str, AppError> {
    let body = value.trim();
    if body.is_empty() || body.chars().count() > 4_000 {
        return Err(AppError::validation(
            "team message must contain 1 to 4000 characters",
        ));
    }
    Ok(body)
}

fn optional_limited(value: Option<&str>, max: usize) -> Result<Option<String>, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            (value.chars().count() <= max)
                .then(|| value.to_string())
                .ok_or_else(|| AppError::validation("team message reference is invalid"))
        })
        .transpose()
}

#[derive(Debug, FromRow)]
pub struct PushDelivery {
    id: String,
    token_ciphertext: String,
    payload_json: Value,
    attempts: i32,
}

pub async fn process_push_deliveries(
    db: &PgPool,
    provider_url: &str,
    provider_token: &str,
    encryption_key: &str,
) -> Result<usize, AppError> {
    let deliveries = sqlx::query_as::<_, PushDelivery>(
        r#"UPDATE mobile_push_deliveries delivery SET status='processing',attempts=attempts+1
            FROM staff_mobile_devices device
           WHERE delivery.id IN (
             SELECT id FROM mobile_push_deliveries
              WHERE status IN ('pending','failed') AND next_attempt_at<=NOW() AND attempts<6
              ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
           ) AND device.id=delivery.device_id AND device.active=TRUE AND device.push_enabled=TRUE
           RETURNING delivery.id,device.push_token_ciphertext AS token_ciphertext,
                     delivery.payload_json,delivery.attempts"#,
    )
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to claim mobile push deliveries"))?;
    let client = reqwest::Client::new();
    let mut sent = 0;
    for delivery in deliveries {
        let token = crate::services::security_service::decrypt_secret(
            encryption_key,
            &delivery.token_ciphertext,
        )?;
        let result = client
            .post(provider_url)
            .bearer_auth(provider_token)
            .json(&json!({"deviceToken":token,"payload":delivery.payload_json}))
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                let provider_id = response
                    .headers()
                    .get("x-provider-message-id")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default();
                sqlx::query("UPDATE mobile_push_deliveries SET status='sent',sent_at=NOW(),provider_message_id=$2,last_error=NULL WHERE id=$1")
                    .bind(&delivery.id).bind(provider_id).execute(db).await
                    .map_err(|_| AppError::internal("failed to complete mobile push delivery"))?;
                sent += 1;
            }
            result => {
                let error = match result {
                    Ok(response) => format!("provider returned {}", response.status()),
                    Err(error) => error.to_string(),
                };
                let backoff_minutes = i64::from(2_i32.pow(delivery.attempts.clamp(1, 6) as u32));
                sqlx::query("UPDATE mobile_push_deliveries SET status='failed',last_error=$2,next_attempt_at=NOW()+($3 || ' minutes')::interval WHERE id=$1")
                    .bind(&delivery.id).bind(error.chars().take(500).collect::<String>()).bind(backoff_minutes)
                    .execute(db).await.map_err(|_| AppError::internal("failed to reschedule mobile push delivery"))?;
            }
        }
    }
    Ok(sent)
}

#[cfg(test)]
mod tests {
    use super::validate_body;

    #[test]
    fn team_chat_rejects_empty_and_oversized_messages() {
        assert!(validate_body(" hello ").is_ok());
        assert!(validate_body("  ").is_err());
        assert!(validate_body(&"x".repeat(4_001)).is_err());
    }
}
