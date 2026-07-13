use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct Settings {
    pub app_env: String,
    pub app_host: String,
    pub app_port: u16,
    pub database_url: String,
    pub redis_url: String,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
    pub jwt_access_ttl_minutes: u64,
    pub jwt_refresh_ttl_days: u64,
    pub oauth_google_client_id: Option<String>,
    pub oauth_google_client_secret: Option<String>,
    pub oauth_google_redirect_uri: Option<String>,
    pub oauth_microsoft_client_id: Option<String>,
    pub oauth_microsoft_client_secret: Option<String>,
    pub oauth_microsoft_redirect_uri: Option<String>,
    pub aws_region: Option<String>,
    pub aws_s3_bucket: Option<String>,
    pub cors_allowed_origins: Vec<String>,
    pub enable_dev_session: bool,
    pub dev_session_secret: Option<String>,
    pub invoice_delivery_webhook_url: Option<String>,
    pub invoice_delivery_webhook_token: Option<String>,
    pub whatsapp_cloud_access_token: Option<String>,
    pub whatsapp_cloud_phone_number_id: Option<String>,
    pub whatsapp_cloud_app_secret: Option<String>,
    pub whatsapp_cloud_verify_token: Option<String>,
    pub whatsapp_invoice_template_name: Option<String>,
    pub razorpay_key_id: Option<String>,
    pub razorpay_key_secret: Option<String>,
    pub razorpay_webhook_secret: Option<String>,
}

