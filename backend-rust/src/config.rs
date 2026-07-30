use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::Path;

pub const PAYMENT_PROVIDERS: &[&str] = &["razorpay", "cashfree", "phonepe"];

pub struct PaymentProviderCatalogEntry {
    pub provider: &'static str,
    pub display_name: &'static str,
    pub regions: &'static [&'static str],
    pub countries: &'static [&'static str],
    pub currencies: &'static [&'static str],
    pub documentation_url: &'static str,
    pub implemented: bool,
    pub recommended: bool,
}

pub const PAYMENT_PROVIDER_CATALOG: &[PaymentProviderCatalogEntry] = &[
    PaymentProviderCatalogEntry {
        provider: "aurashine_payments",
        display_name: "AuraShine Payments",
        regions: &["Global"],
        countries: &["*"],
        currencies: &["Multi-currency"],
        documentation_url: "",
        implemented: false,
        recommended: true,
    },
    PaymentProviderCatalogEntry {
        provider: "razorpay",
        display_name: "Razorpay",
        regions: &["India"],
        countries: &["IN"],
        currencies: &["INR"],
        documentation_url: "https://razorpay.com/docs/payments/payment-links/",
        implemented: true,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "cashfree",
        display_name: "Cashfree",
        regions: &["India"],
        countries: &["IN"],
        currencies: &["INR"],
        documentation_url: "https://www.cashfree.com/docs/payments/payment-links/overview",
        implemented: true,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "phonepe",
        display_name: "PhonePe",
        regions: &["India"],
        countries: &["IN"],
        currencies: &["INR"],
        documentation_url: "https://developer.phonepe.com/payment-gateway/",
        implemented: true,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "stripe",
        display_name: "Stripe",
        regions: &["Global"],
        countries: &["US", "GB", "CA", "AU", "SG", "AE"],
        currencies: &["Multi-currency"],
        documentation_url: "https://stripe.com/global",
        implemented: true,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "paypal",
        display_name: "PayPal",
        regions: &["Global"],
        countries: &["IN", "US", "GB", "AE", "CA", "AU", "SG", "BR", "MX"],
        currencies: &["Multi-currency"],
        documentation_url: "https://developer.paypal.com/docs/checkout/",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "adyen",
        display_name: "Adyen",
        regions: &["Global"],
        countries: &["US", "GB", "AE", "CA", "AU", "SG"],
        currencies: &["Multi-currency"],
        documentation_url: "https://docs.adyen.com/online-payments",
        implemented: true,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "square",
        display_name: "Square",
        regions: &["North America", "Europe", "Asia Pacific"],
        countries: &["US", "GB", "CA", "AU"],
        currencies: &["Local currency"],
        documentation_url: "https://developer.squareup.com/docs/international-development",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "mollie",
        display_name: "Mollie",
        regions: &["Europe"],
        countries: &["GB", "NL", "BE", "DE", "FR"],
        currencies: &["Multi-currency"],
        documentation_url: "https://docs.mollie.com/docs/accepting-payments",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "mercadopago",
        display_name: "Mercado Pago",
        regions: &["Latin America"],
        countries: &["BR", "MX", "AR", "CL", "CO", "PE", "UY"],
        currencies: &["Local currency"],
        documentation_url: "https://www.mercadopago.com/developers/en/docs",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "paystack",
        display_name: "Paystack",
        regions: &["Africa"],
        countries: &["NG", "GH", "ZA", "KE", "CI"],
        currencies: &["NGN", "GHS", "ZAR", "KES", "XOF", "USD"],
        documentation_url: "https://paystack.com/docs/payments/",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "flutterwave",
        display_name: "Flutterwave",
        regions: &["Africa"],
        countries: &["NG", "GH", "ZA", "KE", "UG", "TZ", "RW"],
        currencies: &["Multi-currency"],
        documentation_url: "https://developer.flutterwave.com/docs/collecting-payments/overview",
        implemented: false,
        recommended: false,
    },
    PaymentProviderCatalogEntry {
        provider: "tap",
        display_name: "Tap Payments",
        regions: &["Middle East"],
        countries: &["AE", "SA", "KW", "BH", "QA", "OM"],
        currencies: &["Local currency"],
        documentation_url: "https://developers.tap.company/docs",
        implemented: false,
        recommended: false,
    },
];

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
    pub migration_proof_signing_key: Option<String>,
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
    pub crm_app_base_url: String,
    pub customer_app_base_url: String,
    pub enable_dev_session: bool,
    pub dev_session_secret: Option<String>,
    pub ai_service_url: Option<String>,
    pub ai_service_token: Option<String>,
    pub customer_firebase_api_key: Option<String>,
    pub voice_provider_token: Option<String>,
    pub invoice_delivery_webhook_url: Option<String>,
    pub invoice_delivery_webhook_token: Option<String>,
    pub support_email_webhook_secret: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub turnstile_site_key: Option<String>,
    pub turnstile_secret_key: Option<String>,
    pub compliance_provider_url: Option<String>,
    pub compliance_provider_token: Option<String>,
    pub payroll_payout_provider_url: Option<String>,
    pub payroll_payout_provider_token: Option<String>,
    pub mobile_push_provider_url: Option<String>,
    pub mobile_push_provider_token: Option<String>,
    pub mobile_push_public_key: Option<String>,
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
    pub stripe_secret_key: Option<String>,
    pub stripe_webhook_secret: Option<String>,
    pub adyen_api_key: Option<String>,
    pub adyen_hmac_key: Option<String>,
    pub adyen_merchant_account: Option<String>,
    pub adyen_live_prefix: Option<String>,
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
        let database_url = var_or_required("DATABASE_URL")?;
        validate_database_tls(&app_env, &database_url)?;
        let jwt_access_secret = secure_secret("JWT_ACCESS_SECRET")?;
        let jwt_refresh_secret = secure_secret("JWT_REFRESH_SECRET")?;
        let cors_allowed_origins = csv_var("CORS_ALLOWED_ORIGINS");
        let crm_app_base_url = var_or("CRM_APP_BASE_URL", "http://127.0.0.1:4200")
            .trim_end_matches('/')
            .to_string();
        let customer_app_base_url = var_or("CUSTOMER_APP_BASE_URL", "http://127.0.0.1:4310")
            .trim_end_matches('/')
            .to_string();
        for (name, value) in [
            ("CRM_APP_BASE_URL", &crm_app_base_url),
            ("CUSTOMER_APP_BASE_URL", &customer_app_base_url),
        ] {
            if !value.starts_with("http://") && !value.starts_with("https://") {
                return Err(anyhow!("{name} must be an HTTP(S) URL"));
            }
        }
        let invoice_delivery_webhook_url = optional_value("INVOICE_DELIVERY_WEBHOOK_URL");
        if invoice_delivery_webhook_url
            .as_deref()
            .is_some_and(|value| {
                !value.starts_with("https://")
                    && !(is_local_env(&app_env) && value.starts_with("http://"))
            })
        {
            return Err(anyhow!(
                "INVOICE_DELIVERY_WEBHOOK_URL must use HTTPS outside local environments"
            ));
        }
        let smtp_host = optional_value("SMTP_HOST");
        let smtp_username = optional_value("SMTP_USERNAME");
        let smtp_password = optional_secure_secret("SMTP_PASSWORD")?;
        let smtp_from = optional_value("SMTP_FROM");
        let smtp_values = [
            smtp_host.is_some(),
            smtp_username.is_some(),
            smtp_password.is_some(),
            smtp_from.is_some(),
        ];
        if smtp_values.iter().any(|configured| *configured)
            && !smtp_values.iter().all(|configured| *configured)
        {
            return Err(anyhow!(
                "SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM must be configured together"
            ));
        }
        let smtp_port = var_or_parse("SMTP_PORT", 587)?;
        if !matches!(smtp_port, 587 | 2587) {
            return Err(anyhow!("SMTP_PORT must be 587 or 2587 for STARTTLS"));
        }
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
        let turnstile_site_key = optional_value("TURNSTILE_SITE_KEY");
        let turnstile_secret_key = optional_secure_secret("TURNSTILE_SECRET_KEY")?;
        if turnstile_site_key.is_some() != turnstile_secret_key.is_some() {
            return Err(anyhow!(
                "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together"
            ));
        }

        Ok(Settings {
            app_env,
            app_host: var_or("APP_HOST", "0.0.0.0"),
            app_port: var_or_parse("APP_PORT", 8080)?,
            database_url,
            redis_url: var_or_required("REDIS_URL")?,
            jwt_access_secret,
            jwt_refresh_secret,
            jwt_access_ttl_minutes: var_or_parse("JWT_ACCESS_TTL_MINUTES", 15)?,
            jwt_refresh_ttl_days: var_or_parse("JWT_REFRESH_TTL_DAYS", 30)?,
            security_encryption_key: optional_secure_secret("SECURITY_ENCRYPTION_KEY")?,
            migration_proof_signing_key: optional_secure_secret("MIGRATION_PROOF_SIGNING_KEY")?,
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
            crm_app_base_url,
            customer_app_base_url,
            enable_dev_session,
            dev_session_secret,
            ai_service_url: std::env::var("AI_SERVICE_URL")
                .ok()
                .map(|value| value.trim_end_matches('/').to_string())
                .filter(|value| value.starts_with("http://") || value.starts_with("https://")),
            ai_service_token: optional_secure_secret("AI_SERVICE_TOKEN")?,
            customer_firebase_api_key: optional_value("CUSTOMER_FIREBASE_API_KEY"),
            voice_provider_token: optional_secure_secret("VOICE_PROVIDER_TOKEN")?,
            invoice_delivery_webhook_url,
            invoice_delivery_webhook_token: std::env::var("INVOICE_DELIVERY_WEBHOOK_TOKEN")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            support_email_webhook_secret: optional_secure_secret("SUPPORT_EMAIL_WEBHOOK_SECRET")?,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_password,
            smtp_from,
            turnstile_site_key,
            turnstile_secret_key,
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
            mobile_push_public_key: optional_value("MOBILE_PUSH_PUBLIC_KEY"),
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
            stripe_secret_key: optional_secure_secret("STRIPE_SECRET_KEY")?,
            stripe_webhook_secret: optional_secure_secret("STRIPE_WEBHOOK_SECRET")?,
            adyen_api_key: optional_secure_secret("ADYEN_API_KEY")?,
            adyen_hmac_key: optional_secure_secret("ADYEN_HMAC_KEY")?,
            adyen_merchant_account: optional_value("ADYEN_MERCHANT_ACCOUNT"),
            adyen_live_prefix: optional_value("ADYEN_LIVE_PREFIX"),
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
        self.invoice_delivery_webhook_url.is_some()
            || self.smtp_email_enabled()
            || self.whatsapp_benefit_enabled()
    }

    pub fn whatsapp_cloud_webhook_configured(&self) -> bool {
        self.whatsapp_cloud_app_secret.is_some() && self.whatsapp_cloud_verify_token.is_some()
    }

    pub fn invoice_delivery_configured(&self) -> bool {
        self.invoice_delivery_webhook_url.is_some()
            || self.smtp_email_enabled()
            || self.whatsapp_cloud_enabled()
    }

    pub fn smtp_email_enabled(&self) -> bool {
        self.smtp_host.is_some()
            && self.smtp_username.is_some()
            && self.smtp_password.is_some()
            && self.smtp_from.is_some()
    }

    pub fn turnstile_enabled(&self) -> bool {
        self.turnstile_site_key.is_some() && self.turnstile_secret_key.is_some()
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
            "stripe" => self.stripe_secret_key.is_some() && self.payment_return_url.is_some(),
            "adyen" => {
                self.adyen_api_key.is_some()
                    && self.adyen_merchant_account.is_some()
                    && self.payment_return_url.is_some()
                    && (self.payment_provider_environment == "sandbox"
                        || self.adyen_live_prefix.is_some())
            }
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
            "stripe" => self.stripe_webhook_secret.is_some(),
            "adyen" => self.adyen_hmac_key.is_some(),
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

fn validate_database_tls(app_env: &str, database_url: &str) -> Result<()> {
    if is_local_env(app_env)
        || [
            "sslmode=require",
            "sslmode=verify-ca",
            "sslmode=verify-full",
        ]
        .iter()
        .any(|mode| database_url.to_ascii_lowercase().contains(mode))
    {
        return Ok(());
    }
    Err(anyhow!(
        "DATABASE_URL must require PostgreSQL TLS outside local development"
    ))
}

#[cfg(test)]
mod tests {
    use super::validate_database_tls;

    #[test]
    fn production_database_requires_tls() {
        assert!(validate_database_tls("development", "postgresql://db/app").is_ok());
        assert!(validate_database_tls("production", "postgresql://db/app?sslmode=require").is_ok());
        assert!(validate_database_tls("production", "postgresql://db/app").is_err());
    }
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
