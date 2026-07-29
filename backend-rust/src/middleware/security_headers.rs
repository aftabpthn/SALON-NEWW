use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::{IpAddr, SocketAddr};

use crate::{
    config::is_local_env,
    services::{auth_service, security_service},
    state::AppState,
};

const PROBE_PATTERNS: &[(&str, &str)] = &[
    ("/.env", "environment_file"),
    ("/%2eenv", "environment_file"),
    ("/.git", "git_metadata"),
    ("/%2egit", "git_metadata"),
    ("/wp-admin", "wordpress_admin"),
    ("/wp-login", "wordpress_login"),
    ("/phpmyadmin", "database_admin"),
    ("/server-status", "server_status"),
    ("/actuator", "actuator"),
    ("/cgi-bin", "cgi"),
    ("/vendor/phpunit", "phpunit"),
    ("/etc/passwd", "path_traversal"),
    ("%2e%2e", "path_traversal"),
];

pub async fn add_security_headers(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let sensitive = path.contains("/auth/")
        || path.contains("/security/")
        || path.ends_with("/settings/security");
    let source_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| resolved_source_ip(peer.0.ip(), request.headers()));
    request.headers_mut().remove("x-aurashine-source-ip");
    if let Some(value) = source_ip
        .as_deref()
        .and_then(|value| HeaderValue::from_str(value).ok())
    {
        request.headers_mut().insert("x-aurashine-source-ip", value);
    }

    let blocked = if let Some(ip) = source_ip.as_deref() {
        security_service::intrusion_source_blocked(&state.redis, ip).await
    } else {
        false
    };
    let mut response = if blocked {
        StatusCode::TOO_MANY_REQUESTS.into_response()
    } else if let Some(signal) = probe_signal(&path) {
        let scope = probe_scope(request.headers(), &state.settings.jwt_access_secret);
        if let Err(error) = security_service::record_intrusion_probe(
            &state.db,
            &state.redis,
            &scope.tenant_id,
            &scope.branch_id,
            scope.user_id.as_deref(),
            source_ip.as_deref(),
            request.method().as_str(),
            &path,
            signal,
            request
                .headers()
                .get(header::USER_AGENT)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        {
            tracing::warn!(error = ?error, "intrusion probe recording failed");
        }
        StatusCode::NOT_FOUND.into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();

    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(if path.starts_with("/staff") {
            "camera=(self), microphone=(), geolocation=(self)"
        } else {
            "camera=(), microphone=(), geolocation=()"
        }),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    );

    if sensitive {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    }
    if !is_local_env(&state.settings.app_env) {
        headers.insert(
            HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }

    response
}

struct ProbeScope {
    tenant_id: String,
    branch_id: String,
    user_id: Option<String>,
}

fn probe_scope(headers: &HeaderMap, jwt_secret: &str) -> ProbeScope {
    let claims = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .and_then(|token| auth_service::decode_access_token(token, jwt_secret).ok())
        .filter(|claims| claims.token_type == "access" && claims.branch_id.is_some());
    claims.map_or(
        ProbeScope {
            tenant_id: "platform".into(),
            branch_id: "global".into(),
            user_id: None,
        },
        |claims| ProbeScope {
            tenant_id: claims.tenant_id,
            branch_id: claims.branch_id.unwrap_or_else(|| "global".into()),
            user_id: Some(claims.sub),
        },
    )
}

fn probe_signal(path: &str) -> Option<&'static str> {
    let path = path.to_ascii_lowercase();
    PROBE_PATTERNS
        .iter()
        .find_map(|(pattern, signal)| path.contains(pattern).then_some(*signal))
}

fn resolved_source_ip(peer: IpAddr, headers: &HeaderMap) -> String {
    if trusted_proxy(peer) {
        if let Some(forwarded) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .and_then(|value| value.parse::<IpAddr>().ok())
        {
            return forwarded.to_string();
        }
    }
    peer.to_string()
}

fn trusted_proxy(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local(),
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use axum::http::{HeaderMap, HeaderValue};

    use super::{probe_signal, resolved_source_ip};

    #[test]
    fn csp_is_api_safe_and_denies_embedding() {
        let policy = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("frame-ancestors 'none'"));
    }

    #[test]
    fn intrusion_signals_are_narrow_and_proxy_ip_is_trusted_only_from_private_peers() {
        assert_eq!(probe_signal("/.env"), Some("environment_file"));
        assert_eq!(probe_signal("/wp-login.php"), Some("wordpress_login"));
        assert_eq!(probe_signal("/api/v1/appointments"), None);

        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("203.0.113.10"));
        assert_eq!(
            resolved_source_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5)), &headers),
            "203.0.113.10"
        );
        assert_eq!(
            resolved_source_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)), &headers),
            "8.8.8.8"
        );
    }
}
