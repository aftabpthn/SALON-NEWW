//! Leader-elected background workers.
//!
//! Every worker used to be spawned unconditionally in every API task, so a
//! service scaled to eight replicas ran eight copies of each loop — eight
//! report-export scans every fifteen seconds, all competing for the same rows.
//!
//! Election happens in two stages, because they answer different questions.
//!
//! A **lease** in `worker_leases` decides who should be doing the work at all.
//! An advisory lock alone is not enough: it is taken and released inside a
//! cycle, and replicas tick out of phase, so they almost never collide and all
//! of them still run. The lease gives one replica tenure across cycles, and the
//! others skip after a single cheap upsert. Tenure expires on a clock, so a
//! replica that dies is replaced without anything having to detect it.
//!
//! An **advisory lock** then guarantees the run is exclusive. It closes the
//! window where a cycle outlives its own lease and a new leader starts while
//! the old one is still working. Only the lease holder ever reaches for it, so
//! the connection it pins is held by one replica, not all of them.

use std::future::Future;
use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::infrastructure::metrics;
use crate::state::AppState;

/// How much longer than a worker's period its lease survives. Three cycles of
/// slack means an ordinary slow run does not hand leadership away.
const LEASE_PERIOD_MULTIPLIER: u32 = 3;

/// Floor on lease length, so fast workers do not re-elect constantly.
const MIN_LEASE: Duration = Duration::from_secs(30);

/// Ceiling on lease length. Without it a six-hourly worker would hold tenure
/// for eighteen hours, and a replica that died minutes in would leave the work
/// unclaimed for most of a day.
const MAX_LEASE: Duration = Duration::from_secs(300);

fn lease_duration(period: Duration) -> Duration {
    (period * LEASE_PERIOD_MULTIPLIER).clamp(MIN_LEASE, MAX_LEASE)
}

/// Whether this process should run background workers at all.
///
/// Splitting workers onto a dedicated single-task service is the end state; set
/// `RUN_WORKERS=false` on the API tasks once that service exists. Until then the
/// default stays `true` so behaviour does not change silently on deploy.
pub fn workers_enabled() -> bool {
    parse_workers_flag(std::env::var("RUN_WORKERS").ok().as_deref())
}

/// Parsing lives apart from the environment read so it can be tested without
/// mutating process-wide state, which races with every other test in the
/// binary.
fn parse_workers_flag(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return true;
    };
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no" | "off"
    )
}

/// Claims or renews this process's lease on `name`.
///
/// The `WHERE` clause is what makes it an election: the upsert only writes when
/// this process already holds the lease or the incumbent's has expired, so a
/// non-leader's statement affects no rows and returns nothing.
async fn hold_lease(
    state: &AppState,
    name: &str,
    holder_id: &str,
    lease: Duration,
) -> Result<bool, sqlx::Error> {
    let held: Option<String> = sqlx::query_scalar(
        r#"
        INSERT INTO worker_leases (worker_name, holder_id, acquired_at, renewed_at, expires_at)
        VALUES ($1, $2, NOW(), NOW(), NOW() + make_interval(secs => $3))
        ON CONFLICT (worker_name) DO UPDATE
        SET holder_id = EXCLUDED.holder_id,
            renewed_at = NOW(),
            expires_at = EXCLUDED.expires_at,
            acquired_at = CASE
                WHEN worker_leases.holder_id = EXCLUDED.holder_id THEN worker_leases.acquired_at
                ELSE NOW()
            END
        WHERE worker_leases.holder_id = EXCLUDED.holder_id
           OR worker_leases.expires_at < NOW()
        RETURNING holder_id
        "#,
    )
    .bind(name)
    .bind(holder_id)
    .bind(lease.as_secs_f64())
    .fetch_optional(&state.db)
    .await?;

    Ok(held.is_some())
}

