use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct AuthUser {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role_id: Option<String>,
    pub role_name: String,
    pub login_id: Option<String>,
    pub email: String,
    pub password_hash: String,
    pub locked_until: Option<DateTime<Utc>>,
    pub permission_version: i64,
    pub must_change_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchAccess {
    pub branch_id: String,
    pub branch_name: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub role_id: Option<String>,
    pub role_name: String,
    pub permissions: Vec<String>,
    pub denied_permissions: Vec<String>,
    pub masked_fields: Vec<String>,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
    pub is_default: bool,
}

#[derive(Debug, FromRow)]
struct BranchAccessRow {
    branch_id: String,
    branch_name: String,
    region_name: String,
    zone_name: String,
    cluster_name: String,
    role_id: Option<String>,
    role_name: String,
    permissions_json: Value,
    denied_permissions_json: Value,
    masked_fields_json: Value,
    max_discount_paise: Option<i64>,
    max_refund_paise: Option<i64>,
    max_cash_movement_paise: Option<i64>,
    is_default: bool,
}

pub struct SessionTokenInput<'a> {
    pub tenant_id: &'a str,
    pub user_id: &'a str,
    pub session_id: &'a str,
    pub token_hash: &'a str,
    pub branch_id: Option<&'a str>,
    pub role_name: &'a str,
    pub permission_version: i64,
    pub device_id: Option<&'a str>,
    pub ip_address: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub expires_at: DateTime<Utc>,
}

pub struct AuthAuditInput<'a> {
    pub tenant_id: &'a str,
    pub user_id: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub branch_id: Option<&'a str>,
    pub identity: Option<&'a str>,
    pub event_type: &'a str,
    pub outcome: &'a str,
    pub ip_address: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub details: Value,
}

const AUTH_USER_COLUMNS: &str = "id, tenant_id, branch_id, role_id, role_name, login_id, email, password_hash, locked_until, permission_version, must_change_password";
const EXPLICIT_BRANCH_ACCESS_SQL: &str = r#"
    SELECT COALESCE(NULLIF(b.scope_id, ''), b.id::text) AS branch_id,
           b.name AS branch_name,
           b.region_name,
           b.zone_name,
           b.cluster_name,
           r.id AS role_id,
           r.name AS role_name,
           r.permissions_json,
           r.denied_permissions_json,
           r.masked_fields_json,
           r.max_discount_paise,
           r.max_refund_paise,
           r.max_cash_movement_paise,
           ubr.is_default
    FROM user_branch_roles ubr
    JOIN tenants t
      ON COALESCE(NULLIF(t.scope_id, ''), t.id::text) = ubr.tenant_id
    JOIN branches b
      ON b.tenant_id = t.id
     AND COALESCE(NULLIF(b.scope_id, ''), b.id::text) = ubr.branch_id
     AND b.active = TRUE
    JOIN roles r
      ON r.tenant_id = ubr.tenant_id
     AND (
       (ubr.role_id IS NOT NULL AND r.id = ubr.role_id)
       OR (ubr.role_id IS NULL AND LOWER(r.name) = LOWER(ubr.role_name))
     )
    WHERE ubr.tenant_id=$1 AND ubr.user_id=$2 AND ubr.active=TRUE
      AND (
        ubr.access_type='permanent'
        OR (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN ubr.valid_from AND ubr.valid_until
      )
"#;

pub async fn resolve_auth_tenant_id(
    db: &PgPool,
    tenant_context: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT tenant_id
        FROM (
          SELECT $1::text AS tenant_id, 0 AS priority
          WHERE EXISTS (SELECT 1 FROM users WHERE tenant_id = $1)
          UNION ALL
          SELECT COALESCE(NULLIF(scope_id, ''), id::text) AS tenant_id, 1 AS priority
          FROM tenants
          WHERE status = 'active'
            AND (
              id::text = $1
              OR LOWER(slug) = LOWER($1)
              OR LOWER(scope_id) = LOWER($1)
            )
        ) resolved
        ORDER BY priority
        LIMIT 1
        "#,
    )
    .bind(tenant_context.trim())
    .fetch_optional(db)
    .await
}

