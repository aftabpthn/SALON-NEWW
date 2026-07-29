use axum::{
    body::Bytes,
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, TimeZone, Utc};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::benefit_notification_repository::{self, NewBenefitDelivery},
    routes::pos::{
        append_pos_invoice_event_from_gateway, settle_deferred_customer_commerce_benefits,
    },
    services::{accounting_service, ai_concierge_service, pos_enterprise_service},
    state::AppState,
};

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/webhooks/whatsapp",
            get(verify_whatsapp_webhook).post(receive_whatsapp_webhook),
        )
        .route("/webhooks/sms", axum::routing::post(receive_sms_webhook))
        .route(
            "/webhooks/razorpay",
            axum::routing::post(receive_razorpay_webhook),
        )
        .route(
            "/webhooks/cashfree",
            axum::routing::post(receive_cashfree_webhook),
        )
        .route(
            "/webhooks/phonepe",
            axum::routing::post(receive_phonepe_webhook),
        )
}

#[derive(Deserialize)]
struct WhatsAppVerifyQuery {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    verify_token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}

async fn verify_whatsapp_webhook(
    State(state): State<AppState>,
    Query(query): Query<WhatsAppVerifyQuery>,
) -> Result<String, AppError> {
    if !state.settings.whatsapp_cloud_webhook_configured() {
        return Err(AppError::service_unavailable(
            "WHATSAPP_NOT_CONFIGURED",
            "WhatsApp webhook is not configured",
        ));
    }
    let token = state
        .settings
        .whatsapp_cloud_verify_token
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp webhook is not configured",
            )
        })?;
    if query.mode != "subscribe" || query.verify_token != token {
        return Err(AppError::forbidden("WhatsApp webhook verification failed"));
    }
    Ok(query.challenge)
}

async fn receive_whatsapp_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    if !state.settings.whatsapp_cloud_webhook_configured() {
        return Err(AppError::service_unavailable(
            "WHATSAPP_NOT_CONFIGURED",
            "WhatsApp webhook is not configured",
        ));
    }
    let secret = state
        .settings
        .whatsapp_cloud_app_secret
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "WHATSAPP_NOT_CONFIGURED",
                "WhatsApp webhook is not configured",
            )
        })?;
    verify_signature(&headers, secret, &body)?;
    let payload = serde_json::from_slice::<Value>(&body)
        .map_err(|_| AppError::validation("invalid WhatsApp webhook payload"))?;
    let mut updated = 0u64;
    for status in whatsapp_statuses(&payload) {
        let mapped = match status.status.as_str() {
            "failed" => "failed",
            "sent" | "delivered" | "read" => "sent",
            _ => continue,
        };
        let result = sqlx::query(
            "UPDATE pos_invoice_outbox SET status=$2, delivered_at=CASE WHEN $2='sent' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END, last_error=CASE WHEN $2='failed' THEN $3 ELSE '' END, updated_at=NOW() WHERE external_message_id=$1",
        )
        .bind(&status.message_id)
        .bind(mapped)
        .bind(&status.error)
        .execute(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to record WhatsApp delivery status"))?;
        updated += result.rows_affected();

        let result = sqlx::query(
            "UPDATE benefit_notification_outbox SET status=$2, sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END, last_error=CASE WHEN $2='failed' THEN $3 ELSE '' END, updated_at=NOW() WHERE provider_message_id=$1",
        )
        .bind(&status.message_id)
        .bind(mapped)
        .bind(&status.error)
        .execute(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to record campaign delivery status"))?;
        updated += result.rows_affected();
    }
    let mut inbound = 0u64;
    for message in whatsapp_messages(&payload) {
        if let Some(context) = record_provider_message(&state, &message, "whatsapp").await? {
            inbound += 1;
            let _ = respond_to_inbound_whatsapp(&state, &message, &context).await;
        }
    }
    Ok(Json(
        serde_json::json!({ "received": true, "updated": updated, "inbound": inbound }),
    ))
}

struct WhatsAppStatus {
    message_id: String,
    status: String,
    error: String,
}

struct WhatsAppMessage {
    message_id: String,
    sender: String,
    context_message_id: String,
    body: String,
    /// The provider's identifier for the number the message was *sent to*.
    /// Empty for channels that do not report one (SMS).
    receiving_phone_number_id: String,
    /// The human-readable form of the same receiving number, digits only.
    receiving_display_number: String,
}

struct InboundMessageContext {
    tenant_id: String,
    branch_id: String,
    /// `None` when the sender is not a client of this branch. A staff member
    /// messaging their own branch has no client record, and inventing one — or
    /// refusing to answer them — were both wrong.
    client_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmsWebhookPayload {
    message_id: String,
    from: Option<String>,
    body: Option<String>,
    reply_to_message_id: Option<String>,
    status: Option<String>,
    error: Option<String>,
}

async fn receive_sms_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SmsWebhookPayload>,
) -> Result<Json<Value>, AppError> {
    let token = state
        .settings
        .invoice_delivery_webhook_token
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable("SMS_NOT_CONFIGURED", "SMS webhook is not configured")
        })?;
    let supplied = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if supplied != token {
        return Err(AppError::forbidden("SMS webhook authorization failed"));
    }
    let mut updated = 0u64;
    if let Some(status) = payload.status.as_deref() {
        let mapped = match status.trim().to_ascii_lowercase().as_str() {
            "sent" | "delivered" | "read" => "sent",
            "failed" | "undelivered" => "failed",
            _ => "",
        };
        if !mapped.is_empty() {
            updated = sqlx::query(
                "UPDATE benefit_notification_outbox SET status=$2,sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at,NOW()) ELSE sent_at END,last_error=CASE WHEN $2='failed' THEN $3 ELSE '' END,updated_at=NOW() WHERE provider_message_id=$1",
            )
            .bind(&payload.message_id)
            .bind(mapped)
            .bind(payload.error.as_deref().unwrap_or_default())
            .execute(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to record SMS delivery status"))?
            .rows_affected();
        }
    }
    let inbound = match (payload.from.as_deref(), payload.body.as_deref()) {
        (Some(sender), Some(body)) if !sender.trim().is_empty() && !body.trim().is_empty() => {
            u64::from(
                record_provider_message(
                    &state,
                    &WhatsAppMessage {
                        message_id: payload.message_id,
                        sender: sender.to_string(),
                        context_message_id: payload.reply_to_message_id.unwrap_or_default(),
                        body: body.chars().take(4_000).collect(),
                        // The SMS provider reports no receiving identity, so
                        // this channel keeps its client-anchored routing.
                        receiving_phone_number_id: String::new(),
                        receiving_display_number: String::new(),
                    },
                    "sms",
                )
                .await?
                .is_some(),
            )
        }
        _ => 0,
    };
    Ok(Json(
        serde_json::json!({"received":true,"updated":updated,"inbound":inbound}),
    ))
}

