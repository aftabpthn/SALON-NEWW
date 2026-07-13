use axum::{
    body::Bytes,
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::FromRow;

use crate::{
    models::common::AppError, routes::pos::append_pos_invoice_event_from_gateway,
    services::accounting_service, state::AppState,
};

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/webhooks/whatsapp",
            get(verify_whatsapp_webhook).post(receive_whatsapp_webhook),
        )
        .route(
            "/webhooks/razorpay",
            axum::routing::post(receive_razorpay_webhook),
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
    }
    Ok(Json(
        serde_json::json!({ "received": true, "updated": updated }),
    ))
}

struct WhatsAppStatus {
    message_id: String,
    status: String,
    error: String,
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
    total_paise: i64,
    paid_paise: i64,
    status: String,
    finalized_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn receive_razorpay_webhook(
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
        return Ok(Json(
            serde_json::json!({ "received": true, "matched": false }),
        ));
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
        "SELECT id, total_paise, paid_paise, status, finalized_at FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
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
    let payment_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO pos_payments (id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())",
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
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record Razorpay POS payment"))?;
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

fn gateway_payment_method(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "upi" => "upi",
        "card" => "card",
        _ => "bank_transfer",
    }
}
