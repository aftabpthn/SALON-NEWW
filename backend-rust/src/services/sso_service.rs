use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::{is_local_env, Settings},
    models::common::AppError,
    repositories::sso_repository,
    state::AppState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OidcProvider {
    Google,
    Microsoft,
    Saml,
}

impl OidcProvider {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value.to_ascii_lowercase().as_str() {
            "google" => Ok(Self::Google),
            "microsoft" => Ok(Self::Microsoft),
            "saml" => Ok(Self::Saml),
            _ => Err(AppError::validation("unsupported SSO provider")),
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Microsoft => "microsoft",
            Self::Saml => "saml",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAvailability {
    pub google: bool,
    pub microsoft: bool,
    pub saml: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoPolicyView {
    pub google_configured: bool,
    pub microsoft_configured: bool,
    pub saml_configured: bool,
    pub google_enabled: bool,
    pub microsoft_enabled: bool,
    pub saml_enabled: bool,
    pub enforced_roles: Vec<String>,
    pub persisted: bool,
    pub updated_by: Option<String>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug)]
pub struct OidcIdentity {
    pub subject: String,
    pub email: String,
}

struct ProviderConfig<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    redirect_uri: &'a str,
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    sub: String,
    email: Option<String>,
    preferred_username: Option<String>,
    email_verified: Option<bool>,
    nonce: String,
}

pub fn availability(settings: &Settings) -> ProviderAvailability {
    ProviderAvailability {
        google: provider_config(settings, OidcProvider::Google).is_ok(),
        microsoft: provider_config(settings, OidcProvider::Microsoft).is_ok(),
        saml: provider_config(settings, OidcProvider::Saml).is_ok(),
    }
}

pub async fn policy_view(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
) -> Result<SsoPolicyView, AppError> {
    let configured = availability(settings);
    let policy = sso_repository::get_sso_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load SSO policy"))?;
    Ok(match policy {
        Some(policy) => SsoPolicyView {
            google_configured: configured.google,
            microsoft_configured: configured.microsoft,
            saml_configured: configured.saml,
            google_enabled: policy.google_enabled,
            microsoft_enabled: policy.microsoft_enabled,
            saml_enabled: policy.saml_enabled,
            enforced_roles: policy.enforced_roles,
            persisted: true,
            updated_by: Some(policy.updated_by),
            updated_at: Some(policy.updated_at),
        },
        None => SsoPolicyView {
            google_configured: configured.google,
            microsoft_configured: configured.microsoft,
            saml_configured: configured.saml,
            google_enabled: configured.google,
            microsoft_enabled: configured.microsoft,
            saml_enabled: configured.saml,
            enforced_roles: Vec::new(),
            persisted: false,
            updated_by: None,
            updated_at: None,
        },
    })
}

pub async fn availability_for_tenant(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
) -> Result<ProviderAvailability, AppError> {
    let policy = policy_view(db, settings, tenant_id).await?;
    Ok(ProviderAvailability {
        google: policy.google_configured && policy.google_enabled,
        microsoft: policy.microsoft_configured && policy.microsoft_enabled,
        saml: policy.saml_configured && policy.saml_enabled,
    })
}

pub async fn save_policy(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    actor_id: &str,
    google_enabled: bool,
    microsoft_enabled: bool,
    saml_enabled: bool,
    enforced_roles: &[String],
) -> Result<SsoPolicyView, AppError> {
    let configured = availability(settings);
    if google_enabled && !configured.google {
        return Err(AppError::validation("Google OIDC is not configured"));
    }
    if microsoft_enabled && !configured.microsoft {
        return Err(AppError::validation("Microsoft Entra ID is not configured"));
    }
    if saml_enabled && !configured.saml {
        return Err(AppError::validation("SAML federation is not configured"));
    }
    let enforced_roles = normalize_enforced_roles(enforced_roles)?;
    if !enforced_roles.is_empty() && !google_enabled && !microsoft_enabled && !saml_enabled {
        return Err(AppError::validation(
            "enable at least one SSO provider before enforcing SSO",
        ));
    }
    sso_repository::save_sso_policy(
        db,
        tenant_id,
        google_enabled,
        microsoft_enabled,
        saml_enabled,
        &enforced_roles,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save SSO policy"))?;
    policy_view(db, settings, tenant_id).await
}

pub async fn local_login_requires_sso(
    db: &PgPool,
    tenant_id: &str,
    role_name: &str,
) -> Result<bool, AppError> {
    let policy = sso_repository::get_sso_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to enforce SSO policy"))?;
    let role = normalize_role(role_name);
    Ok(policy.is_some_and(|policy| {
        policy
            .enforced_roles
            .iter()
            .any(|enforced| normalize_role(enforced) == role)
    }))
}

pub async fn begin(
    state: &AppState,
    tenant_id: &str,
    provider: OidcProvider,
    return_uri: &str,
) -> Result<String, AppError> {
    validate_return_uri(&state.settings, return_uri)?;
    let available = availability_for_tenant(&state.db, &state.settings, tenant_id).await?;
    if !match provider {
        OidcProvider::Google => available.google,
        OidcProvider::Microsoft => available.microsoft,
        OidcProvider::Saml => available.saml,
    } {
        return Err(AppError::forbidden(
            "SSO provider is not enabled for this salon",
        ));
    }
    let config = provider_config(&state.settings, provider)?;
    let state_value = random_token(32);
    let nonce = random_token(32);
    let verifier = random_token(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    sso_repository::save_oidc_state(
        &state.db,
        &token_hash(&state_value),
        tenant_id,
        provider.code(),
        &nonce,
        &verifier,
        return_uri,
        Utc::now() + Duration::minutes(10),
    )
    .await
    .map_err(|_| AppError::internal("failed to start SSO login"))?;

    let mut url = reqwest::Url::parse(&config.authorization_endpoint)
        .map_err(|_| AppError::internal("invalid SSO provider configuration"))?;
    url.query_pairs_mut()
        .append_pair("client_id", config.client_id)
        .append_pair("redirect_uri", config.redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state_value)
        .append_pair("nonce", &nonce)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    Ok(url.to_string())
}

pub async fn finish(
    state: &AppState,
    provider: OidcProvider,
    code: &str,
    state_value: &str,
) -> Result<(String, String), AppError> {
    let saved = sso_repository::consume_oidc_state(&state.db, &token_hash(state_value))
        .await
        .map_err(|_| AppError::internal("failed to validate SSO state"))?
        .ok_or_else(|| AppError::unauthenticated("invalid or expired SSO state"))?;
    if saved.provider != provider.code() {
        return Err(AppError::unauthenticated("SSO provider mismatch"));
    }
    let identity = exchange_code(
        &state.settings,
        provider,
        code,
        &saved.code_verifier,
        &saved.nonce,
    )
    .await?;
    let user_id = sso_repository::resolve_external_user(
        &state.db,
        &saved.tenant_id,
        provider.code(),
        &identity.subject,
        &identity.email,
    )
    .await
    .map_err(|_| AppError::internal("failed to link SSO identity"))?
    .ok_or_else(|| AppError::forbidden("SSO identity has not been provisioned for this salon"))?;

    let handoff = random_token(32);
    sso_repository::save_sso_handoff(
        &state.db,
        &token_hash(&handoff),
        &saved.tenant_id,
        &user_id,
        provider.code(),
        Utc::now() + Duration::minutes(2),
    )
    .await
    .map_err(|_| AppError::internal("failed to complete SSO login"))?;
    let mut return_url = reqwest::Url::parse(&saved.return_uri)
        .map_err(|_| AppError::internal("invalid SSO return URL"))?;
    return_url
        .query_pairs_mut()
        .append_pair("ssoCode", &handoff)
        .append_pair("tenant", &saved.tenant_id);
    Ok((return_url.to_string(), identity.email))
}

pub fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

pub fn token_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn normalize_enforced_roles(roles: &[String]) -> Result<Vec<String>, AppError> {
    if roles.len() > 3 {
        return Err(AppError::validation("too many SSO enforcement roles"));
    }
    let mut normalized = Vec::new();
    for role in roles {
        let role = normalize_role(role);
        if !matches!(role.as_str(), "owner" | "admin" | "superadmin") {
            return Err(AppError::validation("SSO enforcement role is invalid"));
        }
        if !normalized.contains(&role) {
            normalized.push(role);
        }
    }
    Ok(normalized)
}

fn normalize_role(value: &str) -> String {
    value
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn provider_config(
    settings: &Settings,
    provider: OidcProvider,
) -> Result<ProviderConfig<'_>, AppError> {
    let missing =
        || AppError::service_unavailable("SSO_NOT_CONFIGURED", "SSO provider is not configured");
    match provider {
        OidcProvider::Google => Ok(ProviderConfig {
            client_id: settings
                .oauth_google_client_id
                .as_deref()
                .ok_or_else(missing)?,
            client_secret: settings
                .oauth_google_client_secret
                .as_deref()
                .ok_or_else(missing)?,
            redirect_uri: settings
                .oauth_google_redirect_uri
                .as_deref()
                .ok_or_else(missing)?,
            issuer: "https://accounts.google.com".into(),
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_endpoint: "https://oauth2.googleapis.com/token".into(),
            jwks_uri: "https://www.googleapis.com/oauth2/v3/certs".into(),
        }),
        OidcProvider::Microsoft => {
            let tenant = settings
                .oauth_microsoft_tenant_id
                .as_deref()
                .ok_or_else(missing)?;
            let issuer = format!("https://login.microsoftonline.com/{tenant}/v2.0");
            Ok(ProviderConfig {
                client_id: settings
                    .oauth_microsoft_client_id
                    .as_deref()
                    .ok_or_else(missing)?,
                client_secret: settings
                    .oauth_microsoft_client_secret
                    .as_deref()
                    .ok_or_else(missing)?,
                redirect_uri: settings
                    .oauth_microsoft_redirect_uri
                    .as_deref()
                    .ok_or_else(missing)?,
                authorization_endpoint: format!(
                    "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
                ),
                token_endpoint: format!(
                    "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
                ),
                jwks_uri: format!("https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"),
                issuer,
            })
        }
        OidcProvider::Saml => Ok(ProviderConfig {
            client_id: settings
                .oauth_saml_client_id
                .as_deref()
                .ok_or_else(missing)?,
            client_secret: settings
                .oauth_saml_client_secret
                .as_deref()
                .ok_or_else(missing)?,
            redirect_uri: settings
                .oauth_saml_redirect_uri
                .as_deref()
                .ok_or_else(missing)?,
            issuer: settings.oauth_saml_issuer.clone().ok_or_else(missing)?,
            authorization_endpoint: settings
                .oauth_saml_authorization_endpoint
                .clone()
                .ok_or_else(missing)?,
            token_endpoint: settings
                .oauth_saml_token_endpoint
                .clone()
                .ok_or_else(missing)?,
            jwks_uri: settings.oauth_saml_jwks_uri.clone().ok_or_else(missing)?,
        }),
    }
}

async fn exchange_code(
    settings: &Settings,
    provider: OidcProvider,
    code: &str,
    verifier: &str,
    nonce: &str,
) -> Result<OidcIdentity, AppError> {
    let config = provider_config(settings, provider)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::internal("failed to initialize SSO client"))?;
    let token = client
        .post(&config.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", config.client_id),
            ("client_secret", config.client_secret),
            ("redirect_uri", config.redirect_uri),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable("SSO_PROVIDER_UNAVAILABLE", "SSO provider is unavailable")
        })?
        .error_for_status()
        .map_err(|_| AppError::unauthenticated("SSO authorization code was rejected"))?
        .json::<TokenResponse>()
        .await
        .map_err(|_| AppError::unauthenticated("invalid SSO token response"))?;
    let header = decode_header(&token.id_token)
        .map_err(|_| AppError::unauthenticated("invalid SSO identity token"))?;
    if header.alg != Algorithm::RS256 {
        return Err(AppError::unauthenticated(
            "unsupported SSO signing algorithm",
        ));
    }
    let kid = header
        .kid
        .ok_or_else(|| AppError::unauthenticated("SSO signing key is missing"))?;
    let jwks = client
        .get(&config.jwks_uri)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "SSO_PROVIDER_UNAVAILABLE",
                "SSO signing keys are unavailable",
            )
        })?
        .error_for_status()
        .map_err(|_| {
            AppError::service_unavailable(
                "SSO_PROVIDER_UNAVAILABLE",
                "SSO signing keys are unavailable",
            )
        })?
        .json::<Jwks>()
        .await
        .map_err(|_| AppError::unauthenticated("invalid SSO signing keys"))?;
    let key = jwks
        .keys
        .into_iter()
        .find(|key| key.kid == kid)
        .ok_or_else(|| AppError::unauthenticated("SSO signing key was not found"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[config.client_id]);
    validation.set_issuer(&[&config.issuer]);
    let claims = decode::<IdClaims>(
        &token.id_token,
        &DecodingKey::from_rsa_components(&key.n, &key.e)
            .map_err(|_| AppError::unauthenticated("invalid SSO signing key"))?,
        &validation,
    )
    .map_err(|_| AppError::unauthenticated("SSO identity token validation failed"))?
    .claims;
    if claims.nonce != nonce {
        return Err(AppError::unauthenticated("SSO nonce validation failed"));
    }
    if provider == OidcProvider::Google && claims.email_verified != Some(true) {
        return Err(AppError::forbidden("Google email is not verified"));
    }
    let email = claims
        .email
        .or(claims.preferred_username)
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| value.contains('@'))
        .ok_or_else(|| AppError::forbidden("SSO provider did not return a valid email"))?;
    Ok(OidcIdentity {
        subject: claims.sub,
        email,
    })
}

fn validate_return_uri(settings: &Settings, value: &str) -> Result<(), AppError> {
    let url =
        reqwest::Url::parse(value).map_err(|_| AppError::validation("invalid SSO return URI"))?;
    let local = is_local_env(&settings.app_env)
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err(AppError::validation("SSO return URI must use HTTPS"));
    }
    let origin = url.origin().ascii_serialization();
    if !local
        && !settings
            .cors_allowed_origins
            .iter()
            .any(|allowed| allowed.trim_end_matches('/') == origin)
    {
        return Err(AppError::forbidden(
            "SSO return URI is not an allowed origin",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_enforced_roles, token_hash};

    #[test]
    fn hashes_one_time_values_without_storing_them() {
        assert_eq!(token_hash("value").len(), 64);
        assert_ne!(token_hash("value"), token_hash("other"));
    }

    #[test]
    fn sso_enforcement_roles_are_normalized_and_bounded() {
        let roles = normalize_enforced_roles(&["super-admin".into(), "Owner".into()]).unwrap();
        assert_eq!(roles, vec!["superadmin", "owner"]);
        assert!(normalize_enforced_roles(&["cashier".into()]).is_err());
    }
}
