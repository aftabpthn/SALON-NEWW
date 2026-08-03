use std::{sync::OnceLock, time::Instant};

use axum::{
    body::Body,
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};

use crate::infrastructure::error_reporter::{self, ErrorEvent};
use crate::infrastructure::metrics;
use crate::state::AppState;

const SLOW_REQUEST_THRESHOLD_MS: u128 = 800;

/// Path segments kept before a route label is truncated. Nothing the router
/// serves is deeper than this; anything that is came from a scanner.
const MAX_ROUTE_SEGMENTS: usize = 12;

fn trace_threshold_ms() -> u128 {
    static TRACE_REQUEST_THRESHOLD_MS: OnceLock<u128> = OnceLock::new();
    *TRACE_REQUEST_THRESHOLD_MS.get_or_init(|| {
        std::env::var("TRACE_REQUEST_LATENCY_MS")
            .ok()
            .and_then(|value| value.parse::<u128>().ok())
            .unwrap_or(1)
    })
}

/// Collapses a concrete request path into a bounded route label.
///
/// This layer sits outside the router, so `MatchedPath` is not populated yet
/// and the raw URI is all there is. Feeding that to a metric would mint a new
/// time series per invoice id, so identifier-shaped segments are folded into
/// `:id` and the query string is dropped.
fn normalize_route(path: &str) -> String {
    let path = path.split('?').next().unwrap_or(path);
    if path == "/" {
        return "/".to_string();
    }

    let mut out = String::with_capacity(path.len());
    let mut segments = 0usize;

    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        segments += 1;
        if segments > MAX_ROUTE_SEGMENTS {
            out.push_str("/...");
            break;
        }
        out.push('/');
        if is_identifier_segment(segment) {
            out.push_str(":id");
        } else {
            out.push_str(segment);
        }
    }

    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

fn is_identifier_segment(segment: &str) -> bool {
    if segment.parse::<u64>().is_ok() {
        return true;
    }
    if is_uuid(segment) {
        return true;
    }
    // Tenant, appointment and invoice ids are TEXT in this schema and vary in
    // shape, so fall back to "long enough to be generated, and not a word".
    segment.len() >= 16 && segment.chars().any(|ch| ch.is_ascii_digit())
}

fn is_uuid(segment: &str) -> bool {
    let groups: Vec<&str> = segment.split('-').collect();
    if groups.len() != 5 {
        return false;
    }
    let expected = [8usize, 4, 4, 4, 12];
    groups.iter().zip(expected.iter()).all(|(group, length)| {
        group.len() == *length && group.chars().all(|ch| ch.is_ascii_hexdigit())
    })
}

pub async fn request_timing(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let raw_path = req
        .uri()
        .path_and_query()
        .map(|value| value.as_str().to_string())
        .unwrap_or_default();
    let route_path = req
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_string())
        .unwrap_or_else(|| normalize_route(&raw_path));
    // Read off the request rather than the tenant middleware's extension: that
    // middleware runs inside this one, so its context is not visible here.
    let tenant_id = req
        .headers()
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    let start = Instant::now();
    let response = next.run(req).await;
    let elapsed = start.elapsed();
    let elapsed_ms = elapsed.as_millis();
    let status = response.status().as_u16();
    let trace_threshold = trace_threshold_ms();

    metrics::record_http_request(
        method.as_str(),
        &route_path,
        status,
        elapsed.as_secs_f64(),
        tenant_id.as_deref(),
        SLOW_REQUEST_THRESHOLD_MS as f64 / 1_000.0,
    );

    if elapsed_ms >= trace_threshold {
        tracing::info!(
            method = %method,
            route = %route_path,
            path = %raw_path,
            status,
            elapsed_ms,
            threshold_ms = trace_threshold,
            "api request timing"
        );
    }

    if elapsed_ms >= SLOW_REQUEST_THRESHOLD_MS {
        tracing::warn!(
            method = %method,
            route = %route_path,
            path = %raw_path,
            status,
            elapsed_ms,
            tenant_id = tenant_id.as_deref().unwrap_or("unknown"),
            "slow api request"
        );
    }

    if status >= 500 {
        error_reporter::report(
            ErrorEvent {
                method: method.to_string(),
                route: route_path,
                path: raw_path,
                status,
                elapsed_ms,
                tenant_id,
            },
            state.settings.error_webhook_url.as_deref(),
            &state.settings.app_env,
        );
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_strings_are_dropped() {
        assert_eq!(
            normalize_route("/api/v1/reports/staff-bookings?days=30"),
            "/api/v1/reports/staff-bookings"
        );
    }

    #[test]
    fn uuid_segments_collapse() {
        assert_eq!(
            normalize_route("/api/v1/clients/3f2504e0-4f89-11d3-9a0c-0305e82c3301/notes"),
            "/api/v1/clients/:id/notes"
        );
    }

    #[test]
    fn numeric_segments_collapse() {
        assert_eq!(
            normalize_route("/api/v1/branches/42"),
            "/api/v1/branches/:id"
        );
    }

    #[test]
    fn generated_text_ids_collapse() {
        assert_eq!(
            normalize_route("/api/v1/appointments/apt01H8XG3M4K2N7P"),
            "/api/v1/appointments/:id"
        );
    }

    #[test]
    fn real_path_words_survive() {
        assert_eq!(
            normalize_route("/api/v1/pos/invoices/outstanding"),
            "/api/v1/pos/invoices/outstanding"
        );
        // Long, but no digits — a route name, not an id.
        assert_eq!(
            normalize_route("/api/v1/staff-operations-intelligence"),
            "/api/v1/staff-operations-intelligence"
        );
    }

    #[test]
    fn root_and_empty_paths_are_stable() {
        assert_eq!(normalize_route("/"), "/");
        assert_eq!(normalize_route(""), "/");
        assert_eq!(normalize_route("?a=1"), "/");
    }

    #[test]
    fn deep_paths_are_truncated() {
        let path = format!("/{}", vec!["seg"; 40].join("/"));
        let normalized = normalize_route(&path);
        assert!(normalized.ends_with("/..."));
        assert_eq!(normalized.matches("/seg").count(), MAX_ROUTE_SEGMENTS);
    }

    #[test]
    fn uuid_detection_rejects_near_misses() {
        assert!(is_uuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
        assert!(!is_uuid("3f2504e0-4f89-11d3-9a0c"));
        assert!(!is_uuid("zzzzzzzz-4f89-11d3-9a0c-0305e82c3301"));
    }
}
