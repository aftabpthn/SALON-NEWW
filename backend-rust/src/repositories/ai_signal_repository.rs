//! Dedupe/cooldown state for proactive signals, and delivery through the
//! existing notification table.

use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

/// What is known about the last time a signal was raised.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SignalStateRecord {
    pub fingerprint: String,
    pub confidence: String,
    pub raised_count: i32,
    /// Computed in SQL so the comparison uses the database clock, not the
    /// worker's, which may drift.
    pub hours_since_raised: f64,
}

/// A branch to brief.
#[derive(Debug, Clone, FromRow)]
pub struct BriefingBranch {
    pub tenant_id: String,
    pub branch_id: String,
}

pub async fn last_state(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    signal_key: &str,
) -> Result<Option<SignalStateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT fingerprint,
                  confidence,
                  raised_count,
                  (EXTRACT(EPOCH FROM (NOW() - last_raised_at)) / 3600.0)::DOUBLE PRECISION AS hours_since_raised
             FROM ai_signal_state
            WHERE tenant_id=$1 AND branch_id=$2 AND signal_key=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(signal_key)
    .fetch_optional(db)
    .await
}

/// Records that a signal was raised.
///
/// One row per signal, updated in place: the history that matters is when it
/// was last said and whether it still says the same thing, not every occasion.
pub async fn record_raised(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    signal_key: &str,
    fingerprint: &str,
    confidence: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ai_signal_state(
              tenant_id,branch_id,signal_key,fingerprint,confidence
            ) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (tenant_id,branch_id,signal_key) DO UPDATE SET
              fingerprint=EXCLUDED.fingerprint,
              confidence=EXCLUDED.confidence,
              raised_count=ai_signal_state.raised_count+1,
              last_raised_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(signal_key)
    .bind(fingerprint)
    .bind(confidence)
    .execute(db)
    .await
    .map(|_| ())
}

/// Active branches worth briefing.
///
/// Restricted to branches that have had recorded activity, so a dormant branch
/// does not generate a daily notification nobody wants.
pub async fn briefing_branches(db: &PgPool) -> Result<Vec<BriefingBranch>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT DISTINCT branch.tenant_id::TEXT AS tenant_id, branch.id::TEXT AS branch_id
             FROM branches branch
            WHERE branch.active=TRUE
              AND EXISTS (
                SELECT 1 FROM pos_sales sale
                 WHERE sale.tenant_id=branch.tenant_id::TEXT
                   AND sale.branch_id=branch.id::TEXT
                   AND sale.created_at >= NOW() - INTERVAL '30 days'
              )"#,
    )
    .fetch_all(db)
    .await
}

/// Delivers a briefing through the notification table the CRM already uses.
pub async fn deliver_notification(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    notification_type: &str,
    title: &str,
    body: &str,
    metadata: &Value,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO notifications(
              tenant_id,branch_id,created_by,notification_type,title,body,
              resource_type,metadata_json
            ) VALUES ($1,$2,'system',$3,$4,$5,'ai_briefing',$6)
            RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(notification_type)
    .bind(title)
    .bind(body)
    .bind(metadata)
    .fetch_one(db)
    .await
}
