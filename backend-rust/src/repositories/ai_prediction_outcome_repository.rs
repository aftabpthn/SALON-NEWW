//! Observed outcomes for stored predictions.
//!
//! Every query here reads the same operational tables the feature builders read,
//! but forward from the moment a prediction was made instead of backward from
//! now. That symmetry is deliberate: a prediction judged against a different
//! definition of "a visit" or "a booking" than the one it was built from would
//! be measuring the definitions, not the model.
//!
//! Nothing here decides whether a prediction was right. These functions report
//! what happened; `ai_prediction_outcome_service` applies the rule. Keeping the
//! two apart is what lets the judging rules be unit-tested without a database.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// A prediction whose horizon has passed and which has not been judged yet.
#[derive(Debug, Clone, FromRow)]
pub struct DuePrediction {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub prediction_kind: String,
    pub subject_id: String,
    pub lower_value: f64,
    pub upper_value: f64,
    /// When the prediction was made — the start of every forward window below.
    pub predicted_at: DateTime<Utc>,
    pub horizon_end: NaiveDate,
    /// The subject's recorded stock at prediction time, read back out of the
    /// run's stored feature set. Only inventory cover needs it, and taking it
    /// from the run rather than from the item today is what makes the
    /// observation reproducible after the stock has moved on.
    pub opening_stock: Option<f64>,
}

/// One kind's accuracy over a window, split by the model that produced it.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccuracyRecord {
    pub model_version: String,
    pub computed_by: String,
    pub resolved: i64,
    pub hits: i64,
    pub pending: i64,
    pub unresolvable: i64,
    /// Mean distance from the range across resolved rows, in the kind's unit.
    pub mean_error: Option<f64>,
}

/// Predictions ready to be judged, oldest horizon first.
///
/// Ordering by horizon means a backlog drains in the order it accumulated, so a
/// long-horizon prediction cannot be starved by a steady stream of short ones.
pub async fn due_predictions(db: &PgPool, limit: i64) -> Result<Vec<DuePrediction>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT prediction.id,
                  prediction.tenant_id,
                  prediction.branch_id,
                  run.prediction_kind,
                  prediction.subject_id,
                  prediction.lower_value::FLOAT8 AS lower_value,
                  prediction.upper_value::FLOAT8 AS upper_value,
                  prediction.created_at AS predicted_at,
                  prediction.horizon_end,
                  (SELECT (subject->'features'->>'stock_quantity')::FLOAT8
                     FROM jsonb_array_elements(run.features->'subjects') AS subject
                    WHERE subject->>'subject_id' = prediction.subject_id
                    LIMIT 1) AS opening_stock
             FROM ai_predictions prediction
             JOIN ai_prediction_runs run ON run.id = prediction.run_id
            WHERE prediction.outcome_status = 'pending'
              AND prediction.horizon_end IS NOT NULL
              AND prediction.horizon_end <= CURRENT_DATE
            ORDER BY prediction.horizon_end, prediction.id
            LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Writes a verdict. Only ever moves a row out of `pending`, never back into it.
#[allow(clippy::too_many_arguments)]
pub async fn record_outcome(
    db: &PgPool,
    prediction_id: &str,
    rule: &str,
    actual_value: f64,
    hit: bool,
    error: f64,
    note: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_predictions
              SET outcome_status='resolved',
                  outcome_rule=$2,
                  actual_value=$3,
                  outcome_hit=$4,
                  outcome_error=$5,
                  outcome_note=$6,
                  resolved_at=NOW()
            WHERE id=$1 AND outcome_status='pending'"#,
    )
    .bind(prediction_id)
    .bind(rule)
    .bind(actual_value)
    .bind(hit)
    .bind(error)
    .bind(note)
    .execute(db)
    .await
    .map(|_| ())
}

