use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    models::common::AppError,
    repositories::{
        integration_repository,
        social_publishing_repository::{self, ClaimedSocialPublication, SocialPublication},
    },
    services::{security_service, security_service::decrypt_secret},
    state::AppState,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SocialPublicationWrite {
    pub provider: String,
    pub caption: String,
    pub media_url: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub idempotency_key: String,
}

pub async fn create(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    mut request: SocialPublicationWrite,
) -> Result<SocialPublication, AppError> {
    request.provider = request.provider.trim().to_ascii_lowercase();
    request.caption = request.caption.trim().to_string();
    request.media_url = Some(request.media_url.unwrap_or_default().trim().to_string());
    request.idempotency_key = request.idempotency_key.trim().to_string();
    validate(&request)?;
    let scheduled_at = request.scheduled_at.unwrap_or_else(Utc::now);
    let hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&request)
                .map_err(|_| AppError::validation("social publication is invalid"))?
        )
    );
    let row = social_publishing_repository::insert_or_get(
        &state.db,
        tenant,
        branch,
        actor,
        &request.provider,
        &request.caption,
        request.media_url.as_deref().unwrap_or(""),
        scheduled_at,
        &hash,
        &request.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue social publication"))?;
    if row.request_hash != hash {
        return Err(AppError::conflict(
            "idempotency key was already used for another publication",
        ));
    }
    let _ = security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "marketing.social_publication.queued",
        json!({"publicationId":row.id,"provider":row.provider,"scheduledAt":row.scheduled_at}),
    )
    .await;
    Ok(row)
}

pub async fn list(
    state: &AppState,
    tenant: &str,
    branch: &str,
) -> Result<Vec<SocialPublication>, AppError> {
    social_publishing_repository::list(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to list social publications"))
}

pub async fn cancel(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<SocialPublication, AppError> {
    let row = social_publishing_repository::cancel(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to cancel social publication"))?
        .ok_or_else(|| AppError::conflict("publication is no longer cancellable"))?;
    let _ = security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "marketing.social_publication.cancelled",
        json!({"publicationId":id}),
    )
    .await;
    Ok(row)
}

pub async fn retry(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
) -> Result<SocialPublication, AppError> {
    let row = social_publishing_repository::retry(&state.db, tenant, branch, id)
        .await
        .map_err(|_| AppError::internal("failed to retry social publication"))?
        .ok_or_else(|| AppError::conflict("publication is not retryable"))?;
    let _ = security_service::record_audit(
        &state.db,
        tenant,
        branch,
        actor,
        "marketing.social_publication.retried",
        json!({"publicationId":id}),
    )
    .await;
    Ok(row)
}

pub async fn process_due(state: &AppState) -> Result<usize, AppError> {
    let rows = social_publishing_repository::claim_due(&state.db, 20)
        .await
        .map_err(|_| AppError::internal("failed to claim social publications"))?;
    let mut completed = 0;
    for row in rows {
        match publish(state, &row).await {
            Ok(PublishOutcome::Published(id)) => {
                social_publishing_repository::complete(&state.db, &row.id, &id)
                    .await
                    .map_err(|_| AppError::internal("failed to complete social publication"))?;
                completed += 1;
            }
            Ok(PublishOutcome::Container(id)) => {
                social_publishing_repository::save_container(&state.db, &row.id, &id, 10)
                    .await
                    .map_err(|_| AppError::internal("failed to save social media container"))?;
            }
            Ok(PublishOutcome::Wait) => {
                social_publishing_repository::reschedule(&state.db, &row.id, 10)
                    .await
                    .map_err(|_| AppError::internal("failed to reschedule social publication"))?;
            }
            Err(error) => {
                social_publishing_repository::fail(
                    &state.db,
                    &row,
                    error.message,
                    error.uncertain,
                    error.retryable,
                )
                .await
                .map_err(|_| AppError::internal("failed to record social publication failure"))?;
            }
        }
    }
    Ok(completed)
}

fn validate(request: &SocialPublicationWrite) -> Result<(), AppError> {
    let media = request.media_url.as_deref().unwrap_or("");
    let caption_limit = if request.provider == "instagram" {
        2_200
    } else {
        5_000
    };
    if !matches!(request.provider.as_str(), "facebook" | "instagram")
        || request.caption.chars().count() > caption_limit
        || (request.caption.is_empty() && media.is_empty())
        || (request.provider == "instagram" && media.is_empty())
        || !(8..=160).contains(&request.idempotency_key.len())
        || !request
            .idempotency_key
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || "-_.:".contains(value))
    {
        return Err(AppError::validation("social publication is invalid"));
    }
    if !media.is_empty() && !valid_public_media_url(media) {
        return Err(AppError::validation("media URL must be a public HTTPS URL"));
    }
    let scheduled = request.scheduled_at.unwrap_or_else(Utc::now);
    if scheduled < Utc::now() - Duration::minutes(5) || scheduled > Utc::now() + Duration::days(365)
    {
        return Err(AppError::validation(
            "scheduled time is outside the allowed range",
        ));
    }
    Ok(())
}

fn valid_public_media_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    let host = url.host_str().unwrap_or("");
    let private_ip = host.parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_loopback() || ip.is_unspecified(),
    });
    url.scheme() == "https"
        && !host.is_empty()
        && !host.eq_ignore_ascii_case("localhost")
        && !host.ends_with(".local")
        && !private_ip
        && url.username().is_empty()
        && url.password().is_none()
}

