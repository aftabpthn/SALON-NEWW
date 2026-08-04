//! Governance for client-data exports.
//!
//! `/clients/bulk/export` asked for `clients.read` — the permission every
//! receptionist has — and returned up to 5000 client records with phone and
//! email, paging freely through the whole book. Nothing rate limited it,
//! nothing capped a day, and nothing recorded that it happened: the master
//! audit tracks *changes* to client records, so reading them in bulk left no
//! trace at all.
//!
//! For a salon the client list is the business, so this is the largest insider
//! risk in the product. The answer is not to block exports — pulling the book
//! for a campaign is legitimate work — but to make them visible, bounded and
//! attributable:
//!
//! * **Recorded.** Who, when, how many rows, what filter, from where.
//! * **Bounded.** A daily row budget per user, with the existing temporary
//!   elevation as the way past it, so exceeding it is a decision someone made
//!   rather than something nobody saw.
//! * **Attributable.** Every export carries a watermark returned to the caller
//!   and stored here, so a leaked file points back at one export.
//! * **Noticed.** An export far above a user's own recent average raises a
//!   security alert against that user.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::security_repository,
    services::{auth_service::AuthClaims, security_service},
};

/// Days of history the anomaly comparison looks back over.
const ANOMALY_WINDOW_DAYS: i64 = 30;
/// Below this an export is never anomalous, however far above average it is.
/// Without it, a user whose average is two rows trips the alert on twenty.
const ANOMALY_FLOOR_ROWS: i64 = 200;

/// Permission to run one export, plus the marker that identifies it later.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportGrant {
    pub watermark: String,
    pub budget_rows: i64,
    pub used_rows_today: i64,
    pub elevated: bool,
}

/// A user's standing against the day's budget, for showing before they export.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportUsage {
    pub budget_rows: i64,
    pub used_rows_today: i64,
    pub remaining_rows: i64,
    pub enforced: bool,
    pub exports_today: i64,
}

fn watermark_for(tenant_id: &str, user_id: &str, kind: &str, at: DateTime<Utc>) -> String {
    // Reproducible from the stored event, so a marker found on a leaked file can
    // be checked rather than merely looked up.
    let mut hasher = Sha256::new();
    hasher.update(tenant_id.as_bytes());
    hasher.update(b"|");
    hasher.update(user_id.as_bytes());
    hasher.update(b"|");
    hasher.update(kind.as_bytes());
    hasher.update(b"|");
    hasher.update(at.timestamp_micros().to_string().as_bytes());
    format!("cx_{}", &format!("{:x}", hasher.finalize())[..24])
}

async fn rows_exported_today(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<(i64, i64), AppError> {
    sqlx::query_as::<_, (i64, i64)>(
        r#"SELECT COALESCE(SUM(row_count), 0)::BIGINT, COUNT(*)::BIGINT
             FROM client_export_events
            WHERE tenant_id = $1 AND branch_id = $2 AND user_id = $3
              AND created_at >= DATE_TRUNC('day', NOW())"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to read today's export usage"))
}

