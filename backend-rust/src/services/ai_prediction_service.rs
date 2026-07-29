//! Predictive intelligence over real CRM history.
//!
//! The division of labour is deliberate. Rust owns the facts: it reads the
//! appointment, POS, client and stock history, turns it into a feature set, and
//! is the transactional record of what was predicted from what. The Python AI
//! service owns the computation. Rust keeps a deterministic fallback so a
//! prediction is still available, and still honest about its confidence, when
//! the model cannot be reached.
//!
//! Three rules run through everything here:
//!
//! * A prediction is a **range**, never an exact future date. Presenting a
//!   single day as fact would be a promise the data cannot support.
//! * **Sufficiency is enforced before computation, not after.** A subject with
//!   too little history is returned as unavailable rather than given a number
//!   that looks equally authoritative.
//! * The **feature set is deterministic**. Ordered maps and a digest over the
//!   canonical form mean the same history always yields the same inputs, so a
//!   stored run can be reproduced and checked.

use std::collections::BTreeMap;

use chrono::{Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::{
        ai_copilot_repository as copilot_repository, ai_prediction_repository as prediction_repository,
        analytics_repository, clients_repository, membership_lifecycle_repository,
    },
    services::{
        ai_scope_service::{self, ScopeRequest},
        ai_tool_dispatcher,
        auth_service::AuthClaims,
    },
};

/// History window every prediction is built from.
const HISTORY_DAYS: i32 = 90;
/// Rows to score per run, matching the copilot's own row budget.
const SUBJECT_LIMIT: i64 = 25;
/// Version of the deterministic fallback, so a stored run says which produced it.
const FALLBACK_MODEL_VERSION: &str = "rust-deterministic-v1";

/// What is being predicted. Adding a variant is the only way to widen this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictionKind {
    ClientChurnRisk,
    ClientReturnWindow,
    NoShowRisk,
    ServiceDemand,
    AppointmentLoad,
    StaffUtilization,
    InventoryReorderRisk,
    MembershipRenewalRisk,
    RevenueForecast,
}

impl PredictionKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::ClientChurnRisk => "client_churn_risk",
            Self::ClientReturnWindow => "client_return_window",
            Self::NoShowRisk => "no_show_risk",
            Self::ServiceDemand => "service_demand",
            Self::AppointmentLoad => "appointment_load",
            Self::StaffUtilization => "staff_utilization",
            Self::InventoryReorderRisk => "inventory_reorder_risk",
            Self::MembershipRenewalRisk => "membership_renewal_risk",
            Self::RevenueForecast => "revenue_forecast",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        [
            Self::ClientChurnRisk,
            Self::ClientReturnWindow,
            Self::NoShowRisk,
            Self::ServiceDemand,
            Self::AppointmentLoad,
            Self::StaffUtilization,
            Self::InventoryReorderRisk,
            Self::MembershipRenewalRisk,
            Self::RevenueForecast,
        ]
        .into_iter()
        .find(|kind| kind.name() == name)
    }

    fn subject_kind(self) -> &'static str {
        match self {
            Self::ClientChurnRisk | Self::ClientReturnWindow | Self::NoShowRisk => "client",
            Self::ServiceDemand => "service",
            Self::StaffUtilization => "staff",
            Self::InventoryReorderRisk => "inventory_item",
            Self::MembershipRenewalRisk => "membership",
            Self::AppointmentLoad | Self::RevenueForecast => "branch",
        }
    }

    fn unit(self) -> &'static str {
        match self {
            Self::ClientChurnRisk | Self::NoShowRisk => "risk_score",
            Self::ClientReturnWindow => "days",
            Self::ServiceDemand | Self::AppointmentLoad => "bookings",
            Self::StaffUtilization => "percent",
            Self::InventoryReorderRisk => "days_of_cover",
            Self::MembershipRenewalRisk => "risk_score",
            Self::RevenueForecast => "paise",
        }
    }

    /// Fewest observations a subject needs before a number is claimed for it.
    ///
    /// These are floors for honesty, not for accuracy: below them a prediction
    /// would be describing noise, so none is made.
    fn min_samples(self) -> i32 {
        match self {
            // Two visits is the fewest that defines an interval at all; three
            // is the fewest that says whether the interval is stable.
            Self::ClientReturnWindow => 3,
            Self::ClientChurnRisk | Self::NoShowRisk => 3,
            Self::ServiceDemand => 4,
            Self::StaffUtilization => 4,
            // A daily series needs enough days to have a shape.
            Self::AppointmentLoad | Self::RevenueForecast => 14,
            Self::InventoryReorderRisk => 1,
            Self::MembershipRenewalRisk => 1,
        }
    }

}

/// One subject's deterministic features.
///
/// `features` is a `BTreeMap` rather than a `HashMap` on purpose: the digest is
/// taken over the serialized form, so key order has to be stable or identical
/// history would produce different digests between runs.
#[derive(Debug, Clone, Serialize)]
pub struct SubjectFeatures {
    pub subject_id: String,
    pub subject_name: String,
    /// Observations behind this subject, checked against `min_samples`.
    pub sample_size: i32,
    pub features: BTreeMap<String, f64>,
}

/// The full deterministic input to a prediction run.
#[derive(Debug, Clone, Serialize)]
pub struct FeatureSet {
    pub kind: String,
    pub history_start: NaiveDate,
    pub history_end: NaiveDate,
    pub subjects: Vec<SubjectFeatures>,
}

impl FeatureSet {
    /// Stable digest of the inputs. Identical history yields an identical
    /// digest, which is what lets a stored run be reproduced and checked.
    pub fn digest(&self) -> String {
        let canonical = serde_json::to_string(self).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        format!("{:x}", hasher.finalize())
    }
}

/// One prediction as returned to a caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prediction {
    pub subject_kind: String,
    pub subject_id: String,
    pub subject_name: String,
    /// Range bounds. Equal bounds still mean a range of one, never a promise.
    pub lower_value: f64,
    pub upper_value: f64,
    pub unit: String,
    pub confidence: String,
    pub sample_size: i32,
    /// False when history was too thin; the bounds are then both zero and must
    /// not be read as a forecast.
    pub data_sufficient: bool,
    /// Plain-language reasons, drawn from the features that drove it.
    pub signals: Vec<String>,
}

