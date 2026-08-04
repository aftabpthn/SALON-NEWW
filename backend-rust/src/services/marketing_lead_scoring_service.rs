//! Automatic lead scoring for the AI Lead Manager agent.
//!
//! `marketing_leads.score` drives the priority queue in `lead_advice`, the
//! follow-up cadence it proposes and the order the lead list is worked in — but
//! nothing ever computed it. It was a number a user could type, so in practice
//! most rows sat at 0 and genuine leads sorted below stale ones.
//!
//! Scoring here is deterministic and explainable by design, which is also what
//! the AI workforce catalog declares for this agent ("rule-based lead queue").
//! Every score carries the factors that produced it, so a manager can see why a
//! lead ranks where it does rather than being handed an opaque number.
//!
//! Source quality is learned from the tenant's own converted leads rather than
//! from fixed weights: which channel produces business differs per salon, and a
//! hard-coded table would be wrong for most of them. Rates are shrunk towards
//! the branch average by sample size, so a source with three leads cannot
//! outrank one with three hundred.

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::models::common::AppError;

/// Bumped whenever the factors or their weights change, so a stored score is
/// always interpretable against the policy that produced it.
pub const MODEL_VERSION: &str = "lead_scoring_v1";

/// Below this many historical leads a source's own conversion rate is too noisy
/// to trust on its own and is blended with the branch average.
const SOURCE_CONFIDENCE_SAMPLE: f64 = 20.0;

const MAX_SOURCE_POINTS: f64 = 30.0;
const MAX_ENGAGEMENT_POINTS: f64 = 25.0;
const MAX_QUALIFICATION_POINTS: f64 = 20.0;
const MAX_RESPONSIVENESS_POINTS: f64 = 15.0;
const MAX_CONTACTABILITY_POINTS: f64 = 10.0;
/// A lead nobody has touched in weeks is worth less than the same lead was on
/// the day it arrived, so staleness subtracts rather than simply not adding.
const MAX_STALENESS_PENALTY: f64 = 20.0;

/// One contribution to a lead's score, kept with the evidence behind it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreFactor {
    pub key: &'static str,
    pub label: String,
    pub points: i32,
    pub detail: String,
}

/// Everything scoring needs about one lead, read once per pass.
#[derive(Debug, Clone, Default)]
pub struct LeadSignals {
    pub lead_id: String,
    pub source: String,
    pub qualification_status: String,
    pub has_phone: bool,
    pub has_email: bool,
    pub is_existing_client: bool,
    pub activity_count: i64,
    /// Calls and messages are a stronger intent signal than an internal note.
    pub outreach_count: i64,
    pub days_since_last_activity: Option<f64>,
    pub days_since_created: f64,
    /// Hours between the lead arriving and someone first contacting it.
    /// `None` means nobody has contacted it yet.
    pub hours_to_first_contact: Option<f64>,
    pub follow_up_overdue: bool,
}

/// Conversion history for the branch, used to rank sources against each other.
#[derive(Debug, Clone, Default)]
pub struct SourcePriors {
    pub branch_conversion_rate: f64,
    /// (source, converted, total) as counted from this branch's own leads.
    pub by_source: Vec<(String, i64, i64)>,
}

impl SourcePriors {
    /// Conversion rate for `source`, pulled towards the branch average in
    /// proportion to how little history backs it.
    fn rate_for(&self, source: &str) -> (f64, i64, i64) {
        let (converted, total) = self
            .by_source
            .iter()
            .find(|(name, _, _)| name.eq_ignore_ascii_case(source))
            .map(|(_, converted, total)| (*converted, *total))
            .unwrap_or((0, 0));
        if total == 0 {
            return (self.branch_conversion_rate, 0, 0);
        }
        let observed = converted as f64 / total as f64;
        let confidence = total as f64 / (total as f64 + SOURCE_CONFIDENCE_SAMPLE);
        let blended = observed * confidence + self.branch_conversion_rate * (1.0 - confidence);
        (blended, converted, total)
    }
}

fn round_points(value: f64) -> i32 {
    value.round() as i32
}

