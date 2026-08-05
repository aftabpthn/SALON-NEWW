//! Closing the loop on a prediction: what was claimed, against what happened.
//!
//! A stored run used to be a record of a claim and nothing else. It said which
//! model produced a range and from which window, but never whether the range
//! held — so no model could be shown to be better than the deterministic
//! fallback, and a confidence label was an assertion rather than a measurement.
//!
//! Three rules govern everything below.
//!
//! * **The horizon is fixed when the prediction is made, not when it is
//!   judged.** Choosing the window afterwards would let a miss be re-framed as
//!   a hit by widening it, so `horizon_for` runs at write time and the resolver
//!   only reads what it stored.
//! * **A prediction is judged by the rule its unit deserves.** A range over
//!   bookings is judged by whether it contained the count. A 0-100 risk score
//!   describes something that either happened or did not, so it is judged on
//!   which side of the decision threshold it fell — asking whether a binary
//!   outcome landed inside a score range would be measuring nothing.
//! * **Unobservable is not wrong.** A no-show risk for a client who never
//!   booked again was never put to the test. Counting that as a miss would
//!   understate the model; dropping it silently would overstate the sample. It
//!   is recorded as unresolvable and reported separately.
//!
//! Accuracy is only stated once enough predictions have resolved to mean
//! anything. Below that floor the answer is how many are still pending, not a
//! percentage computed from four rows — the same sufficiency discipline the
//! prediction path itself applies to history.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_prediction_outcome_repository::{self as outcome_repository, DuePrediction},
    services::{
        ai_prediction_service::{prediction_domain, PredictionKind},
        ai_scope_service::{self, ScopeRequest},
        ai_tool_dispatcher,
        auth_service::AuthClaims,
    },
};

/// Predictions judged per worker cycle. A ceiling rather than a target: the
/// backlog drains oldest-horizon-first across cycles instead of turning one
/// cycle into an unbounded scan.
const RESOLVE_BATCH: i64 = 500;

/// How far back an accuracy figure looks. Six months is long enough to gather a
/// sample and short enough that a model replaced last month stops dominating it.
pub const ACCURACY_LOOKBACK_DAYS: i32 = 180;

/// Resolved predictions needed before a hit rate is stated at all.
///
/// Under this, the percentage would move by double digits on a single outcome,
/// which reads as precision the sample cannot support.
pub const MIN_RESOLVED_FOR_RATE: i64 = 20;

/// Where a risk score stops meaning "probably not" and starts meaning
/// "probably". Scores in this system are 0-100 over a binary event, so the
/// midpoint is the decision point.
const RISK_THRESHOLD: f64 = 50.0;

/// Extra days allowed past a predicted duration before the prediction is called
/// a miss. Without it, a return predicted at 30 days and observed at 31 would be
/// judged the instant the horizon passed, which measures the calendar rather
/// than the model.
const DURATION_GRACE_DAYS: i64 = 14;

/// How a prediction is judged, and therefore what a hit rate means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutcomeRule {
    /// The observed value fell inside the predicted range.
    RangeContains,
    /// The predicted score and the observed event agreed on which side of the
    /// decision threshold they were.
    DirectionMatches,
}

impl OutcomeRule {
    pub fn name(self) -> &'static str {
        match self {
            Self::RangeContains => "range_contains",
            Self::DirectionMatches => "direction_matches",
        }
    }

    /// Plain-language statement of what counted as a hit, carried alongside
    /// every rate so the number is never read without its definition.
    pub fn description(self) -> &'static str {
        match self {
            Self::RangeContains => {
                "A hit is an observed value that landed inside the predicted range."
            }
            Self::DirectionMatches => {
                "A hit is a risk score that fell on the same side of 50 as what actually happened."
            }
        }
    }
}

/// The rule a kind is judged by, decided by what its unit actually describes.
pub fn outcome_rule(kind: PredictionKind) -> OutcomeRule {
    match kind {
        // Risk scores stand in for an event that either happened or did not.
        PredictionKind::ClientChurnRisk
        | PredictionKind::NoShowRisk
        | PredictionKind::MembershipRenewalRisk => OutcomeRule::DirectionMatches,
        PredictionKind::ClientReturnWindow
        | PredictionKind::ServiceDemand
        | PredictionKind::AppointmentLoad
        | PredictionKind::StaffUtilization
        | PredictionKind::InventoryReorderRisk
        | PredictionKind::RevenueForecast => OutcomeRule::RangeContains,
    }
}

/// The date a prediction becomes checkable.
///
/// Kinds that predict a *duration* derive their horizon from the range itself
/// plus a grace period, so that a prediction which has not come true by then has
/// definitively missed high rather than merely being unfinished. Kinds that
/// predict a *level* over a period use a fixed window matching the period the
/// range describes.
pub fn horizon_for(kind: PredictionKind, predicted_on: NaiveDate, upper_value: f64) -> NaiveDate {
    let days = match kind {
        // Duration predictions: judged once the predicted span has run out.
        PredictionKind::ClientReturnWindow | PredictionKind::InventoryReorderRisk => {
            upper_value.max(0.0).ceil() as i64 + DURATION_GRACE_DAYS
        }
        // Level predictions: the window the projected figure describes.
        PredictionKind::ServiceDemand | PredictionKind::StaffUtilization => 90,
        PredictionKind::ClientChurnRisk => 90,
        PredictionKind::MembershipRenewalRisk => 60,
        PredictionKind::NoShowRisk => 45,
        PredictionKind::AppointmentLoad | PredictionKind::RevenueForecast => 30,
    };
    // A horizon far enough out to be unreachable would leave rows pending
    // forever, so duration kinds are capped at a year.
    predicted_on + Duration::days(days.clamp(1, 365))
}

