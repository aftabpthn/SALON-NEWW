use serde_json::Value;
use sqlx::PgPool;

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT settings_json FROM invoice_appearance_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings: &Value,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO invoice_appearance_settings (tenant_id, branch_id, settings_json) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, branch_id) DO UPDATE SET settings_json=EXCLUDED.settings_json, updated_at=NOW() RETURNING settings_json",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(settings)
    .fetch_one(db)
    .await
}
