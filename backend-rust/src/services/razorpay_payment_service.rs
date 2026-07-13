use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{config::Settings, models::common::AppError};

const RAZORPAY_API_BASE: &str = "https://api.razorpay.com/v1";

#[derive(Debug)]
pub struct CreatePaymentLink {
    pub reference_id: String,
    pub amount_paise: i64,
    pub description: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub notes: Value,
}

#[derive(Debug, Clone)]
pub struct PaymentLink {
    pub provider_link_id: String,
    pub short_url: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct RemotePaymentLinkStatus {
    pub status: String,
    pub amount_paid: i64,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct PaymentRefund {
    pub provider_refund_id: String,
    pub status: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
struct RazorpayLinkResponse {
    id: String,
    short_url: Option<String>,
    status: Option<String>,
    amount_paid: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RazorpayRefundResponse {
    id: String,
    status: Option<String>,
}

pub async fn create_payment_refund(
    settings: &Settings,
    provider_payment_id: &str,
    amount_paise: i64,
    idempotency_key: &str,
    receipt: &str,
) -> Result<PaymentRefund, AppError> {
    if amount_paise <= 0 || !valid_refund_idempotency_key(idempotency_key) {
        return Err(AppError::validation("invalid Razorpay refund request"));
    }
    let (key_id, key_secret) = credentials(settings)?;
    let response = reqwest::Client::new()
        .post(format!(
            "{RAZORPAY_API_BASE}/payments/{provider_payment_id}/refund"
        ))
        .basic_auth(key_id, Some(key_secret))
        .header("X-Refund-Idempotency", idempotency_key)
        .json(&json!({ "amount": amount_paise, "receipt": receipt }))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay refund request failed",
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay returned an invalid refund response",
        )
    })?;
    if !status.is_success() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay refund request was rejected",
        ));
    }
    let parsed =
        serde_json::from_value::<RazorpayRefundResponse>(payload.clone()).map_err(|_| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay refund response is incomplete",
            )
        })?;
    if parsed.id.trim().is_empty() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay refund response is incomplete",
        ));
    }
    Ok(PaymentRefund {
        provider_refund_id: parsed.id,
        status: parsed.status.unwrap_or_default(),
        payload,
    })
}

pub async fn create_payment_link(
    settings: &Settings,
    request: CreatePaymentLink,
) -> Result<PaymentLink, AppError> {
    let (key_id, key_secret) = credentials(settings)?;
    let mut body = json!({
        "amount": request.amount_paise,
        "currency": "INR",
        "reference_id": request.reference_id,
        "description": request.description,
        "accept_partial": false,
        "notes": request.notes,
    });
    if let Some(expires_at) = request.expires_at {
        body["expire_by"] = json!(expires_at.timestamp());
    }

    let response = reqwest::Client::new()
        .post(format!("{RAZORPAY_API_BASE}/payment_links"))
        .basic_auth(key_id, Some(key_secret))
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay payment link request failed",
            )
        })?;
    parse_link_response(response).await
}

pub async fn fetch_payment_link(
    settings: &Settings,
    provider_link_id: &str,
) -> Result<RemotePaymentLinkStatus, AppError> {
    let (key_id, key_secret) = credentials(settings)?;
    let response = reqwest::Client::new()
        .get(format!(
            "{RAZORPAY_API_BASE}/payment_links/{provider_link_id}"
        ))
        .basic_auth(key_id, Some(key_secret))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay reconciliation request failed",
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay returned an invalid reconciliation response",
        )
    })?;
    if !status.is_success() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay reconciliation request was rejected",
        ));
    }
    let parsed = serde_json::from_value::<RazorpayLinkResponse>(payload.clone()).map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay reconciliation response is incomplete",
        )
    })?;
    Ok(RemotePaymentLinkStatus {
        status: parsed.status.unwrap_or_default(),
        amount_paid: parsed.amount_paid.unwrap_or(0),
        payload,
    })
}

fn credentials(settings: &Settings) -> Result<(&str, &str), AppError> {
    match (
        settings.razorpay_key_id.as_deref(),
        settings.razorpay_key_secret.as_deref(),
    ) {
        (Some(key_id), Some(key_secret)) => Ok((key_id, key_secret)),
        _ => Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "Razorpay payment links are not configured",
        )),
    }
}

fn valid_refund_idempotency_key(value: &str) -> bool {
    value.len() >= 10
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

#[cfg(test)]
mod tests {
    use super::valid_refund_idempotency_key;

    #[test]
    fn razorpay_refund_idempotency_key_is_provider_safe() {
        assert!(valid_refund_idempotency_key("refund-1234567890"));
        assert!(!valid_refund_idempotency_key("short"));
        assert!(!valid_refund_idempotency_key("invalid key!"));
    }
}

async fn parse_link_response(response: reqwest::Response) -> Result<PaymentLink, AppError> {
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay returned an invalid payment link response",
        )
    })?;
    if !status.is_success() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay payment link request was rejected",
        ));
    }
    let parsed = serde_json::from_value::<RazorpayLinkResponse>(payload.clone()).map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay payment link response is incomplete",
        )
    })?;
    if parsed.id.trim().is_empty()
        || parsed
            .short_url
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay payment link response is incomplete",
        ));
    }
    Ok(PaymentLink {
        provider_link_id: parsed.id,
        short_url: parsed.short_url.unwrap_or_default(),
        payload,
    })
}
