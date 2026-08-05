use chrono::{DateTime, Utc};
use reqwest::Method;
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
pub struct RemoteSubscriptionStatus {
    pub id: String,
    pub status: String,
    pub current_end: i64,
    pub paid_count: i64,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct PaymentRefund {
    pub provider_refund_id: String,
    pub status: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct SubscriptionPlan {
    pub provider_plan_id: String,
}

#[derive(Debug, Clone)]
pub struct SubscriptionCheckout {
    pub provider_subscription_id: String,
    pub status: String,
    pub short_url: String,
    pub current_start: i64,
    pub current_end: i64,
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

pub async fn create_subscription_plan(
    settings: &Settings,
    name: &str,
    billing_interval: &str,
    amount_paise: i64,
    local_plan_id: &str,
) -> Result<SubscriptionPlan, AppError> {
    if amount_paise <= 0 || !matches!(billing_interval, "monthly" | "yearly") {
        return Err(AppError::validation("invalid Razorpay subscription plan"));
    }
    let payload = request_json(
        settings,
        Method::POST,
        "/plans",
        Some(json!({
            "period": billing_interval,
            "interval": 1,
            "item": {"name": name, "amount": amount_paise, "currency": "INR"},
            "notes": {"saasPlanId": local_plan_id}
        })),
    )
    .await?;
    let id = required_provider_id(&payload, "plan_")?;
    Ok(SubscriptionPlan {
        provider_plan_id: id,
    })
}

/// What one billing cycle of a Razorpay plan actually costs.
///
/// Read back from Razorpay rather than from our own plan row. The two are
/// created from the same number, but only one of them is the number that gets
/// charged, and a quote built from the other is a quote that can drift.
pub async fn fetch_subscription_plan_amount(
    settings: &Settings,
    provider_plan_id: &str,
) -> Result<i64, AppError> {
    if !provider_plan_id.starts_with("plan_") {
        return Err(AppError::validation("invalid Razorpay plan reference"));
    }
    let payload = request_json(
        settings,
        Method::GET,
        &format!("/plans/{provider_plan_id}"),
        None,
    )
    .await?;
    payload
        .get("item")
        .and_then(|item| item.get("amount"))
        .and_then(Value::as_i64)
        .filter(|amount| *amount > 0)
        .ok_or_else(|| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay plan amount is unavailable",
            )
        })
}

/// Opens a Razorpay subscription, optionally under an Offer.
///
/// `offer_ref` is the whole of our coupon support. The discount is applied by
/// Razorpay against the offer, not calculated here and sent as an amount —
/// which is what keeps the price on the checkout screen and the amount on the
/// card from ever being two different numbers.
pub async fn create_subscription_checkout(
    settings: &Settings,
    provider_plan_id: &str,
    total_count: i32,
    tenant_id: &str,
    offer_ref: Option<&str>,
) -> Result<SubscriptionCheckout, AppError> {
    if !provider_plan_id.starts_with("plan_") || !(1..=120).contains(&total_count) {
        return Err(AppError::validation(
            "invalid Razorpay subscription checkout",
        ));
    }
    let offer_ref = offer_ref.map(str::trim).filter(|value| !value.is_empty());
    if offer_ref.is_some_and(|value| !value.starts_with("offer_")) {
        return Err(AppError::validation("invalid Razorpay offer reference"));
    }
    let mut body = json!({
        "plan_id": provider_plan_id,
        "total_count": total_count,
        "quantity": 1,
        "customer_notify": 1,
        "notes": {"saasTenantId": tenant_id}
    });
    if let Some(offer_ref) = offer_ref {
        body["offer_id"] = json!(offer_ref);
    }
    let payload = request_json(settings, Method::POST, "/subscriptions", Some(body)).await?;
    subscription_checkout(payload)
}

pub async fn update_subscription_plan(
    settings: &Settings,
    subscription_id: &str,
    provider_plan_id: &str,
    effective: &str,
) -> Result<SubscriptionCheckout, AppError> {
    if !provider_plan_id.starts_with("plan_") || !matches!(effective, "now" | "cycle_end") {
        return Err(AppError::validation("invalid Razorpay plan change"));
    }
    subscription_action(
        settings,
        Method::PATCH,
        subscription_id,
        "",
        json!({"plan_id":provider_plan_id,"schedule_change_at":effective,"customer_notify":1}),
    )
    .await
}

pub async fn pause_subscription(
    settings: &Settings,
    subscription_id: &str,
) -> Result<SubscriptionCheckout, AppError> {
    subscription_action(
        settings,
        Method::POST,
        subscription_id,
        "/pause",
        json!({"pause_at":"now"}),
    )
    .await
}

pub async fn resume_subscription(
    settings: &Settings,
    subscription_id: &str,
) -> Result<SubscriptionCheckout, AppError> {
    subscription_action(
        settings,
        Method::POST,
        subscription_id,
        "/resume",
        json!({"resume_at":"now"}),
    )
    .await
}

pub async fn cancel_subscription(
    settings: &Settings,
    subscription_id: &str,
    at_cycle_end: bool,
) -> Result<SubscriptionCheckout, AppError> {
    subscription_action(
        settings,
        Method::POST,
        subscription_id,
        "/cancel",
        json!({"cancel_at_cycle_end":at_cycle_end}),
    )
    .await
}

async fn subscription_action(
    settings: &Settings,
    method: Method,
    subscription_id: &str,
    suffix: &str,
    body: Value,
) -> Result<SubscriptionCheckout, AppError> {
    if !subscription_id.starts_with("sub_") {
        return Err(AppError::validation(
            "invalid Razorpay subscription reference",
        ));
    }
    let payload = request_json(
        settings,
        method,
        &format!("/subscriptions/{subscription_id}{suffix}"),
        Some(body),
    )
    .await?;
    subscription_checkout(payload)
}

async fn request_json(
    settings: &Settings,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, AppError> {
    let (key_id, key_secret) = credentials(settings)?;
    let mut request = reqwest::Client::new()
        .request(method, format!("{RAZORPAY_API_BASE}{path}"))
        .basic_auth(key_id, Some(key_secret));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay subscription request failed",
        )
    })?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay returned an invalid subscription response",
        )
    })?;
    if !status.is_success() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            payload
                .pointer("/error/description")
                .and_then(Value::as_str)
                .unwrap_or("Razorpay subscription request was rejected"),
        ));
    }
    Ok(payload)
}