pub async fn find_user_by_identity(
    db: &PgPool,
    tenant_id: &str,
    identity: &str,
) -> Result<Option<AuthUser>, sqlx::Error> {
    sqlx::query_as::<_, AuthUser>(&format!(
        "SELECT {AUTH_USER_COLUMNS} FROM users \
         WHERE tenant_id=$1 AND active=TRUE \
           AND (LOWER(email)=LOWER($2) OR LOWER(login_id)=LOWER($2)) \
         ORDER BY CASE WHEN LOWER(email)=LOWER($2) THEN 0 ELSE 1 END LIMIT 1"
    ))
    .bind(tenant_id)
    .bind(identity.trim())
    .fetch_optional(db)
    .await
}

#[allow(dead_code)]
pub async fn find_user_by_email(
    db: &PgPool,
    tenant_id: &str,
    email: &str,
) -> Result<Option<AuthUser>, sqlx::Error> {
    find_user_by_identity(db, tenant_id, email).await
}

pub async fn find_user_by_id(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<AuthUser>, sqlx::Error> {
    sqlx::query_as::<_, AuthUser>(&format!(
        "SELECT {AUTH_USER_COLUMNS} FROM users WHERE tenant_id=$1 AND id=$2 AND active=TRUE LIMIT 1"
    ))
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn list_branch_access(
    db: &PgPool,
    user: &AuthUser,
) -> Result<Vec<BranchAccess>, sqlx::Error> {
    let rows = sqlx::query_as::<_, BranchAccessRow>(&format!(
        "{EXPLICIT_BRANCH_ACCESS_SQL} ORDER BY ubr.is_default DESC, b.region_name, b.zone_name, b.cluster_name, b.name ASC"
    ))
    .bind(&user.tenant_id)
    .bind(&user.id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(branch_access).collect())
}

pub async fn find_branch_access(
    db: &PgPool,
    user: &AuthUser,
    branch_id: &str,
) -> Result<Option<BranchAccess>, sqlx::Error> {
    let row = sqlx::query_as::<_, BranchAccessRow>(&format!(
        "{EXPLICIT_BRANCH_ACCESS_SQL} AND ubr.branch_id=$3 LIMIT 1"
    ))
    .bind(&user.tenant_id)
    .bind(&user.id)
    .bind(branch_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(branch_access))
}

pub async fn save_refresh_token(
    db: &PgPool,
    input: &SessionTokenInput<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO auth_refresh_tokens (
          tenant_id, user_id, session_id, token_hash, branch_id, role_name,
          permission_version, device_id, ip_address, user_agent, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.user_id)
    .bind(input.session_id)
    .bind(input.token_hash)
    .bind(input.branch_id)
    .bind(input.role_name)
    .bind(input.permission_version)
    .bind(input.device_id)
    .bind(input.ip_address)
    .bind(input.user_agent)
    .bind(input.expires_at)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn rotate_refresh_token(
    db: &PgPool,
    old_token_hash: &str,
    input: &SessionTokenInput<'_>,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rotated = sqlx::query_scalar::<_, bool>(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at=NOW(), revoke_reason='rotated', last_used_at=NOW()
        WHERE tenant_id=$1 AND user_id=$2 AND session_id=$3 AND token_hash=$4
          AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING TRUE
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.user_id)
    .bind(input.session_id)
    .bind(old_token_hash)
    .fetch_optional(&mut *tx)
    .await?;

    if rotated.is_none() {
        tx.rollback().await?;
        return Ok(false);
    }

    sqlx::query(
        r#"
        INSERT INTO auth_refresh_tokens (
          tenant_id, user_id, session_id, token_hash, branch_id, role_name,
          permission_version, device_id, ip_address, user_agent, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.user_id)
    .bind(input.session_id)
    .bind(input.token_hash)
    .bind(input.branch_id)
    .bind(input.role_name)
    .bind(input.permission_version)
    .bind(input.device_id)
    .bind(input.ip_address)
    .bind(input.user_agent)
    .bind(input.expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn revoke_refresh_token(db: &PgPool, token_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auth_refresh_tokens SET revoked_at=NOW(), revoke_reason='logout' WHERE token_hash=$1 AND revoked_at IS NULL",
    )
    .bind(token_hash)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn revoke_session(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    session_id: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auth_refresh_tokens SET revoked_at=NOW(), revoke_reason=$4 WHERE tenant_id=$1 AND user_id=$2 AND session_id=$3 AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(session_id)
    .bind(reason)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn change_password_and_revoke_sessions(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    password_hash: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query_scalar::<_, bool>(
        r#"
        UPDATE users
        SET password_hash=$3, must_change_password=FALSE, password_changed_at=NOW(),
            failed_login_count=0, locked_until=NULL, updated_at=NOW()
        WHERE tenant_id=$1 AND id=$2 AND active=TRUE
        RETURNING TRUE
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(password_hash)
    .fetch_optional(&mut *tx)
    .await?
    .is_some();
    if !updated {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query(
        "UPDATE auth_refresh_tokens SET revoked_at=NOW(), revoke_reason='password_changed' WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn is_session_active(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    session_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM auth_refresh_tokens WHERE tenant_id=$1 AND user_id=$2 AND session_id=$3 AND revoked_at IS NULL AND expires_at>NOW())",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(session_id)
    .fetch_one(db)
    .await
}

pub async fn session_id_for_token(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    token_hash: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT session_id FROM auth_refresh_tokens WHERE tenant_id=$1 AND user_id=$2 AND token_hash=$3 AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(token_hash)
    .fetch_optional(db)
    .await
}

pub async fn audit(db: &PgPool, input: AuthAuditInput<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO auth_audit_logs (
          tenant_id,user_id,session_id,branch_id,identity,event_type,outcome,
          ip_address,user_agent,details_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.user_id)
    .bind(input.session_id)
    .bind(input.branch_id)
    .bind(input.identity)
    .bind(input.event_type)
    .bind(input.outcome)
    .bind(input.ip_address)
    .bind(input.user_agent)
    .bind(input.details)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn mark_login_success(db: &PgPool, user_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=NOW(), updated_at=NOW() WHERE id=$1",
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
        SET failed_login_count=failed_login_count+1,
            locked_until=CASE WHEN failed_login_count+1 >= $2
              THEN NOW()+($3*INTERVAL '1 minute') ELSE locked_until END,
            updated_at=NOW()
        WHERE id=$1
        "#,
    )
    .bind(user_id)
    .bind(max_failed_attempts)
    .bind(lock_minutes)
    .execute(db)
    .await?;
    Ok(())
}

fn branch_access(row: BranchAccessRow) -> BranchAccess {
    BranchAccess {
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        region_name: row.region_name,
        zone_name: row.zone_name,
        cluster_name: row.cluster_name,
        role_id: row.role_id,
        role_name: row.role_name,
        permissions: permission_list(row.permissions_json),
        denied_permissions: permission_list(row.denied_permissions_json),
        masked_fields: permission_list(row.masked_fields_json),
        max_discount_paise: row.max_discount_paise,
        max_refund_paise: row.max_refund_paise,
        max_cash_movement_paise: row.max_cash_movement_paise,
        is_default: row.is_default,
    }
}

fn permission_list(value: Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::EXPLICIT_BRANCH_ACCESS_SQL;

    #[test]
    fn branch_access_requires_explicit_active_tenant_scope() {
        for required in [
            "FROM user_branch_roles",
            "JOIN branches b",
            "JOIN tenants t",
            "b.active = TRUE",
            "JOIN roles r",
            "r.tenant_id = ubr.tenant_id",
            "WHERE ubr.tenant_id=$1 AND ubr.user_id=$2 AND ubr.active=TRUE",
            "ubr.access_type='permanent'",
            "Asia/Kolkata",
            "BETWEEN ubr.valid_from AND ubr.valid_until",
        ] {
            assert!(EXPLICIT_BRANCH_ACCESS_SQL.contains(required));
        }
        assert!(!EXPLICIT_BRANCH_ACCESS_SQL.contains("LEFT JOIN"));
    }
}
