//! CSRF protection for cookie-authenticated requests.
//!
//! `GET /auth/csrf` used to hand out a fresh UUID that nothing ever checked, so
//! the header the three front-ends dutifully attached was decoration. The token
//! is now an HMAC over an expiry and a nonce, mirrored into a `HttpOnly` cookie,
//! and verified here: the header must be signed, unexpired, and equal to the
//! cookie. An attacker's page can drive the browser into sending the cookie but
//! cannot read the JSON body the header comes from, so it cannot match the two.
//!
//! Enforcement is scoped to requests that actually carry those cookies. Server
//! integrations, webhooks and API-key callers never do, so they are unaffected;
//! a browser holding a session always does.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::{config::is_local_env, models::common::AppError, state::AppState};

pub const CSRF_COOKIE: &str = "aurashine_csrf";
pub const CSRF_HEADER: &str = "x-csrf-token";
const REFRESH_COOKIE: &str = "aurashine_refresh_token";
const TOKEN_TTL_MINUTES: i64 = 60;
/// Domain separation: the refresh secret also signs refresh tokens, and a CSRF
/// token must never be interchangeable with one.
const SIGNATURE_LABEL: &str = "aurashine.csrf.v1";

pub struct IssuedCsrfToken {
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub max_age_seconds: i64,
}

/// Mints `{expiry}.{nonce}.{signature}`.
pub fn issue(secret: &str) -> IssuedCsrfToken {
    let expires_at = Utc::now() + Duration::minutes(TOKEN_TTL_MINUTES);
    let payload = format!(
        "{}.{}",
        expires_at.timestamp(),
        Uuid::new_v4().simple()
    );
    let signature = sign(&payload, secret);
    IssuedCsrfToken {
        token: format!("{payload}.{signature}"),
        expires_at,
        max_age_seconds: TOKEN_TTL_MINUTES * 60,
    }
}

pub fn cookie_header(state: &AppState, value: &str, max_age: i64) -> Result<HeaderValue, AppError> {
    let secure = if is_local_env(&state.settings.app_env) {
        ""
    } else {
        "; Secure"
    };
    HeaderValue::from_str(&format!(
        "{CSRF_COOKIE}={value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"
    ))
    .map_err(|_| AppError::internal("failed to create csrf cookie"))
}

pub async fn require_csrf(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if let Err(error) = check(req.method(), req.headers(), &state.settings.jwt_refresh_secret) {
        return error.into_response();
    }
    next.run(req).await
}

fn check(method: &Method, headers: &HeaderMap, secret: &str) -> Result<(), AppError> {
    if !is_mutating(method) {
        return Ok(());
    }
    let Some(cookie_token) = cookie(headers, CSRF_COOKIE) else {
        // No CSRF cookie means either a non-browser client (no ambient
        // credentials to abuse) or a browser that has not called /auth/csrf
        // yet. Only the latter is a risk, and it is a risk exactly when a
        // session cookie rides along.
        if cookie(headers, REFRESH_COOKIE).is_some() {
            return Err(csrf_error("csrf token is required for this request"));
        }
        return Ok(());
    };

    let header_token = headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| csrf_error("csrf token is required for this request"))?;

    if !constant_time_eq(header_token.as_bytes(), cookie_token.as_bytes()) {
        return Err(csrf_error("csrf token does not match the session cookie"));
    }
    verify(header_token, secret)
}

/// Checks the signature first and the clock second so a forged token can never
/// be distinguished from an expired one by response alone.
fn verify(token: &str, secret: &str) -> Result<(), AppError> {
    let mut parts = token.rsplitn(2, '.');
    let signature = parts
        .next()
        .ok_or_else(|| csrf_error("csrf token is malformed"))?;
    let payload = parts
        .next()
        .ok_or_else(|| csrf_error("csrf token is malformed"))?;

    let expected = sign(payload, secret);
    if !constant_time_eq(signature.as_bytes(), expected.as_bytes()) {
        return Err(csrf_error("csrf token signature is invalid"));
    }

    let expires_at = payload
        .split('.')
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| csrf_error("csrf token is malformed"))?;
    if expires_at <= Utc::now().timestamp() {
        return Err(csrf_error("csrf token has expired"));
    }
    Ok(())
}