fn subscription_checkout(payload: Value) -> Result<SubscriptionCheckout, AppError> {
    let id = required_provider_id(&payload, "sub_")?;
    Ok(SubscriptionCheckout {
        provider_subscription_id: id,
        status: payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        short_url: payload
            .get("short_url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        current_start: payload
            .get("current_start")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        current_end: payload
            .get("current_end")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    })
}

fn required_provider_id(payload: &Value, prefix: &str) -> Result<String, AppError> {
    let id = payload.get("id").and_then(Value::as_str).unwrap_or("");
    if !id.starts_with(prefix) {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay subscription response is incomplete",
        ));
    }
    Ok(id.to_string())
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

pub async fn fetch_subscription(
    settings: &Settings,
    subscription_id: &str,
) -> Result<RemoteSubscriptionStatus, AppError> {
    if !subscription_id.trim().starts_with("sub_") {
        return Err(AppError::validation(
            "auto-renew payment reference must be a Razorpay subscription id",
        ));
    }
    let (key_id, key_secret) = credentials(settings)?;
    let response = reqwest::Client::new()
        .get(format!(
            "{RAZORPAY_API_BASE}/subscriptions/{subscription_id}"
        ))
        .basic_auth(key_id, Some(key_secret))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay subscription reconciliation failed",
            )
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.map_err(|_| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay returned an invalid subscription response",
        )
    })?;
    if !status.is_success() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay subscription reconciliation was rejected",
        ));
    }
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if id != subscription_id {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_UNAVAILABLE",
            "Razorpay subscription response is incomplete",
        ));
    }
    Ok(RemoteSubscriptionStatus {
        id,
        status: payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        current_end: payload
            .get("current_end")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        paid_count: payload
            .get("paid_count")
            .and_then(Value::as_i64)
            .unwrap_or(0),
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
    use super::{subscription_checkout, valid_refund_idempotency_key};
    use serde_json::json;

    #[test]
    fn razorpay_refund_idempotency_key_is_provider_safe() {
        assert!(valid_refund_idempotency_key("refund-1234567890"));
        assert!(!valid_refund_idempotency_key("short"));
        assert!(!valid_refund_idempotency_key("invalid key!"));
    }

    #[test]
    fn subscription_response_requires_provider_identity() {
        let parsed = subscription_checkout(
            json!({"id":"sub_123","status":"created","short_url":"https://rzp.io/i/x"}),
        )
        .unwrap();
        assert_eq!(parsed.provider_subscription_id, "sub_123");
        assert!(subscription_checkout(json!({"id":"pay_123"})).is_err());
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