/// What was observed, and any caveat that belongs on the record.
struct Observation {
    value: f64,
    note: String,
}

impl Observation {
    fn plain(value: f64) -> Self {
        Self {
            value,
            note: String::new(),
        }
    }

    fn with_note(value: f64, note: impl Into<String>) -> Self {
        Self {
            value,
            note: note.into(),
        }
    }
}

/// The verdict on one prediction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Verdict {
    pub hit: bool,
    /// Distance from the range, zero when the observation landed inside it.
    pub error: f64,
}

/// Applies a kind's rule to one observation.
///
/// Pure on purpose: every judging rule is testable without a database, which is
/// what keeps the definition of "correct" honest as kinds are added.
pub fn judge(rule: OutcomeRule, lower: f64, upper: f64, actual: f64) -> Verdict {
    match rule {
        OutcomeRule::RangeContains => {
            if actual >= lower && actual <= upper {
                Verdict {
                    hit: true,
                    error: 0.0,
                }
            } else {
                let distance = if actual < lower {
                    lower - actual
                } else {
                    actual - upper
                };
                Verdict {
                    hit: false,
                    error: distance,
                }
            }
        }
        OutcomeRule::DirectionMatches => {
            let midpoint = (lower + upper) / 2.0;
            Verdict {
                // Both sides are compared against the same threshold, so a
                // score of exactly 50 predicts the event and is judged as such.
                hit: (midpoint >= RISK_THRESHOLD) == (actual >= RISK_THRESHOLD),
                error: (midpoint - actual).abs(),
            }
        }
    }
}

/// Resolves every prediction whose horizon has passed.
///
/// One failing subject never stops the batch: a client whose branch data has
/// since been archived should not hold up the accuracy of eight other kinds.
pub async fn run_outcome_resolution_worker(db: &PgPool) -> Result<usize, AppError> {
    let due = outcome_repository::due_predictions(db, RESOLVE_BATCH)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to list predictions due for resolution");
            AppError::internal("failed to list predictions due for resolution")
        })?;

    let mut resolved = 0_usize;
    for prediction in due {
        let Some(kind) = PredictionKind::from_name(&prediction.prediction_kind) else {
            // A kind removed from the binary can never be judged again, and
            // leaving the row pending would make it a permanent backlog entry.
            let _ = outcome_repository::record_unresolvable(
                db,
                &prediction.id,
                "This prediction kind is no longer computed, so it cannot be checked.",
            )
            .await;
            continue;
        };

        match observe(db, kind, &prediction).await {
            Ok(Some(observation)) => {
                let rule = outcome_rule(kind);
                let verdict = judge(
                    rule,
                    prediction.lower_value,
                    prediction.upper_value,
                    observation.value,
                );
                if let Err(error) = outcome_repository::record_outcome(
                    db,
                    &prediction.id,
                    rule.name(),
                    observation.value,
                    verdict.hit,
                    verdict.error,
                    &observation.note,
                )
                .await
                {
                    tracing::error!(%error, prediction_id = %prediction.id, "failed to record outcome");
                    continue;
                }
                resolved += 1;
            }
            Ok(None) => {
                if let Err(error) = outcome_repository::record_unresolvable(
                    db,
                    &prediction.id,
                    unresolvable_reason(kind),
                )
                .await
                {
                    tracing::error!(%error, prediction_id = %prediction.id, "failed to close prediction");
                    continue;
                }
                resolved += 1;
            }
            Err(error) => {
                tracing::warn!(
                    prediction_id = %prediction.id,
                    kind = kind.name(),
                    error = error.message(),
                    "could not observe an outcome; leaving it pending for the next cycle"
                );
            }
        }
    }
    Ok(resolved)
}

/// Why a kind's truth can fail to be observable at all.
fn unresolvable_reason(kind: PredictionKind) -> &'static str {
    match kind {
        PredictionKind::NoShowRisk => {
            "The client had no appointment in the window, so the risk was never tested."
        }
        PredictionKind::MembershipRenewalRisk => {
            "The membership record no longer exists, which is neither a renewal nor a lapse."
        }
        PredictionKind::StaffUtilization => {
            "The staff member was not rostered in the window, so utilisation is undefined."
        }
        PredictionKind::RevenueForecast => "The branch recorded no trading day in the window.",
        PredictionKind::InventoryReorderRisk => {
            "The item's stock at prediction time was not recorded, so cover cannot be checked."
        }
        _ => "The outcome did not become observable within the horizon.",
    }
}