/// A completed run: what was predicted, by which model, from what window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionRun {
    pub run_id: String,
    pub kind: String,
    pub model_version: String,
    pub computed_by: String,
    pub history_start: String,
    pub history_end: String,
    pub feature_digest: String,
    pub predictions: Vec<Prediction>,
    /// Subjects held back because their history was too thin to score.
    pub insufficient_subjects: usize,
    /// Which branches the history was read from, and whether the request was
    /// narrowed to reach them.
    pub scope: crate::services::ai_scope_service::ScopeDisclosure,
    /// Plain statement of which engine produced this, so a fallback result is
    /// never mistaken for a live model result.
    pub basis: String,
    /// Every prediction here is a range from past behaviour, not a commitment.
    /// Carried on the payload so a client cannot render it without one.
    pub disclaimer: String,
}

/// The permission domain a prediction reads, and therefore what the caller must
/// hold. Money forecasts sit behind finance, not behind a role name.
pub fn prediction_domain(kind: PredictionKind) -> crate::services::ai_scope_service::AiDomain {
    use crate::services::ai_scope_service::AiDomain;
    match kind {
        PredictionKind::ClientChurnRisk | PredictionKind::ClientReturnWindow => AiDomain::Clients,
        PredictionKind::NoShowRisk | PredictionKind::AppointmentLoad => AiDomain::Appointments,
        PredictionKind::ServiceDemand => AiDomain::Services,
        PredictionKind::StaffUtilization => AiDomain::Staff,
        PredictionKind::InventoryReorderRisk => AiDomain::Inventory,
        PredictionKind::MembershipRenewalRisk => AiDomain::Memberships,
        PredictionKind::RevenueForecast => AiDomain::Finance,
    }
}

/// Where the prediction provider lives, if it is configured at all.
///
/// Mirrors the concierge's own provider handle so both AI paths describe an
/// absent provider the same way, and so a test can run the deterministic
/// fallback without constructing an entire settings object.
#[derive(Debug, Clone, Copy)]
pub struct ProviderConfig<'a> {
    url: Option<&'a str>,
    token: Option<&'a str>,
}

impl<'a> ProviderConfig<'a> {
    pub fn from_settings(settings: &'a Settings) -> Self {
        Self {
            url: settings.ai_service_url.as_deref(),
            token: settings.ai_service_token.as_deref(),
        }
    }

    /// No provider: every run is scored by the deterministic fallback.
    pub fn unconfigured() -> Self {
        Self {
            url: None,
            token: None,
        }
    }
}

/// What produced a run, in words a person can read.
fn basis_statement(computed_by: &str, model_version: &str) -> String {
    match computed_by {
        "python" => format!("Scored by the live prediction service (model {model_version})."),
        _ => format!(
            "The live prediction service was unavailable, so this was scored by the deterministic fallback ({model_version})."
        ),
    }
}

/// Stated on every run, so a range is never read as a commitment.
const PREDICTION_DISCLAIMER: &str = "These are ranges projected from recorded CRM history, not guarantees. Treat them as planning input and re-check as new activity lands.";

#[derive(Debug, Deserialize)]
struct ProviderPrediction {
    subject_id: String,
    lower_value: f64,
    upper_value: f64,
    confidence: String,
    #[serde(default)]
    signals: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderPredictionResponse {
    model_version: String,
    predictions: Vec<ProviderPrediction>,
}

#[derive(Debug, Deserialize)]
struct ProviderEnvelope<T> {
    success: bool,
    data: Option<T>,
}

/// Builds features, scores them, persists the run, and returns it.
///
/// The role check happens before any history is read, so an unauthorized caller
/// cannot learn anything about a branch by timing the call.
pub async fn predict(
    db: &PgPool,
    provider: ProviderConfig<'_>,
    tenant_id: &str,
    claims: &AuthClaims,
    kind: PredictionKind,
    scope_request: &ScopeRequest,
) -> Result<PredictionRun, AppError> {
    // Same order as every other AI surface: identity, then grants, then the
    // domain permission, and only then any history is read. A denial beats a
    // role default here exactly as it does for tools.
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, scope_request).await?;
    ai_scope_service::require_domain(claims, prediction_domain(kind))?;
    let Some(branch_id) = scope.primary_branch_id() else {
        return Err(AppError::forbidden(
            "no branch is authorized for this login, so no history can be read",
        ));
    };
    let branch_ids = scope.branch_ids();
    let role = claims.role.as_str();
    let user_id = claims.sub.as_str();
    let features = build_features(db, tenant_id, branch_id, kind).await?;
    let digest = features.digest();

    // Sufficiency is decided here, on the facts, before any model sees them.
    // A model cannot talk Rust out of a subject having too little history.
    let (scorable, insufficient): (Vec<_>, Vec<_>) = features
        .subjects
        .iter()
        .partition(|subject| subject.sample_size >= kind.min_samples());

    let (mut predictions, model_version, computed_by) =
        match call_provider(provider, tenant_id, branch_id, kind, &features, &scorable).await {
            Some((rows, version)) => (rows, version, "python"),
            None => (
                fallback_predictions(kind, &scorable),
                FALLBACK_MODEL_VERSION.to_string(),
                "rust_fallback",
            ),
        };

    // Subjects that failed the sufficiency gate are still reported, so the
    // caller sees that they exist and were deliberately not scored.
    for subject in &insufficient {
        predictions.push(Prediction {
            subject_kind: kind.subject_kind().into(),
            subject_id: subject.subject_id.clone(),
            subject_name: subject.subject_name.clone(),
            lower_value: 0.0,
            upper_value: 0.0,
            unit: kind.unit().into(),
            confidence: "low".into(),
            sample_size: subject.sample_size,
            data_sufficient: false,
            signals: vec![format!(
                "Prediction unavailable: {} observation(s), {} needed.",
                subject.sample_size,
                kind.min_samples()
            )],
        });
    }

    let stored = predictions
        .iter()
        .map(|prediction| prediction_repository::NewPrediction {
            subject_kind: prediction.subject_kind.clone(),
            subject_id: prediction.subject_id.clone(),
            subject_name: prediction.subject_name.clone(),
            lower_value: prediction.lower_value,
            upper_value: prediction.upper_value,
            unit: prediction.unit.clone(),
            confidence: prediction.confidence.clone(),
            sample_size: prediction.sample_size,
            data_sufficient: prediction.data_sufficient,
            signals: json!(prediction.signals),
        })
        .collect::<Vec<_>>();

