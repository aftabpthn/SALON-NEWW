use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{config::Settings, models::common::AppError};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingRequest {
    pub provider: String,
    pub country: String,
    pub currency: String,
    pub business_type: String,
    pub business_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingResult {
    pub provider_account_id: String,
    pub legal_entity_id: String,
    pub onboarding_url: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequest {
    pub amount_paise: i64,
    pub currency: String,
    pub reference: String,
    pub return_url: Option<String>,
    pub provider_payment_method_id: Option<String>,
    pub provider_customer_id: Option<String>,
    pub payment_method: Option<Value>,
    #[serde(default)]
    pub store_payment_method: bool,
    #[serde(default)]
    pub recurring: bool,
    pub application_fee_paise: Option<i64>,
    pub capture_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    pub currency: String,
    pub reference: String,
    pub provider_customer_id: Option<String>,
    pub return_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutRequest {
    pub amount_paise: i64,
    pub currency: String,
    pub reference: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentModification {
    pub provider_action_id: String,
    pub status: String,
    pub payload: Value,
}

pub async fn create_onboarding(
    settings: &Settings,
    request: &OnboardingRequest,
    existing_account_id: Option<&str>,
) -> Result<OnboardingResult, AppError> {
    validate_country_currency(&request.country, &request.currency)?;
    let return_url = configured_return_url(settings)?;
    match request.provider.as_str() {
        "stripe" => {
            let account = match existing_account_id.filter(|id| !id.is_empty()) {
                Some(id) => id.to_string(),
                None => {
                    let fields = vec![
                        ("type", "express".to_string()),
                        ("country", request.country.to_ascii_uppercase()),
                        (
                            "business_type",
                            stripe_business_type(&request.business_type)?.into(),
                        ),
                        (
                            "business_profile[name]",
                            request.business_name.trim().to_string(),
                        ),
                        ("capabilities[card_payments][requested]", "true".into()),
                        ("capabilities[transfers][requested]", "true".into()),
                    ];
                    let payload =
                        stripe_form(settings, None, "/v1/accounts", &fields, None).await?;
                    required_string(&payload, "id", "Stripe account response")?
                }
            };
            let fields = vec![
                ("account", account.clone()),
                ("refresh_url", return_url.to_string()),
                ("return_url", return_url.to_string()),
                ("type", "account_onboarding".into()),
            ];
            let payload = stripe_form(settings, None, "/v1/account_links", &fields, None).await?;
            Ok(OnboardingResult {
                provider_account_id: account,
                legal_entity_id: String::new(),
                onboarding_url: required_string(&payload, "url", "Stripe onboarding response")?,
                payload,
            })
        }
        "adyen" => {
            let legal_entity = match existing_account_id.filter(|id| !id.is_empty()) {
                Some(id) => id.to_string(),
                None => {
                    let entity_type = if request.business_type == "individual" {
                        "individual"
                    } else {
                        "organization"
                    };
                    let body = if entity_type == "individual" {
                        json!({"type":"individual","individual":{"residentialAddress":{"country":request.country.to_ascii_uppercase()}}})
                    } else {
                        json!({"type":"organization","organization":{"legalName":request.business_name.trim(),"registeredAddress":{"country":request.country.to_ascii_uppercase()}}})
                    };
                    let payload =
                        adyen_json(settings, adyen_kyc_base(settings), "/legalEntities", &body)
                            .await?;
                    required_string(&payload, "id", "Adyen legal entity response")?
                }
            };
            let payload = adyen_json(
                settings,
                adyen_kyc_base(settings),
                &format!("/legalEntities/{legal_entity}/onboardingLinks"),
                &json!({"redirectUrl":return_url}),
            )
            .await?;
            let onboarding_url = payload
                .get("url")
                .or_else(|| payload.get("redirectUrl"))
                .and_then(Value::as_str)
                .filter(|value| value.starts_with("https://"))
                .map(ToString::to_string)
                .ok_or_else(|| provider_error("Adyen onboarding response is incomplete"))?;
            Ok(OnboardingResult {
                provider_account_id: legal_entity.clone(),
                legal_entity_id: legal_entity,
                onboarding_url,
                payload,
            })
        }
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn retrieve_account(
    settings: &Settings,
    provider: &str,
    account_id: &str,
) -> Result<Value, AppError> {
    match provider {
        "stripe" => stripe_get(settings, &format!("/v1/accounts/{account_id}"), None).await,
        "adyen" => {
            adyen_get(
                settings,
                adyen_kyc_base(settings),
                &format!("/legalEntities/{account_id}"),
            )
            .await
        }
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn create_payment(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    request: &PaymentRequest,
    idempotency_key: String,
) -> Result<Value, AppError> {
    validate_money(request.amount_paise, &request.currency)?;
    let capture_method = payment_capture_method(request.capture_method.as_deref())?;
    match provider {
        "stripe" => {
            let mut fields = vec![
                ("amount", request.amount_paise.to_string()),
                ("currency", request.currency.to_ascii_lowercase()),
                ("automatic_payment_methods[enabled]", "true".into()),
                ("metadata[reference]", request.reference.clone()),
                ("capture_method", capture_method.into()),
            ];
            if let Some(value) = clean_id(request.provider_payment_method_id.as_deref()) {
                fields.push(("payment_method", value.into()));
                fields.push(("confirm", "true".into()));
                if request.recurring {
                    fields.push(("off_session", "true".into()));
                }
            }
            if let Some(value) = clean_id(request.provider_customer_id.as_deref()) {
                fields.push(("customer", value.into()));
            }
            if request.store_payment_method {
                fields.push(("setup_future_usage", "off_session".into()));
            }
            if let Some(fee) = request.application_fee_paise.filter(|fee| *fee > 0) {
                if fee >= request.amount_paise {
                    return Err(AppError::validation(
                        "applicationFeePaise must be less than amountPaise",
                    ));
                }
                fields.push(("application_fee_amount", fee.to_string()));
            }
            stripe_form(
                settings,
                Some(account_id),
                "/v1/payment_intents",
                &fields,
                Some(&idempotency_key),
            )
            .await
        }
        "adyen" => {
            let payment_method = request.payment_method.as_ref().ok_or_else(|| {
                AppError::validation("paymentMethod from Adyen Web Components is required")
            })?;
            reject_raw_card_data(payment_method)?;
            let body = json!({
                "amount":{"currency":request.currency.to_ascii_uppercase(),"value":request.amount_paise},
                "reference":request.reference,
                "merchantAccount":adyen_merchant(settings)?,
                "paymentMethod":payment_method,
                "returnUrl":request.return_url.as_deref().unwrap_or(configured_return_url(settings)?),
                "shopperReference":request.provider_customer_id,
                "shopperInteraction":if request.recurring {"ContAuth"} else {"Ecommerce"},
                "recurringProcessingModel":if request.recurring {Some("Subscription")} else {None},
                "storePaymentMethod":request.store_payment_method,
                "captureDelayHours":if capture_method == "manual" {Some("manual")} else {None},
                "metadata":{"merchantAccountId":account_id}
            });
            adyen_checkout(settings, "/payments", &body, Some(&idempotency_key)).await
        }
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn capture_payment(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    provider_payment_id: &str,
    amount_paise: i64,
    currency: &str,
    reference: &str,
    idempotency_key: &str,
) -> Result<PaymentModification, AppError> {
    validate_money(amount_paise, currency)?;
    let payload = match provider {
        "stripe" => {
            stripe_form(
                settings,
                Some(account_id),
                &format!("/v1/payment_intents/{provider_payment_id}/capture"),
                &[("amount_to_capture", amount_paise.to_string())],
                Some(idempotency_key),
            )
            .await?
        }
        "adyen" => {
            adyen_checkout(
                settings,
                &format!("/payments/{provider_payment_id}/captures"),
                &json!({
                    "merchantAccount":adyen_merchant(settings)?,
                    "amount":{"currency":currency.to_ascii_uppercase(),"value":amount_paise},
                    "reference":reference
                }),
                Some(idempotency_key),
            )
            .await?
        }
        _ => return Err(AppError::validation("provider must be stripe or adyen")),
    };
    payment_modification(payload, provider)
}

pub async fn void_payment(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    provider_payment_id: &str,
    reference: &str,
    idempotency_key: &str,
) -> Result<PaymentModification, AppError> {
    let payload = match provider {
        "stripe" => {
            stripe_form(
                settings,
                Some(account_id),
                &format!("/v1/payment_intents/{provider_payment_id}/cancel"),
                &[],
                Some(idempotency_key),
            )
            .await?
        }
        "adyen" => {
            adyen_checkout(
                settings,
                &format!("/payments/{provider_payment_id}/cancels"),
                &json!({"merchantAccount":adyen_merchant(settings)?,"reference":reference}),
                Some(idempotency_key),
            )
            .await?
        }
        _ => return Err(AppError::validation("provider must be stripe or adyen")),
    };
    payment_modification(payload, provider)
}

pub async fn refund_payment(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    provider_payment_id: &str,
    amount_paise: i64,
    currency: &str,
    reference: &str,
    idempotency_key: &str,
) -> Result<PaymentModification, AppError> {
    validate_money(amount_paise, currency)?;
    let payload = match provider {
        "stripe" => {
            stripe_form(
                settings,
                Some(account_id),
                "/v1/refunds",
                &[
                    ("payment_intent", provider_payment_id.to_string()),
                    ("amount", amount_paise.to_string()),
                    ("metadata[reference]", reference.to_string()),
                ],
                Some(idempotency_key),
            )
            .await?
        }
        "adyen" => {
            adyen_checkout(
                settings,
                &format!("/payments/{provider_payment_id}/refunds"),
                &json!({
                    "merchantAccount":adyen_merchant(settings)?,
                    "amount":{"currency":currency.to_ascii_uppercase(),"value":amount_paise},
                    "reference":reference
                }),
                Some(idempotency_key),
            )
            .await?
        }
        _ => return Err(AppError::validation("provider must be stripe or adyen")),
    };
    payment_modification(payload, provider)
}

pub async fn retrieve_payment(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    provider_payment_id: &str,
) -> Result<Value, AppError> {
    match provider {
        "stripe" => {
            stripe_get(
                settings,
                &format!("/v1/payment_intents/{provider_payment_id}"),
                Some(account_id),
            )
            .await
        }
        "adyen" => Err(AppError::conflict(
            "Adyen payment reconciliation is webhook-authoritative; wait for the signed webhook or review it in the provider console",
        )),
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn create_setup(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    request: &SetupRequest,
    idempotency_key: String,
) -> Result<Value, AppError> {
    validate_currency(&request.currency)?;
    match provider {
        "stripe" => {
            let mut fields = vec![
                ("usage", "off_session".into()),
                ("automatic_payment_methods[enabled]", "true".into()),
                ("metadata[reference]", request.reference.clone()),
            ];
            if let Some(customer) = clean_id(request.provider_customer_id.as_deref()) {
                fields.push(("customer", customer.into()));
            }
            stripe_form(
                settings,
                Some(account_id),
                "/v1/setup_intents",
                &fields,
                Some(&idempotency_key),
            )
            .await
        }
        "adyen" => {
            let shopper_reference =
                clean_id(request.provider_customer_id.as_deref()).ok_or_else(|| {
                    AppError::validation("providerCustomerId is required for Adyen setup")
                })?;
            let body = json!({
                "amount":{"currency":request.currency.to_ascii_uppercase(),"value":0},
                "reference":request.reference,
                "merchantAccount":adyen_merchant(settings)?,
                "returnUrl":request.return_url.as_deref().unwrap_or(configured_return_url(settings)?),
                "shopperReference":shopper_reference,
                "storePaymentMethodMode":"enabled"
            });
            adyen_checkout(settings, "/sessions", &body, Some(&idempotency_key)).await
        }
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn create_terminal_session(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    idempotency_key: String,
) -> Result<Value, AppError> {
    match provider {
        "stripe" => {
            stripe_form(
                settings,
                Some(account_id),
                "/v1/terminal/connection_tokens",
                &[],
                Some(&idempotency_key),
            )
            .await
        }
        "adyen" => Err(AppError::validation(
            "Adyen terminals use Terminal API device assignment, not a browser connection token",
        )),
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

pub async fn create_payout(
    settings: &Settings,
    provider: &str,
    account_id: &str,
    request: &PayoutRequest,
    idempotency_key: String,
) -> Result<Value, AppError> {
    validate_money(request.amount_paise, &request.currency)?;
    match provider {
        "stripe" => {
            stripe_form(
                settings,
                Some(account_id),
                "/v1/payouts",
                &[
                    ("amount", request.amount_paise.to_string()),
                    ("currency", request.currency.to_ascii_lowercase()),
                    ("metadata[reference]", request.reference.clone()),
                ],
                Some(&idempotency_key),
            )
            .await
        }
        "adyen" => Err(AppError::validation(
            "Adyen payouts require a verified balanceAccountId and transfer instrument",
        )),
        _ => Err(AppError::validation("provider must be stripe or adyen")),
    }
}

fn configured_return_url(settings: &Settings) -> Result<&str, AppError> {
    settings.payment_return_url.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "PAYMENT_RETURN_URL is not configured",
        )
    })
}

fn stripe_business_type(value: &str) -> Result<&'static str, AppError> {
    match value {
        "company" => Ok("company"),
        "individual" => Ok("individual"),
        "non_profit" => Ok("non_profit"),
        _ => Err(AppError::validation(
            "businessType must be company, individual, or non_profit",
        )),
    }
}

fn validate_country_currency(country: &str, currency: &str) -> Result<(), AppError> {
    if country.len() != 2 || !country.chars().all(|value| value.is_ascii_alphabetic()) {
        return Err(AppError::validation(
            "country must be a two-letter ISO code",
        ));
    }
    validate_currency(currency)
}

fn validate_currency(currency: &str) -> Result<(), AppError> {
    if currency.len() != 3 || !currency.chars().all(|value| value.is_ascii_alphabetic()) {
        return Err(AppError::validation(
            "currency must be a three-letter ISO code",
        ));
    }
    Ok(())
}

fn validate_money(amount: i64, currency: &str) -> Result<(), AppError> {
    validate_currency(currency)?;
    if amount <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    Ok(())
}

pub fn payment_capture_method(value: Option<&str>) -> Result<&'static str, AppError> {
    match value
        .unwrap_or("automatic")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "automatic" => Ok("automatic"),
        "manual" => Ok("manual"),
        _ => Err(AppError::validation(
            "captureMethod must be automatic or manual",
        )),
    }
}

fn payment_modification(payload: Value, provider: &str) -> Result<PaymentModification, AppError> {
    let provider_action_id = payload
        .get("id")
        .or_else(|| payload.get("pspReference"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| provider_error(&format!("{provider} modification response is incomplete")))?
        .to_string();
    let status = payload
        .get("status")
        .or_else(|| payload.get("resultCode"))
        .and_then(Value::as_str)
        .unwrap_or("received")
        .to_ascii_lowercase();
    Ok(PaymentModification {
        provider_action_id,
        status,
        payload,
    })
}

fn clean_id(value: Option<&str>) -> Option<&str> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 255)
}

fn reject_raw_card_data(value: &Value) -> Result<(), AppError> {
    const FORBIDDEN: &[&str] = &["number", "cvc", "cvv", "pan", "expiryMonth", "expiryYear"];
    match value {
        Value::Object(map) => {
            if map
                .keys()
                .any(|key| FORBIDDEN.iter().any(|item| key.eq_ignore_ascii_case(item)))
            {
                return Err(AppError::validation(
                    "raw card data is forbidden; use provider-encrypted paymentMethod data",
                ));
            }
            for child in map.values() {
                reject_raw_card_data(child)?;
            }
        }
        Value::Array(values) => {
            for child in values {
                reject_raw_card_data(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

async fn stripe_form(
    settings: &Settings,
    account_id: Option<&str>,
    path: &str,
    fields: &[(&str, String)],
    idempotency_key: Option<&str>,
) -> Result<Value, AppError> {
    let secret = settings
        .stripe_secret_key
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let client = reqwest::Client::new();
    let mut request = client
        .post(format!("https://api.stripe.com{path}"))
        .bearer_auth(secret)
        .form(fields);
    if let Some(account) = account_id {
        request = request.header("Stripe-Account", account);
    }
    if let Some(key) = idempotency_key {
        request = request.header("Idempotency-Key", key);
    }
    provider_json(request.send().await, "Stripe").await
}

async fn stripe_get(
    settings: &Settings,
    path: &str,
    account_id: Option<&str>,
) -> Result<Value, AppError> {
    let secret = settings
        .stripe_secret_key
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let mut request = reqwest::Client::new()
        .get(format!("https://api.stripe.com{path}"))
        .bearer_auth(secret);
    if let Some(account) = account_id {
        request = request.header("Stripe-Account", account);
    }
    provider_json(request.send().await, "Stripe").await
}

async fn adyen_json(
    settings: &Settings,
    base: &str,
    path: &str,
    body: &Value,
) -> Result<Value, AppError> {
    let key = settings
        .adyen_api_key
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let request = reqwest::Client::new()
        .post(format!("{base}{path}"))
        .header("X-API-Key", key)
        .json(body)
        .send()
        .await;
    provider_json(request, "Adyen").await
}

async fn adyen_get(settings: &Settings, base: &str, path: &str) -> Result<Value, AppError> {
    let key = settings
        .adyen_api_key
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let request = reqwest::Client::new()
        .get(format!("{base}{path}"))
        .header("X-API-Key", key)
        .send()
        .await;
    provider_json(request, "Adyen").await
}

async fn adyen_checkout(
    settings: &Settings,
    path: &str,
    body: &Value,
    idempotency_key: Option<&str>,
) -> Result<Value, AppError> {
    let key = settings
        .adyen_api_key
        .as_deref()
        .ok_or_else(provider_not_configured)?;
    let mut request = reqwest::Client::new()
        .post(format!("{}{path}", adyen_checkout_base(settings)?))
        .header("X-API-Key", key)
        .json(body);
    if let Some(value) = idempotency_key {
        request = request.header("Idempotency-Key", value);
    }
    provider_json(request.send().await, "Adyen").await
}

async fn provider_json(
    response: Result<reqwest::Response, reqwest::Error>,
    provider: &str,
) -> Result<Value, AppError> {
    let response = response.map_err(|_| provider_error(&format!("{provider} request failed")))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| provider_error(&format!("{provider} returned an invalid response")))?;
    if !status.is_success() {
        tracing::warn!(provider, status = %status, "payment provider request rejected");
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_REJECTED",
            format!("{provider} rejected the request"),
        ));
    }
    Ok(payload)
}

fn required_string(payload: &Value, key: &str, context: &str) -> Result<String, AppError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| provider_error(&format!("{context} is incomplete")))
}

fn provider_not_configured() -> AppError {
    AppError::service_unavailable(
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        "payment provider credentials are not configured",
    )
}

fn provider_error(message: &str) -> AppError {
    AppError::service_unavailable("PAYMENT_PROVIDER_UNAVAILABLE", message)
}

fn adyen_merchant(settings: &Settings) -> Result<&str, AppError> {
    settings
        .adyen_merchant_account
        .as_deref()
        .ok_or_else(provider_not_configured)
}

fn adyen_kyc_base(settings: &Settings) -> &'static str {
    if settings.payment_provider_environment == "sandbox" {
        "https://kyc-test.adyen.com/lem/v4"
    } else {
        "https://kyc-live.adyen.com/lem/v4"
    }
}

fn adyen_checkout_base(settings: &Settings) -> Result<String, AppError> {
    if settings.payment_provider_environment == "sandbox" {
        Ok("https://checkout-test.adyen.com/v71".into())
    } else {
        let prefix = settings
            .adyen_live_prefix
            .as_deref()
            .ok_or_else(provider_not_configured)?;
        Ok(format!(
            "https://{prefix}-checkout-live.adyenpayments.com/checkout/v71"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{payment_capture_method, reject_raw_card_data};
    use serde_json::json;

    #[test]
    fn raw_card_fields_are_rejected_but_encrypted_provider_data_is_allowed() {
        assert!(
            reject_raw_card_data(&json!({"type":"scheme","encryptedCardNumber":"abc"})).is_ok()
        );
        assert!(
            reject_raw_card_data(&json!({"type":"scheme","number":"4111111111111111"})).is_err()
        );
    }

    #[test]
    fn capture_method_is_explicit_and_fail_closed() {
        assert_eq!(payment_capture_method(None).unwrap(), "automatic");
        assert_eq!(payment_capture_method(Some("manual")).unwrap(), "manual");
        assert!(payment_capture_method(Some("later")).is_err());
    }
}