/// Scores one lead and returns the value alongside the factors that produced it.
///
/// Pure so the policy can be tested without a database; every input comes from
/// [`LeadSignals`] and [`SourcePriors`].
pub fn score_lead(signals: &LeadSignals, priors: &SourcePriors) -> (i32, Vec<ScoreFactor>) {
    let mut factors = Vec::new();

    let (rate, converted, total) = priors.rate_for(&signals.source);
    // A source that converts at or above twice the branch average earns full
    // marks; the branch average itself earns half. Scoring relative to the
    // branch keeps the scale meaningful for a salon where 5% is excellent and
    // for one where 40% is normal.
    let benchmark = (priors.branch_conversion_rate * 2.0).max(0.02);
    let source_points = (rate / benchmark).clamp(0.0, 1.0) * MAX_SOURCE_POINTS;
    factors.push(ScoreFactor {
        key: "source_quality",
        label: format!("Source: {}", signals.source),
        points: round_points(source_points),
        detail: if total > 0 {
            format!(
                "{converted} of {total} past {} leads converted ({:.0}%)",
                signals.source,
                rate * 100.0
            )
        } else {
            format!(
                "No history for this source yet; using the branch average of {:.0}%",
                priors.branch_conversion_rate * 100.0
            )
        },
    });

    // Someone who has replied to outreach is further along than someone with a
    // pile of internal notes, so outreach counts double towards the cap.
    let engagement_raw = signals.outreach_count as f64 * 2.0 + signals.activity_count as f64;
    let engagement_points = (engagement_raw / 8.0).clamp(0.0, 1.0) * MAX_ENGAGEMENT_POINTS;
    factors.push(ScoreFactor {
        key: "engagement",
        label: "Engagement".into(),
        points: round_points(engagement_points),
        detail: if signals.activity_count == 0 {
            "No activity recorded yet".into()
        } else {
            format!(
                "{} activities, {} of them calls or messages",
                signals.activity_count, signals.outreach_count
            )
        },
    });

    let qualification_points = match signals.qualification_status.as_str() {
        "qualified" => MAX_QUALIFICATION_POINTS,
        "disqualified" => 0.0,
        _ => MAX_QUALIFICATION_POINTS * 0.35,
    };
    factors.push(ScoreFactor {
        key: "qualification",
        label: "Qualification".into(),
        points: round_points(qualification_points),
        detail: match signals.qualification_status.as_str() {
            "qualified" => "Qualified by a team member".into(),
            "disqualified" => "Disqualified by a team member".into(),
            _ => "Not qualified yet".into(),
        },
    });

    // Speed of first contact is the strongest controllable predictor in the
    // data available here: the same lead contacted within the hour and after
    // two days is not the same opportunity.
    let (responsiveness_points, responsiveness_detail) = match signals.hours_to_first_contact {
        Some(hours) if hours <= 1.0 => (
            MAX_RESPONSIVENESS_POINTS,
            "First contact within an hour".to_string(),
        ),
        Some(hours) if hours <= 24.0 => (
            MAX_RESPONSIVENESS_POINTS * 0.6,
            format!("First contact after {hours:.0}h"),
        ),
        Some(hours) => (
            MAX_RESPONSIVENESS_POINTS * 0.2,
            format!("First contact after {:.0} days", hours / 24.0),
        ),
        None if signals.days_since_created <= 1.0 => (
            MAX_RESPONSIVENESS_POINTS * 0.5,
            "Not contacted yet, still inside the first day".to_string(),
        ),
        None => (0.0, "Never contacted".to_string()),
    };
    factors.push(ScoreFactor {
        key: "responsiveness",
        label: "Response speed".into(),
        points: round_points(responsiveness_points),
        detail: responsiveness_detail,
    });

    let mut contactability = 0.0;
    if signals.has_phone {
        contactability += MAX_CONTACTABILITY_POINTS * 0.6;
    }
    if signals.has_email {
        contactability += MAX_CONTACTABILITY_POINTS * 0.2;
    }
    if signals.is_existing_client {
        contactability += MAX_CONTACTABILITY_POINTS * 0.2;
    }
    factors.push(ScoreFactor {
        key: "contactability",
        label: "Reachability".into(),
        points: round_points(contactability),
        detail: match (
            signals.has_phone,
            signals.has_email,
            signals.is_existing_client,
        ) {
            (false, false, _) => "No phone or email on file".into(),
            (_, _, true) => "Existing client with contact details".into(),
            (true, true, _) => "Phone and email on file".into(),
            (true, false, _) => "Phone on file".into(),
            (false, true, _) => "Email on file".into(),
        },
    });

    // Decay is driven by silence, not age: a lead worked yesterday is live
    // however long ago it arrived.
    let idle_days = signals
        .days_since_last_activity
        .unwrap_or(signals.days_since_created);
    let staleness = ((idle_days - 7.0) / 21.0).clamp(0.0, 1.0) * MAX_STALENESS_PENALTY;
    if staleness >= 0.5 {
        factors.push(ScoreFactor {
            key: "staleness",
            label: "Going cold".into(),
            points: -round_points(staleness),
            detail: format!("No activity for {idle_days:.0} days"),
        });
    }

    if signals.follow_up_overdue {
        factors.push(ScoreFactor {
            key: "follow_up_overdue",
            label: "Follow-up overdue".into(),
            points: 5,
            detail: "A follow-up date has passed; work this before it cools".into(),
        });
    }

    let total_points: i32 = factors.iter().map(|factor| factor.points).sum();
    (total_points.clamp(0, 100), factors)
}