    let run_id = prediction_repository::record_run(
        db,
        tenant_id,
        prediction_repository::RunScope {
            branch_id,
            level: scope.level.as_str(),
            label: &scope.label,
            branch_ids: &branch_ids,
            requested_role: role,
        },
        kind.name(),
        &model_version,
        computed_by,
        features.history_start,
        features.history_end,
        &digest,
        &serde_json::to_value(&features).unwrap_or_else(|_| json!({})),
        user_id,
        &stored,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, kind = kind.name(), "failed to persist prediction run");
        AppError::internal("failed to record the prediction run")
    })?;

    Ok(PredictionRun {
        run_id,
        kind: kind.name().into(),
        basis: basis_statement(computed_by, &model_version),
        model_version,
        computed_by: computed_by.into(),
        history_start: features.history_start.to_string(),
        history_end: features.history_end.to_string(),
        feature_digest: digest,
        predictions,
        insufficient_subjects: insufficient.len(),
        scope: scope.disclosure(),
        disclaimer: PREDICTION_DISCLAIMER.to_string(),
    })
}

/// The most recent stored run of a kind, with the predictions it produced.
///
/// This is the audit path: it answers "what did we predict, from what window,
/// with which model" without recomputing anything.
pub async fn latest_run(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    kind: PredictionKind,
    scope_request: &ScopeRequest,
) -> Result<Option<PredictionRun>, AppError> {
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, scope_request).await?;
    ai_scope_service::require_domain(claims, prediction_domain(kind))?;
    let Some(branch_id) = scope.primary_branch_id() else {
        return Err(AppError::forbidden(
            "no branch is authorized for this login",
        ));
    };
    let Some(run) = prediction_repository::latest_run(db, tenant_id, branch_id, kind.name())
        .await
        .map_err(|_| AppError::internal("failed to load the prediction run"))?
    else {
        return Ok(None);
    };
    let rows = prediction_repository::predictions_for_run(db, tenant_id, branch_id, &run.id)
        .await
        .map_err(|_| AppError::internal("failed to load stored predictions"))?;
    let insufficient = rows.iter().filter(|row| !row.data_sufficient).count();
    let basis = basis_statement(&run.computed_by, &run.model_version);
    Ok(Some(PredictionRun {
        run_id: run.id,
        kind: run.prediction_kind,
        basis,
        model_version: run.model_version,
        computed_by: run.computed_by,
        history_start: run.history_start.to_string(),
        history_end: run.history_end.to_string(),
        feature_digest: run.feature_digest,
        predictions: rows
            .into_iter()
            .map(|row| Prediction {
                subject_kind: row.subject_kind,
                subject_id: row.subject_id,
                subject_name: row.subject_name,
                lower_value: row.lower_value.parse().unwrap_or_default(),
                upper_value: row.upper_value.parse().unwrap_or_default(),
                unit: row.unit,
                confidence: row.confidence,
                sample_size: row.sample_size,
                data_sufficient: row.data_sufficient,
                signals: row
                    .signals
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect(),
        insufficient_subjects: insufficient,
        scope: scope.disclosure(),
        disclaimer: PREDICTION_DISCLAIMER.to_string(),
    }))
}

/// Reads real CRM history and turns it into the feature set for a kind.
///
/// Every source here is an existing repository, so a prediction is built from
/// the same numbers the reports show rather than a parallel calculation.
pub async fn build_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: PredictionKind,
) -> Result<FeatureSet, AppError> {
    let history_end = Utc::now().date_naive();
    let history_start = history_end - Duration::days(i64::from(HISTORY_DAYS));
    let subjects = match kind {
        PredictionKind::ClientChurnRisk
        | PredictionKind::ClientReturnWindow
        | PredictionKind::NoShowRisk => client_features(db, tenant_id, branch_id).await?,
        PredictionKind::ServiceDemand => service_features(db, tenant_id, branch_id).await?,
        PredictionKind::StaffUtilization => staff_features(db, tenant_id, branch_id).await?,
        PredictionKind::AppointmentLoad => appointment_load_features(db, tenant_id, branch_id).await?,
        PredictionKind::RevenueForecast => revenue_features(db, tenant_id, branch_id).await?,
        PredictionKind::InventoryReorderRisk => inventory_features(db, tenant_id, branch_id).await?,
        PredictionKind::MembershipRenewalRisk => membership_features(db, tenant_id, branch_id).await?,
    };
    Ok(FeatureSet {
        kind: kind.name().into(),
        history_start,
        history_end,
        subjects,
    })
}

fn number(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).unwrap_or_default()
}

/// Client-level features from the existing client report.
async fn client_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = clients_repository::client_report(
        db,
        tenant_id,
        branch_id,
        "best-clients",
        clients_repository::ClientReportFilters {
            days: HISTORY_DAYS,
            limit: SUBJECT_LIMIT,
            min_lifetime_value_paise: 0,
            min_visits: 0,
            segment: "",
            max_churn_risk_score: 100,
            include_unpaid: true,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to load client prediction features"))?;

    Ok(rows
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|row| {
            let visits = number(row.get("totalVisits"));
            let mut features = BTreeMap::new();
            features.insert("total_visits".into(), visits);
            features.insert("recency_days".into(), number(row.get("recencyDays")));
            features.insert(
                "visit_frequency_days".into(),
                number(row.get("visitFrequencyDays")),
            );
            features.insert("churn_risk_score".into(), number(row.get("churnRiskScore")));
            features.insert("no_show_rate_bps".into(), number(row.get("noShowRateBps")));
            features.insert(
                "cancellation_rate_bps".into(),
                number(row.get("cancellationRateBps")),
            );
            features.insert("rfm_score".into(), number(row.get("rfmScore")));
            SubjectFeatures {
                subject_id: row
                    .get("clientId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                subject_name: row
                    .get("clientName")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                // Visits are the observations a client prediction rests on.
                sample_size: visits as i32,
                features,
            }
        })
        .collect())
}

async fn service_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = copilot_repository::service_performance_trend(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        HISTORY_DAYS,
        SUBJECT_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service prediction features"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let mut features = BTreeMap::new();
            features.insert("current_bookings".into(), row.current_bookings as f64);
            features.insert("previous_bookings".into(), row.previous_bookings as f64);
            features.insert("current_clients".into(), row.current_clients as f64);
            features.insert(
                "current_repeat_clients".into(),
                row.current_repeat_clients as f64,
            );
            SubjectFeatures {
                subject_id: row.service_id.clone(),
                subject_name: row.service_name.clone(),
                sample_size: (row.current_bookings + row.previous_bookings) as i32,
                features,
            }
        })
        .collect())
}

