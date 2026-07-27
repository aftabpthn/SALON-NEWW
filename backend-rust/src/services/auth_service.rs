use std::sync::LazyLock;

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::services::permission_registry;

pub struct PermissionDefinition {
    pub code: &'static str,
    #[allow(dead_code)]
    pub label: &'static str,
    #[allow(dead_code)]
    pub group: &'static str,
}

/// UI-facing tenant permission catalog, derived from the single permission
/// registry so checkboxes always match what routes enforce.
pub static TENANT_PERMISSION_CATALOG: LazyLock<Vec<PermissionDefinition>> = LazyLock::new(|| {
    permission_registry::tenant_assignable()
        .map(|spec| PermissionDefinition {
            code: spec.key,
            label: spec.label,
            group: spec.module,
        })
        .collect()
});

#[allow(dead_code)]
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    PasswordHash::new(password_hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

pub fn password_meets_policy(password: &str) -> bool {
    (12..=128).contains(&password.chars().count())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthClaims {
    pub sub: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role: String,
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub denied_permissions: Vec<String>,
    #[serde(default)]
    pub masked_fields: Vec<String>,
    #[serde(default)]
    pub max_discount_paise: Option<i64>,
    #[serde(default)]
    pub max_refund_paise: Option<i64>,
    #[serde(default)]
    pub max_cash_movement_paise: Option<i64>,
    #[serde(default)]
    pub permission_version: i64,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub mfa_enrollment_required: bool,
    pub token_type: String,
    pub jti: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expires_in_seconds: u64,
    pub must_change_password: bool,
    pub mfa_enrollment_required: bool,
}

pub struct TokenScope<'a> {
    pub user_id: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: Option<&'a str>,
    pub role_id: Option<&'a str>,
    pub role: &'a str,
    pub permissions: &'a [String],
    pub permission_version: i64,
    pub session_id: &'a str,
    pub must_change_password: bool,
    pub mfa_enrollment_required: bool,
}

pub fn issue_token_pair(
    user_id: &str,
    tenant_id: &str,
    branch_id: Option<String>,
    role: &str,
    access_secret: &str,
    refresh_secret: &str,
    access_ttl_minutes: u64,
    refresh_ttl_days: u64,
) -> Result<(TokenPair, chrono::DateTime<Utc>), jsonwebtoken::errors::Error> {
    let session_id = Uuid::new_v4().to_string();
    issue_scoped_token_pair(
        TokenScope {
            user_id,
            tenant_id,
            branch_id: branch_id.as_deref(),
            role_id: None,
            role,
            permissions: &[],
            permission_version: 1,
            session_id: &session_id,
            must_change_password: false,
            mfa_enrollment_required: false,
        },
        access_secret,
        refresh_secret,
        access_ttl_minutes,
        refresh_ttl_days,
    )
}

pub fn issue_scoped_token_pair(
    scope: TokenScope<'_>,
    access_secret: &str,
    refresh_secret: &str,
    access_ttl_minutes: u64,
    refresh_ttl_days: u64,
) -> Result<(TokenPair, chrono::DateTime<Utc>), jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let access_exp = now + Duration::minutes(access_ttl_minutes as i64);
    let refresh_exp = now + Duration::days(refresh_ttl_days as i64);

    let access_claims = claims(&scope, "access", now, access_exp);
    let refresh_claims = claims(&scope, "refresh", now, refresh_exp);

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(access_secret.as_bytes()),
    )?;
    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(refresh_secret.as_bytes()),
    )?;

    Ok((
        TokenPair {
            access_token,
            refresh_token,
            token_type: "Bearer",
            expires_in_seconds: access_ttl_minutes * 60,
            must_change_password: scope.must_change_password,
            mfa_enrollment_required: scope.mfa_enrollment_required,
        },
        refresh_exp,
    ))
}

pub fn issue_branch_selection_token(
    user_id: &str,
    tenant_id: &str,
    permission_version: i64,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = AuthClaims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        branch_id: None,
        role: String::new(),
        role_id: None,
        permissions: Vec::new(),
        denied_permissions: Vec::new(),
        masked_fields: Vec::new(),
        max_discount_paise: None,
        max_refund_paise: None,
        max_cash_movement_paise: None,
        permission_version,
        session_id: String::new(),
        mfa_enrollment_required: false,
        token_type: "branch_selection".to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::minutes(5)).timestamp() as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn decode_access_token(
    token: &str,
    secret: &str,
) -> Result<AuthClaims, jsonwebtoken::errors::Error> {
    decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}

pub fn decode_refresh_token(
    token: &str,
    secret: &str,
) -> Result<AuthClaims, jsonwebtoken::errors::Error> {
    decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}

pub fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn claims(
    scope: &TokenScope<'_>,
    token_type: &str,
    issued_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
) -> AuthClaims {
    AuthClaims {
        sub: scope.user_id.to_string(),
        tenant_id: scope.tenant_id.to_string(),
        branch_id: scope.branch_id.map(str::to_string),
        role: scope.role.to_string(),
        role_id: scope.role_id.map(str::to_string),
        permissions: scope.permissions.to_vec(),
        denied_permissions: Vec::new(),
        masked_fields: Vec::new(),
        max_discount_paise: None,
        max_refund_paise: None,
        max_cash_movement_paise: None,
        permission_version: scope.permission_version,
        session_id: scope.session_id.to_string(),
        mfa_enrollment_required: scope.mfa_enrollment_required,
        token_type: token_type.to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: issued_at.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_access_token, issue_scoped_token_pair, password_meets_policy, TokenScope};

    #[test]
    fn scoped_token_round_trip_preserves_branch_role_and_permissions() {
        let permissions = vec!["read:appointments".to_string()];
        let (tokens, _) = issue_scoped_token_pair(
            TokenScope {
                user_id: "user-1",
                tenant_id: "tenant-1",
                branch_id: Some("branch-2"),
                role_id: Some("role-manager"),
                role: "manager",
                permissions: &permissions,
                permission_version: 4,
                session_id: "session-1",
                must_change_password: false,
                mfa_enrollment_required: true,
            },
            "access-secret-with-enough-entropy",
            "refresh-secret-with-enough-entropy",
            15,
            30,
        )
        .expect("token pair");

        let claims = decode_access_token(&tokens.access_token, "access-secret-with-enough-entropy")
            .expect("access claims");
        assert_eq!(claims.branch_id.as_deref(), Some("branch-2"));
        assert_eq!(claims.role, "manager");
        assert_eq!(claims.permissions, permissions);
        assert_eq!(claims.permission_version, 4);
        assert_eq!(claims.session_id, "session-1");
        assert!(claims.mfa_enrollment_required);
    }

    #[test]
    fn password_policy_accepts_only_bounded_passwords() {
        assert!(!password_meets_policy("short"));
        assert!(password_meets_policy("twelve-chars"));
        assert!(!password_meets_policy(&"x".repeat(129)));
    }
}
