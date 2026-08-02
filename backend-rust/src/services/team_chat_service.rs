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
    pub share_type: Option<String>,
    pub share_id: Option<String>,
    pub attachment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationCreateRequest {
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub title: Option<String>,
    pub participant_user_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamChatMessage {
    pub id: String,
    pub sender_user_id: String,
    pub sender_name: String,
    pub body: String,
    pub reply_to_message_id: Option<String>,
    pub share_type: Option<String>,
    pub share_id: Option<String>,
    pub attachment_id: Option<String>,
    pub attachment_file_name: Option<String>,
    pub attachment_content_type: Option<String>,
    pub attachment_expires_at: Option<DateTime<Utc>>,
    pub read_by_count: i64,
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
    pub unread_count: i64,
    pub can_send: bool,
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
    pub share_type: Option<String>,
    pub share_id: Option<String>,
    pub attachment_id: Option<String>,
    pub attachment_file_name: Option<String>,
    pub attachment_content_type: Option<String>,
    pub attachment_expires_at: Option<DateTime<Utc>>,
    pub read_by_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffChatParticipant {
    pub user_id: String,
    pub name: String,
    pub job_title: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffChatAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i32,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct StaffChatAttachmentContent {
    pub file_name: String,
    pub content_type: String,
    pub content: Vec<u8>,
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
                  COUNT(message.id)::BIGINT AS message_count,
                  COUNT(message.id) FILTER (WHERE message.sender_user_id<>$4 AND message.created_at>COALESCE(read_state.last_read_at,'epoch'::timestamptz))::BIGINT AS unread_count,
                  TRUE AS can_send,MAX(message.created_at) AS last_message_at,
                  COALESCE(branch.created_at,NOW()) AS created_at,
                  COALESCE(MAX(message.created_at),branch.updated_at,branch.created_at,NOW()) AS updated_at
             FROM branches branch
             LEFT JOIN team_chat_messages message
               ON message.tenant_id=$1 AND message.branch_id=$2 AND message.deleted_at IS NULL
             LEFT JOIN team_chat_read_state read_state
               ON read_state.tenant_id=$1 AND read_state.branch_id=$2 AND read_state.user_id=$4
            WHERE branch.tenant_id::TEXT=$1 AND branch.id::TEXT=$2 AND branch.active=TRUE
            GROUP BY branch.id,branch.name,branch.created_at,branch.updated_at,read_state.last_read_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(team_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load team conversation"))?
    .ok_or_else(|| AppError::not_found("active staff branch was not found"))?;
    let mut rows = vec![team];
    let mut private_rows = sqlx::query_as::<_, StaffChatConversation>(
        r#"SELECT conversation.id,conversation.conversation_type,
                  COALESCE(NULLIF(conversation.title,''),participant_names.title,'Conversation')::TEXT AS title,
                  conversation.branch_id,
                  ARRAY(SELECT participant.user_id FROM staff_private_conversation_participants participant
                         WHERE participant.conversation_id=conversation.id ORDER BY participant.user_id) AS participant_user_ids,
                  message_stats.message_count,message_stats.unread_count,
                  (NOT conversation.read_only OR conversation.created_by=$3) AS can_send,message_stats.last_message_at,
                  conversation.created_at,
                  GREATEST(conversation.updated_at,COALESCE(message_stats.last_message_at,conversation.created_at)) AS updated_at
             FROM staff_private_conversations conversation
             JOIN staff_private_conversation_participants current_participant
               ON current_participant.conversation_id=conversation.id
              AND current_participant.tenant_id=$1 AND current_participant.branch_id=$2
              AND current_participant.user_id=$3
             LEFT JOIN LATERAL (
               SELECT STRING_AGG(COALESCE(NULLIF(member.full_name,''),member.email),', ' ORDER BY member.full_name,member.email) AS title
                 FROM staff_private_conversation_participants named_participant
                 JOIN users member ON member.id=named_participant.user_id AND member.tenant_id=$1 AND member.active=TRUE
                WHERE named_participant.conversation_id=conversation.id AND named_participant.user_id<>$3
             ) participant_names ON TRUE
             LEFT JOIN LATERAL (
               SELECT COUNT(message.id)::BIGINT AS message_count,
                      COUNT(message.id) FILTER (WHERE message.sender_user_id<>$3 AND message.created_at>COALESCE(current_participant.last_read_at,'epoch'::timestamptz))::BIGINT AS unread_count,
                      MAX(message.created_at) AS last_message_at
                 FROM staff_private_chat_messages message WHERE message.conversation_id=conversation.id
             ) message_stats ON TRUE
            WHERE conversation.tenant_id=$1 AND conversation.branch_id=$2
            ORDER BY GREATEST(conversation.updated_at,COALESCE(message_stats.last_message_at,conversation.created_at)) DESC"#,
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
        r#"INSERT INTO staff_private_conversations(tenant_id,branch_id,staff_user_id,owner_user_id,created_by)
           VALUES($1,$2,$3,$4,$3)
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

pub async fn participants(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<Vec<StaffChatParticipant>, AppError> {
    sqlx::query_as(
        r#"SELECT users.id AS user_id,
                  COALESCE(NULLIF(users.full_name,''),users.email)::TEXT AS name,
                  COALESCE(staff.job_title,'')::TEXT AS job_title
             FROM users JOIN staff ON staff.user_id=users.id AND staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
            WHERE users.tenant_id=$1 AND users.active=TRUE AND users.id<>$3
            ORDER BY name LIMIT 500"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load chat participants"))
}

pub async fn create_conversation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    request: ConversationCreateRequest,
    idempotency_key: Option<&str>,
) -> Result<StaffChatConversation, AppError> {
    let conversation_type = request.conversation_type.trim().to_ascii_lowercase();
    let participant_limit = match conversation_type.as_str() {
        "direct" => 1,
        "group" => 49,
        "broadcast" => 499,
        _ => {
            return Err(AppError::validation(
                "chat type must be direct, group, or broadcast",
            ))
        }
    };
    let mut participant_ids = request
        .participant_user_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != user_id)
        .collect::<Vec<_>>();
    participant_ids.sort();
    participant_ids.dedup();
    if participant_ids.is_empty()
        || participant_ids.len() > participant_limit
        || (conversation_type == "direct" && participant_ids.len() != 1)
    {
        return Err(AppError::validation("chat participant count is invalid"));
    }
    let title = optional_limited(request.title.as_deref(), 160)?.unwrap_or_default();
    if matches!(conversation_type.as_str(), "group" | "broadcast") && title.is_empty() {
        return Err(AppError::validation("group or broadcast title is required"));
    }
    let idempotency_key = optional_limited(idempotency_key, 200)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start conversation transaction"))?;
    let valid_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users JOIN staff ON staff.user_id=users.id AND staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE WHERE users.tenant_id=$1 AND users.active=TRUE AND users.id=ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&participant_ids)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate chat participants"))?;
    if valid_count != participant_ids.len() as i64 {
        return Err(AppError::validation(
            "one or more chat participants are invalid",
        ));
    }
    let conversation_id = sqlx::query_scalar::<_, String>(
        r#"WITH inserted AS (
             INSERT INTO staff_private_conversations(tenant_id,branch_id,conversation_type,title,created_by,idempotency_key,read_only)
             VALUES($1,$2,$3,$4,$5,$6,$3='broadcast')
             ON CONFLICT(tenant_id,branch_id,created_by,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
             RETURNING id
           ) SELECT id FROM inserted UNION ALL
             SELECT id FROM staff_private_conversations WHERE tenant_id=$1 AND branch_id=$2 AND created_by=$5 AND idempotency_key=$6 LIMIT 1"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&conversation_type).bind(&title).bind(user_id).bind(&idempotency_key)
    .fetch_one(&mut *tx).await.map_err(|_| AppError::internal("failed to create staff conversation"))?;
    let mut all_participants = participant_ids;
    all_participants.push(user_id.to_string());
    sqlx::query(
        r#"INSERT INTO staff_private_conversation_participants(conversation_id,tenant_id,branch_id,user_id,participant_role)
           SELECT $1,$2,$3,user_id,CASE WHEN user_id=$4 THEN 'manager' ELSE 'member' END FROM UNNEST($5::TEXT[]) user_id
           ON CONFLICT(conversation_id,user_id) DO NOTHING"#,
    )
    .bind(&conversation_id).bind(tenant_id).bind(branch_id).bind(user_id).bind(&all_participants)
    .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save chat participants"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit staff conversation"))?;
    conversations(db, tenant_id, branch_id, user_id)
        .await?
        .into_iter()
        .find(|row| row.id == conversation_id)
        .ok_or_else(|| AppError::internal("staff conversation was not returned"))
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
            r#"SELECT message.id,$3::TEXT AS conversation_id,'team'::TEXT AS conversation_type,
                      message.sender_user_id,message.sender_name,message.body,message.share_type,message.share_id,
                      message.attachment_id,attachment.file_name AS attachment_file_name,
                      attachment.content_type AS attachment_content_type,attachment.expires_at AS attachment_expires_at,
                      (SELECT COUNT(*) FROM team_chat_read_state read_state
                        WHERE read_state.tenant_id=$1 AND read_state.branch_id=$2 AND read_state.last_read_at>=message.created_at)::BIGINT AS read_by_count,
                      message.created_at
                 FROM team_chat_messages message
                 LEFT JOIN staff_chat_attachments attachment ON attachment.id=message.attachment_id AND attachment.expires_at>NOW()
                WHERE message.tenant_id=$1 AND message.branch_id=$2 AND message.deleted_at IS NULL
                ORDER BY message.created_at,message.id LIMIT 500"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|_| AppError::internal("failed to load team conversation messages"));
    }
    sqlx::query_as::<_, StaffConversationMessage>(
        r#"SELECT message.id,message.conversation_id,conversation.conversation_type,
                  message.sender_user_id,message.sender_name,message.body,message.share_type,message.share_id,
                  message.attachment_id,attachment.file_name AS attachment_file_name,
                  attachment.content_type AS attachment_content_type,attachment.expires_at AS attachment_expires_at,
                  (SELECT COUNT(*) FROM staff_private_conversation_participants reader
                    WHERE reader.conversation_id=message.conversation_id AND reader.last_read_at>=message.created_at)::BIGINT AS read_by_count,
                  message.created_at
             FROM staff_private_chat_messages message
             JOIN staff_private_conversations conversation ON conversation.id=message.conversation_id
             JOIN staff_private_conversation_participants participant
               ON participant.conversation_id=message.conversation_id AND participant.user_id=$4
             LEFT JOIN staff_chat_attachments attachment ON attachment.id=message.attachment_id AND attachment.expires_at>NOW()
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
    share_type: Option<&str>,
    share_id: Option<&str>,
    attachment_id: Option<&str>,
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
                share_type: share_type.map(str::to_string),
                share_id: share_id.map(str::to_string),
                attachment_id: attachment_id.map(str::to_string),
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
            share_type: message.share_type,
            share_id: message.share_id,
            attachment_id: message.attachment_id,
            attachment_file_name: message.attachment_file_name,
            attachment_content_type: message.attachment_content_type,
            attachment_expires_at: message.attachment_expires_at,
            read_by_count: message.read_by_count,
            created_at: message.created_at,
        });
    }
    let body = validate_body(body)?;
    let (share_type, share_id) = validate_share(share_type, share_id)?;
    validate_share_record(
        db,
        tenant_id,
        branch_id,
        share_type.as_deref(),
        share_id.as_deref(),
    )
    .await?;
    let attachment_id = optional_limited(attachment_id, 120)?;
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
                tenant_id,branch_id,conversation_id,sender_user_id,sender_name,body,idempotency_key,share_type,share_id,attachment_id
              ) SELECT $1,$2,$3,sender.id,sender.sender_name,$5,$6,$7,$8,$9 FROM sender
              WHERE ($9::TEXT IS NULL OR EXISTS(SELECT 1 FROM staff_chat_attachments attachment
                WHERE attachment.id=$9 AND attachment.tenant_id=$1 AND attachment.branch_id=$2
                  AND attachment.uploaded_by=$4 AND attachment.expires_at>NOW()))
                AND NOT EXISTS(SELECT 1 FROM staff_private_conversations conversation WHERE conversation.id=$3
                  AND conversation.read_only=TRUE AND conversation.created_by<>$4)
              ON CONFLICT(tenant_id,conversation_id,sender_user_id,idempotency_key)
                WHERE idempotency_key IS NOT NULL DO NOTHING
              RETURNING id,conversation_id,(SELECT conversation_type FROM staff_private_conversations WHERE id=$3)::TEXT AS conversation_type,
                        sender_user_id,sender_name,body,share_type,share_id,attachment_id,
                        NULL::TEXT AS attachment_file_name,NULL::TEXT AS attachment_content_type,NULL::TIMESTAMPTZ AS attachment_expires_at,
                        1::BIGINT AS read_by_count,created_at
            )
            SELECT * FROM inserted
            UNION ALL
            SELECT existing.id,existing.conversation_id,conversation.conversation_type,existing.sender_user_id,existing.sender_name,existing.body,
                   existing.share_type,existing.share_id,existing.attachment_id,attachment.file_name,attachment.content_type,attachment.expires_at,
                   1::BIGINT,existing.created_at
              FROM staff_private_chat_messages existing
              JOIN staff_private_conversations conversation ON conversation.id=existing.conversation_id
              LEFT JOIN staff_chat_attachments attachment ON attachment.id=existing.attachment_id AND attachment.expires_at>NOW()
             WHERE existing.tenant_id=$1 AND existing.conversation_id=$3 AND existing.sender_user_id=$4 AND existing.idempotency_key=$6
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(conversation_id)
    .bind(user_id)
    .bind(body)
    .bind(idempotency_key)
    .bind(share_type)
    .bind(share_id)
    .bind(attachment_id)
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
        r#"SELECT message.id,message.sender_user_id,message.sender_name,message.body,message.reply_to_message_id,
                  message.share_type,message.share_id,message.attachment_id,attachment.file_name AS attachment_file_name,
                  attachment.content_type AS attachment_content_type,attachment.expires_at AS attachment_expires_at,
                  (SELECT COUNT(*) FROM team_chat_read_state read_state
                    WHERE read_state.tenant_id=$1 AND read_state.branch_id=$2 AND read_state.last_read_at>=message.created_at)::BIGINT AS read_by_count,
                  message.created_at
             FROM team_chat_messages message
             LEFT JOIN staff_chat_attachments attachment ON attachment.id=message.attachment_id AND attachment.expires_at>NOW()
            WHERE message.tenant_id=$1 AND message.branch_id=$2 AND message.deleted_at IS NULL
              AND ($3::timestamptz IS NULL OR message.created_at < $3)
            ORDER BY message.created_at DESC,message.id DESC LIMIT 100"#,
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
    let (share_type, share_id) =
        validate_share(request.share_type.as_deref(), request.share_id.as_deref())?;
    validate_share_record(
        db,
        tenant_id,
        branch_id,
        share_type.as_deref(),
        share_id.as_deref(),
    )
    .await?;
    let attachment_id = optional_limited(request.attachment_id.as_deref(), 120)?;
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
                tenant_id,branch_id,sender_user_id,sender_name,body,reply_to_message_id,idempotency_key,share_type,share_id,attachment_id
              )
              SELECT $1,$2,sender.id,sender.sender_name,$4,$5,$6,$7,$8,$9 FROM sender
              WHERE ($5 IS NULL OR EXISTS(
                SELECT 1 FROM team_chat_messages parent
                 WHERE parent.tenant_id=$1 AND parent.branch_id=$2 AND parent.id=$5 AND parent.deleted_at IS NULL
              )) AND ($9::TEXT IS NULL OR EXISTS(SELECT 1 FROM staff_chat_attachments attachment
                WHERE attachment.id=$9 AND attachment.tenant_id=$1 AND attachment.branch_id=$2
                  AND attachment.uploaded_by=$3 AND attachment.expires_at>NOW()))
              ON CONFLICT(tenant_id,branch_id,sender_user_id,idempotency_key)
                WHERE idempotency_key IS NOT NULL DO NOTHING
              RETURNING id,sender_user_id,sender_name,body,reply_to_message_id,share_type,share_id,attachment_id,
                        NULL::TEXT AS attachment_file_name,NULL::TEXT AS attachment_content_type,NULL::TIMESTAMPTZ AS attachment_expires_at,
                        1::BIGINT AS read_by_count,created_at
            )
            SELECT * FROM inserted
            UNION ALL
            SELECT existing.id,existing.sender_user_id,existing.sender_name,existing.body,existing.reply_to_message_id,
                   existing.share_type,existing.share_id,existing.attachment_id,attachment.file_name,attachment.content_type,attachment.expires_at,
                   1::BIGINT,existing.created_at
              FROM team_chat_messages existing
              LEFT JOIN staff_chat_attachments attachment ON attachment.id=existing.attachment_id AND attachment.expires_at>NOW()
             WHERE existing.tenant_id=$1 AND existing.branch_id=$2 AND existing.sender_user_id=$3 AND existing.idempotency_key=$6
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sender_user_id)
    .bind(body)
    .bind(reply_to)
    .bind(idempotency_key)
    .bind(share_type)
    .bind(share_id)
    .bind(attachment_id)
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