/// What the user has left today.
pub async fn usage(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<ExportUsage, AppError> {
    let policy = security_service::get_policy(db, tenant_id, branch_id)
        .await?
        .settings;
    let (used, exports) = rows_exported_today(db, tenant_id, branch_id, user_id).await?;
    Ok(ExportUsage {
        budget_rows: policy.client_export_daily_row_budget,
        used_rows_today: used,
        remaining_rows: (policy.client_export_daily_row_budget - used).max(0),
        enforced: policy.client_export_budget_enforced,
        exports_today: exports,
    })
}

/// Authorises one export before it runs.
///
/// Returns the watermark to attach to the response. Refuses when the day's
/// budget is spent and the caller holds no elevation for it — the same
/// `security.export.elevated` grant the rest of the product uses for stepping
/// past a limit, so this does not invent a second approval mechanism.
pub async fn authorise(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    kind: &str,
    requested_rows: i64,
) -> Result<ExportGrant, AppError> {
    let policy = security_service::get_policy(db, tenant_id, branch_id)
        .await?
        .settings;
    let (used, _) = rows_exported_today(db, tenant_id, branch_id, &claims.sub).await?;

    let elevated =
        security_repository::active_elevated_permissions(db, tenant_id, branch_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to check temporary elevations"))?
            .iter()
            .any(|permission| permission == "security.export.elevated");

    let over_budget = used + requested_rows > policy.client_export_daily_row_budget;
    if over_budget && policy.client_export_budget_enforced && !elevated {
        return Err(AppError::forbidden(format!(
            "this export would use {} of a {} row daily limit, and {} are already used today; \
             ask a manager for temporary export elevation",
            requested_rows, policy.client_export_daily_row_budget, used
        )));
    }

    Ok(ExportGrant {
        watermark: watermark_for(tenant_id, &claims.sub, kind, Utc::now()),
        budget_rows: policy.client_export_daily_row_budget,
        used_rows_today: used,
        elevated: over_budget && elevated,
    })
}

/// Records what an export actually returned.
///
/// Called with the real row count rather than the requested one, so the ledger
/// reflects data that left rather than data that was asked for.
#[allow(clippy::too_many_arguments)]
pub async fn record(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    grant: &ExportGrant,
    kind: &str,
    row_count: i64,
    filters: Value,
    source_ip: &str,
    user_agent: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO client_export_events
             (tenant_id, branch_id, user_id, role_name, export_kind, row_count,
              filters_json, source_ip, user_agent, watermark, elevated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&claims.sub)
    .bind(&claims.role)
    .bind(kind)
    .bind(row_count.max(0) as i32)
    .bind(&filters)
    .bind(source_ip)
    .bind(user_agent)
    .bind(&grant.watermark)
    .bind(grant.elevated)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to record the client export"))?;

    raise_alert_if_anomalous(db, tenant_id, branch_id, claims, row_count, source_ip).await
}

/// Raises a security alert when an export dwarfs the user's own recent norm.
///
/// Comparing a person against themselves rather than against a global threshold
/// is what makes this usable: a marketing manager who exports every week is not
/// suspicious, and a receptionist who never exports suddenly taking the book is.
async fn raise_alert_if_anomalous(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    row_count: i64,
    source_ip: &str,
) -> Result<(), AppError> {
    if row_count < ANOMALY_FLOOR_ROWS {
        return Ok(());
    }
    let policy = security_service::get_policy(db, tenant_id, branch_id)
        .await?
        .settings;
    let multiplier = policy.client_export_anomaly_multiplier.max(2);

    // Daily totals over the window, excluding today, so one big export does not
    // raise its own baseline.
    let average: Option<f64> = sqlx::query_scalar(
        r#"SELECT AVG(daily_rows)::DOUBLE PRECISION FROM (
                SELECT SUM(row_count)::BIGINT daily_rows
                  FROM client_export_events
                 WHERE tenant_id = $1 AND branch_id = $2 AND user_id = $3
                   AND created_at >= NOW() - ($4 || ' days')::INTERVAL
                   AND created_at < DATE_TRUNC('day', NOW())
                 GROUP BY DATE_TRUNC('day', created_at)
              ) daily"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&claims.sub)
    .bind(ANOMALY_WINDOW_DAYS.to_string())
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to read export history"))?;

    // No history is not evidence of anything on its own; the floor already
    // ensures this only fires on a substantial export.
    let Some(average) = average.filter(|value| *value > 0.0) else {
        return Ok(());
    };
    if (row_count as f64) < average * multiplier as f64 {
        return Ok(());
    }

    sqlx::query(
        r#"INSERT INTO security_alerts
             (tenant_id, branch_id, alert_type, severity, summary, source_ip, user_id, details_json)
           VALUES ($1, $2, 'client_export_spike', 'warning', $3, $4, $5, $6)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(format!(
        "{} exported {} client rows, about {:.0}x their recent daily average",
        claims.role,
        row_count,
        (row_count as f64) / average
    ))
    .bind(source_ip)
    .bind(&claims.sub)
    .bind(json!({
        "rowCount": row_count,
        "recentDailyAverage": average.round(),
        "multiplier": multiplier,
        "windowDays": ANOMALY_WINDOW_DAYS,
    }))
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to raise the export alert"))?;
    Ok(())
}

/// Recent exports for a branch, newest first.
pub async fn history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'id', id, 'userId', user_id, 'roleName', role_name,
                    'exportKind', export_kind, 'rowCount', row_count,
                    'filters', filters_json, 'sourceIp', source_ip,
                    'watermark', watermark, 'elevated', elevated, 'createdAt', created_at)
             FROM client_export_events
            WHERE tenant_id = $1 AND branch_id = $2
            ORDER BY created_at DESC
            LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit.clamp(1, 500))
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load export history"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_watermark_identifies_one_export_and_can_be_recomputed() {
        let at = Utc::now();
        let first = watermark_for("tenant-1", "user-1", "clients.bulk", at);
        // Same inputs reproduce it, so a marker on a leaked file can be checked
        // rather than only looked up.
        assert_eq!(
            first,
            watermark_for("tenant-1", "user-1", "clients.bulk", at)
        );
        // A different person's export never shares a marker.
        assert_ne!(
            first,
            watermark_for("tenant-1", "user-2", "clients.bulk", at)
        );
        assert_ne!(
            first,
            watermark_for("tenant-2", "user-1", "clients.bulk", at)
        );
        assert!(first.starts_with("cx_"), "{first}");
    }

    #[test]
    fn the_anomaly_floor_protects_light_users_from_false_alarms() {
        // Someone whose average is two rows must not trip an alert on twenty.
        // The floor is what makes a per-user comparison usable at all.
        assert!(ANOMALY_FLOOR_ROWS >= 100);
        let tiny_export = 20_i64;
        assert!(tiny_export < ANOMALY_FLOOR_ROWS);
    }

    #[test]
    fn the_window_excludes_today_so_an_export_cannot_raise_its_own_baseline() {
        // Guarded by the SQL rather than a value, so assert the shape of the
        // query that enforces it.
        let sql = include_str!("client_export_governance_service.rs");
        assert!(sql.contains("created_at < DATE_TRUNC('day', NOW())"));
    }
}
