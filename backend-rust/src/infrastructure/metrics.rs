//! Prometheus-compatible metrics registry.
//!
//! Hand-rolled rather than pulled from a crate so the exporter adds no
//! dependencies to a binary that already ships to 1000 live salons. The hot
//! path takes a read lock and one atomic add per observation; a write lock is
//! only taken the first time a label combination is seen.
//!
//! Cardinality is the thing that kills self-hosted Prometheus, so every family
//! caps its distinct label sets and reports the overflow through
//! `aurashine_metrics_series_dropped_total` instead of growing without bound.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

/// Distinct label combinations kept per metric family before new ones are
/// dropped. Routes are bounded by the router, but tenant-labelled families
/// scale with the customer base, so the cap is what keeps a 1000-tenant
/// deployment from turning into a million time series.
const MAX_SERIES_PER_FAMILY: usize = 10_000;

/// Latency buckets in seconds. Tuned for an API where anything past 2.5s is
/// already a support call, so the resolution sits below that.
const DURATION_BUCKETS_SECONDS: &[f64] = &[
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

type LabelValues = Vec<String>;

struct CounterFamily {
    name: &'static str,
    help: &'static str,
    label_names: &'static [&'static str],
    series: RwLock<HashMap<LabelValues, Arc<AtomicU64>>>,
    dropped: AtomicU64,
}

impl CounterFamily {
    fn new(name: &'static str, help: &'static str, label_names: &'static [&'static str]) -> Self {
        Self {
            name,
            help,
            label_names,
            series: RwLock::new(HashMap::new()),
            dropped: AtomicU64::new(0),
        }
    }

    fn increment(&self, labels: &[&str]) {
        debug_assert_eq!(labels.len(), self.label_names.len());
        let key: LabelValues = labels.iter().map(|value| (*value).to_string()).collect();

        if let Ok(series) = self.series.read() {
            if let Some(counter) = series.get(&key) {
                counter.fetch_add(1, Ordering::Relaxed);
                return;
            }
        }

        let Ok(mut series) = self.series.write() else {
            return;
        };
        // Another writer may have inserted while the read lock was released.
        if let Some(counter) = series.get(&key) {
            counter.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if series.len() >= MAX_SERIES_PER_FAMILY {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        series.insert(key, Arc::new(AtomicU64::new(1)));
    }

    fn render(&self, out: &mut String) {
        let Ok(series) = self.series.read() else {
            return;
        };
        if series.is_empty() {
            return;
        }
        let _ = writeln!(out, "# HELP {} {}", self.name, self.help);
        let _ = writeln!(out, "# TYPE {} counter", self.name);
        for (values, counter) in series.iter() {
            let _ = writeln!(
                out,
                "{}{} {}",
                self.name,
                render_labels(self.label_names, values, None),
                counter.load(Ordering::Relaxed)
            );
        }
    }
}

struct HistogramSeries {
    buckets: Vec<AtomicU64>,
    /// Kept in microseconds so the running total stays integral; converted back
    /// to seconds at render time.
    sum_micros: AtomicU64,
    count: AtomicU64,
}

impl HistogramSeries {
    fn new() -> Self {
        Self {
            buckets: (0..DURATION_BUCKETS_SECONDS.len())
                .map(|_| AtomicU64::new(0))
                .collect(),
            sum_micros: AtomicU64::new(0),
            count: AtomicU64::new(0),
        }
    }

    fn observe(&self, seconds: f64) {
        for (index, bound) in DURATION_BUCKETS_SECONDS.iter().enumerate() {
            if seconds <= *bound {
                self.buckets[index].fetch_add(1, Ordering::Relaxed);
            }
        }
        self.sum_micros
            .fetch_add((seconds * 1_000_000.0) as u64, Ordering::Relaxed);
        self.count.fetch_add(1, Ordering::Relaxed);
    }
}

struct HistogramFamily {
    name: &'static str,
    help: &'static str,
    label_names: &'static [&'static str],
    series: RwLock<HashMap<LabelValues, Arc<HistogramSeries>>>,
    dropped: AtomicU64,
}

