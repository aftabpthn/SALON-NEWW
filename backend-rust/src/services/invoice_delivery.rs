use lettre::{
    message::{header::ContentType, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde_json::Value;

use crate::{config::Settings, models::common::AppError};

pub async fn deliver(settings: &Settings, payload: &Value) -> Result<String, AppError> {
    if payload.get("channel").and_then(Value::as_str) == Some("whatsapp")
        && (settings.whatsapp_cloud_enabled() || settings.whatsapp_benefit_enabled())
    {
        return deliver_whatsapp_cloud(settings, payload).await;
    }
    if payload.get("channel").and_then(Value::as_str) == Some("email")
        && settings.smtp_email_enabled()
    {
        return deliver_smtp(settings, payload).await;
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

async fn deliver_smtp(settings: &Settings, payload: &Value) -> Result<String, AppError> {
    let required = |name| {
        payload
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::validation(format!("email {name} is required")))
    };
    let recipient = required("recipient")?;
    let subject = required("subject")?;
    let body = required("message")?;
    let from = settings.smtp_from.as_deref().unwrap_or_default();
    let mut builder = Message::builder()
        .from(
            from.parse()
                .map_err(|_| AppError::validation("SMTP_FROM is invalid"))?,
        )
        .to(recipient
            .parse()
            .map_err(|_| AppError::validation("email recipient is invalid"))?)
        .subject(subject);
    if let Some(value) = payload
        .get("messageId")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        builder = builder.message_id(Some(value.to_string()));
    }
    if let Some(value) = payload
        .get("inReplyTo")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        builder = builder.in_reply_to(value.to_string());
    }
    if let Some(value) = payload
        .get("references")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        builder = builder.references(value.to_string());
    }
    let message = if let Some(html) = payload
        .get("html")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder.multipart(
            MultiPart::alternative()
                .singlepart(SinglePart::plain(body.to_string()))
                .singlepart(
                    SinglePart::builder()
                        .header(ContentType::TEXT_HTML)
                        .body(html.to_string()),
                ),
        )
    } else {
        builder.body(body.to_string())
    }
    .map_err(|_| AppError::validation("email message is invalid"))?;
    let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(
        settings.smtp_host.as_deref().unwrap_or_default(),
    )
    .map_err(|_| {
        AppError::service_unavailable(
            "DELIVERY_NOT_CONFIGURED",
            "SMTP delivery provider is invalid",
        )
    })?
    .port(settings.smtp_port)
    .credentials(Credentials::new(
        settings.smtp_username.clone().unwrap_or_default(),
        settings.smtp_password.clone().unwrap_or_default(),
    ))
    .build();
    let response = transport.send(message).await.map_err(|_| {
        AppError::service_unavailable(
            "DELIVERY_UNAVAILABLE",
            "SMTP delivery provider is unavailable",
        )
    })?;
    Ok(extract_smtp_message_id(
        response.first_line().unwrap_or_default(),
    ))
}

fn extract_smtp_message_id(response: &str) -> String {
    response
        .split_ascii_whitespace()
        .last()
        .filter(|value| !value.eq_ignore_ascii_case("ok"))
        .unwrap_or_default()
        .to_string()
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
    let template_name = if payload.get("templateKind").and_then(Value::as_str) == Some("benefit") {
        settings.whatsapp_benefit_template_name.as_deref()
    } else {
        settings.whatsapp_invoice_template_name.as_deref()
    };
    let template_name = template_name.unwrap_or_default();
    let url = format!("https://graph.facebook.com/v20.0/{phone_number_id}/messages");
    let request_body =
        if payload.get("templateKind").and_then(Value::as_str) == Some("conversation") {
            let body = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if body.is_empty() {
                return Err(AppError::validation("WhatsApp message is required"));
            }
            serde_json::json!({
                "messaging_product": "whatsapp",
                "to": recipient,
                "type": "text",
                "text": { "preview_url": false, "body": body }
            })
        } else {
            serde_json::json!({
                "messaging_product": "whatsapp",
                "to": recipient,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": { "code": "en_US" }
                }
            })
        };
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .json(&request_body)
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

#[cfg(test)]
mod tests {
    use super::extract_smtp_message_id;

    #[test]
    fn extracts_aws_ses_message_id() {
        assert_eq!(
            extract_smtp_message_id(
                "Ok 01000190f1a2b3c4-12345678-90ab-cdef-1234-567890abcdef-000000"
            ),
            "01000190f1a2b3c4-12345678-90ab-cdef-1234-567890abcdef-000000"
        );
    }
}
