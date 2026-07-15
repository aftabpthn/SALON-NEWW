use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct OidcState {
    pub tenant_id: String,
    pub provider: String,
    pub nonce: String,
    pub code_verifier: String,
    pub return_uri: String,
}

#[derive(Debug, FromRow)]
pub struct SsoHandoff {
    pub tenant_id: String,
    pub user_id: String,
    pub provider: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoPolicyRecord {
    pub google_enabled: bool,
    pub microsoft_enabled: bool,
    pub saml_enabled: bool,
    pub enforced_roles: Vec<String>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScimTokenStatus {
    pub configured: bool,
    pub last_four: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ScimUser {
    pub id: String,
    pub external_id: Option<String>,
    pub user_name: String,
    pub full_name: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub async fn save_oidc_state(
    db: &PgPool,
    state_hash: &str,
    tenant_id: &str,
    provider: &str,
    nonce: &str,
    code_verifier: &str,
    return_uri: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auth_oidc_states WHERE expires_at <= NOW()")
        .execute(db)
        .await?;
    sqlx::query(
        "INSERT INTO auth_oidc_states (state_hash, tenant_id, provider, nonce, code_verifier, return_uri, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(state_hash)
    .bind(tenant_id)
    .bind(provider)
    .bind(nonce)
    .bind(code_verifier)
    .bind(return_uri)
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn consume_oidc_state(
    db: &PgPool,
    state_hash: &str,
) -> Result<Option<OidcState>, sqlx::Error> {
    sqlx::query_as::<_, OidcState>(
        "DELETE FROM auth_oidc_states WHERE state_hash=$1 AND expires_at > NOW() RETURNING tenant_id, provider, nonce, code_verifier, return_uri",
    )
    .bind(state_hash)
    .fetch_optional(db)
    .await
}

pub async fn resolve_external_user(
    db: &PgPool,
    tenant_id: &str,
    provider: &str,
    subject: &str,
    email: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(user_id) = sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM auth_external_identities WHERE tenant_id=$1 AND provider=$2 AND subject=$3",
    )
    .bind(tenant_id)
    .bind(provider)
    .bind(subject)
    .fetch_optional(&mut *tx)
    .await?
    {
        sqlx::query("UPDATE auth_external_identities SET email=$4, last_login_at=NOW(), updated_at=NOW() WHERE tenant_id=$1 AND provider=$2 AND subject=$3")
            .bind(tenant_id).bind(provider).bind(subject).bind(email).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(Some(user_id));
    }

    let user_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM users WHERE tenant_id=$1 AND active=TRUE AND LOWER(email)=LOWER($2) LIMIT 1",
    )
    .bind(tenant_id)
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(user_id) = user_id else {
        tx.rollback().await?;
        return Ok(None);
    };
    sqlx::query(
        "INSERT INTO auth_external_identities (tenant_id,user_id,provider,subject,email,last_login_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,provider,user_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(&user_id)
    .bind(provider)
    .bind(subject)
    .bind(email)
    .execute(&mut *tx)
    .await?;
    let linked = sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM auth_external_identities WHERE tenant_id=$1 AND provider=$2 AND subject=$3",
    )
    .bind(tenant_id).bind(provider).bind(subject).fetch_optional(&mut *tx).await?;
    tx.commit().await?;
    Ok(linked.filter(|linked_id| linked_id == &user_id))
}

pub async fn save_sso_handoff(
    db: &PgPool,
    code_hash: &str,
    tenant_id: &str,
    user_id: &str,
    provider: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auth_sso_handoffs WHERE expires_at <= NOW()")
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO auth_sso_handoffs (code_hash,tenant_id,user_id,provider,expires_at) VALUES ($1,$2,$3,$4,$5)")
        .bind(code_hash).bind(tenant_id).bind(user_id).bind(provider).bind(expires_at).execute(db).await?;
    Ok(())
}

pub async fn consume_sso_handoff(
    db: &PgPool,
    code_hash: &str,
) -> Result<Option<SsoHandoff>, sqlx::Error> {
    sqlx::query_as::<_, SsoHandoff>(
        "DELETE FROM auth_sso_handoffs WHERE code_hash=$1 AND expires_at > NOW() RETURNING tenant_id,user_id,provider",
    )
    .bind(code_hash)
    .fetch_optional(db)
    .await
}

pub async fn get_sso_policy(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Option<SsoPolicyRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT google_enabled, microsoft_enabled, saml_enabled, enforced_roles, updated_by, updated_at FROM auth_sso_policies WHERE tenant_id=$1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
}

pub async fn save_sso_policy(
    db: &PgPool,
    tenant_id: &str,
    google_enabled: bool,
    microsoft_enabled: bool,
    saml_enabled: bool,
    enforced_roles: &[String],
    actor_id: &str,
) -> Result<SsoPolicyRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO auth_sso_policies(
          tenant_id, google_enabled, microsoft_enabled, saml_enabled, enforced_roles, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id) DO UPDATE SET
          google_enabled=EXCLUDED.google_enabled,
          microsoft_enabled=EXCLUDED.microsoft_enabled,
          saml_enabled=EXCLUDED.saml_enabled,
          enforced_roles=EXCLUDED.enforced_roles,
          updated_by=EXCLUDED.updated_by,
          updated_at=NOW()
        RETURNING google_enabled, microsoft_enabled, saml_enabled, enforced_roles, updated_by, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(google_enabled)
    .bind(microsoft_enabled)
    .bind(saml_enabled)
    .bind(enforced_roles)
    .bind(actor_id)
    .fetch_one(db)
    .await
}

pub async fn scim_token_status(
    db: &PgPool,
    tenant_id: &str,
) -> Result<ScimTokenStatus, sqlx::Error> {
    Ok(sqlx::query_as::<_, ScimTokenStatus>(
        "SELECT TRUE AS configured, last_four, updated_at FROM auth_scim_tokens WHERE tenant_id=$1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await?
    .unwrap_or(ScimTokenStatus {
        configured: false,
        last_four: None,
        updated_at: None,
    }))
}

pub async fn rotate_scim_token(
    db: &PgPool,
    tenant_id: &str,
    token_hash: &str,
    last_four: &str,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO auth_scim_tokens (tenant_id,token_hash,last_four,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,last_four=EXCLUDED.last_four,updated_by=EXCLUDED.updated_by,updated_at=NOW()")
        .bind(tenant_id).bind(token_hash).bind(last_four).bind(actor).execute(db).await?;
    Ok(())
}

pub async fn revoke_scim_token(db: &PgPool, tenant_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auth_scim_tokens WHERE tenant_id=$1")
        .bind(tenant_id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn tenant_for_scim_token(
    db: &PgPool,
    token_hash: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT tenant_id FROM auth_scim_tokens WHERE token_hash=$1")
        .bind(token_hash)
        .fetch_optional(db)
        .await
}

const SCIM_USER_SELECT: &str = "SELECT u.id, su.external_id, u.email AS user_name, u.full_name, u.active, su.created_at, u.updated_at FROM auth_scim_users su JOIN users u ON u.id=su.user_id AND u.tenant_id=su.tenant_id";

pub async fn list_scim_users(db: &PgPool, tenant_id: &str) -> Result<Vec<ScimUser>, sqlx::Error> {
    sqlx::query_as::<_, ScimUser>(&format!(
        "{SCIM_USER_SELECT} WHERE su.tenant_id=$1 ORDER BY u.email"
    ))
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn get_scim_user(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<ScimUser>, sqlx::Error> {
    sqlx::query_as::<_, ScimUser>(&format!(
        "{SCIM_USER_SELECT} WHERE su.tenant_id=$1 AND u.id=$2"
    ))
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn create_scim_user(
    db: &PgPool,
    tenant_id: &str,
    external_id: Option<&str>,
    email: &str,
    full_name: &str,
    password_hash: &str,
    active: bool,
) -> Result<ScimUser, sqlx::Error> {
    let mut tx = db.begin().await?;
    let user_id = sqlx::query_scalar::<_, String>("INSERT INTO users (tenant_id,email,login_id,password_hash,full_name,role_name,active,must_change_password) VALUES ($1,$2,$2,$3,$4,'staff',$5,TRUE) RETURNING id")
        .bind(tenant_id).bind(email).bind(password_hash).bind(full_name).bind(active).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO auth_scim_users (tenant_id,user_id,external_id) VALUES ($1,$2,$3)")
        .bind(tenant_id)
        .bind(&user_id)
        .bind(external_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_scim_user(db, tenant_id, &user_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn update_scim_user(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    external_id: Option<&str>,
    email: &str,
    full_name: &str,
    active: bool,
) -> Result<Option<ScimUser>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = sqlx::query("UPDATE users SET email=$3,login_id=$3,full_name=$4,active=$5,permission_version=permission_version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND EXISTS (SELECT 1 FROM auth_scim_users WHERE tenant_id=$1 AND user_id=$2)")
        .bind(tenant_id).bind(user_id).bind(email).bind(full_name).bind(active).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        tx.rollback().await?;
        return Ok(None);
    }
    sqlx::query("UPDATE auth_scim_users SET external_id=$3,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2")
        .bind(tenant_id).bind(user_id).bind(external_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE auth_refresh_tokens SET revoked_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL")
        .bind(tenant_id).bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    get_scim_user(db, tenant_id, user_id).await
}

pub async fn deactivate_scim_user(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(update_scim_user_from_existing(db, tenant_id, user_id).await?)
}

async fn update_scim_user_from_existing(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    let Some(user) = get_scim_user(db, tenant_id, user_id).await? else {
        return Ok(false);
    };
    Ok(update_scim_user(
        db,
        tenant_id,
        user_id,
        user.external_id.as_deref(),
        &user.user_name,
        &user.full_name,
        false,
    )
    .await?
    .is_some())
}
