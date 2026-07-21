use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;
use std::time::Duration as StdDuration;
use uuid::Uuid;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::{
        clients_repository,
        customer_portal_repository::{self as repo, AccountRecord},
    },
    services::auth_service,
};

const ACCESS_TOKEN_TYPE: &str = "customer_access";
const REFRESH_TOKEN_TYPE: &str = "customer_refresh";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerClaims {
    pub sub: String,
    pub session_id: String,
    pub role: String,
    pub token_type: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInput {
    pub name: Option<String>,
    pub device_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBundle {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
    pub refresh_expires_at: String,
    pub session_id: String,
    #[serde(rename = "customer")]
    pub account: AccountRecord,
}

pub struct PendingChallenge {
    pub id: String,
    pub code: String,
    pub target: String,
    pub target_type: String,
    pub purpose: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirebaseLookupResponse {
    #[serde(default)]
    users: Vec<FirebaseLookupUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirebaseLookupUser {
    local_id: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    email_verified: bool,
    #[serde(default)]
    phone_number: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    provider_user_info: Vec<FirebaseProviderIdentity>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirebaseProviderIdentity {
    #[serde(default)]
    provider_id: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn request_challenge(
    db: &PgPool,
    settings: &Settings,
    account_id: Option<&str>,
    target_type: &str,
    raw_target: &str,
    purpose: &str,
    tenant_id: &str,
    branch_id: &str,
    first_name: &str,
    last_name: &str,
) -> Result<PendingChallenge, AppError> {
    validate_purpose(target_type, purpose, account_id)?;
    let target = normalize_target(target_type, raw_target)?;
    let count = repo::recent_challenge_count(db, target_type, &target, purpose)
        .await
        .map_err(|_| AppError::internal("failed to check verification rate limit"))?;
    if count >= 3 {
        return Err(AppError::rate_limited(
            "too many verification requests; try again later",
        ));
    }
    if (!tenant_id.is_empty() || !branch_id.is_empty())
        && (tenant_id.is_empty()
            || branch_id.is_empty()
            || !repo::branch_exists(db, tenant_id, branch_id)
                .await
                .map_err(|_| AppError::internal("failed to validate customer branch"))?)
    {
        return Err(AppError::validation(
            "valid tenantId and branchId are required",
        ));
    }
    let code = generate_code();
    let code_hash = challenge_hash(settings, target_type, &target, purpose, &code);
    let metadata = json!({"firstName":clean_name(first_name),"lastName":clean_name(last_name)});
    let id = repo::create_challenge(
        db,
        account_id,
        tenant_id,
        branch_id,
        target_type,
        &target,
        purpose,
        &code_hash,
        &metadata,
        Utc::now() + Duration::minutes(10),
    )
    .await
    .map_err(|_| AppError::internal("failed to create verification challenge"))?;
    Ok(PendingChallenge {
        id,
        code,
        target,
        target_type: target_type.to_string(),
        purpose: purpose.to_string(),
    })
}

pub async fn discard_challenge(db: &PgPool, id: &str) -> Result<(), AppError> {
    repo::delete_challenge(db, id)
        .await
        .map_err(|_| AppError::internal("failed to discard verification challenge"))
}

#[allow(clippy::too_many_arguments)]
pub async fn verify_login(
    db: &PgPool,
    settings: &Settings,
    target_type: &str,
    raw_target: &str,
    code: &str,
    device: &DeviceInput,
    user_agent: &str,
    ip_hash: &str,
) -> Result<TokenBundle, AppError> {
    let target = normalize_target(target_type, raw_target)?;
    let challenge =
        verify_challenge(db, settings, None, target_type, &target, "login", code).await?;
    let first_name = challenge
        .metadata_json
        .get("firstName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let last_name = challenge
        .metadata_json
        .get("lastName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let account = repo::upsert_verified_account(db, target_type, &target, first_name, last_name)
        .await
        .map_err(|_| AppError::conflict("customer identity is already linked"))?;
    if !challenge.tenant_id.is_empty() && !challenge.branch_id.is_empty() {
        repo::ensure_client_link(db, &account, &challenge.tenant_id, &challenge.branch_id)
            .await
            .map_err(|_| AppError::internal("failed to link customer profile"))?;
    }
    issue_new_session(db, settings, account, device, user_agent, ip_hash).await
}

#[allow(clippy::too_many_arguments)]
pub async fn exchange_firebase_token(
    db: &PgPool,
    settings: &Settings,
    id_token: &str,
    requested_provider: &str,
    device: &DeviceInput,
    user_agent: &str,
    ip_hash: &str,
) -> Result<TokenBundle, AppError> {
    let id_token = id_token.trim();
    if id_token.is_empty() || id_token.len() > 16_384 {
        return Err(AppError::unauthenticated("Firebase ID token is required"));
    }
    let provider = canonical_firebase_provider(requested_provider)?;
    let api_key = settings
        .customer_firebase_api_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::service_unavailable(
                "FIREBASE_NOT_CONFIGURED",
                "customer Firebase authentication is not configured",
            )
        })?;
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(8))
        .build()
        .map_err(|_| AppError::internal("failed to initialize Firebase verification"))?;
    let response = client
        .post(format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={api_key}"
        ))
        .json(&json!({"idToken":id_token}))
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "FIREBASE_UNAVAILABLE",
                "Firebase verification is unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(AppError::unauthenticated(
            "Firebase token is invalid or expired",
        ));
    }
    let lookup = response
        .json::<FirebaseLookupResponse>()
        .await
        .map_err(|_| AppError::unauthenticated("Firebase token response is invalid"))?;
    let user = lookup
        .users
        .into_iter()
        .next()
        .filter(|user| !user.disabled && !user.local_id.trim().is_empty())
        .ok_or_else(|| AppError::unauthenticated("Firebase customer is unavailable"))?;
    if !firebase_provider_matches(&user, provider) {
        return Err(AppError::unauthenticated(
            "Firebase sign-in provider does not match the request",
        ));
    }
    let verified_email = if user.email_verified && !user.email.trim().is_empty() {
        normalize_target("email", &user.email)?
    } else {
        String::new()
    };
    let verified_phone = if user.phone_number.trim().is_empty() {
        String::new()
    } else {
        normalize_target("phone", &user.phone_number)?
    };
    if verified_email.is_empty() && verified_phone.is_empty() {
        return Err(AppError::unauthenticated(
            "Firebase account has no verified email or phone",
        ));
    }
    let (first_name, last_name) = split_customer_name(&user.display_name);
    let account = repo::upsert_federated_account(
        db,
        provider,
        user.local_id.trim(),
        &first_name,
        &last_name,
        &verified_email,
        !verified_email.is_empty(),
        &verified_phone,
    )
    .await
    .map_err(|_| AppError::conflict("Firebase identity is already linked"))?;
    issue_new_session(db, settings, account, device, user_agent, ip_hash).await
}

pub async fn refresh(
    db: &PgPool,
    settings: &Settings,
    refresh_token: &str,
) -> Result<TokenBundle, AppError> {
    let claims = decode_customer_token(
        refresh_token,
        &settings.jwt_refresh_secret,
        REFRESH_TOKEN_TYPE,
    )?;
    let account = repo::account(db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer account"))?
        .ok_or_else(|| AppError::unauthenticated("customer account is unavailable"))?;
    let (access_token, new_refresh, refresh_exp) =
        issue_tokens(settings, &claims.sub, &claims.session_id)?;
    let rotated = repo::rotate_session(
        db,
        &claims.session_id,
        &claims.sub,
        &auth_service::token_hash(refresh_token),
        &auth_service::token_hash(&new_refresh),
        refresh_exp,
    )
    .await
    .map_err(|_| AppError::internal("failed to rotate customer session"))?;
    if !rotated {
        return Err(AppError::unauthenticated(
            "customer session is expired or revoked",
        ));
    }
    Ok(bundle(
        settings,
        account,
        claims.session_id,
        access_token,
        new_refresh,
        refresh_exp,
    ))
}

pub fn require_access(
    settings: &Settings,
    authorization: Option<&str>,
) -> Result<CustomerClaims, AppError> {
    let token = authorization
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::unauthenticated("customer access token is required"))?;
    decode_customer_token(token, &settings.jwt_access_secret, ACCESS_TOKEN_TYPE)
}

pub async fn account(db: &PgPool, account_id: &str) -> Result<AccountRecord, AppError> {
    repo::account(db, account_id)
        .await
        .map_err(|_| AppError::internal("failed to load customer profile"))?
        .ok_or_else(|| AppError::not_found("customer profile was not found"))
}

pub async fn update_profile(
    db: &PgPool,
    account_id: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
    preferences: Option<Value>,
) -> Result<AccountRecord, AppError> {
    let first = first_name.map(clean_name);
    let last = last_name.map(clean_name);
    if first.as_deref().is_some_and(str::is_empty) {
        return Err(AppError::validation("firstName cannot be empty"));
    }
    if let Some(value) = preferences.as_ref() {
        if ![
            "preferredChannel",
            "whatsappOptIn",
            "smsOptIn",
            "emailOptIn",
        ]
        .iter()
        .all(|key| value.get(key).is_some())
        {
            return Err(AppError::validation(
                "complete communicationPreferences are required",
            ));
        }
        let preferred = value
            .get("preferredChannel")
            .and_then(Value::as_str)
            .unwrap_or("none");
        if !matches!(preferred, "none" | "whatsapp" | "sms" | "email" | "phone") {
            return Err(AppError::validation(
                "invalid preferred communication channel",
            ));
        }
        repo::sync_preferences(
            db,
            account_id,
            preferred,
            bool_field(value, "whatsappOptIn"),
            bool_field(value, "smsOptIn"),
            bool_field(value, "emailOptIn"),
        )
        .await
        .map_err(|_| AppError::internal("failed to update communication consent"))?;
    }
    repo::update_profile(
        db,
        account_id,
        first.as_deref(),
        last.as_deref(),
        preferences.as_ref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to update customer profile"))?
    .ok_or_else(|| AppError::not_found("customer profile was not found"))
}

pub async fn verify_profile_target(
    db: &PgPool,
    settings: &Settings,
    account_id: &str,
    target_type: &str,
    raw_target: &str,
    code: &str,
) -> Result<AccountRecord, AppError> {
    let target = normalize_target(target_type, raw_target)?;
    let purpose = if target_type == "phone" {
        "change_phone"
    } else {
        "change_email"
    };
    verify_challenge(
        db,
        settings,
        Some(account_id),
        target_type,
        &target,
        purpose,
        code,
    )
    .await?;
    repo::update_verified_target(db, account_id, target_type, &target)
        .await
        .map_err(|_| AppError::conflict("verified contact is already used by another customer"))?
        .ok_or_else(|| AppError::not_found("customer profile was not found"))
}

pub async fn ensure_client_link(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<String, AppError> {
    if !repo::branch_exists(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate booking branch"))?
    {
        return Err(AppError::not_found("booking branch was not found"));
    }
    let account = account(db, account_id).await?;
    repo::ensure_client_link(db, &account, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to link customer to booking branch"))
}

#[allow(clippy::too_many_arguments)]
pub async fn issue_dev_session(
    db: &PgPool,
    settings: &Settings,
    raw_email: &str,
    raw_phone: &str,
    tenant_id: &str,
    branch_id: &str,
    first_name: &str,
    last_name: &str,
    device: &DeviceInput,
    user_agent: &str,
    ip_hash: &str,
) -> Result<TokenBundle, AppError> {
    if !repo::branch_exists(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer branch"))?
    {
        return Err(AppError::not_found("customer branch was not found"));
    }
    let email = raw_email.trim();
    let phone = raw_phone.trim();
    let (target_type, target) = if !email.is_empty() {
        ("email", normalize_target("email", email)?)
    } else {
        ("phone", normalize_target("phone", phone)?)
    };
    let account = repo::upsert_verified_account(
        db,
        target_type,
        &target,
        &clean_name(first_name),
        &clean_name(last_name),
    )
    .await
    .map_err(|_| AppError::conflict("verified contact is already used by another customer"))?;
    let account = if target_type == "email" && !phone.is_empty() {
        let verified_phone = normalize_target("phone", phone)?;
        repo::update_verified_target(db, &account.id, "phone", &verified_phone)
            .await
            .map_err(|_| AppError::conflict("verified phone is already used by another customer"))?
            .ok_or_else(|| AppError::not_found("customer profile was not found"))?
    } else if target_type == "phone" && !email.is_empty() {
        let verified_email = normalize_target("email", email)?;
        repo::update_verified_target(db, &account.id, "email", &verified_email)
            .await
            .map_err(|_| AppError::conflict("verified email is already used by another customer"))?
            .ok_or_else(|| AppError::not_found("customer profile was not found"))?
    } else {
        account
    };
    repo::ensure_client_link(db, &account, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to link customer to branch"))?;
    issue_new_session(db, settings, account, device, user_agent, ip_hash).await
}

pub async fn customer_ai(
    db: &PgPool,
    settings: &Settings,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let client_id = repo::linked_client(db, account_id, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load customer AI scope"))?
        .ok_or_else(|| AppError::not_found("customer is not linked to this business"))?;
    let (summary, recent_services, feedback, candidate_services, recovery_offers) =
        tokio::try_join!(
            clients_repository::summary(db, tenant_id, branch_id, &client_id),
            clients_repository::service_history(db, tenant_id, branch_id, &client_id),
            clients_repository::recommendation_feedback(db, tenant_id, branch_id, &client_id),
            repo::business_services(db, branch_id),
            repo::active_recovery_offers(db, account_id, tenant_id, branch_id),
        )
        .map_err(|_| AppError::internal("failed to build customer AI context"))?;
    let fallback = customer_ai_fallback(
        &client_id,
        &summary,
        &recent_services,
        &feedback,
        &recovery_offers,
    );
    let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) else {
        return Ok(fallback);
    };
    let payload = json!({
        "tenant_id":tenant_id,
        "branch_id":branch_id,
        "customer_id":client_id,
        "metrics":{
            "total_visits":summary.total_visits,
            "open_appointments":summary.open_appointments,
            "amount_due_paise":summary.amount_due_paise,
            "lifetime_value_paise":summary.lifetime_value_paise,
            "inactive_days":summary.inactive_days,
            "no_show_rate_bps":summary.no_show_rate_bps,
            "cancellation_rate_bps":summary.cancellation_rate_bps,
            "churn_risk_score":summary.churn_risk_score,
            "review_sentiment":summary.review_sentiment,
            "rfm_segment":summary.rfm_segment,
            "favourite_services":summary.favourite_services,
            "visit_frequency_days":summary.visit_frequency_days,
            "primary_action":summary.next_best_action,
            "primary_reason":summary.next_best_action_reason,
        },
        "recent_services":recent_services.iter().take(50).map(|service| json!({
            "service_id":service.service_id,
            "service_name":service.service_name,
            "created_at":service.created_at.to_rfc3339(),
        })).collect::<Vec<_>>(),
        "candidate_services":candidate_services.iter().take(200).filter_map(|service| Some(json!({
            "id":service.get("id")?.as_str()?,
            "name":service.get("name")?.as_str()?,
            "category":service.get("category").and_then(Value::as_str).unwrap_or(""),
            "price_paise":service.get("pricePaise").and_then(Value::as_i64).unwrap_or(0),
        }))).collect::<Vec<_>>(),
        "feedback":feedback.iter().take(100).map(|item| json!({
            "recommendation":item.recommendation,
            "reason":item.reason,
            "decision":item.decision,
            "comment":item.comment,
        })).collect::<Vec<_>>(),
        "recovery_offers":recovery_offers,
        "safety":{"requiresExplicitBookingConfirmation":true,"medicalDiagnosisAllowed":false,"guaranteedResultsAllowed":false},
    });
    let Ok(client) = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(3))
        .build()
    else {
        return Ok(fallback);
    };
    let Ok(response) = client
        .post(format!("{url}/api/v1/customer-ai/recommendations"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
    else {
        return Ok(fallback);
    };
    if !response.status().is_success() {
        return Ok(fallback);
    }
    let Ok(body) = response.json::<Value>().await else {
        return Ok(fallback);
    };
    let Some(mut result) = body.get("data").cloned() else {
        return Ok(fallback);
    };
    if result.get("customerId").and_then(Value::as_str) != Some(client_id.as_str()) {
        return Ok(fallback);
    }
    let Some(result_object) = result.as_object_mut() else {
        return Ok(fallback);
    };
    result_object.insert("aiAvailable".into(), Value::Bool(true));
    result_object.insert(
        "bookingConfirmationSafety".into(),
        json!({"requiresExplicitBookingConfirmation":true,"bookingOnlyAfterRealSlot":true,"medicalDiagnosisAllowed":false,"guaranteedResultsAllowed":false}),
    );
    Ok(result)
}

fn customer_ai_fallback(
    client_id: &str,
    summary: &clients_repository::ClientSummaryRecord,
    services: &[clients_repository::ClientServiceHistoryRecord],
    feedback: &[clients_repository::ClientRecommendationFeedbackRecord],
    recovery_offers: &[Value],
) -> Value {
    let health_score = (100
        - summary.churn_risk_score
        - if summary.amount_due_paise > 0 { 5 } else { 0 }
        - if summary.review_sentiment == "negative" {
            10
        } else {
            0
        }
        + if summary.open_appointments > 0 { 5 } else { 0 })
    .clamp(0, 100);
    let rebooking = if summary.open_appointments == 0 {
        services.first().map_or_else(Vec::new, |service| {
            vec![json!({
                "serviceId":service.service_id,
                "serviceName":service.service_name,
                "recommendedInDays":summary.visit_frequency_days.unwrap_or(42.0).round().clamp(14.0,120.0) as i64,
                "reason":"No upcoming appointment and this service appears in recent history",
            })]
        })
    } else {
        Vec::new()
    };
    json!({
        "customerId":client_id,
        "source":"rust_deterministic_fallback",
        "model":"client-summary-rules-v1",
        "aiAvailable":false,
        "healthScore":health_score,
        "healthExplanation":if health_score>=75 {"Customer engagement is healthy based on current CRM signals."} else {"Health needs attention based on current retention signals."},
        "churnRisk":{"score":summary.churn_risk_score,"explanation":[summary.next_best_action_reason]},
        "churnRecoveryOffers":recovery_offers,
        "nextBestActions":[{"action":summary.next_best_action,"reason":summary.next_best_action_reason,"priority":100}],
        "rebookingRecommendations":rebooking,
        "smartRebooking":rebooking.first().map(|item| json!({"status":"ready","serviceId":item["serviceId"],"serviceName":item["serviceName"],"recommendedInDays":item["recommendedInDays"],"requiresExplicitConfirmation":true})).unwrap_or_else(|| json!({"status":"not_needed","requiresExplicitConfirmation":true})),
        "upsellRecommendations":[],
        "multilingual":{"defaultLanguage":"en-IN","supportedLanguages":["en-IN","hi-IN"],"source":"customer_app"},
        "bookingConfirmationSafety":{"requiresExplicitBookingConfirmation":true,"bookingOnlyAfterRealSlot":true,"medicalDiagnosisAllowed":false,"guaranteedResultsAllowed":false},
        "learningContext":{
            "acceptedCount":feedback.iter().filter(|item|item.decision=="accepted").count(),
            "rejectedCount":feedback.iter().filter(|item|item.decision=="rejected").count(),
            "feedbackApplied":!feedback.is_empty(),
        },
        "context":{"segment":summary.rfm_segment,"totalVisits":summary.total_visits,"inactiveDays":summary.inactive_days},
    })
}

fn validate_purpose(
    target_type: &str,
    purpose: &str,
    account_id: Option<&str>,
) -> Result<(), AppError> {
    if !matches!(target_type, "phone" | "email") {
        return Err(AppError::validation("targetType must be phone or email"));
    }
    let valid = matches!(
        (target_type, purpose),
        ("phone", "login")
            | ("email", "login")
            | ("phone", "change_phone")
            | ("email", "change_email")
    );
    if !valid || (purpose != "login" && account_id.is_none()) {
        return Err(AppError::validation("invalid verification purpose"));
    }
    Ok(())
}

async fn verify_challenge(
    db: &PgPool,
    settings: &Settings,
    account_id: Option<&str>,
    target_type: &str,
    target: &str,
    purpose: &str,
    code: &str,
) -> Result<repo::ChallengeRecord, AppError> {
    let challenge = repo::latest_challenge(db, target_type, target, purpose, account_id)
        .await
        .map_err(|_| AppError::internal("failed to load verification challenge"))?
        .ok_or_else(|| AppError::conflict("verification code is missing or expired"))?;
    if challenge.expires_at <= Utc::now() {
        return Err(AppError::conflict("verification code has expired"));
    }
    if challenge.attempt_count >= challenge.max_attempts {
        return Err(AppError::rate_limited("verification attempts exceeded"));
    }
    if !verify_challenge_hash(settings, &challenge, code) {
        repo::fail_challenge(db, &challenge.id)
            .await
            .map_err(|_| AppError::internal("failed to record verification attempt"))?;
        return Err(AppError::conflict("invalid verification code"));
    }
    if !repo::consume_challenge(db, &challenge.id)
        .await
        .map_err(|_| AppError::internal("failed to consume verification code"))?
    {
        return Err(AppError::conflict("verification code was already used"));
    }
    Ok(challenge)
}

async fn issue_new_session(
    db: &PgPool,
    settings: &Settings,
    account: AccountRecord,
    device: &DeviceInput,
    user_agent: &str,
    ip_hash: &str,
) -> Result<TokenBundle, AppError> {
    let session_id = Uuid::new_v4().to_string();
    let (access, refresh, refresh_exp) = issue_tokens(settings, &account.id, &session_id)?;
    repo::create_session(
        db,
        &session_id,
        &account.id,
        &auth_service::token_hash(&refresh),
        device.name.as_deref().unwrap_or("").trim(),
        device.device_type.as_deref().unwrap_or("").trim(),
        user_agent,
        ip_hash,
        refresh_exp,
    )
    .await
    .map_err(|_| AppError::internal("failed to create customer session"))?;
    Ok(bundle(
        settings,
        account,
        session_id,
        access,
        refresh,
        refresh_exp,
    ))
}

fn issue_tokens(
    settings: &Settings,
    account_id: &str,
    session_id: &str,
) -> Result<(String, String, chrono::DateTime<Utc>), AppError> {
    let now = Utc::now();
    let access_exp = now + Duration::minutes(settings.jwt_access_ttl_minutes as i64);
    let refresh_exp = now + Duration::days(settings.jwt_refresh_ttl_days as i64);
    let claims = |token_type: &str, exp: chrono::DateTime<Utc>| CustomerClaims {
        sub: account_id.to_string(),
        session_id: session_id.to_string(),
        role: "customer".to_string(),
        token_type: token_type.to_string(),
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    let access = encode(
        &Header::default(),
        &claims(ACCESS_TOKEN_TYPE, access_exp),
        &EncodingKey::from_secret(settings.jwt_access_secret.as_bytes()),
    )
    .map_err(|_| AppError::internal("failed to issue customer access token"))?;
    let refresh = encode(
        &Header::default(),
        &claims(REFRESH_TOKEN_TYPE, refresh_exp),
        &EncodingKey::from_secret(settings.jwt_refresh_secret.as_bytes()),
    )
    .map_err(|_| AppError::internal("failed to issue customer refresh token"))?;
    Ok((access, refresh, refresh_exp))
}

fn bundle(
    settings: &Settings,
    account: AccountRecord,
    session_id: String,
    access_token: String,
    refresh_token: String,
    refresh_exp: chrono::DateTime<Utc>,
) -> TokenBundle {
    TokenBundle {
        access_token,
        refresh_token,
        token_type: "Bearer",
        expires_in: settings.jwt_access_ttl_minutes * 60,
        refresh_expires_at: refresh_exp.to_rfc3339(),
        session_id,
        account,
    }
}

fn decode_customer_token(
    token: &str,
    secret: &str,
    token_type: &str,
) -> Result<CustomerClaims, AppError> {
    let claims = decode::<CustomerClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AppError::unauthenticated("invalid or expired customer token"))?
    .claims;
    if claims.role != "customer"
        || claims.token_type != token_type
        || claims.sub.is_empty()
        || claims.session_id.is_empty()
    {
        return Err(AppError::unauthenticated("invalid customer token scope"));
    }
    Ok(claims)
}

fn normalize_target(target_type: &str, value: &str) -> Result<String, AppError> {
    if target_type == "email" {
        let email = value.trim().to_ascii_lowercase();
        if email.len() > 254
            || !email.contains('@')
            || email.starts_with('@')
            || email.ends_with('@')
        {
            return Err(AppError::validation("valid email is required"));
        }
        return Ok(email);
    }
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    let normalized = match digits.len() {
        10 => format!("+91{digits}"),
        11 if digits.starts_with('0') => format!("+91{}", &digits[1..]),
        12 if digits.starts_with("91") => format!("+{digits}"),
        8..=15 => format!("+{digits}"),
        _ => return Err(AppError::validation("valid phone number is required")),
    };
    Ok(normalized)
}

fn canonical_firebase_provider(value: &str) -> Result<&'static str, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "google" | "google.com" => Ok("google"),
        "apple" | "apple.com" => Ok("apple"),
        "facebook" | "facebook.com" => Ok("facebook"),
        "phone" => Ok("phone"),
        "password" => Ok("password"),
        "firebase" | "" => Ok("firebase"),
        _ => Err(AppError::validation("unsupported Firebase provider")),
    }
}

fn firebase_provider_matches(user: &FirebaseLookupUser, provider: &str) -> bool {
    let provider_id = match provider {
        "google" => "google.com",
        "apple" => "apple.com",
        "facebook" => "facebook.com",
        "phone" => "phone",
        "password" => "password",
        _ => return true,
    };
    if provider == "phone" {
        return !user.phone_number.trim().is_empty();
    }
    if provider == "password" {
        return user.email_verified && !user.email.trim().is_empty();
    }
    user.provider_user_info
        .iter()
        .any(|identity| identity.provider_id == provider_id)
}

fn split_customer_name(value: &str) -> (String, String) {
    let mut parts = value.split_whitespace();
    let first = clean_name(parts.next().unwrap_or("Customer"));
    let last = clean_name(&parts.collect::<Vec<_>>().join(" "));
    (first, last)
}

fn clean_name(value: &str) -> String {
    value.trim().chars().take(120).collect()
}
fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn generate_code() -> String {
    let value = 100_000 + (OsRng.next_u32() % 900_000);
    value.to_string()
}

fn challenge_hash(
    settings: &Settings,
    target_type: &str,
    target: &str,
    purpose: &str,
    code: &str,
) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(settings.jwt_refresh_secret.as_bytes())
        .expect("configured HMAC key");
    mac.update(format!("{target_type}:{target}:{purpose}:{code}").as_bytes());
    STANDARD_NO_PAD.encode(mac.finalize().into_bytes())
}

fn verify_challenge_hash(
    settings: &Settings,
    challenge: &repo::ChallengeRecord,
    code: &str,
) -> bool {
    let Ok(expected) = STANDARD_NO_PAD.decode(&challenge.code_hash) else {
        return false;
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(settings.jwt_refresh_secret.as_bytes())
        .expect("configured HMAC key");
    mac.update(
        format!(
            "{}:{}:{}:{code}",
            challenge.target_type, challenge.target, challenge.purpose
        )
        .as_bytes(),
    );
    mac.verify_slice(&expected).is_ok()
}

#[cfg(test)]
mod tests {
    use super::{
        customer_ai_fallback, decode_customer_token, normalize_target, CustomerClaims,
        ACCESS_TOKEN_TYPE,
    };
    use crate::repositories::clients_repository::ClientSummaryRecord;
    use chrono::{Duration, Utc};
    use jsonwebtoken::{encode, EncodingKey, Header};

    #[test]
    fn customer_access_rejects_wrong_role_and_token_scope() {
        let token = |role: &str, token_type: &str| {
            encode(
                &Header::default(),
                &CustomerClaims {
                    sub: "account-1".into(),
                    session_id: "session-1".into(),
                    role: role.into(),
                    token_type: token_type.into(),
                    iat: Utc::now().timestamp() as usize,
                    exp: (Utc::now() + Duration::minutes(5)).timestamp() as usize,
                },
                &EncodingKey::from_secret(b"production-test-secret"),
            )
            .unwrap()
        };

        assert!(decode_customer_token(
            &token("customer", ACCESS_TOKEN_TYPE),
            "production-test-secret",
            ACCESS_TOKEN_TYPE,
        )
        .is_ok());
        assert!(decode_customer_token(
            &token("staff", ACCESS_TOKEN_TYPE),
            "production-test-secret",
            ACCESS_TOKEN_TYPE,
        )
        .is_err());
        assert!(decode_customer_token(
            &token("customer", "customer_refresh"),
            "production-test-secret",
            ACCESS_TOKEN_TYPE,
        )
        .is_err());
    }

    #[test]
    fn normalizes_indian_customer_phone() {
        assert_eq!(
            normalize_target("phone", "98765 43210").unwrap(),
            "+919876543210"
        );
        assert_eq!(
            normalize_target("phone", "+91-98765-43210").unwrap(),
            "+919876543210"
        );
    }

    #[test]
    fn normalizes_customer_email() {
        assert_eq!(
            normalize_target("email", " User@Example.COM ").unwrap(),
            "user@example.com"
        );
        assert!(normalize_target("email", "invalid").is_err());
    }

    #[test]
    fn customer_ai_fallback_keeps_crm_available_without_python() {
        let summary = ClientSummaryRecord {
            total_visits: 3,
            open_appointments: 0,
            amount_due_paise: 0,
            reward_points_balance: 0,
            lifetime_value_paise: 10_000,
            average_spend_paise: 3_333,
            highest_bill_paise: 5_000,
            service_spend_paise: 10_000,
            product_spend_paise: 0,
            favourite_services: String::new(),
            preferred_staff_name: String::new(),
            visit_frequency_days: Some(30.0),
            inactive_days: 100,
            no_show_rate_bps: 0,
            cancellation_rate_bps: 0,
            churn_risk_score: 80,
            review_sentiment: "neutral".into(),
            next_best_action: "Start win-back outreach".into(),
            next_best_action_reason: "100 inactive days".into(),
            occasion_opportunity: String::new(),
            rfm_segment: "At risk".into(),
            rfm_score: 6,
            intelligence_calculated_at: None,
        };
        let result = customer_ai_fallback("client-1", &summary, &[], &[], &[]);
        assert_eq!(result["aiAvailable"], false);
        assert_eq!(
            result["nextBestActions"][0]["action"],
            "Start win-back outreach"
        );
    }
}
