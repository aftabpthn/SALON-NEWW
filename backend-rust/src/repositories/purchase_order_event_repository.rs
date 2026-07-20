use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderEventRecord {
    pub id: String,
    pub event_type: String,
    pub from_status: String,
    pub to_status: String,
    pub note: String,
    pub actor_user_id: String,
    pub details: Value,
    pub created_at: DateTime<Utc>,
}

pub async fn list(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    order: &str,
) -> Result<Vec<PurchaseOrderEventRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,event_type,from_status,to_status,note,actor_user_id,details,created_at FROM purchase_order_events WHERE tenant_id=$1 AND branch_id=$2 AND purchase_order_id=$3 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).bind(order).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn add(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    order: &str,
    event: &str,
    from: &str,
    to: &str,
    note: &str,
    actor: &str,
    details: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO purchase_order_events(tenant_id,branch_id,purchase_order_id,event_type,from_status,to_status,note,actor_user_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(tenant).bind(branch).bind(order).bind(event).bind(from).bind(to).bind(note).bind(actor).bind(details).execute(&mut **tx).await?;
    Ok(())
}

pub async fn mark_sent(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    order: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE purchase_orders SET sent_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('approved','partially_received')")
        .bind(tenant).bind(branch).bind(order).execute(&mut **tx).await?.rows_affected()==1)
}

pub async fn set_timestamp(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    order: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE purchase_orders SET closed_at=CASE WHEN $4='closed' THEN NOW() ELSE closed_at END,cancelled_at=CASE WHEN $4='cancelled' THEN NOW() ELSE cancelled_at END,reopened_at=CASE WHEN $4 IN ('draft','approved','partially_received') THEN NOW() ELSE reopened_at END WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(order).bind(status).execute(&mut **tx).await?;
    Ok(())
}

pub async fn has_receipts(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    order: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM purchase_order_lines WHERE tenant_id=$1 AND branch_id=$2 AND purchase_order_id=$3 AND received_quantity>0)")
        .bind(tenant).bind(branch).bind(order).fetch_one(db).await
}