impl HistogramFamily {
    fn new(name: &'static str, help: &'static str, label_names: &'static [&'static str]) -> Self {
        Self {
            name,
            help,
            label_names,
            series: RwLock::new(HashMap::new()),
            dropped: AtomicU64::new(0),
        }
    }

    fn observe(&self, labels: &[&str], seconds: f64) {
        debug_assert_eq!(labels.len(), self.label_names.len());
        let key: LabelValues = labels.iter().map(|value| (*value).to_string()).collect();

        if let Ok(series) = self.series.read() {
            if let Some(histogram) = series.get(&key) {
                histogram.observe(seconds);
                return;
            }
        }

        let Ok(mut series) = self.series.write() else {
            return;
        };
        if let Some(histogram) = series.get(&key) {
            histogram.observe(seconds);
            return;
        }
        if series.len() >= MAX_SERIES_PER_FAMILY {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let histogram = Arc::new(HistogramSeries::new());
        histogram.observe(seconds);
        series.insert(key, histogram);
    }

    fn render(&self, out: &mut String) {
        let Ok(series) = self.series.read() else {
            return;
        };
        if series.is_empty() {
            return;
        }
        let _ = writeln!(out, "# HELP {} {}", self.name, self.help);
        let _ = writeln!(out, "# TYPE {} histogram", self.name);
        for (values, histogram) in series.iter() {
            // `observe` bumps every bucket whose bound the sample fits under, so
            // the stored counts are already cumulative and render as-is.
            for (index, bound) in DURATION_BUCKETS_SECONDS.iter().enumerate() {
                let _ = writeln!(
                    out,
                    "{}_bucket{} {}",
                    self.name,
                    render_labels(self.label_names, values, Some(&format_bound(*bound))),
                    histogram.buckets[index].load(Ordering::Relaxed)
                );
            }
            let count = histogram.count.load(Ordering::Relaxed);
            let _ = writeln!(
                out,
                "{}_bucket{} {}",
                self.name,
                render_labels(self.label_names, values, Some("+Inf")),
                count
            );
            let _ = writeln!(
                out,
                "{}_sum{} {:.6}",
                self.name,
                render_labels(self.label_names, values, None),
                histogram.sum_micros.load(Ordering::Relaxed) as f64 / 1_000_000.0
            );
            let _ = writeln!(
                out,
                "{}_count{} {}",
                self.name,
                render_labels(self.label_names, values, None),
                count
            );
        }
    }
}

pub struct Registry {
    http_requests: CounterFamily,
    http_duration: HistogramFamily,
    http_errors: CounterFamily,
    tenant_slow_requests: CounterFamily,
    worker_runs: HistogramFamily,
    worker_outcomes: CounterFamily,
    worker_step_failures: CounterFamily,
}

impl Registry {
    fn new() -> Self {
        Self {
            http_requests: CounterFamily::new(
                "aurashine_http_requests_total",
                "Total HTTP requests handled, by matched route and status.",
                &["method", "route", "status"],
            ),
            http_duration: HistogramFamily::new(
                "aurashine_http_request_duration_seconds",
                "HTTP request latency by matched route.",
                &["method", "route"],
            ),
            http_errors: CounterFamily::new(
                "aurashine_http_errors_total",
                "HTTP responses that indicate a server-side failure or refusal.",
                &["route", "status"],
            ),
            tenant_slow_requests: CounterFamily::new(
                "aurashine_tenant_slow_requests_total",
                "Requests slower than the slow-request threshold, attributed to a tenant.",
                &["tenant", "route"],
            ),
            worker_runs: HistogramFamily::new(
                "aurashine_worker_run_duration_seconds",
                "Background worker cycle duration.",
                &["worker"],
            ),
            worker_outcomes: CounterFamily::new(
                "aurashine_worker_cycles_total",
                "Background worker cycles by outcome: 'ran', 'skipped' (another replica holds the lease), 'contended' (the previous leader's cycle is still running), or 'unavailable'.",
                &["worker", "outcome"],
            ),
            worker_step_failures: CounterFamily::new(
                "aurashine_worker_step_failures_total",
                "Individual jobs inside a worker cycle that returned an error.",
                &["worker", "step"],
            ),
        }
    }

