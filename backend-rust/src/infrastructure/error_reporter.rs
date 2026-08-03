//! Outbound error reporting for server-side failures.
//!
//! Structured `tracing` output already reaches CloudWatch, but nobody watches a
//! log stream at 3am. This module pushes 5xx responses to an incident webhook
//! (Sentry's store endpoint, a Slack hook, or anything that accepts JSON) so a
//! failure on one salon surfaces before the support call.
//!
//! Two safeguards matter more than the payload shape: a global token bucket so
//! an outage cannot turn into thousands of outbound requests, and a per-route
//! cooldown so one broken endpoint reports once with a count rather than once
//! per request.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Reports sent per minute across the whole process, regardless of how many
/// distinct routes are failing.
const MAX_REPORTS_PER_MINUTE: u64 = 60;

/// A given route reports at most once per window; repeats inside it are counted
/// and folded into the next report as `occurrences`.
const PER_ROUTE_COOLDOWN: Duration = Duration::from_secs(60);

const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct ErrorEvent {
    pub method: String,
    pub route: String,
    pub path: String,
    pub status: u16,
    pub elapsed_ms: u128,
    pub tenant_id: Option<String>,
}

struct RouteState {
    last_sent: Instant,
    suppressed: u64,
}

struct Limiter {
    routes: Mutex<HashMap<String, RouteState>>,
    window_started: Mutex<Instant>,
    sent_in_window: AtomicU64,
}

impl Limiter {
    fn new() -> Self {
        Self {
            routes: Mutex::new(HashMap::new()),
            window_started: Mutex::new(Instant::now()),
            sent_in_window: AtomicU64::new(0),
        }
    }

    /// Returns the number of occurrences to report, or `None` when this event
    /// should be swallowed. A returned `1` means "first in the window".
    fn admit(&self, route: &str) -> Option<u64> {
        let now = Instant::now();

        if let Ok(mut started) = self.window_started.lock() {
            if now.duration_since(*started) >= Duration::from_secs(60) {
                *started = now;
                self.sent_in_window.store(0, Ordering::Relaxed);
            }
        }

        let mut routes = self.routes.lock().ok()?;
        match routes.get_mut(route) {
            Some(state) if now.duration_since(state.last_sent) < PER_ROUTE_COOLDOWN => {
                state.suppressed += 1;
                return None;
            }
            Some(state) => {
                let occurrences = state.suppressed + 1;
                state.last_sent = now;
                state.suppressed = 0;
                self.charge_budget()?;
                Some(occurrences)
            }
            None => {
                // Bound the map so a path-scanning bot cannot grow it forever.
                if routes.len() >= 1_000 {
                    routes.clear();
                }
                routes.insert(
                    route.to_string(),
                    RouteState {
                        last_sent: now,
                        suppressed: 0,
                    },
                );
                self.charge_budget()?;
                Some(1)
            }
        }
    }

    fn charge_budget(&self) -> Option<()> {
        let sent = self.sent_in_window.fetch_add(1, Ordering::Relaxed);
        if sent >= MAX_REPORTS_PER_MINUTE {
            return None;
        }
        Some(())
    }
}

fn limiter() -> &'static Limiter {
    static LIMITER: OnceLock<Limiter> = OnceLock::new();
    LIMITER.get_or_init(Limiter::new)
}

/// Logs the failure and, when `ERROR_WEBHOOK_URL` is configured, forwards it.
///
/// Never blocks the response path: the log is synchronous and cheap, the
/// webhook is spawned and its outcome only reaches the logs.
pub fn report(event: ErrorEvent, webhook_url: Option<&str>, environment: &str) {
    tracing::error!(
        method = %event.method,
        route = %event.route,
        path = %event.path,
        status = event.status,
        elapsed_ms = event.elapsed_ms,
        tenant_id = event.tenant_id.as_deref().unwrap_or("unknown"),
        "api request failed"
    );

    let Some(url) = webhook_url else {
        return;
    };
    let Some(occurrences) = limiter().admit(&event.route) else {
        return;
    };

    let payload = serde_json::json!({
        "service": "aura-shine-backend",
        "environment": environment,
        "level": "error",
        "occurrences": occurrences,
        "method": event.method,
        "route": event.route,
        "path": event.path,
        "status": event.status,
        "elapsed_ms": event.elapsed_ms,
        "tenant_id": event.tenant_id,
        "text": format!(
            "[{}] {} {} -> {} ({}ms, tenant {}, x{})",
            environment,
            event.method,
            event.route,
            event.status,
            event.elapsed_ms,
            event.tenant_id.as_deref().unwrap_or("unknown"),
            occurrences
        ),
    });

    let url = url.to_string();
    tokio::spawn(async move {
        let client = match reqwest::Client::builder().timeout(WEBHOOK_TIMEOUT).build() {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "error webhook client build failed");
                return;
            }
        };
        if let Err(error) = client.post(&url).json(&payload).send().await {
            tracing::warn!(%error, "error webhook delivery failed");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_failure_on_a_route_is_admitted() {
        let limiter = Limiter::new();
        assert_eq!(limiter.admit("/api/v1/pos/sales"), Some(1));
    }

    #[test]
    fn repeats_inside_the_cooldown_are_suppressed_then_counted() {
        let limiter = Limiter::new();
        assert_eq!(limiter.admit("/api/v1/pos/sales"), Some(1));
        assert_eq!(limiter.admit("/api/v1/pos/sales"), None);
        assert_eq!(limiter.admit("/api/v1/pos/sales"), None);

        // Age the route past its cooldown; the swallowed hits ride along.
        if let Ok(mut routes) = limiter.routes.lock() {
            if let Some(state) = routes.get_mut("/api/v1/pos/sales") {
                state.last_sent = Instant::now() - PER_ROUTE_COOLDOWN - Duration::from_secs(1);
            }
        }
        assert_eq!(limiter.admit("/api/v1/pos/sales"), Some(3));
    }

    #[test]
    fn distinct_routes_do_not_share_a_cooldown() {
        let limiter = Limiter::new();
        assert_eq!(limiter.admit("/api/v1/pos/sales"), Some(1));
        assert_eq!(limiter.admit("/api/v1/appointments"), Some(1));
    }

    #[test]
    fn global_budget_stops_a_broad_outage_from_flooding() {
        let limiter = Limiter::new();
        let admitted = (0..(MAX_REPORTS_PER_MINUTE + 40))
            .filter(|index| limiter.admit(&format!("/route/{index}")).is_some())
            .count() as u64;

        assert_eq!(admitted, MAX_REPORTS_PER_MINUTE);
    }

    #[test]
    fn route_map_is_bounded() {
        let limiter = Limiter::new();
        for index in 0..1_200 {
            let _ = limiter.admit(&format!("/scan/{index}"));
        }
        assert!(limiter.routes.lock().unwrap().len() <= 1_000);
    }
}