fn whatsapp_statuses(payload: &Value) -> Vec<WhatsAppStatus> {
    payload
        .get("entry")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            entry
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .flat_map(|change| {
            change
                .get("value")
                .and_then(|value| value.get("statuses"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|status| {
            Some(WhatsAppStatus {
                message_id: status.get("id")?.as_str()?.to_string(),
                status: status.get("status")?.as_str()?.to_string(),
                error: status
                    .get("errors")
                    .map(Value::to_string)
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn whatsapp_messages(payload: &Value) -> Vec<WhatsAppMessage> {
    payload
        .get("entry")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            entry
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .flat_map(|change| {
            // The receiving number lives on the change, not on the message, so
            // it is carried down beside each message rather than looked up
            // again from the sender.
            let value = change.get("value");
            let metadata = value
                .and_then(|value| value.get("metadata"))
                .cloned()
                .unwrap_or(Value::Null);
            value
                .and_then(|value| value.get("messages"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(move |message| (metadata.clone(), message))
        })
        .filter_map(|(metadata, message)| {
            let body = message
                .get("text")
                .and_then(|value| value.get("body"))
                .and_then(Value::as_str)
                .or_else(|| {
                    message
                        .get("button")
                        .and_then(|value| value.get("text"))
                        .and_then(Value::as_str)
                })
                .or_else(|| {
                    message
                        .get("interactive")
                        .and_then(|value| value.get("button_reply"))
                        .and_then(|value| value.get("title"))
                        .and_then(Value::as_str)
                })
                .or_else(|| {
                    message
                        .get("interactive")
                        .and_then(|value| value.get("list_reply"))
                        .and_then(|value| value.get("title"))
                        .and_then(Value::as_str)
                })
                .unwrap_or_else(|| {
                    message
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("message")
                });
            Some(WhatsAppMessage {
                receiving_phone_number_id: metadata
                    .get("phone_number_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                receiving_display_number: metadata
                    .get("display_phone_number")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .chars()
                    .filter(char::is_ascii_digit)
                    .collect(),
                message_id: message.get("id")?.as_str()?.to_string(),
                sender: message.get("from")?.as_str()?.to_string(),
                context_message_id: message
                    .get("context")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                body: body.chars().take(4_000).collect(),
            })
        })
        .collect()
}

/// Resolves the tenant and branch a message was addressed *to*.
///
/// Returns `None` when the receiving number is not provisioned, which leaves
/// the caller on the legacy sender-anchored path rather than guessing.
async fn receiving_branch(
    state: &AppState,
    message: &WhatsAppMessage,
) -> Result<Option<(String, String)>, AppError> {
    if message.receiving_phone_number_id.is_empty() && message.receiving_display_number.is_empty() {
        return Ok(None);
    }
    sqlx::query_as(
        r#"SELECT tenant_id,branch_id
             FROM whatsapp_business_numbers
            WHERE active=TRUE
              AND (
                    (phone_number_id<>'' AND phone_number_id=$1)
                 OR (display_phone_number<>'' AND display_phone_number=$2)
              )
            LIMIT 1"#,
    )
    .bind(&message.receiving_phone_number_id)
    .bind(&message.receiving_display_number)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to resolve the receiving business number"))
}

/// Finds the client record for a sender *within an already-decided scope*.
///
/// Unlike the legacy lookup this never chooses the tenant: the branch is fixed
/// by the receiving number, and the sender either is a client of that branch or
/// is not.
async fn client_in_branch(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sender: &str,
) -> Result<Option<String>, AppError> {
    let digits: String = sender.chars().filter(char::is_ascii_digit).collect();
    let matched: Vec<String> = sqlx::query_scalar(
        r#"SELECT id FROM clients
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
              AND merged_into_client_id IS NULL
              AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g')=$3
            ORDER BY id
            LIMIT 2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&digits)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to resolve message sender"))?;
    // Two clients on one handset is ambiguity; attributing the message to
    // either would put it on the wrong person's history, so neither is used.
    if matched.len() != 1 {
        return Ok(None);
    }
    Ok(matched.into_iter().next())
}

async fn record_provider_message(
    state: &AppState,
    message: &WhatsAppMessage,
    channel: &str,
) -> Result<Option<InboundMessageContext>, AppError> {
    // Preferred anchor: the number the sender wrote to. It is provisioned by
    // the operator and identifies exactly one branch, so the sender cannot
    // influence which tenant's data answers them.
    if let Some((tenant_id, branch_id)) = receiving_branch(state, message).await? {
        let client_id = client_in_branch(state, &tenant_id, &branch_id, &message.sender).await?;
        // A client's message is still recorded on their communication history
        // exactly as before. A sender with no client record — a staff member
        // messaging their own branch — is routed without one.
        if let Some(client_id) = client_id.as_deref() {
            if !record_client_communication(state, &tenant_id, &branch_id, client_id, message, channel)
                .await?
            {
                return Ok(None);
            }
        }
        return Ok(Some(InboundMessageContext {
            tenant_id,
            branch_id,
            client_id,
        }));
    }

    // Fallback for channels that report no receiving identity (SMS) and for
    // numbers that have not been provisioned yet. This path is client-only: it
    // cannot resolve a staff sender, because doing so would mean choosing a
    // tenant from the sender's own phone number.
    let mut scopes: Vec<(String, String, String)> = Vec::new();
    if !message.context_message_id.is_empty() {
        scopes = sqlx::query_as(
            "SELECT tenant_id,branch_id,client_id FROM client_communications WHERE provider_message_id=$1 LIMIT 2",
        )
        .bind(&message.context_message_id)
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to resolve provider conversation"))?;
    }
    if scopes.is_empty() {
        let sender = message
            .sender
            .chars()
            .filter(|character| character.is_ascii_digit())
            .collect::<String>();
        scopes = sqlx::query_as(
            "SELECT tenant_id,branch_id,id FROM clients WHERE active=TRUE AND merged_into_client_id IS NULL AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g')=$1 ORDER BY tenant_id,branch_id,id LIMIT 2",
        )
        .bind(sender)
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to resolve message sender"))?;
    }
    if scopes.len() != 1 {
        return Ok(None);
    }
    let (tenant_id, branch_id, client_id) = &scopes[0];
    if !record_client_communication(state, tenant_id, branch_id, client_id, message, channel).await?
    {
        return Ok(None);
    }
    Ok(Some(InboundMessageContext {
        tenant_id: tenant_id.clone(),
        branch_id: branch_id.clone(),
        client_id: Some(client_id.clone()),
    }))
}

/// Writes the inbound message onto a client's communication history.
///
/// Returns `false` when the message was already recorded, which is how a
/// provider replay is dropped instead of answered twice.
async fn record_client_communication(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    message: &WhatsAppMessage,
    channel: &str,
) -> Result<bool, AppError> {
    let communication_id = Uuid::new_v4().to_string();
    let inserted = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO client_communications (
             id,tenant_id,branch_id,client_id,source_type,source_id,channel,direction,status,
             recipient,subject,body,provider_message_id,occurred_at,updated_at
           ) VALUES ($1,$2,$3,$4,'provider',$5,$6,'inbound','received',$7,INITCAP($6),$8,$5,NOW(),NOW())
           ON CONFLICT DO NOTHING RETURNING id"#,
    )
    .bind(&communication_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(&message.message_id)
    .bind(channel)
    .bind(&message.sender)
    .bind(&message.body)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to record inbound provider message"))?;
    if inserted.is_none() {
        return Ok(false);
    }
    sqlx::query(
        r#"INSERT INTO notifications (
             id,tenant_id,branch_id,notification_type,title,body,resource_type,resource_id,
             metadata_json,is_read,created_at,updated_at
           ) VALUES (gen_random_uuid()::TEXT,$1,$2,'inbound_message',INITCAP($3) || ' message',$4,
                     'client',$5,JSONB_BUILD_OBJECT('channel',$3,'communicationId',$6),FALSE,NOW(),NOW())"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(channel)
    .bind(&message.body)
    .bind(client_id)
    .bind(&communication_id)
    .execute(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to create inbound message notification"))?;
    Ok(true)
}

async fn respond_to_inbound_whatsapp(
    state: &AppState,
    message: &WhatsAppMessage,
    context: &InboundMessageContext,
) -> Result<(), AppError> {
    let response = ai_concierge_service::process_external_message(
        &state.db,
        &state.settings,
        &context.tenant_id,
        &context.branch_id,
        context.client_id.as_deref(),
        "whatsapp",
        &message.sender,
        // The sender's number identifies them; unknown numbers stay anonymous.
        &message.sender,
        "en-IN",
        &message.body,
        Some(&message.message_id),
    )
    .await?;
    let booking_url = response
        .action_payload
        .get("bookingUrl")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reply = if booking_url.is_empty() {
        response.assistant_message.body.clone()
    } else {
        format!("{}\n{}", response.assistant_message.body, booking_url)
    };
    let payload = serde_json::json!({
        "channel":"whatsapp",
        "recipient":message.sender,
        "message":reply,
        "templateKind":"ai_concierge"
    });
    benefit_notification_repository::enqueue(
        &state.db,
        NewBenefitDelivery {
            tenant_id: &context.tenant_id,
            branch_id: &context.branch_id,
            source_type: "ai_concierge",
            source_id: &response.assistant_message.id,
            client_id: context.client_id.as_deref().unwrap_or_default(),
            channel: "whatsapp",
            recipient: &message.sender,
            payload: &payload,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to queue AI WhatsApp reply"))?;
    Ok(())
}

fn verify_signature(headers: &HeaderMap, secret: &str, body: &[u8]) -> Result<(), AppError> {
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("sha256="))
        .and_then(hex_decode)
        .ok_or_else(|| AppError::forbidden("WhatsApp webhook signature is missing or invalid"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("invalid WhatsApp webhook secret"))?;
    mac.update(body);
    mac.verify_slice(&signature)
        .map_err(|_| AppError::forbidden("WhatsApp webhook signature verification failed"))
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[derive(Debug, FromRow)]
struct GatewayPaymentLink {
    id: String,
    tenant_id: String,
    branch_id: String,
    sale_id: String,
    amount_paise: i64,
    status: String,
}

#[derive(Debug, FromRow)]
struct GatewaySale {
    id: String,
    client_id: String,
    total_paise: i64,
    paid_paise: i64,
    status: String,
    finalized_at: Option<chrono::DateTime<chrono::Utc>>,
}

struct NormalizedGatewayEvent {
    provider: &'static str,
    event_type: String,
    provider_link_id: String,
    provider_payment_id: String,
    status: String,
    amount_paise: i64,
    method: String,
    paid_at: DateTime<Utc>,
    payload: Value,
    event_fingerprint: String,
}

async fn receive_cashfree_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let secret = state
        .settings
        .cashfree_client_secret
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Cashfree webhook is not configured",
            )
        })?;
    verify_cashfree_signature(&headers, secret, &body)?;
    let payload = serde_json::from_slice::<Value>(&body)
        .map_err(|_| AppError::validation("invalid Cashfree webhook payload"))?;
    let status = json_string(&payload, &["data", "link_status"]).to_ascii_lowercase();
    let amount_paise = json_decimal_paise(&payload, &["data", "link_amount_paid"]);
    let paid_at = provider_paid_at(
        &payload,
        &[
            "/data/transaction_time",
            "/data/payment_time",
            "/data/payment/transaction_time",
            "/data/payment/payment_time",
        ],
    );
    let event = NormalizedGatewayEvent {
        provider: "cashfree",
        event_type: json_string(&payload, &["type"]),
        provider_link_id: json_string(&payload, &["data", "link_id"]),
        provider_payment_id: json_string(&payload, &["data", "transaction_id"]),
        status,
        amount_paise,
        method: "bank_transfer".to_string(),
        paid_at,
        payload,
        event_fingerprint: format!("{:x}", Sha256::digest(&body)),
    };
    process_external_gateway_event(&state, event).await
}

async fn receive_phonepe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    verify_phonepe_authorization(&state, &headers)?;
    let payload = serde_json::from_slice::<Value>(&body)
        .map_err(|_| AppError::validation("invalid PhonePe webhook payload"))?;
    let raw_state = json_string(&payload, &["payload", "state"]).to_ascii_lowercase();
    let status = match raw_state.as_str() {
        "completed" => "paid".to_string(),
        "failed" => "failed".to_string(),
        value => value.to_string(),
    };
    let payment_details = payload
        .pointer("/payload/paymentDetails/0")
        .cloned()
        .unwrap_or(Value::Null);
    let method = gateway_payment_method(
        payment_details
            .get("paymentMode")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )
    .to_string();
    let paid_at = provider_paid_at(
        &payload,
        &[
            "/payload/paymentDetails/0/timestamp",
            "/payload/completionTime",
        ],
    );
    let event = NormalizedGatewayEvent {
        provider: "phonepe",
        event_type: json_string(&payload, &["event"]),
        provider_link_id: json_string(&payload, &["payload", "merchantOrderId"]),
        provider_payment_id: payment_details
            .get("transactionId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        status,
        amount_paise: json_i64(&payload, &["payload", "amount"]).unwrap_or_default(),
        method,
        paid_at,
        payload,
        event_fingerprint: format!("{:x}", Sha256::digest(&body)),
    };
    process_external_gateway_event(&state, event).await
}

async fn process_external_gateway_event(
    state: &AppState,
    event: NormalizedGatewayEvent,
) -> Result<Json<Value>, AppError> {
    if event.provider_link_id.is_empty() || event.event_type.is_empty() {
        return Ok(Json(
            serde_json::json!({ "received": true, "matched": false }),
        ));
    }
    let link = sqlx::query_as::<_, GatewayPaymentLink>(
        "SELECT id,tenant_id,branch_id,sale_id,amount_paise,status FROM pos_payment_links WHERE provider=$1 AND provider_link_id=$2",
    )
    .bind(event.provider)
    .bind(&event.provider_link_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to locate provider payment link"))?;
    let Some(link) = link else {
        return Ok(Json(
            serde_json::json!({ "received": true, "matched": false }),
        ));
    };
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start provider webhook transaction"))?;
    let event_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO pos_payment_events (id,tenant_id,branch_id,sale_id,payment_id,provider,provider_event_id,event_type,status,idempotency_key,payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$7,$9::jsonb) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.sale_id)
    .bind(&event.provider_payment_id)
    .bind(event.provider)
    .bind(&event.event_fingerprint)
    .bind(&event.event_type)
    .bind(event.payload.to_string())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record provider webhook"))?;
    let Some(event_id) = event_id else {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate provider webhook"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "duplicate": true }),
        ));
    };

    if event.status != "paid" {
        let next = match event.status.as_str() {
            "expired" | "cancelled" | "failed" => Some(event.status.as_str()),
            _ => None,
        };
        if let Some(status) = next {
            sqlx::query("UPDATE pos_payment_links SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'")
                .bind(&link.tenant_id).bind(&link.branch_id).bind(&link.id).bind(status).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to update provider link status"))?;
        }
        mark_gateway_event(&mut tx, &event_id, "processed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit provider webhook"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "processed": true }),
        ));
    }
    if event.provider_payment_id.is_empty() || event.amount_paise != link.amount_paise {
        if let Err(error) = pos_enterprise_service::record_payment_guard_mismatch(
            &mut tx,
            &link.tenant_id,
            &link.branch_id,
            &link.sale_id,
            &link.id,
            event.provider,
            link.amount_paise,
            event.amount_paise,
            !event.provider_payment_id.is_empty(),
        )
        .await
        {
            tracing::warn!(error = ?error, payment_link_id = link.id, "failed to record payment fraud risk");
        }
        mark_gateway_event(&mut tx, &event_id, "failed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit rejected provider webhook"))?;
        return Ok(Json(
            serde_json::json!({"received":true,"processed":false,"reason":"payment_identity_or_amount_mismatch"}),
        ));
    }
    let idempotency_key = format!("{}:{}", event.provider, event.provider_payment_id);
    let duplicate: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4)")
        .bind(&link.tenant_id).bind(&link.branch_id).bind(&link.sale_id).bind(&idempotency_key).fetch_one(&mut *tx).await.map_err(|_|AppError::internal("failed to verify provider payment idempotency"))?;
    if duplicate || link.status == "paid" {
        mark_gateway_event(&mut tx, &event_id, "ignored").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit duplicate provider payment"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "duplicate": true }),
        ));
    }
    let sale = sqlx::query_as::<_, GatewaySale>("SELECT id,client_id,total_paise,paid_paise,status,finalized_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(&link.tenant_id).bind(&link.branch_id).bind(&link.sale_id).fetch_optional(&mut *tx).await.map_err(|_|AppError::internal("failed to validate provider invoice"))?.ok_or_else(||AppError::not_found("provider invoice was not found"))?;
    if sale.finalized_at.is_none()
        || matches!(
            sale.status.as_str(),
            "draft" | "paid" | "voided" | "cancelled"
        )
        || sale.paid_paise.saturating_add(event.amount_paise) > sale.total_paise
    {
        mark_gateway_event(&mut tx, &event_id, "failed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit rejected provider payment"))?;
        return Ok(Json(
            serde_json::json!({"received":true,"processed":false,"reason":"invoice_not_collectable"}),
        ));
    }
    let payment_id = Uuid::new_v4().to_string();
    let label = match event.provider {
        "cashfree" => "Cashfree",
        "phonepe" => "PhonePe",
        _ => "Online",
    };
    sqlx::query("INSERT INTO pos_payments (id,tenant_id,branch_id,sale_id,method,amount_paise,method_reference,label,notes,idempotency_key,paid_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())")
        .bind(&payment_id).bind(&link.tenant_id).bind(&link.branch_id).bind(&link.sale_id).bind(&event.method).bind(event.amount_paise).bind(&event.provider_payment_id).bind(label).bind(format!("{} verified payment webhook",label)).bind(&idempotency_key).bind(event.paid_at.clone()).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to record provider POS payment"))?;
    let paid = sale.paid_paise.saturating_add(event.amount_paise);
    let sale_status = if paid >= sale.total_paise {
        "paid"
    } else {
        "partial"
    };
    sqlx::query("UPDATE pos_sales SET paid_paise=$4,status=$5,locked_at=CASE WHEN $5='paid' THEN COALESCE(locked_at,NOW()) ELSE locked_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&link.tenant_id).bind(&link.branch_id).bind(&sale.id).bind(paid).bind(sale_status).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to update provider invoice"))?;
    sqlx::query("UPDATE pos_payment_links SET status='paid',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&link.tenant_id).bind(&link.branch_id).bind(&link.id).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to settle provider payment link"))?;
    accounting_service::post_payment(
        &mut tx,
        &link.tenant_id,
        &link.branch_id,
        &payment_id,
        &event.method,
        event.amount_paise,
    )
    .await?;
    if sale_status == "paid" {
        settle_deferred_customer_commerce_benefits(
            &mut tx,
            &link.tenant_id,
            &link.branch_id,
            &sale.id,
        )
        .await?;
    }
    append_pos_invoice_event_from_gateway(&mut tx,&link.tenant_id,&link.branch_id,&sale.id,&format!("{}-webhook",event.provider),"payment.gateway_settled",serde_json::json!({"provider":event.provider,"providerPaymentId":event.provider_payment_id,"paymentLinkId":link.id,"amountPaise":event.amount_paise,"method":event.method,"paidAt":event.paid_at,"paidPaise":paid,"status":sale_status})).await?;
    mark_gateway_event(&mut tx, &event_id, "processed").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit provider payment"))?;
    Ok(Json(
        serde_json::json!({ "received": true, "processed": true }),
    ))
}