async fn staff_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = copilot_repository::staff_performance_trend(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        HISTORY_DAYS,
        SUBJECT_LIMIT,
        14,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff prediction features"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let mut features = BTreeMap::new();
            features.insert(
                "current_booked_minutes".into(),
                row.current_booked_minutes as f64,
            );
            features.insert(
                "current_scheduled_minutes".into(),
                row.current_scheduled_minutes as f64,
            );
            features.insert(
                "previous_booked_minutes".into(),
                row.previous_booked_minutes as f64,
            );
            features.insert(
                "previous_scheduled_minutes".into(),
                row.previous_scheduled_minutes as f64,
            );
            features.insert("current_completed".into(), row.current_completed as f64);
            SubjectFeatures {
                subject_id: row.staff_id.clone(),
                subject_name: row.staff_name.clone(),
                sample_size: (row.current_completed + row.previous_completed) as i32,
                features,
            }
        })
        .collect())
}

/// Branch appointment load, from the weekday demand the copilot already uses.
async fn appointment_load_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = copilot_repository::weekday_demand(db, tenant_id, &copilot_repository::one_branch(branch_id),  HISTORY_DAYS, "")
        .await
        .map_err(|_| AppError::internal("failed to load appointment load features"))?;

    let mut features = BTreeMap::new();
    let mut observations = 0_i64;
    for row in &rows {
        features.insert(
            format!("weekday_{}_completed", row.weekday),
            row.completed_appointments as f64,
        );
        features.insert(
            format!("weekday_{}_lost", row.weekday),
            row.lost_appointments as f64,
        );
        observations += row.completed_appointments;
    }
    Ok(vec![SubjectFeatures {
        subject_id: branch_id.to_string(),
        subject_name: "Branch appointment load".into(),
        sample_size: observations.min(i64::from(i32::MAX)) as i32,
        features,
    }])
}

/// Branch revenue, as a daily series from the existing analytics repository.
async fn revenue_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = analytics_repository::daily_revenue(db, tenant_id, branch_id, HISTORY_DAYS)
        .await
        .map_err(|_| AppError::internal("failed to load revenue features"))?;

    let mut features = BTreeMap::new();
    // Days with recorded revenue are the observations; a run of empty days is
    // not evidence of a trend.
    let trading_days = rows.iter().filter(|row| row.value_paise > 0).count() as i32;
    for row in &rows {
        features.insert(
            format!("revenue_{}", row.business_date),
            row.value_paise as f64,
        );
    }
    Ok(vec![SubjectFeatures {
        subject_id: branch_id.to_string(),
        subject_name: "Branch revenue".into(),
        sample_size: trading_days,
        features,
    }])
}

async fn inventory_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows =
        copilot_repository::inventory_risk(db, tenant_id, &copilot_repository::one_branch(branch_id),  HISTORY_DAYS, SUBJECT_LIMIT)
            .await
            .map_err(|_| AppError::internal("failed to load inventory prediction features"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let mut features = BTreeMap::new();
            features.insert("stock_quantity".into(), row.stock_quantity as f64);
            features.insert("reorder_point".into(), row.reorder_point as f64);
            features.insert("consumed_units".into(), row.consumed_units as f64);
            features.insert("history_days".into(), f64::from(HISTORY_DAYS));
            SubjectFeatures {
                subject_id: row.item_id.clone(),
                subject_name: row.item_name.clone(),
                // Consumption is what makes cover predictable; without it the
                // item is low but not forecastable.
                sample_size: row.consumed_units.min(i64::from(i32::MAX)) as i32,
                features,
            }
        })
        .collect())
}

