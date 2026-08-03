use std::time::Duration;

use sqlx::{pool::PoolConnection, PgPool, Postgres};

pub async fn hold_lease(
    pool: &PgPool,
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
    .fetch_optional(pool)
    .await?;

    Ok(held.is_some())
}

pub async fn try_advisory_lock(
    pool: &PgPool,
    key: &str,
) -> Result<Option<PoolConnection<Postgres>>, sqlx::Error> {
    let mut connection = pool.acquire().await?;
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1,0))")
        .bind(key)
        .fetch_one(&mut *connection)
        .await?;
    Ok(acquired.then_some(connection))
}

pub async fn release_advisory_lock(
    connection: &mut PoolConnection<Postgres>,
    key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock(hashtextextended($1,0))")
        .bind(key)
        .fetch_one(&mut **connection)
        .await?;
    Ok(())
}