/// Closes a prediction whose truth never became observable.
pub async fn record_unresolvable(
    db: &PgPool,
    prediction_id: &str,
    note: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_predictions
              SET outcome_status='unresolvable',
                  outcome_note=$2,
                  resolved_at=NOW()
            WHERE id=$1 AND outcome_status='pending'"#,
    )
    .bind(prediction_id)
    .bind(note)
    .execute(db)
    .await
    .map(|_| ())
}

/// Accuracy for one prediction kind across a branch set, grouped by model.
///
/// Grouping by model version is the point: a hit rate pooled across the Python
/// model and the deterministic fallback would describe neither of them.
pub async fn accuracy_for_kind(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    prediction_kind: &str,
    lookback_days: i32,
) -> Result<Vec<AccuracyRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT run.model_version,
                  run.computed_by,
                  COUNT(*) FILTER (WHERE prediction.outcome_status='resolved')::BIGINT AS resolved,
                  COUNT(*) FILTER (WHERE prediction.outcome_hit)::BIGINT AS hits,
                  COUNT(*) FILTER (WHERE prediction.outcome_status='pending')::BIGINT AS pending,
                  COUNT(*) FILTER (WHERE prediction.outcome_status='unresolvable')::BIGINT AS unresolvable,
                  AVG(prediction.outcome_error) FILTER (WHERE prediction.outcome_status='resolved')::FLOAT8 AS mean_error
             FROM ai_predictions prediction
             JOIN ai_prediction_runs run ON run.id = prediction.run_id
            WHERE prediction.tenant_id=$1
              AND prediction.branch_id=ANY($2::TEXT[])
              AND run.prediction_kind=$3
              AND prediction.created_at >= NOW() - MAKE_INTERVAL(days => $4)
            GROUP BY run.model_version, run.computed_by
            ORDER BY resolved DESC, run.model_version"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(prediction_kind)
    .bind(lookback_days)
    .fetch_all(db)
    .await
}

// ---------------------------------------------------------------------------
// Observations. Each returns what happened, or `None` when it never became
// observable — which the service records as unresolvable rather than as a miss.
// ---------------------------------------------------------------------------

/// A visit is a completed appointment or a real sale, matching how the client
/// report counts one when the features are built.
const VISIT_SQL: &str = r#"
SELECT MIN(visited_at) AS visited_at FROM (
  SELECT appointment.start_at AS visited_at
    FROM appointments appointment
   WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.client_id=$3
     AND appointment.status IN ('completed','billed','paid')
     AND appointment.start_at > $4 AND appointment.start_at <= $5
  UNION ALL
  SELECT COALESCE(sale.finalized_at, sale.created_at) AS visited_at
    FROM pos_sales sale
   WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.client_id=$3
     AND sale.status NOT IN ('draft','cancelled','voided','refunded')
     AND COALESCE(sale.is_deleted,FALSE)=FALSE
     AND COALESCE(sale.finalized_at, sale.created_at) > $4
     AND COALESCE(sale.finalized_at, sale.created_at) <= $5
) visits
"#;

/// When the client next came back, if they did inside the window.
pub async fn first_visit_after(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(VISIT_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(after)
        .bind(until)
        .fetch_one(db)
        .await
}

/// Whether the client's first appointment in the window was a no-show.
///
/// `None` means they never had one, so the risk was never put to the test.
pub async fn next_appointment_was_no_show(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT appointment.status='no-show'
             FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.client_id=$3
              AND appointment.start_at > $4 AND appointment.start_at <= $5
              -- A cancelled booking tests neither attendance nor absence.
              AND appointment.status IN ('completed','billed','paid','no-show')
            ORDER BY appointment.start_at
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(after)
    .bind(until)
    .fetch_optional(db)
    .await
}

/// Units of one service actually sold in the window, counted the same way
/// `service_performance_trend` counts bookings.
pub async fn service_units_sold(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<f64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(line.quantity),0)::FLOAT8
             FROM pos_sale_lines line
             JOIN pos_sales sale ON sale.tenant_id=line.tenant_id
                                AND sale.branch_id=line.branch_id
                                AND sale.id=line.sale_id
            WHERE line.tenant_id=$1 AND line.branch_id=$2
              AND line.line_type='service' AND line.item_id=$3
              AND sale.status NOT IN ('draft','cancelled','voided','refunded')
              AND COALESCE(sale.is_deleted,FALSE)=FALSE
              AND COALESCE(sale.finalized_at, sale.created_at) > $4
              AND COALESCE(sale.finalized_at, sale.created_at) <= $5"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await
}