fn verify_cashfree_signature(
    headers: &HeaderMap,
    secret: &str,
    body: &[u8],
) -> Result<(), AppError> {
    let timestamp = headers
        .get("x-webhook-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::forbidden("Cashfree webhook timestamp is missing"))?;
    let timestamp_ms = timestamp
        .parse::<i64>()
        .map_err(|_| AppError::forbidden("Cashfree webhook timestamp is invalid"))?;
    if (chrono::Utc::now().timestamp_millis() - timestamp_ms).abs() > 300_000 {
        return Err(AppError::forbidden(
            "Cashfree webhook timestamp is outside the allowed window",
        ));
    }
    let signature = headers
        .get("x-webhook-signature")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| BASE64.decode(v).ok())
        .ok_or_else(|| AppError::forbidden("Cashfree webhook signature is missing or invalid"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("invalid Cashfree webhook secret"))?;
    mac.update(timestamp.as_bytes());
    mac.update(body);
    mac.verify_slice(&signature)
        .map_err(|_| AppError::forbidden("Cashfree webhook signature verification failed"))
}

fn verify_phonepe_authorization(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let username = state
        .settings
        .phonepe_webhook_username
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "PhonePe webhook is not configured",
            )
        })?;
    let password = state
        .settings
        .phonepe_webhook_password
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "PhonePe webhook is not configured",
            )
        })?;
    let actual = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    let expected = format!(
        "{:x}",
        Sha256::digest(format!("{username}:{password}").as_bytes())
    );
    let actual = actual
        .strip_prefix("SHA256(")
        .and_then(|v| v.strip_suffix(')'))
        .unwrap_or(actual);
    if !actual.eq_ignore_ascii_case(&expected) {
        return Err(AppError::forbidden("PhonePe webhook authorization failed"));
    }
    Ok(())
}