fn validate_share(
    share_type: Option<&str>,
    share_id: Option<&str>,
) -> Result<(Option<String>, Option<String>), AppError> {
    let share_type = optional_limited(share_type, 32)?;
    let share_id = optional_limited(share_id, 120)?;
    if share_type.is_none() && share_id.is_none() {
        return Ok((None, None));
    }
    if !matches!(
        share_type.as_deref(),
        Some("appointment" | "invoice" | "guest")
    ) || share_id.is_none()
    {
        return Err(AppError::validation(
            "Smart Share requires an appointment, invoice, or guest id",
        ));
    }
    Ok((share_type, share_id))
}

async fn validate_share_record(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    share_type: Option<&str>,
    share_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(share_type) = share_type else {
        return Ok(());
    };
    let share_id = share_id.unwrap_or_default();
    let exists = match share_type {
        "appointment" => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
        ),
        "invoice" => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
        ),
        "guest" => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
        ),
        _ => return Err(AppError::validation("Smart Share record type is invalid")),
    }
    .bind(tenant_id)
    .bind(branch_id)
    .bind(share_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to validate Smart Share record"))?;
    if exists {
        Ok(())
    } else {
        Err(AppError::not_found("shared CRM record was not found"))
    }
}

pub async fn resolve_share(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    unrestricted: bool,
    share_type: &str,
    share_id: &str,
) -> Result<Value, AppError> {
    let (share_type, share_id) = validate_share(Some(share_type), Some(share_id))?;
    let allowed = match share_type.as_deref().unwrap_or_default() {
        "appointment" => sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM appointments appointment
          WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=$3
            AND ($5 OR EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$4 AND id=appointment.staff_id)))"#),
        "invoice" => sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM pos_sales sale
          WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3 AND ($5 OR EXISTS(
            SELECT 1 FROM appointments appointment JOIN staff ON staff.id=appointment.staff_id AND staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.user_id=$4
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=sale.appointment_id)))"#),
        "guest" => sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM clients client
          WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3 AND ($5 OR EXISTS(
            SELECT 1 FROM appointments appointment JOIN staff ON staff.id=appointment.staff_id AND staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.user_id=$4
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.client_id=client.id)))"#),
        _ => return Err(AppError::validation("Smart Share record type is invalid")),
    }.bind(tenant_id).bind(branch_id).bind(share_id.as_deref().unwrap_or_default()).bind(user_id).bind(unrestricted)
      .fetch_one(db).await.map_err(|_| AppError::internal("failed to authorize Smart Share record"))?;
    if !allowed {
        return Err(AppError::forbidden(
            "shared CRM record is outside your staff scope",
        ));
    }
    Ok(json!({"type":share_type,"id":share_id,"access":"granted"}))
}

