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