/// Reads what actually happened for one prediction.
///
/// `Ok(None)` means the truth never became observable. `Err` means the read
/// failed and the row stays pending for the next cycle — the difference matters,
/// because one is a fact about the business and the other is a fact about the
/// database being briefly unavailable.
async fn observe(
    db: &PgPool,
    kind: PredictionKind,
    prediction: &DuePrediction,
) -> Result<Option<Observation>, AppError> {
    let from = prediction.predicted_at;
    // The horizon is a date; the window closes at the end of it.
    let until = horizon_instant(prediction.horizon_end);
    let tenant = prediction.tenant_id.as_str();
    let branch = prediction.branch_id.as_str();
    let subject = prediction.subject_id.as_str();
    let read = |what: &'static str| move |_| AppError::internal(what);

    let observation = match kind {
        PredictionKind::ClientChurnRisk => {
            let returned =
                outcome_repository::first_visit_after(db, tenant, branch, subject, from, until)
                    .await
                    .map_err(read("failed to read client visits"))?
                    .is_some();
            // Churn risk is scored 0-100; the observation is the event itself,
            // expressed on the same scale so the two are comparable.
            if returned {
                Observation::with_note(0.0, "The client returned within the horizon.")
            } else {
                Observation::with_note(100.0, "The client did not return within the horizon.")
            }
        }
        PredictionKind::ClientReturnWindow => {
            match outcome_repository::first_visit_after(db, tenant, branch, subject, from, until)
                .await
                .map_err(read("failed to read client visits"))?
            {
                Some(visited_at) => Observation::plain(days_between(from, visited_at)),
                // Still not back when the horizon expired. The true wait is
                // unknown, but it is already longer than the range's upper
                // bound, so the prediction has definitively missed high and the
                // elapsed time is recorded as the floor it is.
                None => Observation::with_note(
                    days_between(from, until),
                    "The client had still not returned when the horizon expired; the observed wait is a floor, not an exact value.",
                ),
            }
        }
        PredictionKind::NoShowRisk => {
            let Some(no_show) = outcome_repository::next_appointment_was_no_show(
                db, tenant, branch, subject, from, until,
            )
            .await
            .map_err(read("failed to read client appointments"))?
            else {
                return Ok(None);
            };
            if no_show {
                Observation::with_note(100.0, "The next appointment was a no-show.")
            } else {
                Observation::with_note(0.0, "The next appointment was attended.")
            }
        }
        PredictionKind::ServiceDemand => Observation::plain(
            outcome_repository::service_units_sold(db, tenant, branch, subject, from, until)
                .await
                .map_err(read("failed to read service sales"))?,
        ),
        PredictionKind::StaffUtilization => {
            let Some(percent) = outcome_repository::staff_utilization_percent(
                db, tenant, branch, subject, from, until,
            )
            .await
            .map_err(read("failed to read staff utilisation"))?
            else {
                return Ok(None);
            };
            Observation::plain(percent)
        }
        PredictionKind::AppointmentLoad => {
            let completed =
                outcome_repository::completed_appointments(db, tenant, branch, from, until)
                    .await
                    .map_err(read("failed to read appointment load"))?;
            let days = days_between(from, until).max(1.0);
            // The prediction is a daily rate, so the observation must be one too.
            Observation::plain(completed / days)
        }
        PredictionKind::RevenueForecast => {
            let Some(mean) =
                outcome_repository::mean_daily_revenue_paise(db, tenant, branch, from, until)
                    .await
                    .map_err(read("failed to read branch revenue"))?
            else {
                return Ok(None);
            };
            Observation::plain(mean)
        }
        PredictionKind::InventoryReorderRisk => {
            let Some(opening_stock) = prediction.opening_stock else {
                return Ok(None);
            };
            match outcome_repository::days_until_stock_exhausted(
                db,
                tenant,
                branch,
                subject,
                opening_stock,
                from,
                until,
            )
            .await
            .map_err(read("failed to read stock movements"))?
            {
                Some(days) => Observation::plain(days),
                // Same censoring as the return window: cover outlasted the
                // horizon, so the observation is a floor and already above the
                // predicted upper bound.
                None => Observation::with_note(
                    days_between(from, until),
                    "Stock had not been exhausted when the horizon expired; the observed cover is a floor, not an exact value.",
                ),
            }
        }
        PredictionKind::MembershipRenewalRisk => {
            let Some(still_active) =
                outcome_repository::membership_still_active(db, tenant, branch, subject)
                    .await
                    .map_err(read("failed to read the membership"))?
            else {
                return Ok(None);
            };
            if still_active {
                Observation::with_note(0.0, "The membership was renewed.")
            } else {
                Observation::with_note(100.0, "The membership lapsed.")
            }
        }
    };
    Ok(Some(observation))
}

/// The instant a horizon date closes.
fn horizon_instant(horizon_end: NaiveDate) -> DateTime<Utc> {
    horizon_end
        .and_hms_opt(23, 59, 59)
        .map(|naive| naive.and_utc())
        .unwrap_or_else(Utc::now)
}

fn days_between(from: DateTime<Utc>, to: DateTime<Utc>) -> f64 {
    (to - from).num_seconds() as f64 / 86_400.0
}

/// One model's measured record for a kind.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelAccuracy {
    pub model_version: String,
    /// `python` or `rust_fallback`, so a live model and the fallback are never
    /// pooled into one figure.
    pub computed_by: String,
    pub resolved: i64,
    pub hits: i64,
    /// Withheld below `MIN_RESOLVED_FOR_RATE` rather than shown as a percentage
    /// derived from a handful of rows.
    pub hit_rate_percent: Option<f64>,
    pub mean_error: Option<f64>,
}