impl Settings {
    pub fn load() -> Result<Self> {
        dotenvy::dotenv().ok();
        let manifest_env = Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
        if manifest_env.exists() {
            dotenvy::from_filename(manifest_env).ok();
        }

        let app_env = var_or_required("APP_ENV")?.trim().to_lowercase();
        if app_env.is_empty() {
            return Err(anyhow!("APP_ENV must not be empty"));
        }
        let jwt_access_secret = secure_secret("JWT_ACCESS_SECRET")?;
        let jwt_refresh_secret = secure_secret("JWT_REFRESH_SECRET")?;
        let cors_allowed_origins = csv_var("CORS_ALLOWED_ORIGINS");
        let enable_dev_session = var_or_parse("ENABLE_DEV_SESSION", false)?;
        if !is_local_env(&app_env) && cors_allowed_origins.is_empty() {
            return Err(anyhow!(
                "CORS_ALLOWED_ORIGINS is required unless APP_ENV is development, local, or test"
            ));
        }
        if enable_dev_session && !is_local_env(&app_env) {
            return Err(anyhow!(
                "ENABLE_DEV_SESSION is only allowed for local development"
            ));
        }
        let dev_session_secret = optional_secure_secret("DEV_SESSION_SECRET")?;
        if enable_dev_session && dev_session_secret.is_none() {
            return Err(anyhow!(
                "DEV_SESSION_SECRET is required when ENABLE_DEV_SESSION=true"
            ));
        }

        Ok(Settings {
            app_env,
            app_host: var_or("APP_HOST", "0.0.0.0"),
            app_port: var_or_parse("APP_PORT", 8080)?,
            database_url: var_or_required("DATABASE_URL")?,
            redis_url: var_or_required("REDIS_URL")?,
            jwt_access_secret,
            jwt_refresh_secret,
            jwt_access_ttl_minutes: var_or_parse("JWT_ACCESS_TTL_MINUTES", 15)?,
            jwt_refresh_ttl_days: var_or_parse("JWT_REFRESH_TTL_DAYS", 30)?,
            oauth_google_client_id: std::env::var("OAUTH_GOOGLE_CLIENT_ID")
                .ok()
                .filter(|v| !v.is_empty()),
            oauth_google_client_secret: std::env::var("OAUTH_GOOGLE_CLIENT_SECRET")
                .ok()
                .filter(|v| !v.is_empty()),
            oauth_google_redirect_uri: std::env::var("OAUTH_GOOGLE_REDIRECT_URI")
                .ok()
                .filter(|v| !v.is_empty()),
            oauth_microsoft_client_id: std::env::var("OAUTH_MICROSOFT_CLIENT_ID")
                .ok()
                .filter(|v| !v.is_empty()),
            oauth_microsoft_client_secret: std::env::var("OAUTH_MICROSOFT_CLIENT_SECRET")
                .ok()
                .filter(|v| !v.is_empty()),
            oauth_microsoft_redirect_uri: std::env::var("OAUTH_MICROSOFT_REDIRECT_URI")
                .ok()
                .filter(|v| !v.is_empty()),
            aws_region: std::env::var("AWS_REGION").ok().filter(|v| !v.is_empty()),
            aws_s3_bucket: std::env::var("AWS_S3_BUCKET")
                .ok()
                .filter(|v| !v.is_empty()),
            cors_allowed_origins,
            enable_dev_session,
            dev_session_secret,
            invoice_delivery_webhook_url: std::env::var("INVOICE_DELIVERY_WEBHOOK_URL")
                .ok()
                .filter(|value| value.starts_with("https://")),
            invoice_delivery_webhook_token: std::env::var("INVOICE_DELIVERY_WEBHOOK_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            whatsapp_cloud_access_token: std::env::var("WHATSAPP_CLOUD_ACCESS_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            whatsapp_cloud_phone_number_id: std::env::var("WHATSAPP_CLOUD_PHONE_NUMBER_ID")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            whatsapp_cloud_app_secret: std::env::var("WHATSAPP_CLOUD_APP_SECRET")
                .ok()
                .filter(|value| value.trim().len() >= 32),
            whatsapp_cloud_verify_token: std::env::var("WHATSAPP_CLOUD_VERIFY_TOKEN")
                .ok()
                .filter(|value| value.trim().len() >= 32),
            whatsapp_invoice_template_name: std::env::var("WHATSAPP_INVOICE_TEMPLATE_NAME")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            razorpay_key_id: std::env::var("RAZORPAY_KEY_ID")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            razorpay_key_secret: std::env::var("RAZORPAY_KEY_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            razorpay_webhook_secret: std::env::var("RAZORPAY_WEBHOOK_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty()),
        })
    }

    pub fn whatsapp_cloud_enabled(&self) -> bool {
        self.whatsapp_cloud_access_token.is_some()
            && self.whatsapp_cloud_phone_number_id.is_some()
            && self.whatsapp_cloud_app_secret.is_some()
            && self.whatsapp_cloud_verify_token.is_some()
            && self.whatsapp_invoice_template_name.is_some()
    }

    pub fn whatsapp_cloud_webhook_configured(&self) -> bool {
        self.whatsapp_cloud_app_secret.is_some() && self.whatsapp_cloud_verify_token.is_some()
    }

    pub fn invoice_delivery_configured(&self) -> bool {
        self.invoice_delivery_webhook_url.is_some() || self.whatsapp_cloud_enabled()
    }

    pub fn razorpay_payment_links_enabled(&self) -> bool {
        self.razorpay_key_id.is_some() && self.razorpay_key_secret.is_some()
    }

    pub fn razorpay_webhook_configured(&self) -> bool {
        self.razorpay_webhook_secret.is_some()
    }
}

pub fn is_local_env(app_env: &str) -> bool {
    matches!(app_env, "development" | "local" | "test")
}

fn var_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn var_or_required(key: &str) -> Result<String> {
    let value = std::env::var(key)
        .with_context(|| format!("Missing required environment variable: {}", key))?;
    if value.trim().is_empty() {
        return Err(anyhow!("{} must not be empty", key));
    }
    Ok(value)
}

fn secure_secret(key: &str) -> Result<String> {
    let value = var_or_required(key)?;
    validate_secret(key, value.trim())
}

fn optional_secure_secret(key: &str) -> Result<Option<String>> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => validate_secret(key, value.trim()).map(Some),
        _ => Ok(None),
    }
}

fn validate_secret(key: &str, trimmed: &str) -> Result<String> {
    let unsafe_defaults = [
        "change_me_access_secret",
        "change_me_refresh_secret",
        "change_me",
        "secret",
        "password",
    ];
    if trimmed.len() < 32
        || unsafe_defaults
            .iter()
            .any(|default| trimmed.eq_ignore_ascii_case(default))
    {
        return Err(anyhow!(
            "{} must be set to a non-default secret with at least 32 characters",
            key
        ));
    }
    Ok(trimmed.to_string())
}

fn csv_var(key: &str) -> Vec<String> {
    std::env::var(key)
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn var_or_parse<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    <T as std::str::FromStr>::Err: std::fmt::Display,
{
    std::env::var(key).ok().map_or(Ok(default), |value| {
        value
            .parse::<T>()
            .map_err(|err| anyhow!("Invalid {} value: {}", key, err))
    })
}
