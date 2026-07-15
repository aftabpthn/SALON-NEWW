use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::{
    config::Settings,
    models::common::AppError,
    services::razorpay_payment_service::{self, PaymentLink, RemotePaymentLinkStatus},
};

pub struct CreatePaymentLink {
    pub reference_id: String,
    pub amount_paise: i64,
    pub description: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub notes: Value,
    pub customer_name: String,
    pub customer_phone: String,
    pub customer_email: String,
}

pub async fn create_payment_link(
    settings: &Settings,
    provider: &str,
    request: CreatePaymentLink,
) -> Result<PaymentLink, AppError> {
    match provider {
        "razorpay" => {
            razorpay_payment_service::create_payment_link(
                settings,
                razorpay_payment_service::CreatePaymentLink {
                    reference_id: request.reference_id,
                    amount_paise: request.amount_paise,
                    description: request.description,
                    expires_at: request.expires_at,
                    notes: request.notes,
                },
            )
            .await
        }
        "cashfree" => create_cashfree_link(settings, request).await,
        "phonepe" => create_phonepe_link(settings, request).await,
        _ => Err(AppError::validation(
            "provider must be razorpay, cashfree, or phonepe",
        )),
    }
}

pub async fn fetch_payment_link(
    settings: &Settings,
    provider: &str,
    provider_link_id: &str,
) -> Result<RemotePaymentLinkStatus, AppError> {
    match provider {
        "razorpay" => {
            razorpay_payment_service::fetch_payment_link(settings, provider_link_id).await
        }
        "cashfree" => fetch_cashfree_link(settings, provider_link_id).await,
        "phonepe" => fetch_phonepe_order(settings, provider_link_id).await,
        _ => Err(AppError::validation("unsupported payment provider")),
    }
}

async fn create_cashfree_link(
    settings: &Settings,
    request: CreatePaymentLink,
) -> Result<PaymentLink, AppError> {
    let (client_id, secret) = cashfree_credentials(settings)?;
    if request.customer_phone.trim().len() < 8 {
        return Err(AppError::validation(
            "Cashfree payment links require a client phone number with country code",
        ));
    }
    let mut customer = json!({
        "customer_name": request.customer_name,
        "customer_phone": request.customer_phone,
    });
    if !request.customer_email.trim().is_empty() {
        customer["customer_email"] = json!(request.customer_email);
    }
    let mut body = json!({
        "link_id": request.reference_id,
        "link_amount": request.amount_paise as f64 / 100.0,
        "link_currency": "INR",
        "link_purpose": request.description,
        "link_partial_payments": false,
        "customer_details": customer,
        "link_notes": request.notes,
    });
    if let Some(expires_at) = request.expires_at {
        body["link_expiry_time"] = json!(expires_at.to_rfc3339());
    }
    let response = reqwest::Client::new()
        .post(format!("{}/links", cashfree_base(settings)))
        .header("x-api-version", "2025-01-01")
        .header("x-client-id", client_id)
        .header("x-client-secret", secret)
        .json(&body)
        .send()
        .await
        .map_err(|_| provider_unavailable("Cashfree payment link request failed"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| provider_unavailable("Cashfree returned an invalid payment link response"))?;
    if !status.is_success() {
        return Err(provider_unavailable(
            "Cashfree payment link request was rejected",
        ));
    }
    let id = payload.get("link_id").and_then(Value::as_str).unwrap_or("");
    let url = payload
        .get("link_url")
        .and_then(Value::as_str)
        .unwrap_or("");
    if id.is_empty() || url.is_empty() {
        return Err(provider_unavailable(
            "Cashfree payment link response is incomplete",
        ));
    }
    Ok(PaymentLink {
        provider_link_id: id.to_string(),
        short_url: url.to_string(),
        payload,
    })
}

async fn fetch_cashfree_link(
    settings: &Settings,
    link_id: &str,
) -> Result<RemotePaymentLinkStatus, AppError> {
    let (client_id, secret) = cashfree_credentials(settings)?;
    let response = reqwest::Client::new()
        .get(format!("{}/links/{link_id}", cashfree_base(settings)))
        .header("x-api-version", "2025-01-01")
        .header("x-client-id", client_id)
        .header("x-client-secret", secret)
        .send()
        .await
        .map_err(|_| provider_unavailable("Cashfree reconciliation request failed"))?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        provider_unavailable("Cashfree returned an invalid reconciliation response")
    })?;
    if !status.is_success() {
        return Err(provider_unavailable(
            "Cashfree reconciliation request was rejected",
        ));
    }
    Ok(RemotePaymentLinkStatus {
        status: payload
            .get("link_status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase(),
        amount_paid: rupees_to_paise(payload.get("link_amount_paid")),
        payload,
    })
}