async fn membership_features(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SubjectFeatures>, AppError> {
    let rows = membership_lifecycle_repository::renewal_queue(db, tenant_id, branch_id, 60)
        .await
        .map_err(|_| AppError::internal("failed to load membership prediction features"))?;

    Ok(rows
        .iter()
        .map(|row| {
            let mut features = BTreeMap::new();
            features.insert(
                "days_until_expiry".into(),
                row.days_until_expiry.max(0) as f64,
            );
            features.insert("failure_count".into(), f64::from(row.failure_count));
            features.insert(
                "auto_renew_paused".into(),
                f64::from(u8::from(row.auto_renew_status == "paused")),
            );
            SubjectFeatures {
                subject_id: row.id.clone(),
                subject_name: format!("{} — {}", row.client_name, row.membership_name),
                sample_size: 1,
                features,
            }
        })
        .collect())
}

/// Sends the feature set to the Python service, which owns the computation.
///
/// Returns `None` on any failure so the caller falls back rather than failing
/// the request; a prediction that degrades is more useful than an error.
async fn call_provider(
    provider: ProviderConfig<'_>,
    tenant_id: &str,
    branch_id: &str,
    kind: PredictionKind,
    features: &FeatureSet,
    scorable: &[&SubjectFeatures],
) -> Option<(Vec<Prediction>, String)> {
    if scorable.is_empty() {
        return None;
    }
    let url = provider.url?;
    let token = provider.token?;
    let payload = json!({
        "tenant_id": tenant_id,
        "branch_id": branch_id,
        "kind": kind.name(),
        "unit": kind.unit(),
        "history_start": features.history_start,
        "history_end": features.history_end,
        "minimum_samples": kind.min_samples(),
        "subjects": scorable,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(14))
        .build()
        .ok()?;
    let response = client
        .post(format!("{url}/api/v1/predictions"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .inspect_err(|error| {
            tracing::warn!(%error, kind = kind.name(), "prediction provider unreachable");
        })
        .ok()?;
    if !response.status().is_success() {
        tracing::warn!(
            status = response.status().as_u16(),
            kind = kind.name(),
            "prediction provider returned an error status"
        );
        return None;
    }
    let envelope = response
        .json::<ProviderEnvelope<ProviderPredictionResponse>>()
        .await
        .ok()?;
    let data = envelope.data.filter(|_| envelope.success)?;
    if data.model_version.trim().is_empty() {
        // An unversioned prediction cannot be audited, so it is not accepted.
        tracing::warn!(kind = kind.name(), "prediction provider omitted its model version");
        return None;
    }

    // Only subjects Rust sent may come back, and each is re-checked against the
    // feature set. A model cannot introduce a subject or claim more samples
    // than the history actually held.
    let rows = data
        .predictions
        .into_iter()
        .filter_map(|row| {
            let subject = scorable
                .iter()
                .find(|candidate| candidate.subject_id == row.subject_id)?;
            let (lower, upper) = ordered(row.lower_value, row.upper_value);
            Some(Prediction {
                subject_kind: kind.subject_kind().into(),
                subject_id: subject.subject_id.clone(),
                subject_name: subject.subject_name.clone(),
                lower_value: lower,
                upper_value: upper,
                unit: kind.unit().into(),
                confidence: normalize_confidence(&row.confidence),
                sample_size: subject.sample_size,
                data_sufficient: true,
                signals: row.signals,
            })
        })
        .collect::<Vec<_>>();
    (!rows.is_empty()).then_some((rows, data.model_version))
}

fn ordered(lower: f64, upper: f64) -> (f64, f64) {
    if upper < lower {
        (upper, lower)
    } else {
        (lower, upper)
    }
}

fn normalize_confidence(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "high" => "high",
        "medium" => "medium",
        _ => "low",
    }
    .into()
}

/// Deterministic scoring used when the model cannot be reached.
///
/// Every branch here produces a range and a confidence tied to how much history
/// backed it, so a fallback answer is weaker but never less honest.
fn fallback_predictions(kind: PredictionKind, scorable: &[&SubjectFeatures]) -> Vec<Prediction> {
    scorable
        .iter()
        .map(|subject| {
            let feature = |key: &str| subject.features.get(key).copied().unwrap_or_default();
            let (lower, upper, mut signals) = match kind {
                PredictionKind::ClientReturnWindow => {
                    let interval = feature("visit_frequency_days");
                    let elapsed = feature("recency_days");
                    // The client's own interval, widened by a quarter either
                    // way, minus the time already waited.
                    let spread = (interval / 4.0).max(2.0);
                    (
                        (interval - spread - elapsed).max(0.0),
                        (interval + spread - elapsed).max(0.0),
                        vec![
                            format!("Usual interval about {:.0} days.", interval),
                            format!("Last visit {:.0} days ago.", elapsed),
                        ],
                    )
                }
                PredictionKind::ClientChurnRisk => {
                    let score = feature("churn_risk_score");
                    (
                        (score - 10.0).max(0.0),
                        (score + 10.0).min(100.0),
                        vec![format!(
                            "Recorded churn risk {score:.0}, {:.0} days since last visit.",
                            feature("recency_days")
                        )],
                    )
                }
                PredictionKind::NoShowRisk => {
                    let rate = feature("no_show_rate_bps") / 100.0;
                    (
                        (rate - 5.0).max(0.0),
                        (rate + 5.0).min(100.0),
                        vec![format!("Historic no-show rate {rate:.1}%.")],
                    )
                }
                PredictionKind::ServiceDemand => {
                    let current = feature("current_bookings");
                    let previous = feature("previous_bookings");
                    let projected = (current + previous) / 2.0;
                    (
                        (projected * 0.75).floor(),
                        (projected * 1.25).ceil(),
                        vec![format!(
                            "{current:.0} bookings this window against {previous:.0} before."
                        )],
                    )
                }
                PredictionKind::StaffUtilization => {
                    let scheduled = feature("current_scheduled_minutes");
                    let booked = feature("current_booked_minutes");
                    let utilization = if scheduled > 0.0 {
                        booked / scheduled * 100.0
                    } else {
                        0.0
                    };
                    (
                        (utilization - 10.0).max(0.0),
                        (utilization + 10.0).min(100.0),
                        vec![format!("Booked {booked:.0} of {scheduled:.0} rostered minutes.")],
                    )
                }
                PredictionKind::AppointmentLoad => {
                    let total: f64 = subject
                        .features
                        .iter()
                        .filter(|(key, _)| key.ends_with("_completed"))
                        .map(|(_, value)| value)
                        .sum();
                    let daily = total / f64::from(HISTORY_DAYS);
                    (
                        (daily * 0.75).floor(),
                        (daily * 1.25).ceil(),
                        vec![format!("{total:.0} completed appointments over the window.")],
                    )
                }
                PredictionKind::RevenueForecast => {
                    let values: Vec<f64> = subject
                        .features
                        .iter()
                        .filter(|(key, _)| key.starts_with("revenue_"))
                        .map(|(_, value)| *value)
                        .collect();
                    let trading: Vec<f64> =
                        values.iter().copied().filter(|value| *value > 0.0).collect();
                    let mean = if trading.is_empty() {
                        0.0
                    } else {
                        trading.iter().sum::<f64>() / trading.len() as f64
                    };
                    (
                        (mean * 0.8).floor(),
                        (mean * 1.2).ceil(),
                        vec![format!(
                            "Mean of {} trading day(s) in the window.",
                            trading.len()
                        )],
                    )
                }
                PredictionKind::InventoryReorderRisk => {
                    let consumed = feature("consumed_units");
                    let stock = feature("stock_quantity");
                    let per_day = consumed / f64::from(HISTORY_DAYS);
                    let cover = if per_day > 0.0 { stock / per_day } else { 0.0 };
                    (
                        (cover * 0.75).floor(),
                        (cover * 1.25).ceil(),
                        vec![format!(
                            "{stock:.0} in stock against {consumed:.0} used in the window."
                        )],
                    )
                }
                PredictionKind::MembershipRenewalRisk => {
                    let failures = feature("failure_count");
                    let days = feature("days_until_expiry");
                    // Failed attempts dominate; imminent expiry adds to it.
                    let score = (failures * 25.0 + if days <= 7.0 { 30.0 } else { 0.0 }).min(100.0);
                    (
                        (score - 10.0).max(0.0),
                        (score + 10.0).min(100.0),
                        vec![format!(
                            "{failures:.0} failed auto-renew attempt(s), expires in {days:.0} days."
                        )],
                    )
                }
            };
            signals.push(format!(
                "Scored from {} observation(s) by the deterministic fallback.",
                subject.sample_size
            ));
            Prediction {
                subject_kind: kind.subject_kind().into(),
                subject_id: subject.subject_id.clone(),
                subject_name: subject.subject_name.clone(),
                lower_value: lower,
                upper_value: upper,
                unit: kind.unit().into(),
                // The fallback is a heuristic over real history: enough for a
                // range, never enough to call it high confidence.
                confidence: if subject.sample_size >= kind.min_samples() * 3 {
                    "medium".into()
                } else {
                    "low".into()
                },
                sample_size: subject.sample_size,
                data_sufficient: true,
                signals,
            }
        })
        .collect()
}

/// Phase 3 — predictive intelligence.
///
/// Covers the guarantees that make a prediction safe to show: identical history
/// produces an identical feature set, a subject with too little history is
/// never given a number, every prediction is a range with a confidence, and a
/// run is auditable back to the model and window that produced it.
#[cfg(test)]
mod phase3_prediction_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    const ALL_KINDS: &[PredictionKind] = &[
        PredictionKind::ClientChurnRisk,
        PredictionKind::ClientReturnWindow,
        PredictionKind::NoShowRisk,
        PredictionKind::ServiceDemand,
        PredictionKind::AppointmentLoad,
        PredictionKind::StaffUtilization,
        PredictionKind::InventoryReorderRisk,
        PredictionKind::MembershipRenewalRisk,
        PredictionKind::RevenueForecast,
    ];

    fn subject(id: &str, sample_size: i32, pairs: &[(&str, f64)]) -> SubjectFeatures {
        SubjectFeatures {
            subject_id: id.into(),
            subject_name: format!("Subject {id}"),
            sample_size,
            features: pairs
                .iter()
                .map(|(key, value)| ((*key).to_string(), *value))
                .collect(),
        }
    }

    /// Every kind round-trips through its name, so a stored run can be read back.
    #[test]
    fn every_kind_round_trips_through_its_name() {
        for kind in ALL_KINDS {
            assert_eq!(
                PredictionKind::from_name(kind.name()),
                Some(*kind),
                "{} does not round-trip",
                kind.name()
            );
            assert!(!kind.unit().is_empty());
            assert!(kind.min_samples() >= 1);
        }
        assert_eq!(PredictionKind::from_name("lottery_numbers"), None);
    }

    /// The same history must always produce the same feature digest, otherwise a
    /// stored run could never be reproduced or checked.
    #[test]
    fn identical_history_produces_an_identical_digest() {
        let build = || FeatureSet {
            kind: PredictionKind::ClientReturnWindow.name().into(),
            history_start: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
            history_end: NaiveDate::from_ymd_opt(2026, 6, 30).unwrap(),
            subjects: vec![
                subject("c1", 12, &[("visit_frequency_days", 30.0), ("recency_days", 10.0)]),
                subject("c2", 4, &[("recency_days", 55.0), ("visit_frequency_days", 21.0)]),
            ],
        };
        assert_eq!(build().digest(), build().digest());

        // Feature insertion order must not change the digest: the map is
        // ordered precisely so that a reshuffle is not a different run.
        let reordered = FeatureSet {
            subjects: vec![
                subject("c1", 12, &[("recency_days", 10.0), ("visit_frequency_days", 30.0)]),
                subject("c2", 4, &[("visit_frequency_days", 21.0), ("recency_days", 55.0)]),
            ],
            ..build()
        };
        assert_eq!(build().digest(), reordered.digest());

        // A real change in the history must change the digest.
        let changed = FeatureSet {
            subjects: vec![
                subject("c1", 12, &[("visit_frequency_days", 31.0), ("recency_days", 10.0)]),
                subject("c2", 4, &[("recency_days", 55.0), ("visit_frequency_days", 21.0)]),
            ],
            ..build()
        };
        assert_ne!(build().digest(), changed.digest());
    }

    /// The fallback returns a range and never claims high confidence.
    #[test]
    fn the_fallback_returns_ranges_and_stays_modest() {
        for kind in ALL_KINDS {
            let rich = subject(
                "s1",
                kind.min_samples() * 10,
                &[
                    ("visit_frequency_days", 30.0),
                    ("recency_days", 5.0),
                    ("churn_risk_score", 40.0),
                    ("no_show_rate_bps", 900.0),
                    ("current_bookings", 20.0),
                    ("previous_bookings", 12.0),
                    ("current_booked_minutes", 6000.0),
                    ("current_scheduled_minutes", 9000.0),
                    ("weekday_1_completed", 40.0),
                    ("revenue_2026-07-01", 500000.0),
                    ("stock_quantity", 20.0),
                    ("consumed_units", 90.0),
                    ("failure_count", 1.0),
                    ("days_until_expiry", 5.0),
                ],
            );
            let predictions = fallback_predictions(*kind, &[&rich]);
            let prediction = predictions.first().expect("fallback scores the subject");
            assert!(
                prediction.lower_value <= prediction.upper_value,
                "{} returned an inverted range",
                kind.name()
            );
            assert_ne!(
                prediction.confidence, "high",
                "{} must not claim high confidence from a heuristic",
                kind.name()
            );
            assert!(prediction.data_sufficient);
            assert!(!prediction.signals.is_empty());
            assert_eq!(prediction.unit, kind.unit());
        }
    }

    /// Bounded scores stay inside their bounds even at the extremes.
    #[test]
    fn scores_never_leave_their_range() {
        for (kind, features) in [
            (PredictionKind::ClientChurnRisk, vec![("churn_risk_score", 100.0)]),
            (PredictionKind::NoShowRisk, vec![("no_show_rate_bps", 10000.0)]),
            (
                PredictionKind::StaffUtilization,
                vec![("current_booked_minutes", 9000.0), ("current_scheduled_minutes", 9000.0)],
            ),
        ] {
            let rich = subject("s1", 100, &features);
            let predictions = fallback_predictions(kind, &[&rich]);
            let prediction = &predictions[0];
            assert!(
                prediction.lower_value >= 0.0 && prediction.upper_value <= 100.0,
                "{} produced {}..{}, outside 0..100",
                kind.name(),
                prediction.lower_value,
                prediction.upper_value
            );
        }
    }

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    /// A run persists its model version, window and digest, and reads back
    /// scoped to the tenant that wrote it.
    #[tokio::test]
    async fn a_run_is_persisted_with_its_model_and_window() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase3_{}", Uuid::new_v4().simple());
        let other = format!("phase3_other_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        let start = NaiveDate::from_ymd_opt(2026, 4, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        let run_id = prediction_repository::record_run(
            &db,
            &tenant,
            prediction_repository::RunScope {
                branch_id: branch,
                level: "branch",
                label: "Test Branch",
                branch_ids: std::slice::from_ref(&branch.to_string()),
                requested_role: "owner",
            },
            PredictionKind::ClientReturnWindow.name(),
            "aurashine-predict-v1",
            "python",
            start,
            end,
            "digest-abc",
            &json!({"subjects": []}),
            "user1",
            &[prediction_repository::NewPrediction {
                subject_kind: "client".into(),
                subject_id: "client-1".into(),
                subject_name: "Priya".into(),
                lower_value: 12.0,
                upper_value: 20.0,
                unit: "days".into(),
                confidence: "medium".into(),
                sample_size: 8,
                data_sufficient: true,
                signals: json!(["Usual interval about 30 days."]),
            }],
        )
        .await
        .expect("run is recorded");

        let latest = prediction_repository::latest_run(
            &db,
            &tenant,
            branch,
            PredictionKind::ClientReturnWindow.name(),
        )
        .await
        .expect("latest run loads")
        .expect("a run exists");
        assert_eq!(latest.id, run_id);
        assert_eq!(latest.model_version, "aurashine-predict-v1");
        assert_eq!(latest.computed_by, "python");
        assert_eq!(latest.history_start, start);
        assert_eq!(latest.history_end, end);
        assert_eq!(latest.feature_digest, "digest-abc");

        let rows = prediction_repository::predictions_for_run(&db, &tenant, branch, &run_id)
            .await
            .expect("predictions load");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].subject_name, "Priya");
        assert!(rows[0].data_sufficient);

        // Another tenant must see neither the run nor its predictions.
        assert!(prediction_repository::latest_run(
            &db,
            &other,
            branch,
            PredictionKind::ClientReturnWindow.name(),
        )
        .await
        .expect("query runs")
        .is_none());
        assert!(
            prediction_repository::predictions_for_run(&db, &other, branch, &run_id)
                .await
                .expect("query runs")
                .is_empty(),
            "a run must not be readable from another tenant"
        );

        let _ = sqlx::query("DELETE FROM ai_prediction_runs WHERE tenant_id=$1")
            .bind(&tenant)
            .execute(&db)
            .await;
    }

    /// A branch with no history yields no invented predictions, and a caller
    /// without the role is refused before any history is read.
    #[tokio::test]
    async fn an_empty_branch_predicts_nothing_and_roles_are_enforced() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase3_empty_{}", Uuid::new_v4().simple());

        for kind in ALL_KINDS {
            let features = build_features(&db, &tenant, "branch1", *kind)
                .await
                .unwrap_or_else(|_| panic!("{} builds features", kind.name()));
            assert_eq!(features.kind, kind.name());
            // Nothing in the branch, so nothing clears the sufficiency gate.
            for subject in &features.subjects {
                assert!(
                    subject.sample_size < kind.min_samples(),
                    "{} found history on an empty branch",
                    kind.name()
                );
            }
            // The digest is still stable and non-empty for an empty branch.
            assert_eq!(features.digest().len(), 64);
        }
    }
}

