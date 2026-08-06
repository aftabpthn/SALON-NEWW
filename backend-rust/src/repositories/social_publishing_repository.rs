use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialPublication {
    pub id: uuid::Uuid,
    pub provider: String,
    pub caption: String,
    pub media_url: String,
    pub scheduled_at: DateTime<Utc>,
    pub status: String,
    pub idempotency_key: String,
    pub provider_container_id: String,
    pub provider_post_id: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub last_error: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub request_hash: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct ClaimedSocialPublication {
    pub id: uuid::Uuid,
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: String,
    pub caption: String,
    pub media_url: String,
    pub provider_container_id: String,
    pub attempts: i32,
    pub max_attempts: i32,
}

const COLUMNS: &str = "id,provider,caption,media_url,scheduled_at,status,idempotency_key,provider_container_id,provider_post_id,attempts,max_attempts,last_error,created_by,created_at,updated_at,published_at,request_hash";

#[allow(clippy::too_many_arguments)]
pub async fn insert_or_get(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    provider: &str,
    caption: &str,
    media_url: &str,
    scheduled_at: DateTime<Utc>,
    request_hash: &str,
    idempotency_key: &str,
) -> Result<SocialPublication, sqlx::Error> {
    sqlx::query_as(&format!(
        "INSERT INTO social_publications(tenant_id,branch_id,provider,caption,media_url,scheduled_at,request_hash,idempotency_key,next_attempt_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6,$9) ON CONFLICT(tenant_id,branch_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING {COLUMNS}"
    ))
    .bind(tenant)
    .bind(branch)
    .bind(provider)
    .bind(caption)
    .bind(media_url)
    .bind(scheduled_at)
    .bind(request_hash)
    .bind(idempotency_key)
    .bind(actor)
    .fetch_one(db)
    .await
}

pub async fn list(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<SocialPublication>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM social_publications WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 500"
    ))
    .bind(tenant)
    .bind(branch)
    .fetch_all(db)
    .await
}

pub async fn cancel(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: uuid::Uuid,
) -> Result<Option<SocialPublication>, sqlx::Error> {
    sqlx::query_as(&format!(
        "UPDATE social_publications SET status='cancelled',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status IN ('queued','retry') RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(tenant)
    .bind(branch)
    .fetch_optional(db)
    .await
}

pub async fn retry(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: uuid::Uuid,
) -> Result<Option<SocialPublication>, sqlx::Error> {
    sqlx::query_as(&format!(
        "UPDATE social_publications SET status='queued',attempts=0,next_attempt_at=NOW(),last_error='',provider_container_id=CASE WHEN status='failed' THEN '' ELSE provider_container_id END,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status IN ('failed','uncertain') RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(tenant)
    .bind(branch)
    .fetch_optional(db)
    .await
}

pub async fn claim_due(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<ClaimedSocialPublication>, sqlx::Error> {
    sqlx::query_as(
        "WITH stale AS (UPDATE social_publications SET status='uncertain',last_error='Publication worker was interrupted; reconcile in Meta before retrying',updated_at=NOW() WHERE status='processing' AND updated_at<NOW()-INTERVAL '5 minutes' RETURNING id), due AS (SELECT id FROM social_publications WHERE status IN ('queued','retry') AND scheduled_at<=NOW() AND next_attempt_at<=NOW() AND attempts<max_attempts ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE social_publications publication SET status='processing',attempts=publication.attempts+1,updated_at=NOW() FROM due WHERE publication.id=due.id RETURNING publication.id,publication.tenant_id,publication.branch_id,publication.provider,publication.caption,publication.media_url,publication.provider_container_id,publication.attempts,publication.max_attempts",
    )
    .bind(limit.clamp(1, 50))
    .fetch_all(db)
    .await
}

pub async fn save_container(
    db: &PgPool,
    id: uuid::Uuid,
    container_id: &str,
    delay_seconds: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE social_publications SET provider_container_id=$2,status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'retry' END,next_attempt_at=NOW()+($3::BIGINT*INTERVAL '1 second'),last_error=CASE WHEN attempts>=max_attempts THEN 'Meta media processing timed out' ELSE '' END,updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(id).bind(container_id).bind(delay_seconds.max(1)).execute(db).await?;
    Ok(())
}

pub async fn reschedule(
    db: &PgPool,
    id: uuid::Uuid,
    delay_seconds: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE social_publications SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'retry' END,next_attempt_at=NOW()+($2::BIGINT*INTERVAL '1 second'),last_error=CASE WHEN attempts>=max_attempts THEN 'Meta media processing timed out' ELSE last_error END,updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(id).bind(delay_seconds.max(1)).execute(db).await?;
    Ok(())
}

pub async fn complete(
    db: &PgPool,
    id: uuid::Uuid,
    provider_post_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE social_publications SET status='published',provider_post_id=$2,last_error='',published_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(id).bind(provider_post_id).execute(db).await?;
    Ok(())
}

pub async fn fail(
    db: &PgPool,
    row: &ClaimedSocialPublication,
    message: &str,
    uncertain: bool,
    retryable: bool,
) -> Result<(), sqlx::Error> {
    let status = if uncertain {
        "uncertain"
    } else if retryable && row.attempts < row.max_attempts {
        "retry"
    } else {
        "failed"
    };
    sqlx::query("UPDATE social_publications SET status=$2,next_attempt_at=CASE WHEN $2='retry' THEN NOW()+(LEAST(attempts,10)::BIGINT*INTERVAL '1 minute') ELSE next_attempt_at END,last_error=$3,updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(row.id).bind(status).bind(message).execute(db).await?;
    Ok(())
}