pub async fn mark_read(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    conversation_id: &str,
) -> Result<(), AppError> {
    let affected = if conversation_id == format!("team:{branch_id}") {
        sqlx::query(
            r#"INSERT INTO team_chat_read_state(tenant_id,branch_id,user_id,last_read_at)
               VALUES($1,$2,$3,NOW()) ON CONFLICT(tenant_id,branch_id,user_id)
               DO UPDATE SET last_read_at=EXCLUDED.last_read_at"#,
        )
        .bind(tenant_id).bind(branch_id).bind(user_id).execute(db).await
    } else {
        sqlx::query(
            "UPDATE staff_private_conversation_participants SET last_read_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND conversation_id=$4",
        )
        .bind(tenant_id).bind(branch_id).bind(user_id).bind(conversation_id).execute(db).await
    }
    .map_err(|_| AppError::internal("failed to update chat read state"))?
    .rows_affected();
    if affected == 0 {
        Err(AppError::forbidden("conversation access is required"))
    } else {
        Ok(())
    }
}

pub fn valid_attachment(file_name: &str, content_type: &str, bytes: &[u8]) -> bool {
    if file_name.is_empty()
        || file_name.chars().count() > 180
        || file_name.chars().any(char::is_control)
        || bytes.is_empty()
        || bytes.len() > 10 * 1024 * 1024
    {
        return false;
    }
    match content_type {
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            bytes.starts_with(b"PK\x03\x04")
        }
        _ => false,
    }
}