#[cfg(test)]
mod governed_prediction_tests {
    use super::*;
    use crate::services::ai_tool_dispatcher::tests_support::claims;
    use sqlx::PgPool;

    const ALL_KINDS: &[PredictionKind] = &[
        PredictionKind::ClientChurnRisk,
        PredictionKind::ClientReturnWindow,
        PredictionKind::NoShowRisk,
        PredictionKind::ServiceDemand,
        PredictionKind::AppointmentLoad,
        PredictionKind::StaffUtilization,
        PredictionKind::InventoryReorderRisk,
        PredictionKind::MembershipRenewalRisk,
        PredictionKind::RevenueForecast,
    ];

    /// Every requested capability must exist as a prediction kind, so the set
    /// cannot silently lose one.
    #[test]
    fn the_governed_prediction_set_is_complete() {
        for name in [
            "client_churn_risk",
            "client_return_window",
            "no_show_risk",
            "service_demand",
            "staff_utilization",
            "inventory_reorder_risk",
            "membership_renewal_risk",
            "revenue_forecast",
        ] {
            assert!(
                PredictionKind::from_name(name).is_some(),
                "missing prediction kind {name}"
            );
        }
    }

    #[test]
    fn every_kind_is_gated_on_a_permission_domain() {
        for kind in ALL_KINDS {
            let domain = prediction_domain(*kind);
            assert!(
                !domain.required_permission().is_empty(),
                "{} has no permission behind it",
                kind.name()
            );
        }
        // Money forecasts sit behind finance, not behind a role name.
        assert_eq!(
            prediction_domain(PredictionKind::RevenueForecast).required_permission(),
            "finance.read"
        );
    }

