use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

pub type DbPool = PgPool;

/// Connections held per process. Every replica multiplies this against the
/// instance's `max_connections`, so raising it is a cluster-wide decision —
/// hence the environment override rather than a recompile.
const DEFAULT_MAX_CONNECTIONS: u32 = 25;

/// Long enough that a pool serving steady traffic never churns, short enough
/// that a scaled-in replica's connections are reclaimed. The previous 30s meant
/// a fresh TLS handshake to RDS during every lull.
const IDLE_TIMEOUT: Duration = Duration::from_secs(600);

/// Caps how long a single connection lives so load rebalances after a failover
/// and server-side memory per backend cannot grow unbounded.
const MAX_LIFETIME: Duration = Duration::from_secs(1_800);

/// Whether this process should apply migrations at startup.
///
/// Running them inside `create_pool` meant every task in a rolling deploy
/// serialised behind the same advisory lock before it could serve traffic. The
/// deploy pipeline should run one dedicated `--migrate-only` task first and set
/// `RUN_MIGRATIONS_ON_BOOT=false` on the serving tasks. The default stays
/// `true` so an environment that has not been rewired yet keeps working.
pub fn migrations_on_boot_enabled() -> bool {
    parse_enabled_flag(std::env::var("RUN_MIGRATIONS_ON_BOOT").ok().as_deref())
}

/// Parsing lives apart from the environment read so it can be tested without
/// mutating process-wide state, which races with every other test in the
/// binary.
fn parse_enabled_flag(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return true;
    };
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no" | "off"
    )
}

fn max_connections() -> u32 {
    parse_max_connections(std::env::var("DATABASE_MAX_CONNECTIONS").ok().as_deref())
}

fn parse_max_connections(value: Option<&str>) -> u32 {
    value
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_CONNECTIONS)
}

/// Builds the pool, optionally applying migrations first.
///
/// `run_migrations` is passed explicitly rather than read from the environment
/// here so `--migrate-only` can force them on even where the serving
/// configuration disables boot migrations.
pub async fn create_pool(database_url: &str, run_migrations: bool) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections())
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(IDLE_TIMEOUT)
        .max_lifetime(MAX_LIFETIME)
        // Validating on every acquire cost a round-trip to RDS before every
        // single query. Turning it off trades that for a real but narrow risk:
        // after an RDS failover the first request on each stale connection fails
        // instead of transparently getting a fresh one. SQLx then evicts the
        // broken connection, and `max_lifetime` retires the rest, so the blast
        // radius is a handful of requests a few times a year against a cost paid
        // by every request all year. Turn this back on if failovers become
        // frequent enough to notice.
        .test_before_acquire(false)
        .connect(database_url)
        .await?;

    if run_migrations {
        // SQLx embeds migration checksums here, so every migration release requires a rebuilt binary.
        tracing::info!("applying database migrations");
        sqlx::migrate!().run(&pool).await?;
        tracing::info!("database migrations applied");
    } else {
        tracing::info!(
            "skipping database migrations (RUN_MIGRATIONS_ON_BOOT=false); a dedicated migrate task must have run first"
        );
    }

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_migrations_default_to_enabled_when_unset() {
        assert!(parse_enabled_flag(None));
    }

    #[test]
    fn boot_migrations_can_be_disabled() {
        for value in ["false", "FALSE", "0", "no", "off", " Off "] {
            assert!(
                !parse_enabled_flag(Some(value)),
                "{value} should disable boot migrations"
            );
        }
    }

    #[test]
    fn boot_migrations_stay_enabled_on_anything_else() {
        for value in ["true", "1", "yes", ""] {
            assert!(
                parse_enabled_flag(Some(value)),
                "{value} should keep boot migrations enabled"
            );
        }
    }

    #[test]
    fn max_connections_falls_back_on_invalid_input() {
        for value in [None, Some(""), Some("0"), Some("not-a-number"), Some("-4")] {
            assert_eq!(parse_max_connections(value), DEFAULT_MAX_CONNECTIONS);
        }
    }

    #[test]
    fn max_connections_reads_the_override() {
        assert_eq!(parse_max_connections(Some("12")), 12);
        assert_eq!(parse_max_connections(Some(" 40 ")), 40);
    }
}