/// A kind's measured accuracy, as it is shown next to its predictions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionAccuracy {
    pub kind: String,
    pub unit: String,
    pub lookback_days: i32,
    pub resolved: i64,
    pub hits: i64,
    pub pending: i64,
    /// Predictions whose truth never became observable. Reported because a
    /// large number here says the kind is being asked about subjects it cannot
    /// be checked against, which a hit rate alone would hide.
    pub unresolvable: i64,
    pub hit_rate_percent: Option<f64>,
    pub mean_error: Option<f64>,
    pub rule: String,
    pub rule_description: String,
    pub by_model: Vec<ModelAccuracy>,
    /// The whole thing in one sentence, so a caller cannot render the number
    /// without the caveat attached to it.
    pub statement: String,
}

fn hit_rate(resolved: i64, hits: i64) -> Option<f64> {
    if resolved < MIN_RESOLVED_FOR_RATE {
        return None;
    }
    Some((hits as f64 / resolved as f64) * 100.0)
}

/// Hit rate above which a kind may claim high confidence.
///
/// A model that is right four times in five has earned the word. Below it,
/// "high" would be the code asserting something the record does not support.
pub const HIGH_CONFIDENCE_HIT_RATE: f64 = 80.0;

/// Hit rate below which nothing from this kind may claim better than low.
///
/// At worse than a coin flip the range is not evidence, however sure the model
/// that produced it sounds.
pub const LOW_CONFIDENCE_HIT_RATE: f64 = 50.0;

/// Adjusts a claimed confidence to what the kind's record actually supports.
///
/// Confidence used to be an assertion by whichever engine produced the range —
/// nothing in the system could contradict it. This makes it a measurement:
///
/// * With no measured record, `high` is capped to `medium`. A model with no
///   track record cannot claim the strongest word in the vocabulary; it can
///   still say `medium`, because the sample-size heuristic behind it is real.
/// * A measured hit rate at or above the bar leaves the claim alone.
/// * A measured hit rate below half floors everything at `low`.
///
/// It never *raises* a claim. A model that called its own answer `low` knows
/// something about that particular subject the aggregate does not.
pub fn confidence_supported_by(claimed: &str, accuracy: &PredictionAccuracy) -> String {
    let claimed = claimed.trim().to_ascii_lowercase();
    match accuracy.hit_rate_percent {
        Some(rate) if rate < LOW_CONFIDENCE_HIT_RATE => "low".to_string(),
        Some(rate) if rate >= HIGH_CONFIDENCE_HIT_RATE => claimed,
        // Measured, but not well enough to support the strongest word.
        Some(_) if claimed == "high" => "medium".to_string(),
        Some(_) => claimed,
        // Not measured yet.
        None if claimed == "high" => "medium".to_string(),
        None => claimed,
    }
}

/// Measured accuracy for one kind, over the branches this login may read.
///
/// The scope chain runs first and unchanged: an accuracy figure is built from
/// the same predictions the caller would have been allowed to see, so it cannot
/// become a side channel onto another branch's performance.
pub async fn accuracy(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    kind: PredictionKind,
    scope_request: &ScopeRequest,
) -> Result<PredictionAccuracy, AppError> {
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, scope_request).await?;
    ai_scope_service::require_domain(claims, prediction_domain(kind))?;
    let branch_ids = scope.branch_ids();
    if branch_ids.is_empty() {
        return Err(AppError::forbidden(
            "no branch is authorized for this login",
        ));
    }

    accuracy_for_branches(db, tenant_id, kind, &branch_ids).await
}

/// Accuracy over an already-resolved branch set.
///
/// The prediction path has done the scope work by the time it wants this, and
/// resolving a second time would both cost a query and open the possibility of
/// the two resolutions disagreeing. Callers that have not resolved yet go
/// through `accuracy` instead — this one trusts its input and must only ever be
/// handed branches the login already reached.
pub async fn accuracy_for_branches(
    db: &PgPool,
    tenant_id: &str,
    kind: PredictionKind,
    branch_ids: &[String],
) -> Result<PredictionAccuracy, AppError> {
    let rows = outcome_repository::accuracy_for_kind(
        db,
        tenant_id,
        branch_ids,
        kind.name(),
        ACCURACY_LOOKBACK_DAYS,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, kind = kind.name(), "failed to read prediction accuracy");
        AppError::internal("failed to read prediction accuracy")
    })?;

    Ok(summarize(kind, rows))
}