    fn dropped_series(&self) -> u64 {
        self.http_requests.dropped.load(Ordering::Relaxed)
            + self.http_duration.dropped.load(Ordering::Relaxed)
            + self.http_errors.dropped.load(Ordering::Relaxed)
            + self.tenant_slow_requests.dropped.load(Ordering::Relaxed)
            + self.worker_runs.dropped.load(Ordering::Relaxed)
            + self.worker_outcomes.dropped.load(Ordering::Relaxed)
            + self.worker_step_failures.dropped.load(Ordering::Relaxed)
    }
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::new)
}

/// Records one finished HTTP request. `route` must be the matched router path
/// (`/api/v1/clients/:id`), never the raw URI, or cardinality explodes.
pub fn record_http_request(
    method: &str,
    route: &str,
    status: u16,
    elapsed_seconds: f64,
    tenant_id: Option<&str>,
    slow_threshold_seconds: f64,
) {
    let registry = registry();
    let status_text = status.to_string();

    registry
        .http_requests
        .increment(&[method, route, &status_text]);
    registry
        .http_duration
        .observe(&[method, route], elapsed_seconds);

    if status >= 500 || status == 429 {
        registry.http_errors.increment(&[route, &status_text]);
    }

    // Tenant labels only ride on the slow counter. Putting them on every family
    // would multiply each series by the tenant count; here the cardinality is
    // bounded by how many tenants are actually having a bad time.
    if elapsed_seconds >= slow_threshold_seconds {
        registry
            .tenant_slow_requests
            .increment(&[tenant_id.unwrap_or("unknown"), route]);
    }
}

/// Records a background worker cycle. `outcome` is `ran`, `skipped` (another
/// replica holds the lease), `contended` (the outgoing leader's cycle is still
/// running), or `unavailable` (the database could not be reached).
pub fn record_worker_cycle(worker: &str, outcome: &str, elapsed_seconds: f64) {
    let registry = registry();
    registry.worker_outcomes.increment(&[worker, outcome]);
    if outcome == "ran" {
        registry.worker_runs.observe(&[worker], elapsed_seconds);
    }
}

/// Records one failed job inside a worker cycle, keyed by worker and step.
pub fn record_worker_step_failure(worker: &str, step: &str) {
    registry().worker_step_failures.increment(&[worker, step]);
}

/// Renders the whole registry in the Prometheus text exposition format.
///
/// Pool statistics are read from the live pool at scrape time rather than
/// tracked incrementally, so they cannot drift.
pub fn render(pool: &sqlx::PgPool, app_env: &str) -> String {
    let registry = registry();
    let mut out = String::with_capacity(16 * 1024);

    registry.http_requests.render(&mut out);
    registry.http_duration.render(&mut out);
    registry.http_errors.render(&mut out);
    registry.tenant_slow_requests.render(&mut out);
    registry.worker_runs.render(&mut out);
    registry.worker_outcomes.render(&mut out);
    registry.worker_step_failures.render(&mut out);

    let size = u64::from(pool.size());
    let idle = pool.num_idle() as u64;
    let _ = writeln!(
        out,
        "# HELP aurashine_db_pool_connections Connections held by the SQLx pool, by state."
    );
    let _ = writeln!(out, "# TYPE aurashine_db_pool_connections gauge");
    let _ = writeln!(
        out,
        "aurashine_db_pool_connections{{state=\"idle\"}} {}",
        idle
    );
    let _ = writeln!(
        out,
        "aurashine_db_pool_connections{{state=\"in_use\"}} {}",
        size.saturating_sub(idle)
    );
    let _ = writeln!(
        out,
        "aurashine_db_pool_connections{{state=\"total\"}} {}",
        size
    );

    let _ = writeln!(
        out,
        "# HELP aurashine_metrics_series_dropped_total Observations discarded because a metric family hit its cardinality cap."
    );
    let _ = writeln!(out, "# TYPE aurashine_metrics_series_dropped_total counter");
    let _ = writeln!(
        out,
        "aurashine_metrics_series_dropped_total {}",
        registry.dropped_series()
    );

    let _ = writeln!(
        out,
        "# HELP aurashine_build_info Build and runtime identification, always 1."
    );
    let _ = writeln!(out, "# TYPE aurashine_build_info gauge");
    let _ = writeln!(
        out,
        "aurashine_build_info{{version=\"{}\",environment=\"{}\"}} 1",
        escape_label_value(env!("CARGO_PKG_VERSION")),
        escape_label_value(app_env)
    );

    out
}

