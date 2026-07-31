use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{collections::BTreeSet, net::IpAddr};
use uuid::Uuid;

use crate::{
    config::Settings,
    infrastructure::cache::RedisClient,
    models::common::AppError,
    repositories::integration_repository::{
        self, ApiKeyCredential, ApiKeyRecord, ConnectorCredential, ConnectorSyncJob,
        WebhookDeliveryLog, WebhookRecord,
    },
    services::{auth_service, entitlement_service, security_service},
};

const API_SCOPES: &[&str] = &[
    "clients.read",
    "appointments.read",
    "sales.read",
    "staff.read",
];
const DEFAULT_API_RATE_LIMIT_PER_MINUTE: i32 = 60;
const WEBHOOK_EVENTS: &[&str] = &[
    "client.created",
    "appointment.created",
    "appointment.status_changed",
    "sale.status_changed",
    "happy_hours.rule.created",
    "happy_hours.rule.updated",
    "happy_hours.approval.requested",
    "happy_hours.approval.approved",
    "happy_hours.approval.rejected",
    "happy_hours.discount_approval.requested",
    "happy_hours.discount_approval.approved",
    "happy_hours.discount_approval.rejected",
    "happy_hours.coupon_abuse.scanned",
    "happy_hours.coupon_abuse.resolved",
    "happy_hours.anomalies.scanned",
    "happy_hours.anomaly.reviewed",
    "happy_hours.budget.updated",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyCreated {
    pub record: ApiKeyRecord,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookView {
    pub id: String,
    pub name: String,
    pub endpoint_url: String,
    pub events: Value,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookCreated {
    pub record: WebhookView,
    pub signing_secret: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectorProvider {
    QuickBooks,
    Xero,
    NetSuite,
    Google,
    Zapier,
    Zenoti,
    Dingg,
}

impl ConnectorProvider {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "quickbooks" => Ok(Self::QuickBooks),
            "xero" => Ok(Self::Xero),
            "netsuite" => Ok(Self::NetSuite),
            "google" => Ok(Self::Google),
            "zapier" => Ok(Self::Zapier),
            "zenoti" => Ok(Self::Zenoti),
            "dingg" => Ok(Self::Dingg),
            _ => Err(AppError::validation("unsupported connector provider")),
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::QuickBooks => "quickbooks",
            Self::Xero => "xero",
            Self::NetSuite => "netsuite",
            Self::Google => "google",
            Self::Zapier => "zapier",
            Self::Zenoti => "zenoti",
            Self::Dingg => "dingg",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::QuickBooks => "QuickBooks Online",
            Self::Xero => "Xero Accounting",
            Self::NetSuite => "Oracle NetSuite",
            Self::Google => "Google Calendar",
            Self::Zapier => "Zapier",
            Self::Zenoti => "Zenoti Migration",
            Self::Dingg => "DINGG Migration",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorView {
    pub provider: String,
    pub label: String,
    pub category: String,
    pub auth_mode: String,
    pub configured: bool,
    pub status: String,
    pub external_account_id: String,
    pub external_account_name: String,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorAuthorize {
    pub authorization_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationConnectorWrite {
    pub credential: String,
    pub auth_scheme: Option<String>,
    #[serde(default)]
    pub center_ids: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub export_url: Option<String>,
    pub source_file_name: Option<String>,
    pub mode: Option<String>,
    pub auto_queue: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ConnectorTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    expires_in: Option<i64>,
    #[serde(default)]
    scope: String,
}

struct ConnectorOauthConfig<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    redirect_uri: &'a str,
    authorization_endpoint: String,
    token_endpoint: String,
    scope: &'static str,
    credentials_in_body: bool,
}

pub async fn list_api_keys(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ApiKeyRecord>, AppError> {
    integration_repository::list_api_keys(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list API keys"))
}

pub async fn create_api_key(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    scopes: Vec<String>,
    ip_allowlist: Vec<String>,
    rate_limit_per_minute: Option<i32>,
    expires_at: Option<DateTime<Utc>>,
    rotated_from: Option<&str>,
) -> Result<ApiKeyCreated, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(AppError::validation("API key name is invalid"));
    }
    validate_scopes(&scopes)?;
    let ip_allowlist = normalize_ip_allowlist(ip_allowlist)?;
    let rate_limit_per_minute = validate_rate_limit(rate_limit_per_minute)?;
    validate_expiry(expires_at)?;
    let (api_key, prefix, secret_hash) = generate_api_key()?;
    let record = integration_repository::insert_api_key(
        db,
        tenant,
        branch,
        name,
        &prefix,
        &secret_hash,
        &json!(scopes),
        &json!(ip_allowlist),
        rate_limit_per_minute,
        expires_at,
        actor,
        rotated_from,
    )
    .await
    .map_err(|_| AppError::internal("failed to create API key"))?;
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "api_client.created",
        json!({"apiClientId": record.id, "name": record.name, "scopes": record.scopes_json, "ipAllowlist": record.ip_allowlist_json, "rateLimitPerMinute": record.rate_limit_per_minute}),
    )
    .await;
    Ok(ApiKeyCreated { record, api_key })
}

pub async fn rotate_api_key(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<ApiKeyCreated, AppError> {
    let old = integration_repository::list_api_keys(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load API key"))?
        .into_iter()
        .find(|row| row.id == id && row.status == "active")
        .ok_or_else(|| AppError::not_found("active API key was not found"))?;
    let scopes = old
        .scopes_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    validate_scopes(&scopes)?;
    let ip_allowlist = old
        .ip_allowlist_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let ip_allowlist = normalize_ip_allowlist(ip_allowlist)?;
    let rate_limit_per_minute = validate_rate_limit(Some(old.rate_limit_per_minute))?;
    validate_expiry(old.expires_at)?;
    let (api_key, prefix, secret_hash) = generate_api_key()?;
    let record = integration_repository::rotate_api_key(
        db,
        tenant,
        branch,
        &old.id,
        &old.name,
        &prefix,
        &secret_hash,
        &json!(scopes),
        &json!(ip_allowlist),
        rate_limit_per_minute,
        old.expires_at,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to rotate API key"))?
    .ok_or_else(|| AppError::not_found("active API key was not found"))?;
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "api_client.rotated",
        json!({"apiClientId": record.id, "rotatedFromId": old.id, "name": record.name, "scopes": record.scopes_json, "ipAllowlist": record.ip_allowlist_json, "rateLimitPerMinute": record.rate_limit_per_minute}),
    )
    .await;
    Ok(ApiKeyCreated { record, api_key })
}

pub async fn revoke_api_key(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<(), AppError> {
    if !integration_repository::revoke_api_key(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to revoke API key"))?
    {
        return Err(AppError::not_found("active API key was not found"));
    }
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "api_client.revoked",
        json!({"apiClientId": id}),
    )
    .await;
    Ok(())
}

pub async fn authenticate_api_key(
    db: &PgPool,
    redis: &RedisClient,
    api_key: &str,
    required_scope: &str,
    source_ip: Option<&str>,
) -> Result<ApiKeyCredential, AppError> {
    let prefix = api_key.chars().take(17).collect::<String>();
    let credential = integration_repository::active_api_key(db, &prefix)
        .await
        .map_err(|_| AppError::internal("failed to authenticate API key"))?
        .ok_or_else(|| AppError::unauthenticated("invalid API key"))?;
    if !auth_service::verify_password(api_key, &credential.secret_hash) {
        return Err(AppError::unauthenticated("invalid API key"));
    }
    let allowed = credential
        .scopes_json
        .as_array()
        .into_iter()
        .flatten()
        .any(|scope| scope.as_str() == Some(required_scope));
    if !allowed {
        return Err(AppError::forbidden("API key scope is not allowed"));
    }
    ensure_source_ip_allowed(&credential.ip_allowlist_json, source_ip)?;
    entitlement_service::ensure_feature(db, &credential.tenant_id, "staff.api").await?;
    enforce_api_key_rate_limit(redis, &credential).await?;
    integration_repository::touch_api_key(db, &credential.id)
        .await
        .map_err(|_| AppError::internal("failed to record API key usage"))?;
    Ok(credential)
}

pub async fn api_clients(
    db: &PgPool,
    credential: &ApiKeyCredential,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    integration_repository::api_clients(
        db,
        &credential.tenant_id,
        &credential.branch_id,
        limit.clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to list integration clients"))
}
pub async fn api_appointments(
    db: &PgPool,
    credential: &ApiKeyCredential,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    integration_repository::api_appointments(
        db,
        &credential.tenant_id,
        &credential.branch_id,
        limit.clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to list integration appointments"))
}
pub async fn api_sales(
    db: &PgPool,
    credential: &ApiKeyCredential,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    integration_repository::api_sales(
        db,
        &credential.tenant_id,
        &credential.branch_id,
        limit.clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to list integration sales"))
}
pub async fn api_staff(
    db: &PgPool,
    credential: &ApiKeyCredential,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    integration_repository::api_staff(
        db,
        &credential.tenant_id,
        &credential.branch_id,
        limit.clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to list integration staff"))
}

pub async fn list_webhooks(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<WebhookView>, AppError> {
    Ok(integration_repository::list_webhooks(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list webhooks"))?
        .into_iter()
        .map(webhook_view)
        .collect())
}

pub async fn create_webhook(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    actor: &str,
    name: &str,
    endpoint: &str,
    events: Vec<String>,
) -> Result<WebhookCreated, AppError> {
    validate_webhook(name, endpoint, &events)?;
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "webhook secret encryption is not configured",
        )
    })?;
    let secret = format!(
        "whsec_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let ciphertext = security_service::encrypt_secret(encryption_key, &secret)?;
    let record = integration_repository::insert_webhook(
        db,
        tenant,
        branch,
        name.trim(),
        endpoint.trim(),
        &json!(events),
        &ciphertext,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create webhook"))?;
    Ok(WebhookCreated {
        record: webhook_view(record),
        signing_secret: secret,
    })
}

pub async fn rotate_webhook_secret(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<WebhookCreated, AppError> {
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "webhook secret encryption is not configured",
        )
    })?;
    let secret = format!(
        "whsec_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let ciphertext = security_service::encrypt_secret(encryption_key, &secret)?;
    let record =
        integration_repository::update_webhook_secret(db, tenant, branch, id, &ciphertext, actor)
            .await
            .map_err(|_| AppError::internal("failed to rotate webhook secret"))?
            .ok_or_else(|| AppError::not_found("webhook was not found"))?;
    Ok(WebhookCreated {
        record: webhook_view(record),
        signing_secret: secret,
    })
}

pub async fn deactivate_webhook(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<(), AppError> {
    if !integration_repository::deactivate_webhook(db, tenant, branch, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to deactivate webhook"))?
    {
        return Err(AppError::not_found("active webhook was not found"));
    }
    Ok(())
}

pub async fn test_webhook(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<(), AppError> {
    if !integration_repository::enqueue_webhook_test(db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to queue webhook test"))?
    {
        return Err(AppError::not_found("active webhook was not found"));
    }
    Ok(())
}

pub async fn webhook_logs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    subscription: Option<&str>,
) -> Result<Vec<WebhookDeliveryLog>, AppError> {
    integration_repository::webhook_logs(db, tenant, branch, subscription)
        .await
        .map_err(|_| AppError::internal("failed to list webhook delivery logs"))
}

pub async fn process_webhooks(db: &PgPool, settings: &Settings) -> Result<usize, AppError> {
    let Some(encryption_key) = settings.security_encryption_key.as_deref() else {
        return Ok(0);
    };
    let rows = integration_repository::claim_webhook_deliveries(db, 50)
        .await
        .map_err(|_| AppError::internal("failed to claim webhook deliveries"))?;
    let mut delivered = 0;
    for row in rows {
        let secret = security_service::decrypt_secret(encryption_key, &row.secret_ciphertext)?;
        let body = serde_json::to_string(&row.payload_json)
            .map_err(|_| AppError::internal("failed to serialize webhook"))?;
        let signature = sign(&secret, &format!("{}.{}", row.event_id, body))?;
        let response = reqwest::Client::new()
            .post(&row.endpoint_url)
            .header("content-type", "application/json")
            .header("x-aurashine-event", &row.event_type)
            .header("x-aurashine-delivery", &row.event_id)
            .header("x-aurashine-signature", format!("sha256={signature}"))
            .body(body)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                integration_repository::mark_webhook_delivered(
                    db,
                    &row.id,
                    response.status().as_u16() as i32,
                )
                .await
                .map_err(|_| AppError::internal("failed to complete webhook delivery"))?;
                delivered += 1;
            }
            Ok(response) => integration_repository::mark_webhook_failed(
                db,
                &row,
                Some(response.status().as_u16() as i32),
                "endpoint rejected webhook",
            )
            .await
            .map_err(|_| AppError::internal("failed to reschedule webhook"))?,
            Err(_) => {
                integration_repository::mark_webhook_failed(db, &row, None, "endpoint unavailable")
                    .await
                    .map_err(|_| AppError::internal("failed to reschedule webhook"))?
            }
        }
    }
    Ok(delivered)
}

pub async fn list_connectors(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ConnectorView>, AppError> {
    let saved = integration_repository::list_connectors(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list connectors"))?;
    let api_keys = integration_repository::list_api_keys(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load Zapier API status"))?;
    let webhooks = integration_repository::list_webhooks(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load Zapier webhook status"))?;
    let zapier_active =
        api_keys.iter().any(|row| row.status == "active") || webhooks.iter().any(|row| row.active);
    Ok([
        ConnectorProvider::QuickBooks,
        ConnectorProvider::Xero,
        ConnectorProvider::NetSuite,
        ConnectorProvider::Google,
        ConnectorProvider::Zapier,
        ConnectorProvider::Zenoti,
        ConnectorProvider::Dingg,
    ]
    .into_iter()
    .map(|provider| {
        let record = saved.iter().find(|row| row.provider == provider.code());
        let (configured, auth_mode) = if provider == ConnectorProvider::Zapier {
            (true, "api_key_webhook")
        } else if provider == ConnectorProvider::Zenoti {
            (settings.security_encryption_key.is_some(), "api_key")
        } else if provider == ConnectorProvider::Dingg {
            (settings.security_encryption_key.is_some(), "partner_export")
        } else {
            (
                connector_provider_configured(settings, provider),
                "oauth2_pkce",
            )
        };
        ConnectorView {
            provider: provider.code().into(),
            label: provider.label().into(),
            category: if matches!(
                provider,
                ConnectorProvider::Zenoti | ConnectorProvider::Dingg
            ) {
                "migration".into()
            } else if matches!(
                provider,
                ConnectorProvider::Google | ConnectorProvider::Zapier
            ) {
                "automation".into()
            } else {
                "accounting".into()
            },
            auth_mode: auth_mode.into(),
            configured,
            status: if provider == ConnectorProvider::Zapier {
                if zapier_active {
                    "connected"
                } else {
                    "available"
                }
                .into()
            } else {
                record
                    .map(|row| row.status.clone())
                    .unwrap_or_else(|| "disconnected".into())
            },
            external_account_id: record
                .map(|row| row.external_account_id.clone())
                .unwrap_or_default(),
            external_account_name: record
                .map(|row| row.external_account_name.clone())
                .unwrap_or_default(),
            last_synced_at: record.and_then(|row| row.last_synced_at),
            last_error: record.map(|row| row.last_error.clone()).unwrap_or_default(),
        }
    })
    .collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn begin_connector_oauth(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    actor: &str,
    provider: ConnectorProvider,
    return_uri: &str,
    account_id: Option<&str>,
) -> Result<ConnectorAuthorize, AppError> {
    if matches!(
        provider,
        ConnectorProvider::Zapier | ConnectorProvider::Zenoti | ConnectorProvider::Dingg
    ) {
        return Err(AppError::validation(
            "Zapier uses the existing scoped API keys and signed webhooks",
        ));
    }
    validate_connector_return_uri(settings, return_uri)?;
    let account_id = account_id.unwrap_or("").trim();
    if provider == ConnectorProvider::NetSuite
        && (account_id.is_empty()
            || account_id.len() > 80
            || !account_id
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-')))
    {
        return Err(AppError::validation("NetSuite account ID is required"));
    }
    let config_json = if account_id.is_empty() {
        json!({})
    } else {
        json!({"accountId": account_id})
    };
    let config = connector_oauth_config(settings, provider, &config_json)?;
    let state_value = random_connector_token(32);
    let verifier = random_connector_token(64);
    let challenge = URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()));
    integration_repository::save_connector_oauth_state(
        db,
        &connector_token_hash(&state_value),
        tenant,
        branch,
        provider.code(),
        actor,
        &verifier,
        return_uri,
        &config_json,
        Utc::now() + Duration::minutes(10),
    )
    .await
    .map_err(|_| AppError::internal("failed to start connector authorization"))?;
    let mut url = reqwest::Url::parse(&config.authorization_endpoint)
        .map_err(|_| AppError::internal("invalid connector authorization endpoint"))?;
    url.query_pairs_mut()
        .append_pair("client_id", config.client_id)
        .append_pair("redirect_uri", config.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", config.scope)
        .append_pair("state", &state_value)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if provider == ConnectorProvider::Google {
        url.query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    Ok(ConnectorAuthorize {
        authorization_url: url.to_string(),
    })
}

pub async fn connect_migration_provider(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    actor: &str,
    provider: ConnectorProvider,
    request: MigrationConnectorWrite,
) -> Result<ConnectorSyncJob, AppError> {
    if !matches!(
        provider,
        ConnectorProvider::Zenoti | ConnectorProvider::Dingg
    ) {
        return Err(AppError::validation(
            "provider does not use migration credentials",
        ));
    }
    let secret = request.credential.trim();
    if !(8..=4096).contains(&secret.len()) {
        return Err(AppError::validation("provider credential is invalid"));
    }
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "connector credential encryption is not configured",
        )
    })?;
    let config = crate::services::migration_provider_service::validated_config(provider, &request)?;
    let ciphertext = security_service::encrypt_secret(encryption_key, secret)?;
    integration_repository::upsert_connector(
        db,
        tenant,
        branch,
        provider.code(),
        provider.label(),
        config
            .get("accountId")
            .and_then(Value::as_str)
            .unwrap_or(""),
        "",
        &ciphertext,
        "",
        None,
        &json!(["migration.read"]),
        &config,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save migration connector"))?;
    let job = integration_repository::enqueue_connector_sync(
        db,
        tenant,
        branch,
        provider.code(),
        "manual",
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue migration connector"))?
    .ok_or_else(|| AppError::internal("failed to activate migration connector"))?;
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "integration.migration_connector.connected",
        json!({"provider":provider.code()}),
    )
    .await;
    Ok(job)
}

pub async fn finish_connector_oauth(
    db: &PgPool,
    settings: &Settings,
    provider: ConnectorProvider,
    code: &str,
    state_value: &str,
    provider_account_id: Option<&str>,
) -> Result<String, AppError> {
    let saved = integration_repository::consume_connector_oauth_state(
        db,
        &connector_token_hash(state_value),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate connector state"))?
    .ok_or_else(|| AppError::unauthenticated("invalid or expired connector state"))?;
    if saved.provider != provider.code() {
        return Err(AppError::unauthenticated("connector provider mismatch"));
    }
    let config = connector_oauth_config(settings, provider, &saved.config_json)?;
    let token = exchange_connector_token(&config, code, &saved.code_verifier).await?;
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "connector credential encryption is not configured",
        )
    })?;
    let access = security_service::encrypt_secret(encryption_key, &token.access_token)?;
    let refresh = if token.refresh_token.is_empty() {
        String::new()
    } else {
        security_service::encrypt_secret(encryption_key, &token.refresh_token)?
    };
    let external_account_id = provider_account_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| saved.config_json.get("accountId").and_then(Value::as_str))
        .unwrap_or("");
    let scopes = token
        .scope
        .split_whitespace()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    integration_repository::upsert_connector(
        db,
        &saved.tenant_id,
        &saved.branch_id,
        provider.code(),
        provider.label(),
        external_account_id,
        "",
        &access,
        &refresh,
        token
            .expires_in
            .map(|seconds| Utc::now() + Duration::seconds(seconds.max(60))),
        &json!(scopes),
        &saved.config_json,
        &saved.actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save connector authorization"))?;
    integration_repository::enqueue_connector_sync(
        db,
        &saved.tenant_id,
        &saved.branch_id,
        provider.code(),
        "oauth_callback",
        &saved.actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue connector verification"))?;
    let _ = security_service::record_audit(
        db,
        &saved.tenant_id,
        &saved.branch_id,
        &saved.actor_id,
        "integration.connector.connected",
        json!({"provider":provider.code()}),
    )
    .await;
    let mut return_url = reqwest::Url::parse(&saved.return_uri)
        .map_err(|_| AppError::internal("invalid connector return URL"))?;
    return_url
        .query_pairs_mut()
        .append_pair("connector", provider.code())
        .append_pair("connectorStatus", "connected");
    Ok(return_url.to_string())
}

pub async fn disconnect_connector(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    provider: ConnectorProvider,
) -> Result<(), AppError> {
    if provider == ConnectorProvider::Zapier {
        return Err(AppError::validation(
            "Revoke Zapier API keys and deactivate its webhooks instead",
        ));
    }
    if !integration_repository::disconnect_connector(db, tenant, branch, provider.code(), actor)
        .await
        .map_err(|_| AppError::internal("failed to disconnect connector"))?
    {
        return Err(AppError::not_found("active connector was not found"));
    }
    let _ = security_service::record_audit(
        db,
        tenant,
        branch,
        actor,
        "integration.connector.disconnected",
        json!({"provider":provider.code()}),
    )
    .await;
    Ok(())
}

pub async fn queue_connector_sync(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    provider: ConnectorProvider,
) -> Result<ConnectorSyncJob, AppError> {
    if provider == ConnectorProvider::Zapier {
        return Err(AppError::validation(
            "Zapier delivery is driven by signed webhook events",
        ));
    }
    integration_repository::enqueue_connector_sync(
        db,
        tenant,
        branch,
        provider.code(),
        "manual",
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue connector sync"))?
    .ok_or_else(|| AppError::not_found("connected provider was not found"))
}

pub async fn list_connector_sync_jobs(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<ConnectorSyncJob>, AppError> {
    integration_repository::list_connector_sync_jobs(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list connector sync jobs"))
}

pub async fn process_connector_sync_jobs(
    db: &PgPool,
    settings: &Settings,
) -> Result<usize, AppError> {
    let jobs = integration_repository::claim_connector_sync_jobs(db, 20)
        .await
        .map_err(|_| AppError::internal("failed to claim connector sync jobs"))?;
    let mut completed = 0;
    for job in jobs {
        let result = if matches!(job.provider.as_str(), "zenoti" | "dingg") {
            crate::services::migration_provider_service::run(db, settings, &job).await
        } else {
            run_connector_check(db, settings, &job.tenant_id, &job.branch_id, &job.provider).await
        };
        match result {
            Ok((summary, account_id, account_name)) => {
                integration_repository::complete_connector_sync(
                    db,
                    &job.id,
                    &job.connection_id,
                    &summary,
                    &account_id,
                    &account_name,
                )
                .await
                .map_err(|_| AppError::internal("failed to complete connector sync"))?;
                completed += 1;
            }
            Err(error) => {
                integration_repository::fail_connector_sync(db, &job, &safe_connector_error(&error))
                    .await
                    .map_err(|_| AppError::internal("failed to reschedule connector sync"))?
            }
        }
    }
    Ok(completed)
}

async fn run_connector_check(
    db: &PgPool,
    settings: &Settings,
    tenant: &str,
    branch: &str,
    provider_code: &str,
) -> Result<(Value, String, String), AppError> {
    let provider = ConnectorProvider::parse(provider_code)?;
    let credential =
        integration_repository::connector_credential(db, tenant, branch, provider.code())
            .await
            .map_err(|_| AppError::internal("failed to load connector credential"))?
            .ok_or_else(|| AppError::not_found("connector credential was not found"))?;
    let encryption_key = settings.security_encryption_key.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "SECURITY_ENCRYPTION_NOT_CONFIGURED",
            "connector credential encryption is not configured",
        )
    })?;
    let access_token =
        current_connector_token(db, settings, provider, &credential, encryption_key).await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| AppError::internal("failed to initialize connector client"))?;
    let url = match provider {
        ConnectorProvider::QuickBooks => {
            if credential.external_account_id.is_empty() {
                return Err(AppError::validation("QuickBooks company ID is missing"));
            }
            format!(
                "https://quickbooks.api.intuit.com/v3/company/{0}/companyinfo/{0}?minorversion=75",
                credential.external_account_id
            )
        }
        ConnectorProvider::Xero => "https://api.xero.com/connections".into(),
        ConnectorProvider::Google => {
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1".into()
        }
        ConnectorProvider::NetSuite => {
            let account = credential
                .config_json
                .get("accountId")
                .and_then(Value::as_str)
                .unwrap_or("");
            if account.is_empty() {
                return Err(AppError::validation("NetSuite account ID is missing"));
            }
            let domain = account.to_ascii_lowercase().replace('_', "-");
            format!("https://{domain}.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog")
        }
        ConnectorProvider::Zapier => {
            return Err(AppError::validation(
                "Zapier does not use connector sync jobs",
            ))
        }
        ConnectorProvider::Zenoti | ConnectorProvider::Dingg => {
            return Err(AppError::validation(
                "migration connectors use the migration worker",
            ))
        }
    };
    let response = client
        .get(url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "CONNECTOR_UNAVAILABLE",
                "connector provider is unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "CONNECTOR_REJECTED",
            "connector authorization was rejected",
        ));
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| AppError::internal("invalid connector response"))?;
    let (account_id, account_name) = match provider {
        ConnectorProvider::QuickBooks => {
            let info = value
                .pointer("/QueryResponse/CompanyInfo/0")
                .or_else(|| value.get("CompanyInfo"));
            (
                credential.external_account_id.clone(),
                info.and_then(|v| v.get("CompanyName"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        }
        ConnectorProvider::Xero => {
            let first = value.as_array().and_then(|rows| rows.first());
            (
                first
                    .and_then(|v| v.get("tenantId"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                first
                    .and_then(|v| v.get("tenantName"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        }
        ConnectorProvider::Google => {
            let first = value
                .get("items")
                .and_then(Value::as_array)
                .and_then(|rows| rows.first());
            (
                first
                    .and_then(|v| v.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                first
                    .and_then(|v| v.get("summary"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )
        }
        ConnectorProvider::NetSuite => (
            credential.external_account_id.clone(),
            credential.external_account_id.clone(),
        ),
        ConnectorProvider::Zapier => (String::new(), String::new()),
        ConnectorProvider::Zenoti | ConnectorProvider::Dingg => (String::new(), String::new()),
    };
    Ok((
        json!({"verified":true,"provider":provider.code()}),
        account_id,
        account_name,
    ))
}

async fn current_connector_token(
    db: &PgPool,
    settings: &Settings,
    provider: ConnectorProvider,
    credential: &ConnectorCredential,
    encryption_key: &str,
) -> Result<String, AppError> {
    let access =
        security_service::decrypt_secret(encryption_key, &credential.access_token_ciphertext)?;
    if credential
        .token_expires_at
        .is_none_or(|expiry| expiry > Utc::now() + Duration::seconds(60))
    {
        return Ok(access);
    }
    if credential.refresh_token_ciphertext.is_empty() {
        return Err(AppError::unauthenticated(
            "connector authorization has expired",
        ));
    }
    let refresh =
        security_service::decrypt_secret(encryption_key, &credential.refresh_token_ciphertext)?;
    let config = connector_oauth_config(settings, provider, &credential.config_json)?;
    let token = refresh_connector_token(&config, &refresh).await?;
    let access_ciphertext = security_service::encrypt_secret(encryption_key, &token.access_token)?;
    let refresh_ciphertext = if token.refresh_token.is_empty() {
        String::new()
    } else {
        security_service::encrypt_secret(encryption_key, &token.refresh_token)?
    };
    integration_repository::update_connector_access_token(
        db,
        &credential.id,
        &access_ciphertext,
        &refresh_ciphertext,
        token
            .expires_in
            .map(|seconds| Utc::now() + Duration::seconds(seconds.max(60))),
    )
    .await
    .map_err(|_| AppError::internal("failed to refresh connector authorization"))?;
    Ok(token.access_token)
}

async fn exchange_connector_token(
    config: &ConnectorOauthConfig<'_>,
    code: &str,
    verifier: &str,
) -> Result<ConnectorTokenResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| AppError::internal("failed to initialize connector client"))?;
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", config.redirect_uri),
        ("code_verifier", verifier),
    ];
    if config.credentials_in_body {
        form.push(("client_id", config.client_id));
        form.push(("client_secret", config.client_secret));
    }
    let mut request = client.post(&config.token_endpoint);
    if !config.credentials_in_body {
        request = request.basic_auth(config.client_id, Some(config.client_secret));
    }
    request
        .form(&form)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "CONNECTOR_UNAVAILABLE",
                "connector provider is unavailable",
            )
        })?
        .error_for_status()
        .map_err(|_| AppError::unauthenticated("connector authorization code was rejected"))?
        .json()
        .await
        .map_err(|_| AppError::unauthenticated("invalid connector token response"))
}

async fn refresh_connector_token(
    config: &ConnectorOauthConfig<'_>,
    refresh_token: &str,
) -> Result<ConnectorTokenResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| AppError::internal("failed to initialize connector client"))?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ];
    if config.credentials_in_body {
        form.push(("client_id", config.client_id));
        form.push(("client_secret", config.client_secret));
    }
    let mut request = client.post(&config.token_endpoint);
    if !config.credentials_in_body {
        request = request.basic_auth(config.client_id, Some(config.client_secret));
    }
    request
        .form(&form)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "CONNECTOR_UNAVAILABLE",
                "connector provider is unavailable",
            )
        })?
        .error_for_status()
        .map_err(|_| AppError::unauthenticated("connector refresh token was rejected"))?
        .json()
        .await
        .map_err(|_| AppError::unauthenticated("invalid connector refresh response"))
}

fn connector_oauth_config<'a>(
    settings: &'a Settings,
    provider: ConnectorProvider,
    config_json: &Value,
) -> Result<ConnectorOauthConfig<'a>, AppError> {
    let missing = || {
        AppError::service_unavailable(
            "CONNECTOR_NOT_CONFIGURED",
            "connector provider is not configured",
        )
    };
    match provider {
        ConnectorProvider::QuickBooks => Ok(ConnectorOauthConfig {
            client_id: settings
                .connector_quickbooks_client_id
                .as_deref()
                .ok_or_else(missing)?,
            client_secret: settings
                .connector_quickbooks_client_secret
                .as_deref()
                .ok_or_else(missing)?,
            redirect_uri: settings
                .connector_quickbooks_redirect_uri
                .as_deref()
                .ok_or_else(missing)?,
            authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2".into(),
            token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer".into(),
            scope: "com.intuit.quickbooks.accounting openid profile email",
            credentials_in_body: false,
        }),
        ConnectorProvider::Xero => Ok(ConnectorOauthConfig {
            client_id: settings
                .connector_xero_client_id
                .as_deref()
                .ok_or_else(missing)?,
            client_secret: settings
                .connector_xero_client_secret
                .as_deref()
                .ok_or_else(missing)?,
            redirect_uri: settings
                .connector_xero_redirect_uri
                .as_deref()
                .ok_or_else(missing)?,
            authorization_endpoint: "https://login.xero.com/identity/connect/authorize".into(),
            token_endpoint: "https://identity.xero.com/connect/token".into(),
            scope:
                "openid profile email accounting.transactions accounting.settings offline_access",
            credentials_in_body: false,
        }),
        ConnectorProvider::Google => Ok(ConnectorOauthConfig {
            client_id: settings
                .connector_google_client_id
                .as_deref()
                .ok_or_else(missing)?,
            client_secret: settings
                .connector_google_client_secret
                .as_deref()
                .ok_or_else(missing)?,
            redirect_uri: settings
                .connector_google_redirect_uri
                .as_deref()
                .ok_or_else(missing)?,
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_endpoint: "https://oauth2.googleapis.com/token".into(),
            scope: "openid email https://www.googleapis.com/auth/calendar",
            credentials_in_body: true,
        }),
        ConnectorProvider::NetSuite => {
            let account = config_json
                .get("accountId")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| AppError::validation("NetSuite account ID is required"))?;
            let domain = account.to_ascii_lowercase().replace('_', "-");
            Ok(ConnectorOauthConfig{client_id:settings.connector_netsuite_client_id.as_deref().ok_or_else(missing)?,client_secret:settings.connector_netsuite_client_secret.as_deref().ok_or_else(missing)?,redirect_uri:settings.connector_netsuite_redirect_uri.as_deref().ok_or_else(missing)?,authorization_endpoint:format!("https://{domain}.app.netsuite.com/app/login/oauth2/authorize.nl"),token_endpoint:format!("https://{domain}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token"),scope:"rest_webservices",credentials_in_body:false})
        }
        ConnectorProvider::Zapier => Err(AppError::validation("Zapier uses API keys and webhooks")),
        ConnectorProvider::Zenoti | ConnectorProvider::Dingg => Err(AppError::validation(
            "migration connectors do not use OAuth",
        )),
    }
}

fn connector_provider_configured(settings: &Settings, provider: ConnectorProvider) -> bool {
    match provider {
        ConnectorProvider::QuickBooks => {
            settings.connector_quickbooks_client_id.is_some()
                && settings.connector_quickbooks_client_secret.is_some()
                && settings.connector_quickbooks_redirect_uri.is_some()
        }
        ConnectorProvider::Xero => {
            settings.connector_xero_client_id.is_some()
                && settings.connector_xero_client_secret.is_some()
                && settings.connector_xero_redirect_uri.is_some()
        }
        ConnectorProvider::NetSuite => {
            settings.connector_netsuite_client_id.is_some()
                && settings.connector_netsuite_client_secret.is_some()
                && settings.connector_netsuite_redirect_uri.is_some()
        }
        ConnectorProvider::Google => {
            settings.connector_google_client_id.is_some()
                && settings.connector_google_client_secret.is_some()
                && settings.connector_google_redirect_uri.is_some()
        }
        ConnectorProvider::Zapier => true,
        ConnectorProvider::Zenoti | ConnectorProvider::Dingg => {
            settings.security_encryption_key.is_some()
        }
    }
}

fn validate_connector_return_uri(settings: &Settings, value: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| AppError::validation("invalid connector return URI"))?;
    let local = crate::config::is_local_env(&settings.app_env)
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err(AppError::validation("connector return URI must use HTTPS"));
    }
    let origin = url.origin().ascii_serialization();
    if !local
        && !settings
            .cors_allowed_origins
            .iter()
            .any(|allowed| allowed.trim_end_matches('/') == origin)
    {
        return Err(AppError::forbidden(
            "connector return URI is not an allowed origin",
        ));
    }
    Ok(())
}

fn random_connector_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}
fn connector_token_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn safe_connector_error(error: &AppError) -> String {
    if error.code().starts_with("ZENOTI_") || error.code().starts_with("DINGG_") {
        error.code().into()
    } else {
        "provider connection check failed".into()
    }
}

fn validate_scopes(scopes: &[String]) -> Result<(), AppError> {
    if scopes.is_empty()
        || scopes.len() > API_SCOPES.len()
        || scopes
            .iter()
            .any(|scope| !API_SCOPES.contains(&scope.as_str()))
        || scopes
            .iter()
            .enumerate()
            .any(|(index, scope)| scopes[..index].contains(scope))
    {
        return Err(AppError::validation("API key scopes are invalid"));
    }
    Ok(())
}
fn validate_expiry(expires_at: Option<DateTime<Utc>>) -> Result<(), AppError> {
    if expires_at.is_some_and(|value| value <= Utc::now()) {
        return Err(AppError::validation("API key expiry must be in the future"));
    }
    Ok(())
}
fn normalize_ip_allowlist(values: Vec<String>) -> Result<Vec<String>, AppError> {
    if values.len() > 100 {
        return Err(AppError::validation("API key IP allowlist is invalid"));
    }
    values
        .into_iter()
        .map(|value| {
            value
                .trim()
                .parse::<IpAddr>()
                .map(|ip| ip.to_string())
                .map_err(|_| AppError::validation("API key IP allowlist is invalid"))
        })
        .collect::<Result<BTreeSet<_>, _>>()
        .map(BTreeSet::into_iter)
        .map(Iterator::collect)
}
fn validate_rate_limit(value: Option<i32>) -> Result<i32, AppError> {
    let value = value.unwrap_or(DEFAULT_API_RATE_LIMIT_PER_MINUTE);
    if !(1..=10_000).contains(&value) {
        return Err(AppError::validation("API key rate limit is invalid"));
    }
    Ok(value)
}
fn ensure_source_ip_allowed(allowlist: &Value, source_ip: Option<&str>) -> Result<(), AppError> {
    let allowed = allowlist
        .as_array()
        .ok_or_else(|| AppError::internal("API key IP policy is invalid"))?;
    if allowed.is_empty() {
        return Ok(());
    }
    let source_ip = source_ip
        .and_then(|value| value.parse::<IpAddr>().ok())
        .ok_or_else(|| AppError::forbidden("API key is not allowed from this IP address"))?;
    if allowed
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|value| value.parse::<IpAddr>().ok())
        .any(|value| value == source_ip)
    {
        return Ok(());
    }
    Err(AppError::forbidden(
        "API key is not allowed from this IP address",
    ))
}
async fn enforce_api_key_rate_limit(
    redis: &RedisClient,
    credential: &ApiKeyCredential,
) -> Result<(), AppError> {
    let mut connection = redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "API_RATE_LIMIT_UNAVAILABLE",
                "API key rate limit store is unavailable",
            )
        })?;
    let count: i64 = redis::cmd("EVAL")
        .arg("local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count")
        .arg(1)
        .arg(format!("integration_api_key_rate:{}", credential.id))
        .arg(60)
        .query_async(&mut connection)
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "API_RATE_LIMIT_UNAVAILABLE",
                "API key rate limit store is unavailable",
            )
        })?;
    if count > i64::from(credential.rate_limit_per_minute) {
        return Err(AppError::rate_limited(
            "API key request limit exceeded; try again later",
        ));
    }
    Ok(())
}
fn generate_api_key() -> Result<(String, String, String), AppError> {
    let api_key = format!(
        "ask_live_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let prefix = api_key.chars().take(17).collect::<String>();
    let secret_hash = auth_service::hash_password(&api_key)
        .map_err(|_| AppError::internal("failed to protect API key"))?;
    Ok((api_key, prefix, secret_hash))
}
fn validate_webhook(name: &str, endpoint: &str, events: &[String]) -> Result<(), AppError> {
    let parsed = reqwest::Url::parse(endpoint).ok();
    let host = parsed
        .as_ref()
        .and_then(reqwest::Url::host_str)
        .unwrap_or("");
    let private_ip = host.parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_loopback() || ip.is_unspecified(),
    });
    if name.trim().is_empty()
        || name.chars().count() > 120
        || parsed.as_ref().is_none_or(|url| url.scheme() != "https")
        || host.is_empty()
        || host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".local")
        || private_ip
        || endpoint.len() > 2048
    {
        return Err(AppError::validation(
            "webhook name or HTTPS endpoint is invalid",
        ));
    }
    if events.is_empty()
        || events.len() > WEBHOOK_EVENTS.len()
        || events
            .iter()
            .any(|event| !WEBHOOK_EVENTS.contains(&event.as_str()))
    {
        return Err(AppError::validation("webhook events are invalid"));
    }
    Ok(())
}
fn webhook_view(row: WebhookRecord) -> WebhookView {
    WebhookView {
        id: row.id,
        name: row.name,
        endpoint_url: row.endpoint_url,
        events: row.events_json,
        active: row.active,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
fn sign(secret: &str, message: &str) -> Result<String, AppError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("failed to sign webhook"))?;
    mac.update(message.as_bytes());
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        connector_token_hash, ensure_source_ip_allowed, normalize_ip_allowlist, sign,
        validate_expiry, validate_rate_limit, validate_scopes, validate_webhook, ConnectorProvider,
    };
    use chrono::{Duration, Utc};
    use serde_json::json;
    #[test]
    fn integration_inputs_are_scoped_and_signed() {
        assert!(validate_scopes(&["clients.read".into()]).is_ok());
        assert!(validate_scopes(&["staff.read".into()]).is_ok());
        assert!(validate_scopes(&["admin".into()]).is_err());
        assert!(validate_scopes(&["clients.read".into(), "clients.read".into()]).is_err());
        assert!(validate_expiry(Some(Utc::now() - Duration::minutes(1))).is_err());
        assert!(validate_expiry(Some(Utc::now() + Duration::minutes(1))).is_ok());
        assert_eq!(
            normalize_ip_allowlist(vec!["127.0.0.1".into(), "127.0.0.1".into()]).unwrap(),
            vec!["127.0.0.1"]
        );
        assert!(normalize_ip_allowlist(vec!["not-an-ip".into()]).is_err());
        assert!(ensure_source_ip_allowed(&json!(["127.0.0.1"]), Some("127.0.0.1")).is_ok());
        assert!(ensure_source_ip_allowed(&json!(["127.0.0.1"]), Some("10.0.0.1")).is_err());
        assert_eq!(validate_rate_limit(None).unwrap(), 60);
        assert!(validate_rate_limit(Some(0)).is_err());
        assert!(validate_webhook(
            "CRM",
            "https://example.com/hook",
            &["client.created".into()]
        )
        .is_ok());
        assert!(validate_webhook("CRM", "http://example.com", &["client.created".into()]).is_err());
        assert_eq!(sign("secret", "event.body").unwrap().len(), 64);
        assert_eq!(
            ConnectorProvider::parse("QuickBooks").unwrap().code(),
            "quickbooks"
        );
        assert!(ConnectorProvider::parse("unknown").is_err());
        assert_eq!(connector_token_hash("state").len(), 64);
    }
}
