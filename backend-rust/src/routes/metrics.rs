//! Prometheus scrape endpoint.
//!
//! Mounted outside `/api/v1` so it is not behind tenant resolution, and gated
//! on its own bearer token: the series here expose route names, tenant
//! identifiers and failure rates across every salon on the platform.

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

use crate::config::is_local_env;
use crate::infrastructure::metrics;
use crate::state::AppState;

const PROMETHEUS_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

pub async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match state.settings.metrics_auth_token.as_deref() {
        Some(expected) => {
            if !bearer_matches(&headers, expected) {
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
        // Without a token the endpoint would publish platform-wide operational
        // data unauthenticated, so outside local development it simply does not
        // exist. 404 rather than 403 keeps its presence unadvertised.
        None if !is_local_env(&state.settings.app_env) => {
            return StatusCode::NOT_FOUND.into_response();
        }
        None => {}
    }

    let body = metrics::render(&state.db, &state.settings.app_env);
    ([(header::CONTENT_TYPE, PROMETHEUS_CONTENT_TYPE)], body).into_response()
}

fn bearer_matches(headers: &HeaderMap, expected: &str) -> bool {
    let Some(provided) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
    else {
        return false;
    };
    constant_time_eq(provided.as_bytes(), expected.as_bytes())
}

/// Compares without an early return on the first differing byte, so response
/// timing does not leak how much of the token was guessed correctly.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers_with(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, value.parse().unwrap());
        headers
    }

    #[test]
    fn matching_bearer_token_is_accepted() {
        assert!(bearer_matches(
            &headers_with("Bearer s3cret-token"),
            "s3cret-token"
        ));
    }

    #[test]
    fn wrong_or_missing_tokens_are_rejected() {
        assert!(!bearer_matches(
            &headers_with("Bearer nope"),
            "s3cret-token"
        ));
        assert!(!bearer_matches(
            &headers_with("s3cret-token"),
            "s3cret-token"
        ));
        assert!(!bearer_matches(&HeaderMap::new(), "s3cret-token"));
    }

    #[test]
    fn prefix_of_the_real_token_is_rejected() {
        assert!(!bearer_matches(
            &headers_with("Bearer s3cret"),
            "s3cret-token"
        ));
    }

    #[test]
    fn constant_time_eq_matches_equality() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }
}
