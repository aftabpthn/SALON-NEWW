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

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffChatConversation {
    pub id: String,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub title: String,
    pub branch_id: String,
    pub participant_user_ids: Option<Vec<String>>,
    pub message_count: i64,
    pub last_message_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffConversationMessage {
    pub id: String,
    pub conversation_id: String,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub sender_user_id: String,
    pub sender_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

pub async fn conversations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<Vec<StaffChatConversation>, AppError> {
    let team_id = format!("team:{branch_id}");
    let team = sqlx::query_as::<_, StaffChatConversation>(
        r#"SELECT $3::TEXT AS id,'team'::TEXT AS conversation_type,
                  COALESCE(NULLIF(branch.name,''),'Branch team')::TEXT AS title,
                  branch.id::TEXT AS branch_id,NULL::TEXT[] AS participant_user_ids,
                  COUNT(message.id)::BIGINT AS message_count,MAX(message.created_at) AS last_message_at,
                  COALESCE(branch.created_at,NOW()) AS created_at,
                  COALESCE(MAX(message.created_at),branch.updated_at,branch.created_at,NOW()) AS updated_at
             FROM branches branch
             LEFT JOIN team_chat_messages message
               ON message.tenant_id=$1 AND message.branch_id=$2 AND message.deleted_at IS NULL
            WHERE branch.tenant_id::TEXT=$1 AND branch.id::TEXT=$2 AND branch.active=TRUE
            GROUP BY branch.id,branch.name,branch.created_at,branch.updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(team_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load team conversation"))?
    .ok_or_else(|| AppError::not_found("active staff branch was not found"))?;
    let mut rows = vec![team];
    let mut private_rows = sqlx::query_as::<_, StaffChatConversation>(
        r#"SELECT conversation.id,'private-owner'::TEXT AS conversation_type,
                  CASE WHEN conversation.owner_user_id=$3
                    THEN COALESCE(NULLIF(staff_user.full_name,''),staff_user.email,'Staff')
                    ELSE COALESCE(NULLIF(owner.full_name,''),owner.email,'Owner')
                  END::TEXT AS title,
                  conversation.branch_id,
                  ARRAY(SELECT participant.user_id FROM staff_private_conversation_participants participant
                         WHERE participant.conversation_id=conversation.id ORDER BY participant.user_id) AS participant_user_ids,
                  COUNT(message.id)::BIGINT AS message_count,MAX(message.created_at) AS last_message_at,
                  conversation.created_at,
                  GREATEST(conversation.updated_at,COALESCE(MAX(message.created_at),conversation.created_at)) AS updated_at
             FROM staff_private_conversations conversation
             JOIN staff_private_conversation_participants current_participant
               ON current_participant.conversation_id=conversation.id
              AND current_participant.tenant_id=$1 AND current_participant.branch_id=$2
              AND current_participant.user_id=$3
             JOIN users owner ON owner.id=conversation.owner_user_id AND owner.tenant_id=$1 AND owner.active=TRUE
             JOIN users staff_user ON staff_user.id=conversation.staff_user_id AND staff_user.tenant_id=$1 AND staff_user.active=TRUE
             LEFT JOIN staff_private_chat_messages message ON message.conversation_id=conversation.id
            WHERE conversation.tenant_id=$1 AND conversation.branch_id=$2
            GROUP BY conversation.id,conversation.branch_id,conversation.created_at,conversation.updated_at,
                     conversation.owner_user_id,owner.full_name,owner.email,staff_user.full_name,staff_user.email
            ORDER BY GREATEST(conversation.updated_at,COALESCE(MAX(message.created_at),conversation.created_at)) DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load private conversations"))?;
    rows.append(&mut private_rows);
    Ok(rows)
}

pub async fn start_private_owner(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<StaffChatConversation, AppError> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start private chat transaction"))?;
    let staff_user_id = sqlx::query_scalar::<_, String>(
        "SELECT users.id FROM users JOIN staff ON staff.user_id=users.id AND staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE WHERE users.tenant_id=$1 AND users.id=$3 AND users.active=TRUE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate staff chat identity"))?
    .ok_or_else(|| AppError::forbidden("an active staff profile is required"))?;
    let owner_user_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM users WHERE tenant_id=$1 AND active=TRUE AND REPLACE(REPLACE(LOWER(role_name),'-',''),'_','') IN ('owner','superadmin') ORDER BY CASE WHEN branch_id IS NULL OR branch_id='' THEN 0 WHEN branch_id=$2 THEN 1 ELSE 2 END,created_at LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to find business owner"))?
    .ok_or_else(|| AppError::not_found("active business owner was not found"))?;
    let conversation_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO staff_private_conversations(tenant_id,branch_id,staff_user_id,owner_user_id)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(tenant_id,branch_id,staff_user_id,owner_user_id)
           DO UPDATE SET updated_at=staff_private_conversations.updated_at
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_user_id)
    .bind(&owner_user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to create private owner conversation"))?;
    for (participant_id, participant_role) in [
        (staff_user_id.as_str(), "staff"),
        (owner_user_id.as_str(), "owner"),
    ] {
        sqlx::query(
            "INSERT INTO staff_private_conversation_participants(conversation_id,tenant_id,branch_id,user_id,participant_role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,user_id) DO NOTHING",
        )
        .bind(&conversation_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(participant_id)
        .bind(participant_role)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to secure private chat participants"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit private owner conversation"))?;
    conversations(db, tenant_id, branch_id, user_id)
        .await?
        .into_iter()
        .find(|row| row.id == conversation_id)
        .ok_or_else(|| AppError::internal("private owner conversation was not returned"))
}

pub async fn conversation_messages(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    conversation_id: &str,
) -> Result<Vec<StaffConversationMessage>, AppError> {
    if conversation_id == format!("team:{branch_id}") {
        return sqlx::query_as::<_, StaffConversationMessage>(
            r#"SELECT id,$3::TEXT AS conversation_id,'team'::TEXT AS conversation_type,
                      sender_user_id,sender_name,body,created_at
                 FROM team_chat_messages
                WHERE tenant_id=$1 AND branch_id=$2 AND deleted_at IS NULL
                ORDER BY created_at,id LIMIT 500"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|_| AppError::internal("failed to load team conversation messages"));
    }
    sqlx::query_as::<_, StaffConversationMessage>(
        r#"SELECT message.id,message.conversation_id,'private-owner'::TEXT AS conversation_type,
                  message.sender_user_id,message.sender_name,message.body,message.created_at
             FROM staff_private_chat_messages message
             JOIN staff_private_conversation_participants participant
               ON participant.conversation_id=message.conversation_id AND participant.user_id=$4
            WHERE message.tenant_id=$1 AND message.branch_id=$2 AND message.conversation_id=$3
            ORDER BY message.created_at,message.id LIMIT 500"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(conversation_id)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load private conversation messages"))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_conversation_message(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    conversation_id: &str,
    body: &str,
    idempotency_key: Option<&str>,
) -> Result<StaffConversationMessage, AppError> {
    if conversation_id == format!("team:{branch_id}") {
        let message = send(
            db,
            tenant_id,
            branch_id,
            user_id,
            TeamChatRequest {
                body: body.to_string(),
                reply_to_message_id: None,
                idempotency_key: idempotency_key.map(str::to_string),
            },
        )
        .await?;
        return Ok(StaffConversationMessage {
            id: message.id,
            conversation_id: conversation_id.to_string(),
            conversation_type: "team".to_string(),
            sender_user_id: message.sender_user_id,
            sender_name: message.sender_name,
            body: message.body,
            created_at: message.created_at,
        });
    }
    let body = validate_body(body)?;
    let idempotency_key = optional_limited(idempotency_key, 200)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start private message transaction"))?;
    let row = sqlx::query_as::<_, StaffConversationMessage>(
        r#"WITH sender AS (
              SELECT id,COALESCE(NULLIF(full_name,''),email) AS sender_name FROM users
               WHERE tenant_id=$1 AND id=$4 AND active=TRUE
                 AND EXISTS(SELECT 1 FROM staff_private_conversation_participants participant
                             WHERE participant.conversation_id=$3 AND participant.tenant_id=$1
                               AND participant.branch_id=$2 AND participant.user_id=$4)
            ), inserted AS (
              INSERT INTO staff_private_chat_messages(
                tenant_id,branch_id,conversation_id,sender_user_id,sender_name,body,idempotency_key
              ) SELECT $1,$2,$3,sender.id,sender.sender_name,$5,$6 FROM sender
              ON CONFLICT(tenant_id,conversation_id,sender_user_id,idempotency_key)
                WHERE idempotency_key IS NOT NULL DO NOTHING
              RETURNING id,conversation_id,'private-owner'::TEXT AS conversation_type,
                        sender_user_id,sender_name,body,created_at
            )
            SELECT * FROM inserted
            UNION ALL
            SELECT id,conversation_id,'private-owner'::TEXT,sender_user_id,sender_name,body,created_at
              FROM staff_private_chat_messages
             WHERE tenant_id=$1 AND conversation_id=$3 AND sender_user_id=$4 AND idempotency_key=$6
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(conversation_id)
    .bind(user_id)
    .bind(body)
    .bind(idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to send private message"))?
    .ok_or_else(|| AppError::forbidden("private conversation access is required"))?;
    sqlx::query("UPDATE staff_private_conversations SET updated_at=NOW() WHERE id=$1")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to update private conversation"))?;
    sqlx::query(
        r#"INSERT INTO mobile_push_deliveries(tenant_id,branch_id,device_id,source_type,source_id,payload_json)
           SELECT $1,$2,device.id,'private_chat',$3,$4
             FROM staff_private_conversation_participants participant
             JOIN staff ON staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.user_id=participant.user_id
             JOIN staff_mobile_devices device ON device.tenant_id=$1 AND device.branch_id=$2
                                             AND device.staff_id=staff.id AND device.active=TRUE
                                             AND device.push_enabled=TRUE AND device.push_token_ciphertext IS NOT NULL
            WHERE participant.conversation_id=$5 AND participant.user_id<>$6
           ON CONFLICT(tenant_id,device_id,source_type,source_id) DO NOTHING"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&row.id)
    .bind(json!({"type":"private_chat","conversationId":conversation_id,"messageId":row.id,"senderName":row.sender_name,"body":row.body}))
    .bind(conversation_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to queue private chat push"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit private message"))?;
    Ok(row)
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
