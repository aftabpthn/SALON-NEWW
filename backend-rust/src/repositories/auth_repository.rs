use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct AuthUser {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role_name: String,
    pub email: String,
    pub password_hash: String,
    pub full_name: String,
    pub active: bool,
    pub failed_login_count: i32,
    pub locked_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct RefreshTokenRecord {
    pub user_id: String,
    pub tenant_id: String,
    pub expires_at: DateTime<Utc>,
}

pub async fn find_user_by_email(
    db: &PgPool,
    tenant_id: &str,
    email: &str,
) -> Result<Option<AuthUser>, sqlx::Error> {
    sqlx::query_as::<_, AuthUser>(
        r#"
        SELECT id, tenant_id, branch_id, role_name, email, password_hash, full_name, active,
               failed_login_count, locked_until
        FROM users
        WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND active = TRUE
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(email)
    .fetch_optional(db)
    .await
}

pub async fn find_user_by_id(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<AuthUser>, sqlx::Error> {
    sqlx::query_as::<_, AuthUser>(
        r#"
        SELECT id, tenant_id, branch_id, role_name, email, password_hash, full_name, active,
               failed_login_count, locked_until
        FROM users
        WHERE tenant_id = $1 AND id = $2 AND active = TRUE
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn save_refresh_token(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO auth_refresh_tokens (tenant_id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn revoke_refresh_token(db: &PgPool, token_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at = NOW()
        WHERE token_hash = $1 AND revoked_at IS NULL
        "#,
    )
    .bind(token_hash)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn rotate_refresh_token(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    old_token_hash: &str,
    new_token_hash: &str,
    new_expires_at: DateTime<Utc>,
) -> Result<Option<RefreshTokenRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;

    let old_token = sqlx::query_as::<_, RefreshTokenRecord>(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at = NOW()
        WHERE tenant_id = $1
          AND user_id = $2
          AND token_hash = $3
          AND revoked_at IS NULL
          AND expires_at > NOW()
        RETURNING user_id, tenant_id, expires_at
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(old_token_hash)
    .fetch_optional(&mut *tx)
    .await?;

    if old_token.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }

    sqlx::query(
        r#"
        INSERT INTO auth_refresh_tokens (tenant_id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(new_token_hash)
    .bind(new_expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(old_token)
}

pub async fn mark_login_success(db: &PgPool, user_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE users
        SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn mark_login_failure(
    db: &PgPool,
    user_id: &str,
    max_failed_attempts: i32,
    lock_minutes: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
                WHEN failed_login_count + 1 >= $2 THEN NOW() + ($3 * INTERVAL '1 minute')
                ELSE locked_until
            END,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(max_failed_attempts)
    .bind(lock_minutes)
    .execute(db)
    .await?;

    Ok(())
}