enum PublishOutcome {
    Published(String),
    Container(String),
    Wait,
}

struct PublishFailure {
    message: &'static str,
    retryable: bool,
    uncertain: bool,
}

async fn publish(
    state: &AppState,
    row: &ClaimedSocialPublication,
) -> Result<PublishOutcome, PublishFailure> {
    let credential = integration_repository::connected_connector_credential(
        &state.db,
        &row.tenant_id,
        &row.branch_id,
        "meta",
    )
    .await
    .map_err(|_| failure("Meta connection could not be loaded", true, false))?
    .ok_or_else(|| failure("Meta Business connector is not connected", false, false))?;
    let encryption_key = state
        .settings
        .security_encryption_key
        .as_deref()
        .ok_or_else(|| failure("credential encryption is not configured", false, false))?;
    let token = decrypt_secret(encryption_key, &credential.access_token_ciphertext)
        .map_err(|_| failure("Meta credential could not be decrypted", false, false))?;
    let base = config(&credential.config_json, "graphApiBaseUrl")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| failure("Meta publisher could not start", true, false))?;
    if row.provider == "facebook" {
        let page = config(&credential.config_json, "pageId")?;
        let (path, form) = if row.media_url.is_empty() {
            ("feed", vec![("message", row.caption.as_str())])
        } else {
            (
                "photos",
                vec![
                    ("url", row.media_url.as_str()),
                    ("caption", row.caption.as_str()),
                ],
            )
        };
        return post_publish(&client, &format!("{base}/{page}/{path}"), &token, &form).await;
    }
    let account = config(&credential.config_json, "instagramBusinessAccountId")?;
    if row.provider_container_id.is_empty() {
        let value = send(
            client
                .post(format!("{base}/{account}/media"))
                .bearer_auth(&token)
                .form(&[
                    ("image_url", row.media_url.as_str()),
                    ("caption", row.caption.as_str()),
                ]),
            true,
        )
        .await?;
        return provider_id(&value).map(PublishOutcome::Container);
    }
    let status = send(
        client
            .get(format!(
                "{base}/{}?fields=status_code",
                row.provider_container_id
            ))
            .bearer_auth(&token),
        false,
    )
    .await?;
    match status
        .get("status_code")
        .and_then(Value::as_str)
        .unwrap_or("")
    {
        "FINISHED" => {
            post_publish(
                &client,
                &format!("{base}/{account}/media_publish"),
                &token,
                &[("creation_id", row.provider_container_id.as_str())],
            )
            .await
        }
        "IN_PROGRESS" | "PUBLISHED" => Ok(PublishOutcome::Wait),
        _ => Err(failure("Instagram media processing failed", false, false)),
    }
}

async fn post_publish(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    form: &[(&str, &str)],
) -> Result<PublishOutcome, PublishFailure> {
    let value = send(client.post(url).bearer_auth(token).form(form), true).await?;
    provider_id(&value).map(PublishOutcome::Published)
}

async fn send(request: reqwest::RequestBuilder, mutation: bool) -> Result<Value, PublishFailure> {
    let response = request
        .send()
        .await
        .map_err(|_| failure("Meta publication result is uncertain", false, mutation))?;
    let status = response.status();
    if !status.is_success() {
        let provider_may_have_committed = mutation && status.is_server_error();
        return Err(failure(
            "Meta rejected the publication request",
            (!mutation && status.is_server_error()) || status.as_u16() == 429,
            provider_may_have_committed,
        ));
    }
    response.json().await.map_err(|_| {
        failure(
            "Meta returned an invalid publication response",
            false,
            mutation,
        )
    })
}

fn provider_id(value: &Value) -> Result<String, PublishFailure> {
    value
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| failure("Meta did not return a publication identifier", false, true))
}

fn config<'a>(value: &'a Value, key: &str) -> Result<&'a str, PublishFailure> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| failure("Meta account mapping is incomplete", false, false))
}

fn failure(message: &'static str, retryable: bool, uncertain: bool) -> PublishFailure {
    PublishFailure {
        message,
        retryable,
        uncertain,
    }
}

#[cfg(test)]
mod tests {
    use super::{valid_public_media_url, validate, SocialPublicationWrite};

    #[test]
    fn publication_validation_blocks_unsafe_media_and_missing_instagram_media() {
        let request = SocialPublicationWrite {
            provider: "instagram".into(),
            caption: "New look".into(),
            media_url: Some("https://cdn.example.com/post.jpg".into()),
            scheduled_at: None,
            idempotency_key: "post-12345678".into(),
        };
        assert!(validate(&request).is_ok());
        assert!(valid_public_media_url("https://cdn.example.com/post.jpg"));
        assert!(!valid_public_media_url("http://127.0.0.1/post.jpg"));
        assert!(validate(&SocialPublicationWrite {
            media_url: Some(String::new()),
            ..request
        })
        .is_err());
    }
}
