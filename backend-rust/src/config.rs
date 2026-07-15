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
    pub security_encryption_key: Option<String>,
    pub webauthn_rp_id: Option<String>,
    pub webauthn_rp_origin: Option<String>,
    pub oauth_google_client_id: Option<String>,
    pub oauth_google_client_secret: Option<String>,
    pub oauth_google_redirect_uri: Option<String>,
    pub oauth_microsoft_client_id: Option<String>,
    pub oauth_microsoft_client_secret: Option<String>,
    pub oauth_microsoft_redirect_uri: Option<String>,
    pub oauth_microsoft_tenant_id: Option<String>,
    pub oauth_saml_client_id: Option<String>,
    pub oauth_saml_client_secret: Option<String>,
    pub oauth_saml_redirect_uri: Option<String>,
    pub oauth_saml_issuer: Option<String>,
    pub oauth_saml_authorization_endpoint: Option<String>,
    pub oauth_saml_token_endpoint: Option<String>,
    pub oauth_saml_jwks_uri: Option<String>,
    pub connector_quickbooks_client_id: Option<String>,
    pub connector_quickbooks_client_secret: Option<String>,
    pub connector_quickbooks_redirect_uri: Option<String>,
    pub connector_xero_client_id: Option<String>,
    pub connector_xero_client_secret: Option<String>,
    pub connector_xero_redirect_uri: Option<String>,
    pub connector_netsuite_client_id: Option<String>,
    pub connector_netsuite_client_secret: Option<String>,
    pub connector_netsuite_redirect_uri: Option<String>,
    pub connector_google_client_id: Option<String>,
    pub connector_google_client_secret: Option<String>,
    pub connector_google_redirect_uri: Option<String>,
    pub aws_region: Option<String>,
    pub aws_s3_bucket: Option<String>,
    pub cors_allowed_origins: Vec<String>,
    pub enable_dev_session: bool,
    pub dev_session_secret: Option<String>,
    pub ai_service_url: Option<String>,
    pub ai_service_token: Option<String>,
    pub voice_provider_token: Option<String>,
    pub invoice_delivery_webhook_url: Option<String>,
    pub invoice_delivery_webhook_token: Option<String>,
    pub compliance_provider_url: Option<String>,
    pub compliance_provider_token: Option<String>,
    pub payroll_payout_provider_url: Option<String>,
    pub payroll_payout_provider_token: Option<String>,
    pub mobile_push_provider_url: Option<String>,
    pub mobile_push_provider_token: Option<String>,
    pub whatsapp_cloud_access_token: Option<String>,
    pub whatsapp_cloud_phone_number_id: Option<String>,
    pub whatsapp_cloud_app_secret: Option<String>,
    pub whatsapp_cloud_verify_token: Option<String>,
    pub whatsapp_invoice_template_name: Option<String>,
    pub whatsapp_benefit_template_name: Option<String>,
    pub razorpay_key_id: Option<String>,
    pub razorpay_key_secret: Option<String>,
    pub razorpay_webhook_secret: Option<String>,
    pub cashfree_client_id: Option<String>,
    pub cashfree_client_secret: Option<String>,
    pub phonepe_client_id: Option<String>,
    pub phonepe_client_secret: Option<String>,
    pub phonepe_client_version: Option<String>,
    pub phonepe_webhook_username: Option<String>,
    pub phonepe_webhook_password: Option<String>,
    pub payment_provider_environment: String,
    pub payment_return_url: Option<String>,
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
        let webauthn_rp_id = optional_value("WEBAUTHN_RP_ID");
        let webauthn_rp_origin = optional_value("WEBAUTHN_RP_ORIGIN");
        if webauthn_rp_id.is_some() != webauthn_rp_origin.is_some() {
            return Err(anyhow!(
                "WEBAUTHN_RP_ID and WEBAUTHN_RP_ORIGIN must be configured together"
            ));
        }
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
            security_encryption_key: optional_secure_secret("SECURITY_ENCRYPTION_KEY")?,
            webauthn_rp_id,
            webauthn_rp_origin,
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
            oauth_microsoft_tenant_id: optional_value("OAUTH_MICROSOFT_TENANT_ID"),
            oauth_saml_client_id: optional_value("OAUTH_SAML_CLIENT_ID"),
            oauth_saml_client_secret: optional_secure_secret("OAUTH_SAML_CLIENT_SECRET")?,
            oauth_saml_redirect_uri: optional_value("OAUTH_SAML_REDIRECT_URI"),
            oauth_saml_issuer: optional_value("OAUTH_SAML_ISSUER"),
            oauth_saml_authorization_endpoint: optional_value("OAUTH_SAML_AUTHORIZATION_ENDPOINT"),
            oauth_saml_token_endpoint: optional_value("OAUTH_SAML_TOKEN_ENDPOINT"),
            oauth_saml_jwks_uri: optional_value("OAUTH_SAML_JWKS_URI"),
            connector_quickbooks_client_id: optional_value("CONNECTOR_QUICKBOOKS_CLIENT_ID"),
            connector_quickbooks_client_secret: optional_secure_secret(
                "CONNECTOR_QUICKBOOKS_CLIENT_SECRET",
            )?,
            connector_quickbooks_redirect_uri: optional_value("CONNECTOR_QUICKBOOKS_REDIRECT_URI"),
            connector_xero_client_id: optional_value("CONNECTOR_XERO_CLIENT_ID"),
            connector_xero_client_secret: optional_secure_secret("CONNECTOR_XERO_CLIENT_SECRET")?,
            connector_xero_redirect_uri: optional_value("CONNECTOR_XERO_REDIRECT_URI"),
            connector_netsuite_client_id: optional_value("CONNECTOR_NETSUITE_CLIENT_ID"),
            connector_netsuite_client_secret: optional_secure_secret(
                "CONNECTOR_NETSUITE_CLIENT_SECRET",
            )?,
            connector_netsuite_redirect_uri: optional_value("CONNECTOR_NETSUITE_REDIRECT_URI"),
            connector_google_client_id: optional_value("CONNECTOR_GOOGLE_CLIENT_ID"),
            connector_google_client_secret: optional_secure_secret(
                "CONNECTOR_GOOGLE_CLIENT_SECRET",
            )?,
            connector_google_redirect_uri: optional_value("CONNECTOR_GOOGLE_REDIRECT_URI"),
            aws_region: std::env::var("AWS_REGION").ok().filter(|v| !v.is_empty()),
            aws_s3_bucket: std::env::var("AWS_S3_BUCKET")
                .ok()
                .filter(|v| !v.is_empty()),
            cors_allowed_origins,
            enable_dev_session,
            dev_session_secret,
            ai_service_url: std::env::var("AI_SERVICE_URL")
                .ok()
                .map(|value| value.trim_end_matches('/').to_string())
                .filter(|value| value.starts_with("http://") || value.starts_with("https://")),
            ai_service_token: optional_secure_secret("AI_SERVICE_TOKEN")?,
            voice_provider_token: optional_secure_secret("VOICE_PROVIDER_TOKEN")?,
            invoice_delivery_webhook_url: std::env::var("INVOICE_DELIVERY_WEBHOOK_URL")
                .ok()
                .filter(|value| value.starts_with("https://")),
            invoice_delivery_webhook_token: std::env::var("INVOICE_DELIVERY_WEBHOOK_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            compliance_provider_url: std::env::var("COMPLIANCE_PROVIDER_URL")
                .ok()
                .filter(|value| value.starts_with("https://")),
            compliance_provider_token: std::env::var("COMPLIANCE_PROVIDER_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            payroll_payout_provider_url: std::env::var("PAYROLL_PAYOUT_PROVIDER_URL")
                .ok()
                .filter(|value| value.starts_with("https://")),
            payroll_payout_provider_token: std::env::var("PAYROLL_PAYOUT_PROVIDER_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            mobile_push_provider_url: std::env::var("MOBILE_PUSH_PROVIDER_URL")
                .ok()
                .map(|value| value.trim_end_matches('/').to_string())
                .filter(|value| value.starts_with("http://") || value.starts_with("https://")),
            mobile_push_provider_token: optional_secure_secret("MOBILE_PUSH_PROVIDER_TOKEN")?,
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
            whatsapp_benefit_template_name: std::env::var("WHATSAPP_BENEFIT_TEMPLATE_NAME")
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
            cashfree_client_id: optional_value("CASHFREE_CLIENT_ID"),
            cashfree_client_secret: optional_value("CASHFREE_CLIENT_SECRET"),
            phonepe_client_id: optional_value("PHONEPE_CLIENT_ID"),
            phonepe_client_secret: optional_value("PHONEPE_CLIENT_SECRET"),
            phonepe_client_version: optional_value("PHONEPE_CLIENT_VERSION"),
            phonepe_webhook_username: optional_value("PHONEPE_WEBHOOK_USERNAME"),
            phonepe_webhook_password: optional_value("PHONEPE_WEBHOOK_PASSWORD"),
            payment_provider_environment: var_or("PAYMENT_PROVIDER_ENVIRONMENT", "production")
                .trim()
                .to_ascii_lowercase(),
            payment_return_url: std::env::var("PAYMENT_RETURN_URL")
                .ok()
                .filter(|value| value.starts_with("https://")),
        })
    }

    pub fn whatsapp_cloud_enabled(&self) -> bool {
        self.whatsapp_cloud_access_token.is_some()
            && self.whatsapp_cloud_phone_number_id.is_some()
            && self.whatsapp_cloud_app_secret.is_some()
            && self.whatsapp_cloud_verify_token.is_some()
            && self.whatsapp_invoice_template_name.is_some()
    }

    pub fn whatsapp_benefit_enabled(&self) -> bool {
        self.whatsapp_cloud_access_token.is_some()
            && self.whatsapp_cloud_phone_number_id.is_some()
            && self.whatsapp_cloud_app_secret.is_some()
            && self.whatsapp_cloud_verify_token.is_some()
            && self.whatsapp_benefit_template_name.is_some()
    }

    pub fn benefit_delivery_configured(&self) -> bool {
        self.invoice_delivery_webhook_url.is_some() || self.whatsapp_benefit_enabled()
    }

    pub fn whatsapp_cloud_webhook_configured(&self) -> bool {
        self.whatsapp_cloud_app_secret.is_some() && self.whatsapp_cloud_verify_token.is_some()
    }

    pub fn invoice_delivery_configured(&self) -> bool {
        self.invoice_delivery_webhook_url.is_some() || self.whatsapp_cloud_enabled()
    }

    pub fn compliance_provider_enabled(&self) -> bool {
        self.compliance_provider_url.is_some() && self.compliance_provider_token.is_some()
    }

    pub fn payroll_payout_provider_enabled(&self) -> bool {
        self.payroll_payout_provider_url.is_some() && self.payroll_payout_provider_token.is_some()
    }

    pub fn mobile_push_provider_enabled(&self) -> bool {
        self.mobile_push_provider_url.is_some()
            && self.mobile_push_provider_token.is_some()
            && self.security_encryption_key.is_some()
    }

    pub fn razorpay_payment_links_enabled(&self) -> bool {
        self.razorpay_key_id.is_some() && self.razorpay_key_secret.is_some()
    }

    pub fn razorpay_webhook_configured(&self) -> bool {
        self.razorpay_webhook_secret.is_some()
    }

    pub fn payment_provider_enabled(&self, provider: &str) -> bool {
        match provider {
            "razorpay" => self.razorpay_payment_links_enabled(),
            "cashfree" => {
                self.cashfree_client_id.is_some() && self.cashfree_client_secret.is_some()
            }
            "phonepe" => {
                self.phonepe_client_id.is_some()
                    && self.phonepe_client_secret.is_some()
                    && self.phonepe_client_version.is_some()
                    && self.payment_return_url.is_some()
            }
            _ => false,
        }
    }

    pub fn payment_provider_webhook_configured(&self, provider: &str) -> bool {
        match provider {
            "razorpay" => self.razorpay_webhook_configured(),
            "cashfree" => self.cashfree_client_secret.is_some(),
            "phonepe" => {
                self.phonepe_webhook_username.is_some() && self.phonepe_webhook_password.is_some()
            }
            _ => false,
        }
    }
}

pub fn is_local_env(app_env: &str) -> bool {
    matches!(app_env, "development" | "local" | "test")
}

fn var_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn optional_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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