/// Folds the per-model rows into the figure shown next to a prediction.
///
/// Separated from the query so the reporting rules — when a rate is withheld,
/// how the sentence reads — are testable without a database.
pub fn summarize(
    kind: PredictionKind,
    rows: Vec<outcome_repository::AccuracyRecord>,
) -> PredictionAccuracy {
    let resolved: i64 = rows.iter().map(|row| row.resolved).sum();
    let hits: i64 = rows.iter().map(|row| row.hits).sum();
    let pending: i64 = rows.iter().map(|row| row.pending).sum();
    let unresolvable: i64 = rows.iter().map(|row| row.unresolvable).sum();

    // Weighted by resolved count, so a model with three outcomes cannot move
    // the overall error as much as one with three hundred.
    let mean_error = if resolved > 0 {
        let total: f64 = rows
            .iter()
            .filter_map(|row| row.mean_error.map(|error| error * row.resolved as f64))
            .sum();
        Some(total / resolved as f64)
    } else {
        None
    };

    let rule = outcome_rule(kind);
    let rate = hit_rate(resolved, hits);
    let statement = match rate {
        Some(percent) => format!(
            "{percent:.0}% of {resolved} checked predictions were correct over the last {ACCURACY_LOOKBACK_DAYS} days. {}",
            rule.description()
        ),
        None if pending > 0 => format!(
            "Not enough predictions have been checked yet to state accuracy: {resolved} resolved of the {MIN_RESOLVED_FOR_RATE} needed, {pending} still within their horizon."
        ),
        None => format!(
            "Not enough predictions have been checked yet to state accuracy: {resolved} resolved of the {MIN_RESOLVED_FOR_RATE} needed."
        ),
    };

    PredictionAccuracy {
        kind: kind.name().into(),
        unit: kind.unit().into(),
        lookback_days: ACCURACY_LOOKBACK_DAYS,
        resolved,
        hits,
        pending,
        unresolvable,
        hit_rate_percent: rate,
        mean_error,
        rule: rule.name().into(),
        rule_description: rule.description().into(),
        by_model: rows
            .into_iter()
            .map(|row| ModelAccuracy {
                hit_rate_percent: hit_rate(row.resolved, row.hits),
                model_version: row.model_version,
                computed_by: row.computed_by,
                resolved: row.resolved,
                hits: row.hits,
                mean_error: row.mean_error,
            })
            .collect(),
        statement,
    }
}

