use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Executor, FromRow, PgPool, Postgres, Transaction};

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
    SELECT b.id::text AS branch_id,
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
      ON t.id::text = ubr.tenant_id
    JOIN branches b
      ON b.tenant_id = t.id
     AND b.id::text = ubr.branch_id
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
          SELECT 'platform'::text AS tenant_id, 0 AS priority
          WHERE LOWER($1)='platform'
            AND EXISTS (SELECT 1 FROM users WHERE tenant_id='platform' AND active=TRUE)
          UNION ALL
          SELECT tenant.id::text AS tenant_id, 1 AS priority
          FROM tenants tenant
          WHERE tenant.status = 'active'
            AND (
              tenant.id::text = $1
              OR LOWER(tenant.slug) = LOWER($1)
              OR EXISTS (
                SELECT 1 FROM tenant_id_aliases alias
                WHERE alias.tenant_id=tenant.id AND LOWER(alias.alias)=LOWER($1)
              )
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

pub async fn find_active_permission_version(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT permission_version FROM users WHERE tenant_id=$1 AND id=$2 AND active=TRUE LIMIT 1",
    )
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
        "{EXPLICIT_BRANCH_ACCESS_SQL} AND (
           ubr.branch_id=$3 OR EXISTS (
             SELECT 1 FROM branch_id_aliases alias
             WHERE alias.tenant_id=t.id AND alias.branch_id=b.id
               AND LOWER(alias.alias)=LOWER($3)
           )
         ) LIMIT 1"
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
    insert_audit(db, input).await
}

pub async fn audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: AuthAuditInput<'_>,
) -> Result<(), sqlx::Error> {
    insert_audit(&mut **tx, input).await
}