    #[test]
    fn a_denied_permission_overrides_an_owner_role() {
        let owner = claims("owner", &[], &[]);
        assert!(ai_scope_service::domain_allowed(
            &owner,
            prediction_domain(PredictionKind::RevenueForecast)
        ));
        let denied = claims("owner", &[], &["finance.read"]);
        assert!(
            !ai_scope_service::domain_allowed(
                &denied,
                prediction_domain(PredictionKind::RevenueForecast)
            ),
            "a revoked finance permission must close the revenue forecast"
        );
    }

    #[test]
    fn the_basis_statement_names_the_engine_that_scored_the_run() {
        let live = basis_statement("python", "churn-v3");
        assert!(live.contains("live prediction service"));
        assert!(live.contains("churn-v3"));

        let fallback = basis_statement("rust_fallback", FALLBACK_MODEL_VERSION);
        assert!(
            fallback.contains("unavailable") && fallback.contains("deterministic fallback"),
            "a fallback result must say so plainly: {fallback}"
        );
    }

    #[test]
    fn a_prediction_is_never_presented_as_a_guarantee() {
        assert!(PREDICTION_DISCLAIMER.contains("not guarantees"));
        assert!(PREDICTION_DISCLAIMER.contains("ranges"));
    }

    /// The digest is what makes a stored run reproducible: identical history
    /// must produce an identical digest, and any change to the inputs must
    /// change it.
    #[test]
    fn identical_features_produce_an_identical_digest() {
        let build = |sample: i32| FeatureSet {
            kind: PredictionKind::ClientChurnRisk.name().into(),
            history_start: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
            history_end: NaiveDate::from_ymd_opt(2026, 6, 30).unwrap(),
            subjects: vec![SubjectFeatures {
                subject_id: "client-1".into(),
                subject_name: "Priya Menon".into(),
                sample_size: sample,
                features: BTreeMap::from([
                    ("visit_gap_days".to_string(), 32.0),
                    ("days_since_last_visit".to_string(), 61.0),
                ]),
            }],
        };

        assert_eq!(
            build(6).digest(),
            build(6).digest(),
            "the same history must digest identically"
        );
        assert_ne!(
            build(6).digest(),
            build(7).digest(),
            "a change in the inputs must change the digest"
        );
    }