fn json_decimal_paise(payload: &Value, path: &[&str]) -> i64 {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .map(|value| match value {
            Value::Number(number) => number
                .as_f64()
                .map(|v| (v * 100.0).round() as i64)
                .unwrap_or(0),
            Value::String(text) => text
                .parse::<f64>()
                .map(|v| (v * 100.0).round() as i64)
                .unwrap_or(0),
            _ => 0,
        })
        .unwrap_or(0)
}

pub(crate) async fn receive_razorpay_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let secret = state
        .settings
        .razorpay_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Razorpay webhook is not configured",
            )
        })?;
    verify_razorpay_signature(&headers, secret, &body)?;
    let payload = serde_json::from_slice::<Value>(&body)
        .map_err(|_| AppError::validation("invalid Razorpay webhook payload"))?;
    let event_type = json_string(&payload, &["event"]);
    if event_type.starts_with("payment.dispute.") {
        return process_razorpay_dispute(&state, &event_type, payload).await;
    }
    let provider_link_id = json_string(&payload, &["payload", "payment_link", "entity", "id"]);
    if event_type.is_empty() || provider_link_id.is_empty() {
        return Ok(Json(
            serde_json::json!({ "received": true, "matched": false }),
        ));
    }
    let link = sqlx::query_as::<_, GatewayPaymentLink>(
        "SELECT id, tenant_id, branch_id, sale_id, amount_paise, status FROM pos_payment_links WHERE provider='razorpay' AND provider_link_id=$1",
    )
    .bind(&provider_link_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to locate Razorpay payment link"))?;
    let Some(link) = link else {
        return crate::routes::booking_extensions::settle_razorpay_booking_payment(
            &state,
            &event_type,
            &provider_link_id,
            &body,
            &payload,
        )
        .await;
    };
    let provider_event_id = format!("{:x}", Sha256::digest(&body));
    let provider_payment_id = json_string(&payload, &["payload", "payment", "entity", "id"]);
    let payload_text = payload.to_string();

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start Razorpay webhook transaction"))?;
    let inserted_event = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO pos_payment_events (
            id, tenant_id, branch_id, sale_id, payment_id, provider, provider_event_id,
            event_type, status, idempotency_key, payload_json
        ) VALUES ($1,$2,$3,$4,$5,'razorpay',$6,$7,'received',$6,$8::jsonb)
        ON CONFLICT DO NOTHING
        RETURNING id
        "#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.sale_id)
    .bind(&provider_payment_id)
    .bind(&provider_event_id)
    .bind(&event_type)
    .bind(&payload_text)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record Razorpay webhook"))?;
    let Some(event_id) = inserted_event else {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to complete duplicate Razorpay webhook"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "duplicate": true }),
        ));
    };

    if event_type != "payment_link.paid" {
        let next_status = match event_type.as_str() {
            "payment_link.expired" => Some("expired"),
            "payment_link.cancelled" => Some("cancelled"),
            _ => None,
        };
        if let Some(status) = next_status {
            sqlx::query(
                "UPDATE pos_payment_links SET status=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'",
            )
            .bind(&link.tenant_id)
            .bind(&link.branch_id)
            .bind(&link.id)
            .bind(status)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::internal("failed to update Razorpay payment link status"))?;
        }
        mark_gateway_event(&mut tx, &event_id, "processed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit Razorpay webhook"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "processed": true }),
        ));
    }

    let amount_paise = json_i64(&payload, &["payload", "payment", "entity", "amount"])
        .or_else(|| {
            json_i64(
                &payload,
                &["payload", "payment_link", "entity", "amount_paid"],
            )
        })
        .unwrap_or_default();
    if provider_payment_id.is_empty() || amount_paise != link.amount_paise {
        if let Err(error) = pos_enterprise_service::record_payment_guard_mismatch(
            &mut tx,
            &link.tenant_id,
            &link.branch_id,
            &link.sale_id,
            &link.id,
            "razorpay",
            link.amount_paise,
            amount_paise,
            !provider_payment_id.is_empty(),
        )
        .await
        {
            tracing::warn!(error = ?error, payment_link_id = link.id, "failed to record payment fraud risk");
        }
        mark_gateway_event(&mut tx, &event_id, "failed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit rejected Razorpay webhook"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "processed": false, "reason": "payment_identity_or_amount_mismatch" }),
        ));
    }

    let payment_idempotency_key = format!("razorpay:{provider_payment_id}");
    let existing_payment = sqlx::query_scalar::<_, String>(
        "SELECT id FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4",
    )
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.sale_id)
    .bind(&payment_idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to verify Razorpay payment idempotency"))?;
    if existing_payment.is_some() || link.status == "paid" {
        mark_gateway_event(&mut tx, &event_id, "ignored").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit duplicate Razorpay payment"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "duplicate": true }),
        ));
    }

    let sale = sqlx::query_as::<_, GatewaySale>(
        "SELECT id, client_id, total_paise, paid_paise, status, finalized_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.sale_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate paid invoice"))?;
    let Some(sale) = sale else {
        mark_gateway_event(&mut tx, &event_id, "failed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit unmatched Razorpay payment"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "processed": false, "reason": "invoice_not_found" }),
        ));
    };
    if sale.finalized_at.is_none()
        || matches!(
            sale.status.as_str(),
            "draft" | "paid" | "voided" | "cancelled"
        )
        || sale.paid_paise.saturating_add(amount_paise) > sale.total_paise
    {
        mark_gateway_event(&mut tx, &event_id, "failed").await?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit rejected Razorpay payment"))?;
        return Ok(Json(
            serde_json::json!({ "received": true, "processed": false, "reason": "invoice_not_collectable" }),
        ));
    }

    let method = gateway_payment_method(&json_string(
        &payload,
        &["payload", "payment", "entity", "method"],
    ));
    let paid_at = provider_paid_at(
        &payload,
        &[
            "/payload/payment/entity/created_at",
            "/payload/payment_link/entity/updated_at",
        ],
    );
    let payment_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO pos_payments (id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, paid_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())",
    )
    .bind(&payment_id)
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.sale_id)
    .bind(method)
    .bind(amount_paise)
    .bind(&provider_payment_id)
    .bind("Razorpay")
    .bind("Razorpay signed payment-link webhook")
    .bind(&payment_idempotency_key)
    .bind(paid_at.clone())
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record Razorpay POS payment"))?;
    record_razorpay_payment_instrument(
        &mut tx,
        &link.tenant_id,
        &link.branch_id,
        &sale.client_id,
        &payload,
    )
    .await?;
    let paid_paise = sale.paid_paise.saturating_add(amount_paise);
    let status = if paid_paise >= sale.total_paise {
        "paid"
    } else {
        "partial"
    };
    sqlx::query(
        "UPDATE pos_sales SET paid_paise=$4, status=$5, locked_at=CASE WHEN $5='paid' THEN COALESCE(locked_at, NOW()) ELSE locked_at END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&sale.id)
    .bind(paid_paise)
    .bind(status)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to update Razorpay invoice payment status"))?;
    sqlx::query(
        "UPDATE pos_payment_links SET status='paid', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&link.tenant_id)
    .bind(&link.branch_id)
    .bind(&link.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to settle Razorpay payment link"))?;
    accounting_service::post_payment(
        &mut tx,
        &link.tenant_id,
        &link.branch_id,
        &payment_id,
        method,
        amount_paise,
    )
    .await?;
    if status == "paid" {
        settle_deferred_customer_commerce_benefits(
            &mut tx,
            &link.tenant_id,
            &link.branch_id,
            &sale.id,
        )
        .await?;
    }
    append_pos_invoice_event_from_gateway(
        &mut tx,
        &link.tenant_id,
        &link.branch_id,
        &sale.id,
        "razorpay-webhook",
        "payment.gateway_settled",
        serde_json::json!({
            "provider": "razorpay",
            "providerPaymentId": provider_payment_id,
            "paymentLinkId": link.id,
            "amountPaise": amount_paise,
            "method": method,
            "paidAt": paid_at,
            "paidPaise": paid_paise,
            "status": status,
        }),
    )
    .await?;
    mark_gateway_event(&mut tx, &event_id, "processed").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit Razorpay payment"))?;
    Ok(Json(
        serde_json::json!({ "received": true, "processed": true }),
    ))
}

async fn process_razorpay_dispute(
    state: &AppState,
    event_type: &str,
    payload: Value,
) -> Result<Json<Value>, AppError> {
    let dispute_id = json_string(&payload, &["payload", "dispute", "entity", "id"]);
    let provider_payment_id =
        json_string(&payload, &["payload", "dispute", "entity", "payment_id"]);
    if dispute_id.is_empty() || provider_payment_id.is_empty() {
        return Ok(Json(serde_json::json!({"received":true,"matched":false})));
    }
    let payment = sqlx::query_as::<_, (String, String, String, String, String)>(
        r#"
        SELECT payment.id, payment.tenant_id, payment.branch_id, payment.sale_id, sale.client_id
          FROM pos_payments payment
          JOIN pos_sales sale
            ON sale.tenant_id=payment.tenant_id
           AND sale.branch_id=payment.branch_id
           AND sale.id=payment.sale_id
         WHERE payment.method_reference=$1
         ORDER BY payment.created_at DESC
         LIMIT 1
        "#,
    )
    .bind(&provider_payment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to locate disputed payment"))?;
    let Some((payment_id, tenant_id, branch_id, sale_id, client_id)) = payment else {
        return Ok(Json(serde_json::json!({"received":true,"matched":false})));
    };
    let raw_status = json_string(&payload, &["payload", "dispute", "entity", "status"]);
    let status = normalize_dispute_status(event_type, &raw_status);
    let amount_paise = json_i64(&payload, &["payload", "dispute", "entity", "amount"])
        .unwrap_or_default()
        .max(0);
    let reason = json_string(&payload, &["payload", "dispute", "entity", "reason"]);
    let currency = json_string(&payload, &["payload", "dispute", "entity", "currency"]);
    let evidence_due_at = json_i64(&payload, &["payload", "dispute", "entity", "respond_by"])
        .and_then(|value| chrono::DateTime::<Utc>::from_timestamp(value, 0));
    let resolved = matches!(status, "won" | "lost" | "closed");
    let payload_json = payload.to_string();
    let event_fingerprint = format!("{:x}", Sha256::digest(payload_json.as_bytes()));
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start dispute transaction"))?;
    let event_id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO pos_payment_events (
            id,tenant_id,branch_id,sale_id,payment_id,provider,provider_event_id,
            event_type,status,idempotency_key,payload_json
        ) VALUES ($1,$2,$3,$4,$5,'razorpay',$6,$7,'received',$6,$8::jsonb)
        ON CONFLICT DO NOTHING RETURNING id
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&sale_id)
    .bind(&payment_id)
    .bind(&event_fingerprint)
    .bind(event_type)
    .bind(&payload_json)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record dispute webhook"))?;
    let Some(event_id) = event_id else {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate dispute webhook"))?;
        return Ok(Json(serde_json::json!({"received":true,"duplicate":true})));
    };
    sqlx::query(
        r#"
        INSERT INTO payment_disputes (
            tenant_id,branch_id,sale_id,payment_id,client_id,provider,
            provider_dispute_id,provider_payment_id,amount_paise,currency,reason,status,
            evidence_due_at,payload_json,opened_at,resolved_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,'razorpay',$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
                  NOW(),CASE WHEN $14 THEN NOW() ELSE NULL END,NOW())
        ON CONFLICT (tenant_id,provider,provider_dispute_id)
        DO UPDATE SET status=EXCLUDED.status, amount_paise=EXCLUDED.amount_paise,
                      currency=EXCLUDED.currency, reason=EXCLUDED.reason,
                      evidence_due_at=EXCLUDED.evidence_due_at,
                      payload_json=EXCLUDED.payload_json,
                      resolved_at=CASE WHEN $14 THEN COALESCE(payment_disputes.resolved_at,NOW()) ELSE NULL END,
                      updated_at=NOW()
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&sale_id)
    .bind(&payment_id)
    .bind(&client_id)
    .bind(&dispute_id)
    .bind(&provider_payment_id)
    .bind(amount_paise)
    .bind(if currency.is_empty() { "INR" } else { &currency })
    .bind(&reason)
    .bind(status)
    .bind(evidence_due_at)
    .bind(payload_json)
    .bind(resolved)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record payment dispute"))?;
    append_pos_invoice_event_from_gateway(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale_id,
        "razorpay-dispute-webhook",
        "payment.dispute_updated",
        serde_json::json!({
            "provider":"razorpay",
            "providerDisputeId":dispute_id,
            "providerPaymentId":provider_payment_id,
            "status":status,
            "amountPaise":amount_paise
        }),
    )
    .await?;
    mark_gateway_event(&mut tx, &event_id, "processed").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payment dispute"))?;
    Ok(Json(
        serde_json::json!({"received":true,"processed":true,"status":status}),
    ))
}

async fn record_razorpay_payment_instrument(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    payload: &Value,
) -> Result<(), AppError> {
    let token_id = json_string(payload, &["payload", "payment", "entity", "token_id"]);
    if token_id.is_empty() {
        return Ok(());
    }
    let method = json_string(payload, &["payload", "payment", "entity", "method"]);
    if gateway_payment_method(&method) != "card" {
        return Ok(());
    }
    let last4 = normalize_card_last4(&json_string(
        payload,
        &["payload", "payment", "entity", "card", "last4"],
    ));
    let brand = json_string(
        payload,
        &["payload", "payment", "entity", "card", "network"],
    );
    let customer_id = json_string(payload, &["payload", "payment", "entity", "customer_id"]);
    let recurring =
        json_bool(payload, &["payload", "payment", "entity", "recurring"]).unwrap_or(false);
    let expiry_month = json_i64(
        payload,
        &["payload", "payment", "entity", "card", "expiry_month"],
    )
    .and_then(|value| i16::try_from(value).ok());
    let expiry_year = json_i64(
        payload,
        &["payload", "payment", "entity", "card", "expiry_year"],
    )
    .and_then(|value| i16::try_from(value).ok());
    sqlx::query(
        r#"
        INSERT INTO client_payment_instruments (
            tenant_id,branch_id,client_id,provider,provider_customer_id,
            provider_instrument_id,method_type,brand,last4,expiry_month,expiry_year,
            recurring_enabled,status,consent_source,consented_at,last_used_at,updated_at
        ) VALUES ($1,$2,$3,'razorpay',$4,$5,'card',$6,$7,$8,$9,$10,
                  CASE WHEN $10 THEN 'active' ELSE 'saved' END,
                  'provider_webhook',NOW(),NOW(),NOW())
        ON CONFLICT (tenant_id,provider,provider_instrument_id)
        DO UPDATE SET branch_id=EXCLUDED.branch_id,client_id=EXCLUDED.client_id,
                      provider_customer_id=EXCLUDED.provider_customer_id,
                      brand=EXCLUDED.brand,last4=EXCLUDED.last4,
                      expiry_month=EXCLUDED.expiry_month,expiry_year=EXCLUDED.expiry_year,
                      recurring_enabled=EXCLUDED.recurring_enabled,
                      status=CASE WHEN client_payment_instruments.status='revoked' THEN 'revoked' ELSE EXCLUDED.status END,
                      last_used_at=NOW(),updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(customer_id)
    .bind(token_id)
    .bind(brand)
    .bind(last4)
    .bind(expiry_month)
    .bind(expiry_year)
    .bind(recurring)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to save tokenized payment instrument"))?;
    Ok(())
}

fn normalize_dispute_status(event_type: &str, raw_status: &str) -> &'static str {
    let value = raw_status.trim().to_ascii_lowercase();
    if event_type.ends_with(".won") || value == "won" {
        "won"
    } else if event_type.ends_with(".lost") || value == "lost" {
        "lost"
    } else if event_type.ends_with(".closed") || value == "closed" {
        "closed"
    } else if matches!(value.as_str(), "under_review" | "under review") {
        "under_review"
    } else {
        "open"
    }
}

fn normalize_card_last4(value: &str) -> String {
    let digits = value.trim();
    if digits.len() == 4 && digits.chars().all(|character| character.is_ascii_digit()) {
        digits.to_string()
    } else {
        String::new()
    }
}

async fn mark_gateway_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
    status: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE pos_payment_events SET status=$2 WHERE id=$1")
        .bind(event_id)
        .bind(status)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to update Razorpay webhook event"))?;
    Ok(())
}

fn verify_razorpay_signature(
    headers: &HeaderMap,
    secret: &str,
    body: &[u8],
) -> Result<(), AppError> {
    let signature = headers
        .get("x-razorpay-signature")
        .and_then(|value| value.to_str().ok())
        .and_then(hex_decode)
        .ok_or_else(|| AppError::forbidden("Razorpay webhook signature is missing or invalid"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("invalid Razorpay webhook secret"))?;
    mac.update(body);
    mac.verify_slice(&signature)
        .map_err(|_| AppError::forbidden("Razorpay webhook signature verification failed"))
}

fn json_string(payload: &Value, path: &[&str]) -> String {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn json_i64(payload: &Value, path: &[&str]) -> Option<i64> {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .and_then(Value::as_i64)
}

fn provider_paid_at(payload: &Value, pointers: &[&str]) -> DateTime<Utc> {
    pointers
        .iter()
        .find_map(|pointer| payload.pointer(pointer).and_then(parse_provider_timestamp))
        .unwrap_or_else(Utc::now)
}

fn parse_provider_timestamp(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(raw) = value.as_i64().or_else(|| value.as_str()?.parse().ok()) {
        let (seconds, nanos) = if raw.abs() >= 1_000_000_000_000 {
            (
                raw.div_euclid(1_000),
                raw.rem_euclid(1_000) as u32 * 1_000_000,
            )
        } else {
            (raw, 0)
        };
        return Utc.timestamp_opt(seconds, nanos).single();
    }
    value
        .as_str()
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|value| value.with_timezone(&Utc))
}

#[cfg(test)]
mod payment_timestamp_tests {
    use super::parse_provider_timestamp;
    use serde_json::json;

    #[test]
    fn provider_timestamp_supports_epoch_seconds_millis_and_rfc3339() {
        let seconds = parse_provider_timestamp(&json!(1_700_000_000)).unwrap();
        let millis = parse_provider_timestamp(&json!(1_700_000_000_000_i64)).unwrap();
        let rfc3339 = parse_provider_timestamp(&json!("2023-11-14T22:13:20Z")).unwrap();
        assert_eq!(seconds, millis);
        assert_eq!(seconds, rfc3339);
    }
}

fn json_bool(payload: &Value, path: &[&str]) -> Option<bool> {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .and_then(Value::as_bool)
}

fn gateway_payment_method(raw: &str) -> &'static str {
    let value = raw.trim().to_ascii_lowercase();
    if value.starts_with("upi") {
        "upi"
    } else if value.contains("card") {
        "card"
    } else {
        "bank_transfer"
    }
}

#[cfg(test)]
mod payment_compliance_tests {
    use super::{normalize_card_last4, normalize_dispute_status};

    #[test]
    fn accepts_only_masked_card_identity_and_known_dispute_states() {
        assert_eq!(normalize_card_last4("4242"), "4242");
        assert_eq!(normalize_card_last4("4242424242424242"), "");
        assert_eq!(
            normalize_dispute_status("payment.dispute.won", "open"),
            "won"
        );
        assert_eq!(
            normalize_dispute_status("payment.dispute.created", "under_review"),
            "under_review"
        );
        assert_eq!(
            normalize_dispute_status("payment.dispute.created", "unknown"),
            "open"
        );
    }
}
