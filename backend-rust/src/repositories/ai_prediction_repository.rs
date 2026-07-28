//! Persistence for predictive runs and their outputs.
//!
//! A prediction is only meaningful next to the inputs and the model that
//! produced it, so a run and its predictions are written together and never
//! updated in place. Re-running produces a new run, which is what makes an
//! earlier answer auditable after the model has moved on.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

/// One stored prediction: a range, its confidence, and what backed it.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PredictionRecord {
    pub id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub subject_name: String,
    /// Stored as text because NUMERIC has no lossless primitive mapping.
    pub lower_value: String,
    pub upper_value: String,
    pub unit: String,
    pub confidence: String,
    pub sample_size: i32,
    pub data_sufficient: bool,
    pub signals: Value,
    pub created_at: DateTime<Utc>,
}

/// The run that produced a set of predictions.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PredictionRunRecord {
    pub id: String,
    pub prediction_kind: String,
    pub model_version: String,
    pub computed_by: String,
    pub history_start: NaiveDate,
    pub history_end: NaiveDate,
    pub feature_digest: String,
    pub features: Value,
    pub created_at: DateTime<Utc>,
}

/// What to write for one prediction within a run.
pub struct NewPrediction {
    pub subject_kind: String,
    pub subject_id: String,
    pub subject_name: String,
    pub lower_value: f64,
    pub upper_value: f64,
    pub unit: String,
    pub confidence: String,
    pub sample_size: i32,
    pub data_sufficient: bool,
    pub signals: Value,
}

/// Writes a run and its predictions atomically.
///
/// A run without its predictions would be an audit record of nothing, and
/// predictions without their run would have no model version, so both land in
/// one transaction or neither does.
#[allow(clippy::too_many_arguments)]
pub async fn record_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    prediction_kind: &str,
    model_version: &str,
    computed_by: &str,
    history_start: NaiveDate,
    history_end: NaiveDate,
    feature_digest: &str,
    features: &Value,
    requested_by: &str,
    predictions: &[NewPrediction],
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let run_id: String = sqlx::query_scalar(
        r#"INSERT INTO ai_prediction_runs(
              tenant_id,branch_id,prediction_kind,model_version,computed_by,
              history_start,history_end,feature_digest,features,requested_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(prediction_kind)
    .bind(model_version)
    .bind(computed_by)
    .bind(history_start)
    .bind(history_end)
    .bind(feature_digest)
    .bind(features)
    .bind(requested_by)
    .fetch_one(&mut *tx)
    .await?;

    for prediction in predictions {
        sqlx::query(
            r#"INSERT INTO ai_predictions(
                  tenant_id,branch_id,run_id,subject_kind,subject_id,subject_name,
                  lower_value,upper_value,unit,confidence,sample_size,data_sufficient,signals
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&run_id)
        .bind(&prediction.subject_kind)
        .bind(&prediction.subject_id)
        .bind(&prediction.subject_name)
        .bind(prediction.lower_value)
        .bind(prediction.upper_value)
        .bind(&prediction.unit)
        .bind(&prediction.confidence)
        .bind(prediction.sample_size)
        .bind(prediction.data_sufficient)
        .bind(&prediction.signals)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(run_id)
}

/// The most recent run of a kind for a branch, for audit and for reuse.
pub async fn latest_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    prediction_kind: &str,
) -> Result<Option<PredictionRunRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,prediction_kind,model_version,computed_by,history_start,history_end,
                  feature_digest,features,created_at
             FROM ai_prediction_runs
            WHERE tenant_id=$1 AND branch_id=$2 AND prediction_kind=$3
            ORDER BY created_at DESC
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(prediction_kind)
    .fetch_optional(db)
    .await
}

/// The predictions belonging to a run, scoped so one tenant cannot read another's.
pub async fn predictions_for_run(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
) -> Result<Vec<PredictionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,subject_kind,subject_id,subject_name,
                  lower_value::TEXT AS lower_value,
                  upper_value::TEXT AS upper_value,
                  unit,confidence,sample_size,data_sufficient,signals,created_at
             FROM ai_predictions
            WHERE tenant_id=$1 AND branch_id=$2 AND run_id=$3
            ORDER BY created_at, id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .fetch_all(db)
    .await
}