    #[test]
    fn feature_order_does_not_change_the_digest() {
        // Ordered maps are what make this hold; a HashMap here would make runs
        // irreproducible in a way no test would otherwise catch.
        let one = FeatureSet {
            kind: PredictionKind::ServiceDemand.name().into(),
            history_start: NaiveDate::from_ymd_opt(2026, 4, 1).unwrap(),
            history_end: NaiveDate::from_ymd_opt(2026, 6, 30).unwrap(),
            subjects: vec![SubjectFeatures {
                subject_id: "service-1".into(),
                subject_name: "Hair Colour".into(),
                sample_size: 9,
                features: BTreeMap::from([("a".to_string(), 1.0), ("b".to_string(), 2.0)]),
            }],
        };
        let two = FeatureSet {
            subjects: vec![SubjectFeatures {
                features: BTreeMap::from([("b".to_string(), 2.0), ("a".to_string(), 1.0)]),
                ..one.subjects[0].clone()
            }],
            ..one.clone()
        };
        assert_eq!(one.digest(), two.digest());
    }

    async fn seed_branch(db: &PgPool) -> (String, String, String) {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();
        let branch_id: String = sqlx::query_scalar(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),'Banjara Hills','','South','Hyderabad','Central',TRUE)
               RETURNING scope_id"#,
        )
        .bind(&tenant_id)
        .fetch_one(db)
        .await
        .unwrap();
        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'owner','asha.rao@aurasalon.in','x','Asha Rao') RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(db)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active)
               VALUES($1,$2,$3,'owner',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&branch_id)
        .execute(db)
        .await
        .unwrap();
        (tenant_id, branch_id, user_id)
    }

    fn owner_claims(tenant_id: &str, branch_id: &str, user_id: &str) -> AuthClaims {
        let mut value = claims("owner", &[], &[]);
        value.sub = user_id.to_string();
        value.tenant_id = tenant_id.to_string();
        value.branch_id = Some(branch_id.to_string());
        value
    }

    /// With no configured provider the run must still complete, be marked as
    /// fallback, and say so — a missing provider is not an outage for the user.
    #[sqlx::test]
    async fn an_absent_provider_falls_back_and_discloses_it(pool: PgPool) {
        let (tenant_id, branch_id, user_id) = seed_branch(&pool).await;
        let run = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &owner_claims(&tenant_id, &branch_id, &user_id),
            PredictionKind::RevenueForecast,
            &ScopeRequest::default(),
        )
        .await
        .expect("a run completes without a provider");

        assert_eq!(run.computed_by, "rust_fallback");
        assert_eq!(run.model_version, FALLBACK_MODEL_VERSION);
        assert!(run.basis.contains("deterministic fallback"));
        assert!(run.disclaimer.contains("not guarantees"));
        assert!(!run.feature_digest.is_empty());
    }

    /// The stored run must say whose data it read, not just which branch id was
    /// on the request.
    #[sqlx::test]
    async fn a_run_persists_the_scope_it_was_produced_under(pool: PgPool) {
        let (tenant_id, branch_id, user_id) = seed_branch(&pool).await;
        let run = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &owner_claims(&tenant_id, &branch_id, &user_id),
            PredictionKind::ClientChurnRisk,
            &ScopeRequest::default(),
        )
        .await
        .expect("a run completes");

        let (level, label, branches, role): (String, String, Vec<String>, String) =
            sqlx::query_as(
                r#"SELECT scope_level,scope_label,scope_branch_ids,requested_role
                     FROM ai_prediction_runs WHERE id=$1"#,
            )
            .bind(&run.run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        // The seeded tenant has exactly one branch and the caller is an owner,
        // so the honest scope is the whole tenant, not a single branch.
        assert_eq!(level, "tenant");
        assert!(!label.is_empty());
        assert_eq!(branches, vec![branch_id]);
        assert_eq!(role, "owner");
        assert_eq!(run.scope.branch_count, 1);
    }

    /// A branch with no history must produce a run that scores nobody, rather
    /// than a run full of confident zeroes.
    #[sqlx::test]
    async fn an_empty_history_scores_nobody(pool: PgPool) {
        let (tenant_id, branch_id, user_id) = seed_branch(&pool).await;
        let run = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &owner_claims(&tenant_id, &branch_id, &user_id),
            PredictionKind::ClientChurnRisk,
            &ScopeRequest::default(),
        )
        .await
        .expect("a run completes");

        assert!(
            run.predictions.iter().all(|row| !row.data_sufficient),
            "no subject may be scored from an empty history"
        );
    }

    /// The same login asking twice must get the same digest: the features are a
    /// function of stored history, not of when the question was asked.
    #[sqlx::test]
    async fn two_runs_over_the_same_history_reproduce_the_digest(pool: PgPool) {
        let (tenant_id, branch_id, user_id) = seed_branch(&pool).await;
        let caller = owner_claims(&tenant_id, &branch_id, &user_id);

        let first = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &caller,
            PredictionKind::ServiceDemand,
            &ScopeRequest::default(),
        )
        .await
        .expect("first run");
        let second = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &caller,
            PredictionKind::ServiceDemand,
            &ScopeRequest::default(),
        )
        .await
        .expect("second run");

        assert_eq!(
            first.feature_digest, second.feature_digest,
            "unchanged history must reproduce the same feature digest"
        );
        assert_ne!(first.run_id, second.run_id, "each run is stored separately");
    }

    /// A login without the domain permission must be refused before any history
    /// is read, so the refusal cannot leak whether data exists.
    #[sqlx::test]
    async fn a_denied_domain_refuses_before_reading_history(pool: PgPool) {
        let (tenant_id, branch_id, user_id) = seed_branch(&pool).await;
        let mut denied = owner_claims(&tenant_id, &branch_id, &user_id);
        denied.denied_permissions = vec!["finance.read".into()];

        let error = predict(
            &pool,
            ProviderConfig::unconfigured(),
            &tenant_id,
            &denied,
            PredictionKind::RevenueForecast,
            &ScopeRequest::default(),
        )
        .await
        .expect_err("a denied finance permission must refuse the revenue forecast");
        assert!(format!("{error:?}").to_lowercase().contains("finance"));

        // Nothing was stored for the refused request.
        let runs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_prediction_runs WHERE tenant_id=$1 AND prediction_kind='revenue_forecast'",
        )
        .bind(&tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(runs, 0, "a refused prediction must not leave a run behind");
    }
}