/// Reads the branch's own conversion history.
pub async fn source_priors(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SourcePriors, AppError> {
    let rows = sqlx::query_as::<_, (String, i64, i64)>(
        r#"SELECT source,
                  COUNT(*) FILTER (WHERE stage = 'converted')::BIGINT,
                  COUNT(*)::BIGINT
             FROM marketing_leads
            WHERE tenant_id = $1 AND branch_id = $2
            GROUP BY source"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load lead conversion history"))?;

    let converted: i64 = rows.iter().map(|(_, converted, _)| converted).sum();
    let total: i64 = rows.iter().map(|(_, _, total)| total).sum();
    Ok(SourcePriors {
        branch_conversion_rate: if total > 0 {
            converted as f64 / total as f64
        } else {
            0.0
        },
        by_source: rows,
    })
}

/// Reads the signals for every open lead in a branch.
async fn open_lead_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<LeadSignals>, AppError> {
    let rows = sqlx::query_as::<_, (String, String, String, bool, bool, bool, i64, i64, Option<f64>, f64, Option<f64>, bool)>(
        r#"SELECT lead.id,
                  lead.source,
                  lead.qualification_status,
                  lead.phone <> '',
                  lead.email <> '',
                  lead.client_id IS NOT NULL,
                  COALESCE(activity.activity_count, 0)::BIGINT,
                  COALESCE(activity.outreach_count, 0)::BIGINT,
                  EXTRACT(EPOCH FROM (NOW() - activity.last_activity_at)) / 86400.0,
                  EXTRACT(EPOCH FROM (NOW() - lead.created_at)) / 86400.0,
                  EXTRACT(EPOCH FROM (lead.first_contacted_at - lead.created_at)) / 3600.0,
                  lead.next_follow_up_date IS NOT NULL AND lead.next_follow_up_date < CURRENT_DATE
             FROM marketing_leads lead
             LEFT JOIN (
                    SELECT lead_id,
                           COUNT(*)::BIGINT activity_count,
                           COUNT(*) FILTER (WHERE activity_type IN ('call', 'message'))::BIGINT outreach_count,
                           MAX(created_at) last_activity_at
                      FROM marketing_lead_activities
                     WHERE tenant_id = $1 AND branch_id = $2
                     GROUP BY lead_id
                  ) activity ON activity.lead_id = lead.id
            WHERE lead.tenant_id = $1
              AND lead.branch_id = $2
              AND lead.stage NOT IN ('converted', 'lost')
              AND lead.score_source = 'auto'"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load lead scoring signals"))?;

    Ok(rows
        .into_iter()
        .map(|row| LeadSignals {
            lead_id: row.0,
            source: row.1,
            qualification_status: row.2,
            has_phone: row.3,
            has_email: row.4,
            is_existing_client: row.5,
            activity_count: row.6,
            outreach_count: row.7,
            days_since_last_activity: row.8,
            days_since_created: row.9.max(0.0),
            hours_to_first_contact: row.10.map(|hours| hours.max(0.0)),
            follow_up_overdue: row.11,
        })
        .collect())
}