async fn insert_audit<'e, E>(executor: E, input: AuthAuditInput<'_>) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
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
    .execute(executor)
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
    use super::{find_branch_access, resolve_auth_tenant_id, AuthUser, EXPLICIT_BRANCH_ACCESS_SQL};
    use sqlx::PgPool;

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
            "b.id::text AS branch_id",
        ] {
            assert!(EXPLICIT_BRANCH_ACCESS_SQL.contains(required));
        }
        assert!(!EXPLICIT_BRANCH_ACCESS_SQL.contains("LEFT JOIN"));
        assert!(!EXPLICIT_BRANCH_ACCESS_SQL.contains("b.scope_id"));
    }

    #[sqlx::test(migrations = false)]
    async fn suspended_tenant_with_active_user_cannot_resolve_for_login(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE tenants(
              id UUID PRIMARY KEY,slug TEXT,status TEXT NOT NULL
            );
            CREATE TABLE users(
              id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,active BOOLEAN NOT NULL
            );
            CREATE TABLE tenant_id_aliases(
              tenant_id UUID NOT NULL,alias TEXT NOT NULL
            );
            INSERT INTO tenants(id,slug,status)
            VALUES('11111111-1111-4111-8111-111111111111','suspended-salon','suspended');
            INSERT INTO users(id,tenant_id,active)
            VALUES('owner-1','11111111-1111-4111-8111-111111111111',TRUE);
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let active_user_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND active=TRUE)",
        )
        .bind("11111111-1111-4111-8111-111111111111")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(active_user_exists);
        assert!(resolve_auth_tenant_id(&pool, "suspended-salon")
            .await
            .unwrap()
            .is_none());
    }

    #[sqlx::test(migrations = false)]
    async fn staff_security_cross_branch_access_requires_explicit_grant(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE tenants(id UUID PRIMARY KEY);
            CREATE TABLE branches(
              id UUID PRIMARY KEY,tenant_id UUID,active BOOLEAN,name TEXT,
              region_name TEXT,zone_name TEXT,cluster_name TEXT
            );
            CREATE TABLE roles(
              id TEXT,tenant_id TEXT,name TEXT,permissions_json JSONB,
              denied_permissions_json JSONB,masked_fields_json JSONB,
              max_discount_paise BIGINT,max_refund_paise BIGINT,max_cash_movement_paise BIGINT,
              PRIMARY KEY(tenant_id,id)
            );
            CREATE TABLE user_branch_roles(
              tenant_id TEXT,user_id TEXT,branch_id TEXT,role_id TEXT,role_name TEXT,
              access_type TEXT,valid_from DATE,valid_until DATE,is_default BOOLEAN,active BOOLEAN
            );
            CREATE TABLE branch_id_aliases(
              tenant_id UUID,branch_id UUID,alias TEXT
            );
            INSERT INTO tenants VALUES('11111111-1111-4111-8111-111111111111');
            INSERT INTO branches VALUES
              ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',TRUE,'Granted','','',''),
              ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',TRUE,'Denied','','','');
            INSERT INTO roles VALUES('manager','11111111-1111-4111-8111-111111111111','Manager','[]','[]','[]',NULL,NULL,NULL);
            INSERT INTO user_branch_roles VALUES(
              '11111111-1111-4111-8111-111111111111','user-1',
              '22222222-2222-4222-8222-222222222222','manager','Manager',
              'permanent',NULL,NULL,TRUE,TRUE
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let user = AuthUser {
            id: "user-1".into(),
            tenant_id: "11111111-1111-4111-8111-111111111111".into(),
            branch_id: None,
            role_id: None,
            role_name: "Manager".into(),
            login_id: None,
            email: "manager@example.test".into(),
            password_hash: String::new(),
            locked_until: None,
            permission_version: 1,
            must_change_password: false,
        };

        assert!(
            find_branch_access(&pool, &user, "22222222-2222-4222-8222-222222222222")
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            find_branch_access(&pool, &user, "33333333-3333-4333-8333-333333333333")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = false)]
    async fn staff_security_role_changes_invalidate_affected_sessions(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE roles(
              id TEXT,tenant_id TEXT,name TEXT,permissions_json JSONB,
              denied_permissions_json JSONB,masked_fields_json JSONB,
              max_discount_paise BIGINT,max_refund_paise BIGINT,max_cash_movement_paise BIGINT,
              PRIMARY KEY(tenant_id,id)
            );
            CREATE TABLE users(
              id TEXT,tenant_id TEXT,role_id TEXT,permission_version BIGINT,updated_at TIMESTAMPTZ,
              PRIMARY KEY(tenant_id,id)
            );
            CREATE TABLE user_branch_roles(
              tenant_id TEXT,user_id TEXT,role_id TEXT,active BOOLEAN
            );
            CREATE TABLE auth_refresh_tokens(
              tenant_id TEXT,user_id TEXT,revoked_at TIMESTAMPTZ,revoke_reason TEXT
            );
            INSERT INTO roles VALUES('manager','tenant-1','Manager','[]','[]','[]',NULL,NULL,NULL);
            INSERT INTO users VALUES
              ('direct','tenant-1','manager',1,NULL),
              ('branch','tenant-1',NULL,1,NULL),
              ('unrelated','tenant-1',NULL,1,NULL);
            INSERT INTO user_branch_roles VALUES('tenant-1','branch','manager',TRUE);
            INSERT INTO auth_refresh_tokens(tenant_id,user_id) VALUES
              ('tenant-1','direct'),('tenant-1','branch'),('tenant-1','unrelated');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0272_role_authorization_session_invalidation.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("UPDATE roles SET permissions_json='[\"staff.basic\"]' WHERE tenant_id='tenant-1' AND id='manager'")
            .execute(&pool)
            .await
            .unwrap();

        let versions: Vec<(String, i64)> =
            sqlx::query_as("SELECT id,permission_version FROM users ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            versions,
            vec![
                ("branch".into(), 2),
                ("direct".into(), 2),
                ("unrelated".into(), 1),
            ]
        );
        let sessions: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT user_id,revoke_reason FROM auth_refresh_tokens ORDER BY user_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            sessions,
            vec![
                ("branch".into(), Some("role_authorization_changed".into())),
                ("direct".into(), Some("role_authorization_changed".into())),
                ("unrelated".into(), None),
            ]
        );
    }
}