/// The outcome loop's guarantees.
///
/// These cover what makes a measured accuracy trustworthy rather than merely
/// present: the horizon cannot be chosen after the fact, a binary event is not
/// judged as though it were a range, an unobservable outcome is not a miss, and
/// a rate is not stated from a sample too small to support it.
#[cfg(test)]
mod outcome_tests {
    use super::*;
    use crate::repositories::ai_prediction_outcome_repository::AccuracyRecord;

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

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 1, 1).expect("valid date")
    }

    #[test]
    fn every_kind_has_a_reachable_horizon() {
        for kind in ALL_KINDS {
            let horizon = horizon_for(*kind, today(), 30.0);
            assert!(
                horizon > today(),
                "{} must be checkable after the day it was predicted",
                kind.name()
            );
            assert!(
                horizon <= today() + Duration::days(365),
                "{} must not defer its own judgement beyond a year",
                kind.name()
            );
        }
    }

    /// A duration prediction has to outlive its own upper bound, or a range that
    /// was going to be wrong would be judged before it had a chance to be right.
    #[test]
    fn duration_horizons_extend_past_the_predicted_upper_bound() {
        for kind in [
            PredictionKind::ClientReturnWindow,
            PredictionKind::InventoryReorderRisk,
        ] {
            let horizon = horizon_for(kind, today(), 40.0);
            assert!(
                horizon > today() + Duration::days(40),
                "{} must wait past its own upper bound before judging",
                kind.name()
            );
        }
    }

    /// A horizon that could land in the past would let a prediction be judged
    /// against a window that had already closed.
    #[test]
    fn a_negative_upper_bound_cannot_pull_the_horizon_backwards() {
        let horizon = horizon_for(PredictionKind::ClientReturnWindow, today(), -100.0);
        assert!(horizon > today());
    }

    #[test]
    fn a_range_hit_is_inside_the_bounds_and_carries_no_error() {
        let verdict = judge(OutcomeRule::RangeContains, 10.0, 20.0, 15.0);
        assert!(verdict.hit);
        assert_eq!(verdict.error, 0.0);
    }

    #[test]
    fn a_range_miss_records_its_distance_from_the_nearer_bound() {
        let low = judge(OutcomeRule::RangeContains, 10.0, 20.0, 4.0);
        assert!(!low.hit);
        assert_eq!(low.error, 6.0);

        let high = judge(OutcomeRule::RangeContains, 10.0, 20.0, 26.0);
        assert!(!high.hit);
        assert_eq!(high.error, 6.0);
    }

    /// The bounds themselves are inside the range the caller was shown.
    #[test]
    fn a_value_exactly_on_a_bound_is_a_hit() {
        assert!(judge(OutcomeRule::RangeContains, 10.0, 20.0, 10.0).hit);
        assert!(judge(OutcomeRule::RangeContains, 10.0, 20.0, 20.0).hit);
    }

    /// A high risk score followed by the event, and a low one followed by
    /// nothing, are both the model being right.
    #[test]
    fn a_risk_score_is_judged_on_the_side_it_fell() {
        assert!(judge(OutcomeRule::DirectionMatches, 70.0, 90.0, 100.0).hit);
        assert!(judge(OutcomeRule::DirectionMatches, 5.0, 15.0, 0.0).hit);
        assert!(!judge(OutcomeRule::DirectionMatches, 70.0, 90.0, 0.0).hit);
        assert!(!judge(OutcomeRule::DirectionMatches, 5.0, 15.0, 100.0).hit);
    }

    /// Judging a binary event by whether it landed inside a score range would
    /// call a correct high-risk warning a miss, because 100 is not inside 70-90.
    #[test]
    fn a_binary_outcome_is_never_judged_as_a_range() {
        let as_range = judge(OutcomeRule::RangeContains, 70.0, 90.0, 100.0);
        let as_direction = judge(OutcomeRule::DirectionMatches, 70.0, 90.0, 100.0);
        assert!(!as_range.hit);
        assert!(as_direction.hit);
    }

    #[test]
    fn risk_kinds_are_judged_by_direction_and_quantities_by_range() {
        for kind in ALL_KINDS {
            let expected = match kind {
                PredictionKind::ClientChurnRisk
                | PredictionKind::NoShowRisk
                | PredictionKind::MembershipRenewalRisk => OutcomeRule::DirectionMatches,
                _ => OutcomeRule::RangeContains,
            };
            assert_eq!(outcome_rule(*kind), expected, "{}", kind.name());
        }
    }

    fn record(resolved: i64, hits: i64, pending: i64, unresolvable: i64) -> AccuracyRecord {
        AccuracyRecord {
            model_version: "rust-deterministic-v1".into(),
            computed_by: "rust_fallback".into(),
            resolved,
            hits,
            pending,
            unresolvable,
            mean_error: Some(2.0),
        }
    }

    #[test]
    fn a_rate_is_withheld_until_enough_predictions_have_resolved() {
        let summary = summarize(PredictionKind::ServiceDemand, vec![record(4, 4, 12, 0)]);
        assert!(summary.hit_rate_percent.is_none());
        assert!(summary.statement.contains("Not enough"));
        assert!(summary.statement.contains("12 still within their horizon"));
    }

    #[test]
    fn a_rate_is_stated_once_the_sample_supports_it() {
        let summary = summarize(PredictionKind::ServiceDemand, vec![record(40, 30, 5, 3)]);
        assert_eq!(summary.hit_rate_percent, Some(75.0));
        assert_eq!(summary.unresolvable, 3);
        assert!(summary.statement.contains("75%"));
        // The definition of a hit travels with the number.
        assert!(summary.statement.contains("inside the predicted range"));
    }

    /// An unobservable outcome is reported, but it is not a miss: including it
    /// in the denominator would make a model look worse for subjects it was
    /// never tested on.
    #[test]
    fn unresolvable_predictions_stay_out_of_the_rate() {
        let summary = summarize(PredictionKind::NoShowRisk, vec![record(20, 20, 0, 500)]);
        assert_eq!(summary.hit_rate_percent, Some(100.0));
        assert_eq!(summary.unresolvable, 500);
    }

    /// Two models are reported side by side, never pooled — otherwise a strong
    /// live model would be masked by the fallback that covered its outages.
    #[test]
    fn models_are_reported_separately_as_well_as_together() {
        let mut fallback = record(20, 10, 0, 0);
        fallback.mean_error = Some(10.0);
        let mut live = AccuracyRecord {
            model_version: "python-v2".into(),
            computed_by: "python".into(),
            ..record(80, 72, 0, 0)
        };
        live.mean_error = Some(2.0);

        let summary = summarize(PredictionKind::ServiceDemand, vec![live, fallback]);
        assert_eq!(summary.resolved, 100);
        assert_eq!(summary.hit_rate_percent, Some(82.0));
        assert_eq!(summary.by_model.len(), 2);
        assert_eq!(summary.by_model[0].hit_rate_percent, Some(90.0));
        assert_eq!(summary.by_model[1].hit_rate_percent, Some(50.0));
        // Weighted by resolved count: (2*80 + 10*20)/100.
        assert_eq!(summary.mean_error, Some(3.6));
    }

    /// A per-model rate obeys the same floor as the overall one.
    #[test]
    fn a_thin_model_row_states_no_rate_of_its_own() {
        let summary = summarize(
            PredictionKind::ServiceDemand,
            vec![record(30, 24, 0, 0), record(3, 3, 0, 0)],
        );
        assert_eq!(summary.by_model[0].hit_rate_percent, Some(80.0));
        assert!(summary.by_model[1].hit_rate_percent.is_none());
    }

    fn accuracy_with(resolved: i64, hits: i64) -> PredictionAccuracy {
        summarize(
            PredictionKind::ServiceDemand,
            vec![record(resolved, hits, 0, 0)],
        )
    }

    /// A model with no checked record cannot claim the strongest word. It can
    /// still say medium, because the sample-size heuristic behind that is real.
    #[test]
    fn an_unmeasured_kind_cannot_claim_high_confidence() {
        let none = accuracy_with(0, 0);
        assert_eq!(confidence_supported_by("high", &none), "medium");
        assert_eq!(confidence_supported_by("medium", &none), "medium");
        assert_eq!(confidence_supported_by("low", &none), "low");
    }

    /// A measured record at or above the bar leaves the claim as made.
    #[test]
    fn a_strong_record_supports_the_claim_it_was_given() {
        let strong = accuracy_with(100, 85);
        assert_eq!(confidence_supported_by("high", &strong), "high");
        assert_eq!(confidence_supported_by("medium", &strong), "medium");
    }

    /// Measured, but not well enough for the strongest word.
    #[test]
    fn a_middling_record_caps_high_at_medium() {
        let middling = accuracy_with(100, 70);
        assert_eq!(confidence_supported_by("high", &middling), "medium");
        assert_eq!(confidence_supported_by("medium", &middling), "medium");
    }

    /// Worse than a coin flip floors everything, however sure the model sounded.
    #[test]
    fn a_failing_record_floors_every_claim_at_low() {
        let failing = accuracy_with(100, 30);
        assert_eq!(confidence_supported_by("high", &failing), "low");
        assert_eq!(confidence_supported_by("medium", &failing), "low");
    }

    /// It never raises a claim: a model that called its own answer low knows
    /// something about that subject the aggregate does not.
    #[test]
    fn measured_accuracy_never_raises_a_modest_claim() {
        assert_eq!(
            confidence_supported_by("low", &accuracy_with(100, 99)),
            "low"
        );
    }

    #[test]
    fn a_kind_with_nothing_recorded_states_no_accuracy() {
        let summary = summarize(PredictionKind::RevenueForecast, Vec::new());
        assert_eq!(summary.resolved, 0);
        assert!(summary.hit_rate_percent.is_none());
        assert!(summary.mean_error.is_none());
        assert!(summary.by_model.is_empty());
    }

    // -----------------------------------------------------------------------
    // The resolver itself, against a real database. These need `DATABASE_URL`
    // and skip without it, matching the prediction service's own DB tests.
    // -----------------------------------------------------------------------

    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    /// Seeds one prediction whose horizon has already passed.
    ///
    /// `predicted_days_ago` places the run in the past so the resolver has a
    /// real forward window to read, which is the only way to exercise the
    /// observation queries as they will actually run.
    async fn seed_due_prediction(
        db: &PgPool,
        tenant: &str,
        branch: &str,
        kind: PredictionKind,
        subject_id: &str,
        lower: f64,
        upper: f64,
        predicted_days_ago: i64,
    ) -> String {
        let run_id = Uuid::new_v4().to_string();
        let predicted_at = Utc::now() - Duration::days(predicted_days_ago);
        sqlx::query(
            r#"INSERT INTO ai_prediction_runs(id,tenant_id,branch_id,prediction_kind,model_version,
                  computed_by,history_start,history_end,feature_digest,features,requested_by,created_at)
               VALUES ($1,$2,$3,$4,'test-model','python',$5::DATE - 90,$5::DATE,'digest',
                  '{"subjects":[]}'::JSONB,'tester',$5)"#,
        )
        .bind(&run_id)
        .bind(tenant)
        .bind(branch)
        .bind(kind.name())
        .bind(predicted_at)
        .execute(db)
        .await
        .expect("run is seeded");

        let prediction_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO ai_predictions(id,tenant_id,branch_id,run_id,subject_kind,subject_id,
                  subject_name,lower_value,upper_value,unit,confidence,sample_size,data_sufficient,
                  signals,horizon_end,outcome_status,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,'Test subject',$7,$8,$9,'medium',10,TRUE,'[]'::JSONB,
                  CURRENT_DATE - 1,'pending',$10)"#,
        )
        .bind(&prediction_id)
        .bind(tenant)
        .bind(branch)
        .bind(&run_id)
        .bind(kind.subject_kind())
        .bind(subject_id)
        .bind(lower)
        .bind(upper)
        .bind(kind.unit())
        .bind(predicted_at)
        .execute(db)
        .await
        .expect("prediction is seeded");
        prediction_id
    }

    async fn outcome_of(db: &PgPool, prediction_id: &str) -> (String, Option<bool>, Option<f64>) {
        sqlx::query_as(
            r#"SELECT outcome_status, outcome_hit, actual_value::FLOAT8
                 FROM ai_predictions WHERE id=$1"#,
        )
        .bind(prediction_id)
        .fetch_one(db)
        .await
        .expect("the prediction is readable")
    }

    /// The loop end to end: a client came back inside the predicted window, and
    /// the stored prediction is marked correct with the observed wait recorded.
    #[tokio::test]
    async fn a_prediction_is_judged_against_what_actually_happened() {
        let Some(db) = connect().await else { return };
        let tenant = format!("outcome_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = format!("client_{}", Uuid::new_v4().simple());

        // The visit lands first. The resolver is global by design — it drains
        // every due prediction, not this test's — so seeding the truth before
        // the prediction is what keeps a concurrently running test from
        // resolving this row against a history that has not been written yet.
        let visit_at = Utc::now() - Duration::days(45);
        sqlx::query(
            r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,start_at,end_at,status)
               VALUES ($1,$2,$3,$4,$5,$5 + INTERVAL '45 minutes','completed')"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant)
        .bind(branch)
        .bind(&client)
        .bind(visit_at)
        .execute(&db)
        .await
        .expect("visit is recorded");

        // Predicted 60 days ago: the client would return in 10-20 days. They
        // actually came back on day 15 — inside the range.
        let prediction_id = seed_due_prediction(
            &db,
            &tenant,
            branch,
            PredictionKind::ClientReturnWindow,
            &client,
            10.0,
            20.0,
            60,
        )
        .await;

        run_outcome_resolution_worker(&db)
            .await
            .expect("the resolver runs");

        let (status, hit, actual) = outcome_of(&db, &prediction_id).await;
        assert_eq!(status, "resolved");
        assert_eq!(hit, Some(true));
        let actual = actual.expect("an observation was recorded");
        assert!(
            (14.0..=16.0).contains(&actual),
            "the observed wait should be about 15 days, got {actual}"
        );
    }

    /// A range the outcome fell outside of is recorded as a miss, with the
    /// distance kept so a near miss is distinguishable from a wild one.
    #[tokio::test]
    async fn a_missed_range_records_the_distance_it_missed_by() {
        let Some(db) = connect().await else { return };
        let tenant = format!("outcome_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = format!("client_{}", Uuid::new_v4().simple());

        // As above, the truth is written before the prediction that will be
        // judged against it.
        sqlx::query(
            r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,start_at,end_at,status)
               VALUES ($1,$2,$3,$4,$5,$5 + INTERVAL '45 minutes','completed')"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant)
        .bind(branch)
        .bind(&client)
        .bind(Utc::now() - Duration::days(20))
        .execute(&db)
        .await
        .expect("visit is recorded");

        // Predicted a return within 2-5 days, 60 days ago. They came back on
        // day 40 instead.
        let prediction_id = seed_due_prediction(
            &db,
            &tenant,
            branch,
            PredictionKind::ClientReturnWindow,
            &client,
            2.0,
            5.0,
            60,
        )
        .await;

        run_outcome_resolution_worker(&db)
            .await
            .expect("the resolver runs");

        let (status, hit, _) = outcome_of(&db, &prediction_id).await;
        assert_eq!(status, "resolved");
        assert_eq!(hit, Some(false));

        let error: Option<f64> =
            sqlx::query_scalar("SELECT outcome_error::FLOAT8 FROM ai_predictions WHERE id=$1")
                .bind(&prediction_id)
                .fetch_one(&db)
                .await
                .expect("the error is readable");
        // Observed ~40 days against an upper bound of 5.
        assert!(error.unwrap_or_default() > 30.0);
    }

    /// A no-show risk for a client who never booked again was never put to the
    /// test. It must be closed as unresolvable, not counted against the model.
    #[tokio::test]
    async fn an_untested_risk_is_closed_as_unresolvable_rather_than_wrong() {
        let Some(db) = connect().await else { return };
        let tenant = format!("outcome_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = format!("client_{}", Uuid::new_v4().simple());

        let prediction_id = seed_due_prediction(
            &db,
            &tenant,
            branch,
            PredictionKind::NoShowRisk,
            &client,
            70.0,
            90.0,
            60,
        )
        .await;

        run_outcome_resolution_worker(&db)
            .await
            .expect("the resolver runs");

        let (status, hit, actual) = outcome_of(&db, &prediction_id).await;
        assert_eq!(status, "unresolvable");
        assert!(hit.is_none(), "an untested risk is neither right nor wrong");
        assert!(actual.is_none());

        // And it stays out of the rate while still being reported.
        let summary = accuracy_for_branches(
            &db,
            &tenant,
            PredictionKind::NoShowRisk,
            std::slice::from_ref(&branch.to_string()),
        )
        .await
        .expect("accuracy reads");
        assert_eq!(summary.resolved, 0);
        assert_eq!(summary.unresolvable, 1);
        assert!(summary.hit_rate_percent.is_none());
    }

    /// A high churn risk followed by silence is the model being right, even
    /// though 100 is nowhere inside the 70-90 score range it predicted.
    #[tokio::test]
    async fn a_correct_churn_warning_is_scored_as_a_hit() {
        let Some(db) = connect().await else { return };
        let tenant = format!("outcome_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = format!("client_{}", Uuid::new_v4().simple());

        let prediction_id = seed_due_prediction(
            &db,
            &tenant,
            branch,
            PredictionKind::ClientChurnRisk,
            &client,
            70.0,
            90.0,
            120,
        )
        .await;

        run_outcome_resolution_worker(&db)
            .await
            .expect("the resolver runs");

        let (status, hit, actual) = outcome_of(&db, &prediction_id).await;
        assert_eq!(status, "resolved");
        assert_eq!(hit, Some(true), "the client never returned, as warned");
        assert_eq!(actual, Some(100.0));
    }

    /// Running twice must not re-judge anything: a verdict is written once, so
    /// a restarted worker cannot rewrite history with a longer window.
    #[tokio::test]
    async fn a_resolved_prediction_is_never_judged_again() {
        let Some(db) = connect().await else { return };
        let tenant = format!("outcome_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = format!("client_{}", Uuid::new_v4().simple());

        let prediction_id = seed_due_prediction(
            &db,
            &tenant,
            branch,
            PredictionKind::ClientChurnRisk,
            &client,
            70.0,
            90.0,
            120,
        )
        .await;

        run_outcome_resolution_worker(&db).await.expect("first run");
        let first: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT resolved_at FROM ai_predictions WHERE id=$1")
                .bind(&prediction_id)
                .fetch_one(&db)
                .await
                .expect("resolved_at is readable");

        // The client comes back after the horizon closed. The verdict must not
        // move: it was judged on the window it was given.
        sqlx::query(
            r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,start_at,end_at,status)
               VALUES ($1,$2,$3,$4,NOW(),NOW() + INTERVAL '45 minutes','completed')"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&tenant)
        .bind(branch)
        .bind(&client)
        .execute(&db)
        .await
        .expect("late visit is recorded");

        run_outcome_resolution_worker(&db)
            .await
            .expect("second run");
        let second: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT resolved_at FROM ai_predictions WHERE id=$1")
                .bind(&prediction_id)
                .fetch_one(&db)
                .await
                .expect("resolved_at is readable");

        assert_eq!(first, second, "a verdict must be written exactly once");
        let (_, hit, _) = outcome_of(&db, &prediction_id).await;
        assert_eq!(hit, Some(true));
    }
}
