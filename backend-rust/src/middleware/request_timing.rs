use std::{sync::OnceLock, time::Instant};

use axum::{
    body::Body,
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};

const SLOW_REQUEST_THRESHOLD_MS: u128 = 800;

fn trace_threshold_ms() -> u128 {
    static TRACE_REQUEST_THRESHOLD_MS: OnceLock<u128> = OnceLock::new();
    *TRACE_REQUEST_THRESHOLD_MS.get_or_init(|| {
        std::env::var("TRACE_REQUEST_LATENCY_MS")
            .ok()
            .and_then(|value| value.parse::<u128>().ok())
            .unwrap_or(1)
    })
}

pub async fn request_timing(req: Request<Body>, next: Next) -> Response {
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
        .unwrap_or_else(|| raw_path.clone());

    let start = Instant::now();
    let response = next.run(req).await;
    let elapsed_ms = start.elapsed().as_millis();
    let trace_threshold = trace_threshold_ms();

    if elapsed_ms >= trace_threshold {
        tracing::info!(
            method = %method,
            route = %route_path,
            path = %raw_path,
            status = response.status().as_u16(),
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
            status = response.status().as_u16(),
            elapsed_ms,
            "slow api request"
        );
    }

    response
}