fn sign(payload: &str, secret: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("hmac accepts keys of any length");
    mac.update(SIGNATURE_LABEL.as_bytes());
    mac.update(b":");
    mac.update(payload.as_bytes());
    hex(&mac.finalize().into_bytes())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut acc, byte| {
        use std::fmt::Write;
        let _ = write!(acc, "{byte:02x}");
        acc
    })
}

fn is_mutating(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|item| {
                let (key, value) = item.trim().split_once('=')?;
                (key == name && !value.is_empty()).then(|| value.to_string())
            })
        })
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

fn csrf_error(message: &'static str) -> AppError {
    AppError::forbidden_code("CSRF_TOKEN_INVALID", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const SECRET: &str = "csrf-secret-with-more-than-32-characters";

    fn headers(cookie: Option<&str>, csrf_header: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(cookie) = cookie {
            headers.insert(header::COOKIE, HeaderValue::from_str(cookie).unwrap());
        }
        if let Some(value) = csrf_header {
            headers.insert(CSRF_HEADER, HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    #[test]
    fn issued_token_passes_double_submit() {
        let issued = issue(SECRET);
        let cookie = format!("{CSRF_COOKIE}={}", issued.token);
        assert!(check(&Method::POST, &headers(Some(&cookie), Some(&issued.token)), SECRET).is_ok());
    }

    #[test]
    fn reads_are_never_challenged() {
        assert!(check(&Method::GET, &headers(None, None), SECRET).is_ok());
    }

    #[test]
    fn cookieless_clients_are_untouched() {
        // Webhooks and API-key integrations carry no ambient browser credential.
        assert!(check(&Method::POST, &headers(None, None), SECRET).is_ok());
    }

    #[test]
    fn session_cookie_without_csrf_cookie_is_rejected() {
        let cookie = format!("{REFRESH_COOKIE}=refresh-value");
        assert!(check(&Method::POST, &headers(Some(&cookie), None), SECRET).is_err());
    }

    #[test]
    fn forged_header_is_rejected() {
        // The cross-site case: the browser attaches the cookie, the attacker
        // guesses the header.
        let issued = issue(SECRET);
        let cookie = format!("{CSRF_COOKIE}={}", issued.token);
        assert!(check(
            &Method::POST,
            &headers(Some(&cookie), Some("00000000.deadbeef.badsignature")),
            SECRET
        )
        .is_err());
        assert!(check(&Method::POST, &headers(Some(&cookie), None), SECRET).is_err());
    }

    #[test]
    fn tokens_from_another_deployment_are_rejected() {
        let issued = issue("a-different-signing-secret-entirely");
        let cookie = format!("{CSRF_COOKIE}={}", issued.token);
        assert!(
            check(&Method::POST, &headers(Some(&cookie), Some(&issued.token)), SECRET).is_err()
        );
    }

    #[test]
    fn expired_tokens_are_rejected() {
        let expired = Utc::now() - Duration::minutes(1);
        let payload = format!("{}.{}", expired.timestamp(), Uuid::new_v4().simple());
        let token = format!("{payload}.{}", sign(&payload, SECRET));
        let cookie = format!("{CSRF_COOKIE}={token}");
        assert!(check(&Method::POST, &headers(Some(&cookie), Some(&token)), SECRET).is_err());
    }

    #[test]
    fn refresh_tokens_cannot_be_replayed_as_csrf_tokens() {
        // The label keeps the shared secret from making the two interchangeable.
        let payload = format!("{}.{}", (Utc::now() + Duration::hours(1)).timestamp(), "nonce");
        let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).unwrap();
        mac.update(payload.as_bytes());
        let unlabelled = format!("{payload}.{}", hex(&mac.finalize().into_bytes()));
        let cookie = format!("{CSRF_COOKIE}={unlabelled}");
        assert!(check(&Method::POST, &headers(Some(&cookie), Some(&unlabelled)), SECRET).is_err());
    }
}
