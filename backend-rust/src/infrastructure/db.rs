use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

pub type DbPool = PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(25)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(30))
        .test_before_acquire(true)
        .connect(database_url)
        .await?;

    // SQLx embeds migration checksums here, so every migration release requires a rebuilt binary.
    sqlx::migrate!().run(&pool).await?;

    Ok(pool)
}
