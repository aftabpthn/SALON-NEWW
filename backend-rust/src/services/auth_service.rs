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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthClaims {
    pub sub: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role: String,
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
    let now = Utc::now();
    let access_exp = now + Duration::minutes(access_ttl_minutes as i64);
    let refresh_exp = now + Duration::days(refresh_ttl_days as i64);

    let access_claims = claims(
        user_id,
        tenant_id,
        branch_id.clone(),
        role,
        "access",
        now,
        access_exp,
    );
    let refresh_claims = claims(
        user_id,
        tenant_id,
        branch_id,
        role,
        "refresh",
        now,
        refresh_exp,
    );

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
        },
        refresh_exp,
    ))
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
    user_id: &str,
    tenant_id: &str,
    branch_id: Option<String>,
    role: &str,
    token_type: &str,
    issued_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
) -> AuthClaims {
    AuthClaims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        branch_id,
        role: role.to_string(),
        token_type: token_type.to_string(),
        jti: Uuid::new_v4().to_string(),
        iat: issued_at.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    }
}