fn render_labels(names: &[&str], values: &[String], le: Option<&str>) -> String {
    if names.is_empty() && le.is_none() {
        return String::new();
    }
    let mut out = String::from("{");
    for (index, name) in names.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let value = values.get(index).map(String::as_str).unwrap_or_default();
        let _ = write!(out, "{}=\"{}\"", name, escape_label_value(value));
    }
    if let Some(le) = le {
        if !names.is_empty() {
            out.push(',');
        }
        let _ = write!(out, "le=\"{}\"", le);
    }
    out.push('}');
    out
}

fn format_bound(bound: f64) -> String {
    // Prometheus compares `le` lexically in some tooling, so emit a stable
    // fixed-precision form rather than Rust's shortest round-trip float.
    format!("{:.3}", bound)
}

fn escape_label_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_family_accumulates_per_label_set() {
        let family = CounterFamily::new("test_total", "help", &["route"]);
        family.increment(&["/a"]);
        family.increment(&["/a"]);
        family.increment(&["/b"]);

        let mut out = String::new();
        family.render(&mut out);

        assert!(out.contains("test_total{route=\"/a\"} 2"));
        assert!(out.contains("test_total{route=\"/b\"} 1"));
    }

    #[test]
    fn counter_family_caps_cardinality() {
        let family = CounterFamily::new("capped_total", "help", &["tenant"]);
        for index in 0..(MAX_SERIES_PER_FAMILY + 25) {
            family.increment(&[&format!("tenant-{index}")]);
        }

        assert_eq!(
            family.series.read().unwrap().len(),
            MAX_SERIES_PER_FAMILY,
            "series map must stop growing at the cap"
        );
        assert_eq!(family.dropped.load(Ordering::Relaxed), 25);
    }

    #[test]
    fn histogram_buckets_are_cumulative_and_end_at_count() {
        let family = HistogramFamily::new("latency_seconds", "help", &["route"]);
        family.observe(&["/a"], 0.004);
        family.observe(&["/a"], 0.4);
        family.observe(&["/a"], 30.0);

        let mut out = String::new();
        family.render(&mut out);

        // 0.004s falls in every bucket; 0.4s from the 0.5 bound up; 30s only in +Inf.
        assert!(out.contains("latency_seconds_bucket{route=\"/a\",le=\"0.005\"} 1"));
        assert!(out.contains("latency_seconds_bucket{route=\"/a\",le=\"0.500\"} 2"));
        assert!(out.contains("latency_seconds_bucket{route=\"/a\",le=\"10.000\"} 2"));
        assert!(out.contains("latency_seconds_bucket{route=\"/a\",le=\"+Inf\"} 3"));
        assert!(out.contains("latency_seconds_count{route=\"/a\"} 3"));
        assert!(out.contains("latency_seconds_sum{route=\"/a\"} 30.404000"));
    }

    #[test]
    fn label_values_are_escaped() {
        assert_eq!(escape_label_value("a\"b\\c"), "a\\\"b\\\\c");
    }

    #[test]
    fn tenant_label_only_rides_on_slow_requests() {
        record_http_request(
            "GET",
            "/metrics-test/fast",
            200,
            0.01,
            Some("tenant-a"),
            0.8,
        );
        record_http_request(
            "GET",
            "/metrics-test/slow",
            200,
            1.20,
            Some("tenant-a"),
            0.8,
        );

        let registry = registry();
        let mut out = String::new();
        registry.tenant_slow_requests.render(&mut out);

        assert!(out.contains("tenant=\"tenant-a\",route=\"/metrics-test/slow\""));
        assert!(!out.contains("/metrics-test/fast"));
    }
}
