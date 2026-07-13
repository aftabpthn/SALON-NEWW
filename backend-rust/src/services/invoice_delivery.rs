use serde_json::Value;

use crate::{config::Settings, models::common::AppError};

pub async fn deliver(settings: &Settings, payload: &Value) -> Result<String, AppError> {
    if payload.get("channel").and_then(Value::as_str) == Some("whatsapp")
        && settings.whatsapp_cloud_enabled()
    {
        return deliver_whatsapp_cloud(settings, payload).await;
    }
    let url = settings
        .invoice_delivery_webhook_url
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "DELIVERY_NOT_CONFIGURED",
                "invoice delivery provider is not configured",
            )
        })?;
    let client = reqwest::Client::new();
    let mut request = client.post(url).json(payload);
    if let Some(token) = settings.invoice_delivery_webhook_token.as_deref() {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|_| {
        AppError::service_unavailable(
            "DELIVERY_UNAVAILABLE",
            "invoice delivery provider is unavailable",
        )
    })?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "DELIVERY_REJECTED",
            "invoice delivery provider rejected the request",
        ));
    }
    Ok(response
        .headers()
        .get("x-message-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string())
}

async fn deliver_whatsapp_cloud(settings: &Settings, payload: &Value) -> Result<String, AppError> {
    let recipient = payload
        .get("recipient")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if recipient.len() < 8 {
        return Err(AppError::validation(
            "WhatsApp recipient must be a phone number with country code",
        ));
    }
    let phone_number_id = settings
        .whatsapp_cloud_phone_number_id
        .as_deref()
        .unwrap_or_default();
    let access_token = settings
        .whatsapp_cloud_access_token
        .as_deref()
        .unwrap_or_default();
    let template_name = settings
        .whatsapp_invoice_template_name
        .as_deref()
        .unwrap_or_default();
    let url = format!("https://graph.facebook.com/v20.0/{phone_number_id}/messages");
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": {
                "name": template_name,
                "language": { "code": "en_US" }
            }
        }))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "WHATSAPP_UNAVAILABLE",
                "WhatsApp Cloud API is unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "WHATSAPP_REJECTED",
            "WhatsApp Cloud API rejected the invoice template",
        ));
    }
    let body = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "WHATSAPP_INVALID_RESPONSE",
            "WhatsApp Cloud API returned an invalid response",
        )
    })?;
    body.get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.first())
        .and_then(|message| message.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| {
            AppError::service_unavailable(
                "WHATSAPP_INVALID_RESPONSE",
                "WhatsApp Cloud API did not return a message id",
            )
        })
}