/// Spawns `body` on a fixed interval, running it only on the replica that holds
/// the lease for `name`.
///
/// `name` is the lease key, the advisory lock identity and the metric label, so
/// it must be stable across releases — renaming it lets two versions elect
/// separate leaders and run the same worker twice during a rolling deploy.
pub fn spawn<F, Fut>(state: &AppState, name: &'static str, period: Duration, body: F)
where
    F: Fn(AppState) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    if !workers_enabled() {
        tracing::info!(worker = name, "background worker disabled by RUN_WORKERS");
        return;
    }

    let state = state.clone();
    tokio::spawn(async move {
        let holder_id = Uuid::new_v4().to_string();
        let lease = lease_duration(period);
        let lock_key = format!("aurashine:worker:{name}");
        let mut interval = tokio::time::interval(period);
        // A tick missed because the previous cycle overran should not queue up a
        // burst of catch-up runs against an already-loaded database.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;

            // Non-leaders stop here, at the cost of one upsert against the pool
            // and no connection checked out.
            match hold_lease(&state, name, &holder_id, lease).await {
                Ok(true) => {}
                Ok(false) => {
                    metrics::record_worker_cycle(name, "skipped", 0.0);
                    continue;
                }
                Err(error) => {
                    tracing::warn!(worker = name, %error, "worker lease upsert failed");
                    metrics::record_worker_cycle(name, "unavailable", 0.0);
                    continue;
                }
            }

            let mut connection = match state.db.acquire().await {
                Ok(connection) => connection,
                Err(error) => {
                    tracing::warn!(worker = name, %error, "worker could not acquire a connection");
                    metrics::record_worker_cycle(name, "unavailable", 0.0);
                    continue;
                }
            };

            let acquired: bool =
                match sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1,0))")
                    .bind(&lock_key)
                    .fetch_one(&mut *connection)
                    .await
                {
                    Ok(acquired) => acquired,
                    Err(error) => {
                        tracing::warn!(worker = name, %error, "worker leader lock failed");
                        metrics::record_worker_cycle(name, "unavailable", 0.0);
                        continue;
                    }
                };

            // Reached only when a previous leader's cycle outlived its lease and
            // is still running; that replica finishes, this one waits a tick.
            if !acquired {
                metrics::record_worker_cycle(name, "contended", 0.0);
                continue;
            }

            let started = Instant::now();
            body(state.clone()).await;
            let elapsed = started.elapsed().as_secs_f64();

            // Released explicitly, but dropping the connection would release it
            // too — that is what makes replica loss self-healing.
            let _ =
                sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock(hashtextextended($1,0))")
                    .bind(&lock_key)
                    .fetch_one(&mut *connection)
                    .await;

            metrics::record_worker_cycle(name, "ran", elapsed);

            if elapsed >= period.as_secs_f64() {
                tracing::warn!(
                    worker = name,
                    elapsed_seconds = elapsed,
                    period_seconds = period.as_secs_f64(),
                    "worker cycle is slower than its interval"
                );
            }
        }
    });
}

/// Records a failed step inside a worker cycle.
///
/// A cycle usually chains several independent jobs, and one of them failing
/// should be visible per job rather than collapsing the whole cycle. Replaces
/// the bare `tracing::warn!` the workers used to emit, which nothing could
/// alert on.
pub fn note_failure(worker: &'static str, step: &'static str) {
    tracing::warn!(worker, step, "worker step failed");
    metrics::record_worker_step_failure(worker, step);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workers_default_to_enabled_when_unset() {
        assert!(parse_workers_flag(None));
    }

    #[test]
    fn fast_workers_get_the_minimum_lease() {
        // 5s * 3 = 15s, below the floor, so re-election cannot thrash.
        assert_eq!(lease_duration(Duration::from_secs(5)), MIN_LEASE);
        // 10s * 3 lands exactly on the floor.
        assert_eq!(lease_duration(Duration::from_secs(10)), MIN_LEASE);
        // 15s * 3 clears it, so the multiplier applies unchanged.
        assert_eq!(
            lease_duration(Duration::from_secs(15)),
            Duration::from_secs(45)
        );
    }

    #[test]
    fn ordinary_workers_get_three_periods_of_slack() {
        assert_eq!(
            lease_duration(Duration::from_secs(60)),
            Duration::from_secs(180)
        );
    }

    #[test]
    fn slow_workers_are_capped_so_a_dead_leader_is_replaced() {
        // A six-hourly worker must not hold tenure for eighteen hours.
        assert_eq!(lease_duration(Duration::from_secs(21_600)), MAX_LEASE);
        assert_eq!(lease_duration(Duration::from_secs(900)), MAX_LEASE);
    }

    #[test]
    fn every_lease_outlives_at_least_one_period() {
        for seconds in [5, 15, 30, 60, 300, 900, 21_600] {
            let period = Duration::from_secs(seconds);
            let lease = lease_duration(period);
            assert!(
                lease >= MIN_LEASE && lease <= MAX_LEASE,
                "{seconds}s period produced an out-of-range lease"
            );
        }
    }

    #[test]
    fn workers_disable_on_falsey_values() {
        for value in ["false", "FALSE", "0", "no", "off", " Off "] {
            assert!(
                !parse_workers_flag(Some(value)),
                "{value} should disable workers"
            );
        }
    }

    #[test]
    fn workers_stay_enabled_on_anything_else() {
        for value in ["true", "1", "yes", ""] {
            assert!(
                parse_workers_flag(Some(value)),
                "{value} should keep workers enabled"
            );
        }
    }
}