async fn create_phonepe_link(
    settings: &Settings,
    request: CreatePaymentLink,
) -> Result<PaymentLink, AppError> {
    if request.amount_paise < 100 {
        return Err(AppError::validation(
            "PhonePe payment amount must be at least 100 paise",
        ));
    }
    let token = phonepe_token(settings).await?;
    let redirect_url = settings.payment_return_url.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "PhonePe return URL is not configured",
        )
    })?;
    let expire_after = request
        .expires_at
        .map(|value| (value - Utc::now()).num_seconds().clamp(300, 3600))
        .unwrap_or(1200);
    let body = json!({
        "merchantOrderId": request.reference_id,
        "amount": request.amount_paise,
        "expireAfter": expire_after,
        "paymentFlow": {"type":"PG_CHECKOUT","message":request.description,"merchantUrls":{"redirectUrl":redirect_url}},
        "metaInfo": {"udf1": request.notes.get("localPaymentLinkId").and_then(Value::as_str).unwrap_or("")}
    });
    let response = reqwest::Client::new()
        .post(format!("{}/checkout/v2/pay", phonepe_pg_base(settings)))
        .header("Authorization", format!("O-Bearer {token}"))
        .json(&body)
        .send()
        .await
        .map_err(|_| provider_unavailable("PhonePe payment request failed"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| provider_unavailable("PhonePe returned an invalid payment response"))?;
    if !status.is_success() {
        return Err(provider_unavailable("PhonePe payment request was rejected"));
    }
    let url = payload
        .get("redirectUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.is_empty() {
        return Err(provider_unavailable(
            "PhonePe payment response is incomplete",
        ));
    }
    Ok(PaymentLink {
        provider_link_id: request.reference_id,
        short_url: url.to_string(),
        payload,
    })
}

async fn fetch_phonepe_order(
    settings: &Settings,
    merchant_order_id: &str,
) -> Result<RemotePaymentLinkStatus, AppError> {
    let token = phonepe_token(settings).await?;
    let response = reqwest::Client::new()
        .get(format!(
            "{}/checkout/v2/order/{merchant_order_id}/status?details=false",
            phonepe_pg_base(settings)
        ))
        .header("Authorization", format!("O-Bearer {token}"))
        .send()
        .await
        .map_err(|_| provider_unavailable("PhonePe reconciliation request failed"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| provider_unavailable("PhonePe returned an invalid reconciliation response"))?;
    if !status.is_success() {
        return Err(provider_unavailable(
            "PhonePe reconciliation request was rejected",
        ));
    }
    let state = payload
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let amount = if state == "completed" {
        payload.get("amount").and_then(Value::as_i64).unwrap_or(0)
    } else {
        0
    };
    Ok(RemotePaymentLinkStatus {
        status: match state.as_str() {
            "completed" => "paid".into(),
            "failed" => "failed".into(),
            other => other.into(),
        },
        amount_paid: amount,
        payload,
    })
}

async fn phonepe_token(settings: &Settings) -> Result<String, AppError> {
    let client_id = settings
        .phonepe_client_id
        .as_deref()
        .ok_or_else(|| provider_not_configured("PhonePe"))?;
    let client_secret = settings
        .phonepe_client_secret
        .as_deref()
        .ok_or_else(|| provider_not_configured("PhonePe"))?;
    let client_version = settings
        .phonepe_client_version
        .as_deref()
        .ok_or_else(|| provider_not_configured("PhonePe"))?;
    let response = reqwest::Client::new()
        .post(phonepe_identity_url(settings))
        .form(&[
            ("client_id", client_id),
            ("client_version", client_version),
            ("client_secret", client_secret),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|_| provider_unavailable("PhonePe authorization request failed"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| provider_unavailable("PhonePe returned an invalid authorization response"))?;
    if !status.is_success() {
        return Err(provider_unavailable(
            "PhonePe authorization request was rejected",
        ));
    }
    payload
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| provider_unavailable("PhonePe authorization response is incomplete"))
}

fn cashfree_credentials(settings: &Settings) -> Result<(&str, &str), AppError> {
    match (
        settings.cashfree_client_id.as_deref(),
        settings.cashfree_client_secret.as_deref(),
    ) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(provider_not_configured("Cashfree")),
    }
}
fn cashfree_base(settings: &Settings) -> &'static str {
    if settings.payment_provider_environment == "sandbox" {
        "https://sandbox.cashfree.com/pg"
    } else {
        "https://api.cashfree.com/pg"
    }
}
fn phonepe_identity_url(settings: &Settings) -> &'static str {
    if settings.payment_provider_environment == "sandbox" {
        "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token"
    } else {
        "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    }
}
fn phonepe_pg_base(settings: &Settings) -> &'static str {
    if settings.payment_provider_environment == "sandbox" {
        "https://api-preprod.phonepe.com/apis/pg-sandbox"
    } else {
        "https://api.phonepe.com/apis/pg"
    }
}
fn provider_not_configured(provider: &str) -> AppError {
    AppError::service_unavailable(
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        format!("{provider} payment provider is not configured"),
    )
}
fn provider_unavailable(message: &str) -> AppError {
    AppError::service_unavailable("PAYMENT_PROVIDER_UNAVAILABLE", message)
}
fn rupees_to_paise(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(number)) => number
            .as_f64()
            .map(|v| (v * 100.0).round() as i64)
            .unwrap_or(0),
        Some(Value::String(text)) => text
            .parse::<f64>()
            .map(|v| (v * 100.0).round() as i64)
            .unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::rupees_to_paise;
    use serde_json::json;
    #[test]
    fn cashfree_rupees_are_converted_to_paise() {
        assert_eq!(rupees_to_paise(Some(&json!("55.25"))), 5525);
        assert_eq!(rupees_to_paise(Some(&json!(10.01))), 1001);
    }
}
