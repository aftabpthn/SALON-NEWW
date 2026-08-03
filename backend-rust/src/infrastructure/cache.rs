use anyhow::{ensure, Result};
use redis::Client;

pub type RedisClient = Client;

pub async fn create_client(redis_url: &str) -> Result<RedisClient> {
    Ok(Client::open(redis_url)?)
}

pub async fn ping(client: &RedisClient) -> Result<()> {
    let mut connection = client.get_multiplexed_async_connection().await?;
    let pong: String = redis::cmd("PING").query_async(&mut connection).await?;
    ensure!(pong == "PONG", "Redis PING returned {}", pong);
    Ok(())
}

/// Counts one attempt against `key` and reports whether the caller is now over
/// `max_attempts` within the `ttl_seconds` window.
///
/// `Ok(true)` means the caller is inside the budget, `Ok(false)` means it has
/// been exhausted. An unreachable store is an error rather than a silent pass,
/// so a Redis outage cannot quietly disable a limiter that is guarding a
/// brute-forceable endpoint.
pub async fn rate_limit_allows(
    client: &RedisClient,
    key: &str,
    max_attempts: i64,
    ttl_seconds: i64,
) -> Result<bool> {
    let mut connection = client.get_multiplexed_async_connection().await?;
    let count: i64 = redis::cmd("INCR")
        .arg(key)
        .query_async(&mut connection)
        .await?;
    if count == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(key)
            .arg(ttl_seconds)
            .query_async(&mut connection)
            .await?;
    }
    Ok(count <= max_attempts)
}