pub async fn save_attachment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    file_name: &str,
    content_type: &str,
    content: Vec<u8>,
) -> Result<StaffChatAttachment, AppError> {
    let byte_size = content.len() as i32;
    sqlx::query_as(
        r#"INSERT INTO staff_chat_attachments(tenant_id,branch_id,uploaded_by,file_name,content_type,byte_size,content)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,file_name,content_type,byte_size,expires_at"#,
    )
    .bind(tenant_id).bind(branch_id).bind(user_id).bind(file_name).bind(content_type).bind(byte_size).bind(content)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to save chat attachment"))
}

pub async fn attachment_content(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    attachment_id: &str,
) -> Result<StaffChatAttachmentContent, AppError> {
    sqlx::query_as(
        r#"SELECT attachment.file_name,attachment.content_type,attachment.content
             FROM staff_chat_attachments attachment
            WHERE attachment.id=$4 AND attachment.tenant_id=$1 AND attachment.branch_id=$2 AND attachment.expires_at>NOW()
              AND (attachment.uploaded_by=$3 OR EXISTS(
                SELECT 1 FROM team_chat_messages message WHERE message.tenant_id=$1 AND message.branch_id=$2 AND message.attachment_id=attachment.id
              ) OR EXISTS(
                SELECT 1 FROM staff_private_chat_messages message
                JOIN staff_private_conversation_participants participant ON participant.conversation_id=message.conversation_id AND participant.user_id=$3
                WHERE message.tenant_id=$1 AND message.branch_id=$2 AND message.attachment_id=attachment.id
              ))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(user_id).bind(attachment_id)
    .fetch_optional(db).await.map_err(|_| AppError::internal("failed to load chat attachment"))?
    .ok_or_else(|| AppError::not_found("chat attachment was not found or has expired"))
}

#[derive(Debug, FromRow)]
pub struct PushDelivery {
    id: String,
    tenant_id: String,
    branch_id: String,
    device_id: String,
    provider: String,
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
           RETURNING delivery.id,delivery.tenant_id,delivery.branch_id,delivery.device_id,
                     CASE WHEN LOWER(device.platform)='web' THEN 'web_push' WHEN LOWER(device.platform) IN ('ios','apns') THEN 'apns' ELSE 'fcm' END AS provider,
                     device.push_token_ciphertext AS token_ciphertext,
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
                sqlx::query("INSERT INTO mobile_push_delivery_attempt_logs(tenant_id,branch_id,delivery_id,device_id,provider,attempt_no,status,provider_message_id) VALUES($1,$2,$3,$4,$5,$6,'sent',$7) ON CONFLICT(delivery_id,attempt_no) DO NOTHING")
                    .bind(&delivery.tenant_id).bind(&delivery.branch_id).bind(&delivery.id).bind(&delivery.device_id)
                    .bind(&delivery.provider).bind(delivery.attempts).bind(provider_id).execute(db).await
                    .map_err(|_| AppError::internal("failed to record mobile push delivery attempt"))?;
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
                sqlx::query("INSERT INTO mobile_push_delivery_attempt_logs(tenant_id,branch_id,delivery_id,device_id,provider,attempt_no,status,error_message) VALUES($1,$2,$3,$4,$5,$6,'failed',$7) ON CONFLICT(delivery_id,attempt_no) DO NOTHING")
                    .bind(&delivery.tenant_id).bind(&delivery.branch_id).bind(&delivery.id).bind(&delivery.device_id)
                    .bind(&delivery.provider).bind(delivery.attempts).bind(error.chars().take(500).collect::<String>()).execute(db).await
                    .map_err(|_| AppError::internal("failed to record mobile push failure"))?;
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
