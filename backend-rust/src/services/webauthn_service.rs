use passkey_auth::{
    Attachment, AuthenticationChallenge, AuthenticationResponse, AuthenticationState,
    PasskeyCredential, RegistrationChallenge, RegistrationResponse, RegistrationState, Webauthn,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::security_repository::{self, WebauthnCredentialRecord},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationStart {
    pub challenge_id: String,
    pub options: RegistrationChallenge,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationStart {
    pub challenge_id: String,
    pub options: AuthenticationChallenge,
}

pub async fn list_credentials(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Vec<WebauthnCredentialRecord>, AppError> {
    security_repository::list_webauthn_credentials(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load passkeys"))
}

pub async fn begin_registration(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    user_id: &str,
    user_name: &str,
    label: &str,
) -> Result<RegistrationStart, AppError> {
    let label = validate_label(label)?;
    let webauthn = configured_webauthn(settings)?;
    let records = security_repository::list_webauthn_credentials(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load passkeys"))?;
    let passkeys = deserialize_passkeys(&records)?;
    let existing = passkeys
        .iter()
        .map(|passkey| passkey.id.clone())
        .collect::<Vec<_>>();
    let user_handle = stable_user_handle(tenant_id, user_id);
    let (options, state) =
        webauthn.start_registration(&user_handle, user_name, user_name, &existing);
    let state_json = serde_json::to_value(state)
        .map_err(|_| AppError::internal("failed to store passkey challenge"))?;
    let challenge_id = security_repository::save_webauthn_challenge(
        db,
        tenant_id,
        user_id,
        "registration",
        state_json,
        Some(label),
    )
    .await
    .map_err(|_| AppError::internal("failed to store passkey challenge"))?;
    Ok(RegistrationStart {
        challenge_id,
        options,
    })
}

pub async fn finish_registration(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    user_id: &str,
    challenge_id: &str,
    response: RegistrationResponse,
) -> Result<WebauthnCredentialRecord, AppError> {
    let webauthn = configured_webauthn(settings)?;
    let challenge = security_repository::take_webauthn_challenge(
        db,
        challenge_id,
        "registration",
        Some(tenant_id),
        Some(user_id),
    )
    .await
    .map_err(|_| AppError::internal("failed to load passkey challenge"))?
    .ok_or_else(|| AppError::unauthenticated("passkey challenge is invalid or expired"))?;
    let state: RegistrationState = serde_json::from_value(challenge.state_json)
        .map_err(|_| AppError::internal("stored passkey challenge is invalid"))?;
    let passkey = webauthn
        .finish_registration(&state, &response)
        .map_err(|_| AppError::unauthenticated("passkey registration could not be verified"))?;
    let credential_id = passkey.id.to_b64url();
    let passkey_json =
        serde_json::to_value(passkey).map_err(|_| AppError::internal("failed to store passkey"))?;
    security_repository::create_webauthn_credential(
        db,
        tenant_id,
        user_id,
        &credential_id,
        challenge.label.as_deref().unwrap_or("Passkey"),
        passkey_json,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|value| value.is_unique_violation())
        {
            AppError::conflict("this passkey is already registered")
        } else {
            AppError::internal("failed to store passkey")
        }
    })
}

pub async fn begin_authentication(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    user_id: &str,
) -> Result<AuthenticationStart, AppError> {
    begin_authentication_for_purpose(db, settings, tenant_id, user_id, "authentication").await
}

pub async fn begin_authentication_for_purpose(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    user_id: &str,
    purpose: &str,
) -> Result<AuthenticationStart, AppError> {
    let webauthn = configured_webauthn(settings)?;
    let records = security_repository::list_webauthn_credentials(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load passkeys"))?;
    let passkeys = deserialize_passkeys(&records)?;
    if passkeys.is_empty() {
        return Err(AppError::unauthenticated("passkey sign-in is unavailable"));
    }
    let user_handle = stable_user_handle(tenant_id, user_id);
    let (options, state) =
        webauthn.start_authentication_with_creds_for_user(&user_handle, &passkeys);
    let state_json = serde_json::to_value(state)
        .map_err(|_| AppError::internal("failed to store passkey challenge"))?;
    let challenge_id = security_repository::save_webauthn_challenge(
        db, tenant_id, user_id, purpose, state_json, None,
    )
    .await
    .map_err(|_| AppError::internal("failed to store passkey challenge"))?;
    Ok(AuthenticationStart {
        challenge_id,
        options,
    })
}

pub async fn finish_authentication(
    db: &PgPool,
    settings: &Settings,
    expected_tenant_id: &str,
    challenge_id: &str,
    response: AuthenticationResponse,
) -> Result<(String, String), AppError> {
    finish_authentication_for_purpose(
        db,
        settings,
        expected_tenant_id,
        None,
        "authentication",
        challenge_id,
        &response,
    )
    .await
}

pub async fn finish_authentication_for_purpose(
    db: &PgPool,
    settings: &Settings,
    expected_tenant_id: &str,
    expected_user_id: Option<&str>,
    purpose: &str,
    challenge_id: &str,
    response: &AuthenticationResponse,
) -> Result<(String, String), AppError> {
    let webauthn = configured_webauthn(settings)?;
    let challenge = security_repository::take_webauthn_challenge(
        db,
        challenge_id,
        purpose,
        Some(expected_tenant_id),
        expected_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load passkey challenge"))?
    .ok_or_else(|| AppError::unauthenticated("passkey challenge is invalid or expired"))?;
    let state: AuthenticationState = serde_json::from_value(challenge.state_json)
        .map_err(|_| AppError::internal("stored passkey challenge is invalid"))?;
    let records = security_repository::list_webauthn_credentials(
        db,
        &challenge.tenant_id,
        &challenge.user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load passkey"))?;
    let record = records
        .into_iter()
        .find(|record| record.credential_id == response.id)
        .ok_or_else(|| AppError::unauthenticated("passkey is no longer registered"))?;
    let mut passkey: PasskeyCredential = serde_json::from_value(record.passkey_json)
        .map_err(|_| AppError::internal("stored passkey is invalid"))?;
    let result = webauthn
        .finish_authentication(&state, response, &passkey)
        .map_err(|_| AppError::unauthenticated("passkey sign-in could not be verified"))?;
    passkey.counter = result.new_counter;
    let passkey_json = serde_json::to_value(passkey)
        .map_err(|_| AppError::internal("failed to update passkey"))?;
    let updated = security_repository::update_webauthn_credential(
        db,
        &challenge.tenant_id,
        &challenge.user_id,
        &record.credential_id,
        passkey_json,
    )
    .await
    .map_err(|_| AppError::internal("failed to update passkey"))?;
    if !updated {
        return Err(AppError::unauthenticated("passkey is no longer registered"));
    }
    Ok((challenge.tenant_id, challenge.user_id))
}

pub async fn delete_credential(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    credential_id: &str,
) -> Result<(), AppError> {
    let deleted =
        security_repository::delete_webauthn_credential(db, tenant_id, user_id, credential_id)
            .await
            .map_err(|_| AppError::internal("failed to delete passkey"))?;
    if deleted {
        Ok(())
    } else {
        Err(AppError::not_found("passkey was not found"))
    }
}

fn configured_webauthn(settings: &Settings) -> Result<Webauthn, AppError> {
    let rp_id = settings.webauthn_rp_id.as_deref().ok_or_else(|| {
        AppError::service_unavailable("WEBAUTHN_NOT_CONFIGURED", "passkeys are not configured")
    })?;
    let origin = settings.webauthn_rp_origin.as_deref().ok_or_else(|| {
        AppError::service_unavailable("WEBAUTHN_NOT_CONFIGURED", "passkeys are not configured")
    })?;
    if rp_id.is_empty()
        || rp_id.contains("://")
        || rp_id.contains('/')
        || rp_id.contains(':')
        || !valid_origin(origin)
    {
        return Err(AppError::service_unavailable(
            "WEBAUTHN_INVALID_CONFIG",
            "passkey RP configuration is invalid",
        ));
    }
    Ok(Webauthn::new(rp_id, "AuraShine CRM", origin)
        .strict_base64(true)
        .require_user_verification(true)
        .authenticator_attachment(Attachment::Any))
}

fn valid_origin(origin: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    (url.scheme() == "https" || local_http)
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn deserialize_passkeys(
    records: &[WebauthnCredentialRecord],
) -> Result<Vec<PasskeyCredential>, AppError> {
    records
        .iter()
        .map(|record| {
            serde_json::from_value(record.passkey_json.clone())
                .map_err(|_| AppError::internal("stored passkey is invalid"))
        })
        .collect()
}

fn stable_user_handle(tenant_id: &str, user_id: &str) -> [u8; 32] {
    Sha256::digest(format!("aurashine:{tenant_id}:{user_id}").as_bytes()).into()
}

fn validate_label(label: &str) -> Result<&str, AppError> {
    let label = label.trim();
    if (1..=60).contains(&label.chars().count()) && !label.chars().any(char::is_control) {
        Ok(label)
    } else {
        Err(AppError::validation(
            "passkey label must be between 1 and 60 characters",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{stable_user_handle, valid_origin, validate_label};

    #[test]
    fn passkey_boundaries_are_tenant_safe() {
        assert_ne!(
            stable_user_handle("tenant-a", "user-1"),
            stable_user_handle("tenant-b", "user-1")
        );
        assert!(valid_origin("https://crm.example.com"));
        assert!(valid_origin("http://localhost:4200"));
        assert!(!valid_origin("http://crm.example.com"));
        assert!(validate_label("Device\nName").is_err());
    }
}