/// Recomputes every automatically scored open lead in one branch.
///
/// Leads whose score a person set stay untouched: `score_source` only becomes
/// `'auto'` when someone opts the lead in, so enabling scoring never overwrites
/// a judgement that was made deliberately.
pub async fn rescore_branch(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<usize, AppError> {
    let priors = source_priors(db, tenant_id, branch_id).await?;
    let leads = open_lead_signals(db, tenant_id, branch_id).await?;
    let mut updated = 0usize;
    for signals in &leads {
        let (score, factors) = score_lead(signals, &priors);
        sqlx::query(
            r#"UPDATE marketing_leads
                  SET score = $4,
                      score_factors_json = $5,
                      score_model_version = $6,
                      score_computed_at = NOW(),
                      updated_at = NOW()
                WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 AND score_source = 'auto'"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&signals.lead_id)
        .bind(score)
        .bind(json!(factors))
        .bind(MODEL_VERSION)
        .execute(db)
        .await
        .map_err(|_| AppError::internal("failed to store lead score"))?;
        updated += 1;
    }
    Ok(updated)
}

/// Recomputes one lead on demand and returns its breakdown, without requiring
/// the lead to be opted into automatic scoring — so a manager can see what the
/// policy would say before switching it on.
pub async fn explain(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
) -> Result<Value, AppError> {
    let priors = source_priors(db, tenant_id, branch_id).await?;
    let stored = sqlx::query_as::<_, (i32, String, Option<String>, Value)>(
        r#"SELECT score, score_source, score_model_version, score_factors_json
             FROM marketing_leads
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load lead"))?
    .ok_or_else(|| AppError::not_found("lead was not found"))?;

    let signals = open_lead_signals(db, tenant_id, branch_id)
        .await?
        .into_iter()
        .find(|signals| signals.lead_id == lead_id);

    // A manual or closed lead is not in the scoring set, so recompute it in
    // isolation rather than reporting nothing.
    let signals = match signals {
        Some(signals) => signals,
        None => single_lead_signals(db, tenant_id, branch_id, lead_id).await?,
    };
    let (score, factors) = score_lead(&signals, &priors);

    Ok(json!({
        "leadId": lead_id,
        "storedScore": stored.0,
        "storedScoreSource": stored.1,
        "storedModelVersion": stored.2.unwrap_or_default(),
        "storedFactors": stored.3,
        "policyScore": score,
        "policyModelVersion": MODEL_VERSION,
        "policyFactors": factors,
        "branchConversionRate": (priors.branch_conversion_rate * 10_000.0).round() / 100.0,
    }))
}

async fn single_lead_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
) -> Result<LeadSignals, AppError> {
    let row = sqlx::query_as::<_, (String, String, String, bool, bool, bool, i64, i64, Option<f64>, f64, Option<f64>, bool)>(
        r#"SELECT lead.id,
                  lead.source,
                  lead.qualification_status,
                  lead.phone <> '',
                  lead.email <> '',
                  lead.client_id IS NOT NULL,
                  COALESCE(activity.activity_count, 0)::BIGINT,
                  COALESCE(activity.outreach_count, 0)::BIGINT,
                  EXTRACT(EPOCH FROM (NOW() - activity.last_activity_at)) / 86400.0,
                  EXTRACT(EPOCH FROM (NOW() - lead.created_at)) / 86400.0,
                  EXTRACT(EPOCH FROM (lead.first_contacted_at - lead.created_at)) / 3600.0,
                  lead.next_follow_up_date IS NOT NULL AND lead.next_follow_up_date < CURRENT_DATE
             FROM marketing_leads lead
             LEFT JOIN (
                    SELECT lead_id,
                           COUNT(*)::BIGINT activity_count,
                           COUNT(*) FILTER (WHERE activity_type IN ('call', 'message'))::BIGINT outreach_count,
                           MAX(created_at) last_activity_at
                      FROM marketing_lead_activities
                     WHERE tenant_id = $1 AND branch_id = $2 AND lead_id = $3
                     GROUP BY lead_id
                  ) activity ON activity.lead_id = lead.id
            WHERE lead.tenant_id = $1 AND lead.branch_id = $2 AND lead.id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load lead scoring signals"))?
    .ok_or_else(|| AppError::not_found("lead was not found"))?;

    Ok(LeadSignals {
        lead_id: row.0,
        source: row.1,
        qualification_status: row.2,
        has_phone: row.3,
        has_email: row.4,
        is_existing_client: row.5,
        activity_count: row.6,
        outreach_count: row.7,
        days_since_last_activity: row.8,
        days_since_created: row.9.max(0.0),
        hours_to_first_contact: row.10.map(|hours| hours.max(0.0)),
        follow_up_overdue: row.11,
    })
}

/// Opts a lead into or out of automatic scoring.
///
/// Switching to manual keeps whatever the policy last produced, so a manager
/// adjusts from the computed number rather than starting from zero.
pub async fn set_score_source(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    lead_id: &str,
    automatic: bool,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        r#"UPDATE marketing_leads
              SET score_source = $4, updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(lead_id)
    .bind(if automatic { "auto" } else { "manual" })
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to update lead scoring mode"))?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::not_found("lead was not found"));
    }
    Ok(())
}

/// Branches with open automatically scored leads, oldest scores first.
pub async fn branches_due(db: &PgPool, limit: i64) -> Result<Vec<(String, String)>, AppError> {
    sqlx::query_as::<_, (String, String)>(
        r#"SELECT tenant_id, branch_id
             FROM marketing_leads
            WHERE stage NOT IN ('converted', 'lost')
              AND score_source = 'auto'
              AND (score_computed_at IS NULL OR score_computed_at < NOW() - INTERVAL '1 hour')
            GROUP BY tenant_id, branch_id
            ORDER BY MIN(COALESCE(score_computed_at, TIMESTAMPTZ '-infinity'))
            LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load branches due for lead scoring"))
}

/// Rescores every branch with work waiting. Returns how many leads were updated.
pub async fn process_due(db: &PgPool) -> Result<usize, AppError> {
    let mut updated = 0usize;
    for (tenant_id, branch_id) in branches_due(db, 25).await? {
        updated += rescore_branch(db, &tenant_id, &branch_id).await?;
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn priors() -> SourcePriors {
        SourcePriors {
            branch_conversion_rate: 0.20,
            by_source: vec![
                ("referral".into(), 45, 100),
                ("walk_in".into(), 20, 100),
                ("web".into(), 5, 100),
                ("rare".into(), 3, 3),
            ],
        }
    }

    fn base_signals() -> LeadSignals {
        LeadSignals {
            lead_id: "lead-1".into(),
            source: "walk_in".into(),
            qualification_status: "unqualified".into(),
            has_phone: true,
            has_email: false,
            is_existing_client: false,
            activity_count: 0,
            outreach_count: 0,
            days_since_last_activity: None,
            days_since_created: 0.0,
            hours_to_first_contact: None,
            follow_up_overdue: false,
        }
    }

    fn points(factors: &[ScoreFactor], key: &str) -> i32 {
        factors
            .iter()
            .find(|factor| factor.key == key)
            .map_or(0, |factor| factor.points)
    }

    #[test]
    fn a_source_that_converts_better_than_the_branch_scores_higher() {
        let priors = priors();
        let mut referral = base_signals();
        referral.source = "referral".into();
        let mut web = base_signals();
        web.source = "web".into();

        let (_, referral_factors) = score_lead(&referral, &priors);
        let (_, web_factors) = score_lead(&web, &priors);
        assert!(
            points(&referral_factors, "source_quality") > points(&web_factors, "source_quality"),
            "referral converts at 45% against web at 5% and must outrank it"
        );
    }

    #[test]
    fn a_source_with_almost_no_history_cannot_outrank_a_proven_one() {
        let priors = priors();
        // "rare" converted 3 of 3, a perfect rate on a sample too small to mean
        // anything. Without shrinkage it would beat referral's 45% of 100.
        let mut rare = base_signals();
        rare.source = "rare".into();
        let mut referral = base_signals();
        referral.source = "referral".into();

        let (_, rare_factors) = score_lead(&rare, &priors);
        let (_, referral_factors) = score_lead(&referral, &priors);
        assert!(
            points(&rare_factors, "source_quality") < points(&referral_factors, "source_quality"),
            "a 3-lead sample must be pulled towards the branch average"
        );
    }

    #[test]
    fn an_unknown_source_falls_back_to_the_branch_average() {
        let priors = priors();
        let mut unknown = base_signals();
        unknown.source = "instagram".into();
        let (_, factors) = score_lead(&unknown, &priors);
        let factor = factors
            .iter()
            .find(|factor| factor.key == "source_quality")
            .unwrap();
        assert!(
            factor.detail.contains("branch average"),
            "{}",
            factor.detail
        );
    }

    #[test]
    fn contacting_within_the_hour_beats_contacting_days_later() {
        let priors = priors();
        let mut fast = base_signals();
        fast.hours_to_first_contact = Some(0.5);
        let mut slow = base_signals();
        slow.hours_to_first_contact = Some(72.0);

        let (fast_score, _) = score_lead(&fast, &priors);
        let (slow_score, _) = score_lead(&slow, &priors);
        assert!(
            fast_score > slow_score,
            "{fast_score} should beat {slow_score}"
        );
    }

    #[test]
    fn calls_and_messages_count_for_more_than_notes() {
        let priors = priors();
        let mut notes = base_signals();
        notes.activity_count = 4;
        notes.outreach_count = 0;
        let mut outreach = base_signals();
        outreach.activity_count = 4;
        outreach.outreach_count = 4;

        let (_, note_factors) = score_lead(&notes, &priors);
        let (_, outreach_factors) = score_lead(&outreach, &priors);
        assert!(points(&outreach_factors, "engagement") > points(&note_factors, "engagement"));
    }

    #[test]
    fn a_lead_going_quiet_loses_points() {
        let priors = priors();
        let mut fresh = base_signals();
        fresh.days_since_last_activity = Some(1.0);
        let mut cold = base_signals();
        cold.days_since_last_activity = Some(40.0);

        let (fresh_score, _) = score_lead(&fresh, &priors);
        let (cold_score, cold_factors) = score_lead(&cold, &priors);
        assert!(cold_score < fresh_score);
        assert!(
            points(&cold_factors, "staleness") < 0,
            "staleness must subtract"
        );
    }

    #[test]
    fn a_disqualified_lead_earns_nothing_for_qualification() {
        let priors = priors();
        let mut disqualified = base_signals();
        disqualified.qualification_status = "disqualified".into();
        let (_, factors) = score_lead(&disqualified, &priors);
        assert_eq!(points(&factors, "qualification"), 0);
    }

    #[test]
    fn scores_stay_inside_the_column_constraint() {
        let priors = priors();
        let mut best = base_signals();
        best.source = "referral".into();
        best.qualification_status = "qualified".into();
        best.has_email = true;
        best.is_existing_client = true;
        best.activity_count = 50;
        best.outreach_count = 50;
        best.hours_to_first_contact = Some(0.1);
        best.days_since_last_activity = Some(0.0);
        best.follow_up_overdue = true;

        let mut worst = base_signals();
        worst.source = "web".into();
        worst.qualification_status = "disqualified".into();
        worst.has_phone = false;
        worst.days_since_created = 400.0;
        worst.days_since_last_activity = Some(400.0);

        let (best_score, _) = score_lead(&best, &priors);
        let (worst_score, _) = score_lead(&worst, &priors);
        // marketing_leads.score is CHECK (score BETWEEN 0 AND 100); a policy
        // change that escapes that range would fail every write at runtime.
        assert!((0..=100).contains(&best_score), "{best_score}");
        assert!((0..=100).contains(&worst_score), "{worst_score}");
        assert!(best_score > worst_score);
    }

    #[test]
    fn every_factor_carries_an_explanation() {
        let priors = priors();
        let (_, factors) = score_lead(&base_signals(), &priors);
        assert!(!factors.is_empty());
        for factor in &factors {
            assert!(!factor.label.is_empty(), "{} has no label", factor.key);
            assert!(!factor.detail.is_empty(), "{} has no detail", factor.key);
        }
    }
}