/// Booked minutes over rostered minutes in the window, as a percentage.
///
/// `None` when the staff member was never rostered: dividing by an empty roster
/// would report 0% utilisation for someone who was not expected to work.
pub async fn staff_utilization_percent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Option<f64>, sqlx::Error> {
    let scheduled: f64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(
                    COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)
                  + COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0)
                  ),0)::FLOAT8
             FROM staff_schedules
            WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status<>'off'
              AND schedule_date > $4::DATE AND schedule_date <= $5::DATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await?;

    if scheduled <= 0.0 {
        return Ok(None);
    }

    let booked: f64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))/60),0)::FLOAT8
             FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND status IN ('completed','billed','paid')
              AND start_at > $4 AND start_at <= $5"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await?;

    Ok(Some(booked / scheduled * 100.0))
}

/// Completed appointments per day across the window.
pub async fn completed_appointments(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<f64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COUNT(*)::FLOAT8
             FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2
              AND status IN ('completed','billed','paid')
              AND start_at > $3 AND start_at <= $4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await
}

/// Mean revenue across trading days in the window, in paise.
///
/// Days with no revenue are excluded exactly as they are when the forecast is
/// built, so a closed day cannot drag the observation below the prediction.
/// `None` when the branch never traded in the window.
pub async fn mean_daily_revenue_paise(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Option<f64>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT AVG(daily.total)::FLOAT8
             FROM (
               SELECT (COALESCE(sale.finalized_at, sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE AS business_date,
                      SUM(sale.total_paise)::FLOAT8 AS total
                 FROM pos_sales sale
                WHERE sale.tenant_id=$1 AND sale.branch_id=$2
                  AND sale.status NOT IN ('draft','voided','cancelled','refunded')
                  AND COALESCE(sale.is_deleted,FALSE)=FALSE
                  AND COALESCE(sale.finalized_at, sale.created_at) > $3
                  AND COALESCE(sale.finalized_at, sale.created_at) <= $4
                GROUP BY (COALESCE(sale.finalized_at, sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE
               HAVING SUM(sale.total_paise) > 0
             ) daily"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await
}

/// When cumulative consumption first exhausted the stock the item held at
/// prediction time — the observed cover, in days.
///
/// `None` when the item was still not exhausted by the end of the window, which
/// the service turns into a floor rather than a number.
pub async fn days_until_stock_exhausted(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    item_id: &str,
    opening_stock: f64,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Option<f64>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT MIN(EXTRACT(EPOCH FROM (movement.created_at - $5))/86400)::FLOAT8
             FROM (
               SELECT ledger.created_at,
                      SUM(ABS(ledger.quantity_delta)) OVER (ORDER BY ledger.created_at, ledger.id) AS consumed
                 FROM inventory_stock_ledger ledger
                WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
                  AND ledger.inventory_item_id=$3
                  AND ledger.movement_type='sale'
                  AND ledger.created_at > $5 AND ledger.created_at <= $6
             ) movement
            WHERE movement.consumed >= $4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(item_id)
    .bind(opening_stock)
    .bind(after)
    .bind(until)
    .fetch_one(db)
    .await
}

/// Whether a membership was still live after its renewal decision passed.
///
/// `None` when the row no longer exists, which is a deletion rather than a
/// lapse and must not be counted as either.
pub async fn membership_still_active(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT (active = TRUE AND (expires_at IS NULL OR expires_at > NOW()))
             FROM client_memberships
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_membership_id)
    .fetch_optional(db)
    .await
}
