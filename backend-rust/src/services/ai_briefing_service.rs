//! Proactive signals and the owner briefing.
//!
//! Nothing here computes anything new. A signal *is* a copilot tool answer: the
//! same tools that answer a typed question are run on a schedule instead, so a
//! briefing and an asked question can never disagree, and every alert already
//! carries the evidence, period and confidence the tool produced.
//!
//! Three suppressions stand between a finding and a notification, and they are
//! separate on purpose:
//!
//! * **Low confidence is dropped.** A tool that is unsure is worth answering
//!   with, but not worth interrupting someone over.
//! * **An unchanged finding is dropped**, however long ago it was last raised.
//!   Repeating the same sentence adds nothing.
//! * **A recently raised signal is dropped** even when it has changed, because
//!   a signal that flickers would train people to ignore it.
//!
//! Delivery reuses the existing `notifications` table and the worker pattern
//! already used elsewhere in `main`. Nothing here mutates business data.

use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_signal_repository as signal_repository,
    services::ai_copilot_tools::{self, CopilotAnswer, CopilotTool, ToolActor, ToolMatch},
};

/// Hours before a signal that is still true may be raised again.
const COOLDOWN_HOURS: i64 = 20;
/// Hours before a weekly-cadence signal may be raised again.
const WEEKLY_COOLDOWN_HOURS: i64 = 144;

/// The proactive signals. Each maps to a tool that already knows how to find it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    ServiceDecline,
    StaffPerformance,
    ClientChurnOpportunity,
    MembershipExpiry,
    StockRisk,
    MarginMovement,
    OfferPerformance,
}

impl Signal {
        pub fn from_key(key: &str) -> Option<Self> {
        Self::all().into_iter().find(|signal| signal.key() == key)
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::ServiceDecline => "service_decline",
            Self::StaffPerformance => "staff_performance",
            Self::ClientChurnOpportunity => "client_churn_opportunity",
            Self::MembershipExpiry => "membership_expiry",
            Self::StockRisk => "stock_risk",
            Self::MarginMovement => "margin_movement",
            Self::OfferPerformance => "offer_performance",
        }
    }

    /// The existing tool that detects this signal.
    fn tool(self) -> CopilotTool {
        match self {
            Self::ServiceDecline => CopilotTool::ServiceDecline,
            Self::StaffPerformance => CopilotTool::StaffPerformanceDecline,
            Self::ClientChurnOpportunity => CopilotTool::LapsedClients,
            Self::MembershipExpiry => CopilotTool::MembershipRenewals,
            Self::StockRisk => CopilotTool::InventoryRisk,
            Self::MarginMovement => CopilotTool::ProfitIntelligence,
            Self::OfferPerformance => CopilotTool::OfferPerformance,
        }
    }

    /// Why this matters, stated for the reader rather than derived from data.
    fn why_it_matters(self) -> &'static str {
        match self {
            Self::ServiceDecline => "A service losing demand takes revenue with it before it shows up in the monthly total.",
            Self::StaffPerformance => "A drop in one person's numbers is usually fixable with coaching, if it is caught early.",
            Self::ClientChurnOpportunity => "A lapsed client is far cheaper to win back than a new one is to find.",
            Self::MembershipExpiry => "A membership that lapses quietly is recurring revenue lost without a decision.",
            Self::StockRisk => "Running out mid-service costs the appointment, not just the item.",
            Self::MarginMovement => "Revenue can hold steady while margin erodes; only the margin figure shows it.",
            Self::OfferPerformance => "An offer that is redeemed but unprofitable costs more the better it performs.",
        }
    }

    fn all() -> [Self; 7] {
        [
            Self::ServiceDecline,
            Self::StaffPerformance,
            Self::ClientChurnOpportunity,
            Self::MembershipExpiry,
            Self::StockRisk,
            Self::MarginMovement,
            Self::OfferPerformance,
        ]
    }

    fn cooldown_hours(self, cadence: Cadence) -> i64 {
        match cadence {
            Cadence::Daily => COOLDOWN_HOURS,
            Cadence::Weekly => WEEKLY_COOLDOWN_HOURS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cadence {
    Daily,
    Weekly,
}

impl Cadence {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "daily" => Some(Self::Daily),
            "weekly" => Some(Self::Weekly),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Daily => "Daily briefing",
            Self::Weekly => "Weekly performance briefing",
        }
    }
}

/// One briefing entry, in the sections a reader needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingSection {
    pub signal: String,
    /// What changed.
    pub headline: String,
    /// Why it matters.
    pub why_it_matters: String,
    /// The figures behind it, from the tool that found it.
    pub evidence: Vec<String>,
    pub recommended_action: String,
    /// What acting is expected to achieve. An estimate, never a recorded figure.
    pub expected_impact: String,
    /// CRM screen that owns this.
    pub open_report_link: String,
    pub confidence: String,
    /// Which tool produced it, so the figures stay traceable.
    pub source: String,
    pub period: String,
}

/// A branch's line in a multi-branch comparison.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparisonRow {
    pub branch_id: String,
    pub branch_name: String,
    pub headline: String,
    pub confidence: String,
    /// Empty when the branch had nothing to report.
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Briefing {
    pub cadence: String,
    pub title: String,
    pub branch_id: String,
    pub generated_at: String,
    pub sections: Vec<BriefingSection>,
    /// Signals that were found but deliberately not raised, and why.
    pub suppressed: Vec<String>,
    /// True when no tool had anything worth reporting.
    pub quiet: bool,
}

/// Digest of a finding's substance.
///
/// Deliberately excludes the confidence and the recommended action: those can
/// change wording without the underlying finding being different, and a
/// rewording is not news.
fn fingerprint(answer: &CopilotAnswer) -> String {
    let mut hasher = Sha256::new();
    hasher.update(answer.tool.as_bytes());
    hasher.update(answer.headline.as_bytes());
    for line in &answer.evidence {
        hasher.update(line.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn section_of(signal: Signal, answer: &CopilotAnswer) -> BriefingSection {
    BriefingSection {
        signal: signal.key().into(),
        headline: answer.headline.clone(),
        why_it_matters: signal.why_it_matters().into(),
        evidence: answer.evidence.clone(),
        recommended_action: answer.recommended_action.clone(),
        // Reuses the proposal's stated effect where there is one, so the
        // briefing and the drawer say the same thing about the same step.
        expected_impact: answer
            .proposals
            .first()
            .map(|proposal| proposal.expected_impact.clone())
            .unwrap_or_else(|| "Opening the report shows the detail behind this.".into()),
        open_report_link: answer.deep_link.clone(),
        confidence: answer.confidence.clone(),
        source: answer.source.clone(),
        period: answer.period.label.clone(),
    }
}

/// Builds a briefing for one branch, applying every suppression.
///
/// `persist` decides whether this run records that the signals were raised. An
/// on-demand preview passes false so that reading the briefing does not consume
/// the cooldown a scheduled run depends on.
pub async fn build_briefing(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    user_id: &str,
    cadence: Cadence,
    persist: bool,
) -> Result<Briefing, AppError> {
    let actor = ToolActor::new(user_id, role);
    let mut sections = Vec::new();
    let mut suppressed = Vec::new();

    for signal in Signal::all() {
        let tool = signal.tool();
        // Role gating is the tool's own, so a briefing can never show a reader
        // something they could not have asked for.
        if !tool.permitted_for(role) {
            continue;
        }
        let matched = ToolMatch {
            tool,
            subject_candidates: Vec::new(),
        };
        let Ok(answer) = ai_copilot_tools::run(db, tenant_id, branch_id, &actor, &matched).await
        else {
            continue;
        };

        // "Nothing is wrong" is a perfectly good answer to a question and a
        // useless alert. A tool with no rows behind its answer found nothing to
        // report, however confident it is about that.
        if answer.data_row_count() == 0 {
            suppressed.push(format!("{}: nothing to report", signal.key()));
            continue;
        }

        // A tool that is unsure is worth answering with, not interrupting over.
        if answer.confidence == "low" {
            suppressed.push(format!("{}: confidence too low to raise", signal.key()));
            continue;
        }

        let print = fingerprint(&answer);
        let previous = signal_repository::last_state(db, tenant_id, branch_id, signal.key())
            .await
            .map_err(|_| AppError::internal("failed to load signal state"))?;

        if let Some(previous) = &previous {
            if previous.fingerprint == print {
                suppressed.push(format!("{}: unchanged since it was last raised", signal.key()));
                continue;
            }
            if previous.hours_since_raised < signal.cooldown_hours(cadence) as f64 {
                suppressed.push(format!(
                    "{}: raised {:.0}h ago, inside the cooldown",
                    signal.key(),
                    previous.hours_since_raised
                ));
                continue;
            }
        }

        if persist {
            // Recorded before delivery: raising the same signal twice is worse
            // than missing one, so a crash between the two should suppress
            // rather than repeat.
            signal_repository::record_raised(
                db,
                tenant_id,
                branch_id,
                signal.key(),
                &print,
                &answer.confidence,
            )
            .await
            .map_err(|_| AppError::internal("failed to record signal state"))?;
        }
        sections.push(section_of(signal, &answer));
    }

    Ok(Briefing {
        cadence: match cadence {
            Cadence::Daily => "daily",
            Cadence::Weekly => "weekly",
        }
        .into(),
        title: cadence.label().into(),
        branch_id: branch_id.into(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        quiet: sections.is_empty(),
        sections,
        suppressed,
    })
}

/// Compares one signal across the branches a user may actually see.
///
/// The caller supplies the authorized branches; this never widens that list.
pub async fn compare_branches(
    db: &PgPool,
    tenant_id: &str,
    role: &str,
    user_id: &str,
    branches: &[(String, String)],
    signal: Signal,
) -> Result<Vec<BranchComparisonRow>, AppError> {
    let tool = signal.tool();
    if !tool.permitted_for(role) {
        return Err(AppError::forbidden(
            "this comparison is not available for your role",
        ));
    }
    let actor = ToolActor::new(user_id, role);
    let mut rows = Vec::new();
    for (branch_id, branch_name) in branches {
        let matched = ToolMatch {
            tool,
            subject_candidates: Vec::new(),
        };
        let row = match ai_copilot_tools::run(db, tenant_id, branch_id, &actor, &matched).await {
            Ok(answer) => BranchComparisonRow {
                branch_id: branch_id.clone(),
                branch_name: branch_name.clone(),
                headline: answer.headline,
                confidence: answer.confidence,
                evidence: answer.evidence,
            },
            // A branch that cannot be read is reported as such rather than
            // silently dropped, so a comparison is never quietly incomplete.
            Err(_) => BranchComparisonRow {
                branch_id: branch_id.clone(),
                branch_name: branch_name.clone(),
                headline: "Data unavailable for this branch.".into(),
                confidence: "low".into(),
                evidence: Vec::new(),
            },
        };
        rows.push(row);
    }
    Ok(rows)
}

/// Worker cycle: builds the daily briefing for every active branch and delivers
/// it through the existing notification table.
///
/// Reads and notifies only; no business data is changed.
pub async fn run_daily_briefing_worker(db: &PgPool) -> Result<usize, AppError> {
    let branches = signal_repository::briefing_branches(db)
        .await
        .map_err(|_| AppError::internal("failed to list branches for briefing"))?;

    let mut delivered = 0_usize;
    for branch in branches {
        // The worker has no signed-in user, so it briefs at owner scope — the
        // notification is addressed to the branch, and every reader of it is an
        // owner or admin by the query above.
        let briefing = match build_briefing(
            db,
            &branch.tenant_id,
            &branch.branch_id,
            "owner",
            "system",
            Cadence::Daily,
            true,
        )
        .await
        {
            Ok(briefing) => briefing,
            Err(error) => {
                tracing::warn!(
                    tenant_id = %branch.tenant_id,
                    branch_id = %branch.branch_id,
                    error = error.message(),
                    "daily briefing failed for a branch; continuing"
                );
                continue;
            }
        };
        // Nothing new is not worth a notification.
        if briefing.quiet {
            continue;
        }

        let body = briefing
            .sections
            .iter()
            .map(|section| format!("• {}", section.headline))
            .collect::<Vec<_>>()
            .join("\n");
        let metadata = json!({
            "cadence": briefing.cadence,
            "sections": briefing.sections,
            "generatedAt": briefing.generated_at,
        });
        if let Err(error) = signal_repository::deliver_notification(
            db,
            &branch.tenant_id,
            &branch.branch_id,
            "ai_briefing",
            &briefing.title,
            &body,
            &metadata,
        )
        .await
        {
            tracing::error!(%error, "failed to deliver AI briefing notification");
            continue;
        }
        delivered += 1;
    }
    Ok(delivered)
}

/// Counts how many sections each signal contributed, for tests and telemetry.
#[cfg(test)]
fn signal_counts(briefing: &Briefing) -> std::collections::BTreeMap<String, usize> {
    let mut counts = std::collections::BTreeMap::new();
    for section in &briefing.sections {
        *counts.entry(section.signal.clone()).or_insert(0) += 1;
    }
    counts
}

#[cfg(test)]
mod phase6_briefing_tests {
    use super::*;
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

    async fn cleanup(db: &PgPool, tenant: &str) {
        for table in ["ai_signal_state", "notifications"] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(tenant)
                .execute(db)
                .await;
        }
    }

    #[test]
    fn every_signal_maps_to_a_tool_and_says_why_it_matters() {
        for signal in Signal::all() {
            assert!(!signal.key().is_empty());
            assert!(
                !signal.why_it_matters().is_empty(),
                "{} must explain why it matters",
                signal.key()
            );
            // The tool is an existing one, not a parallel calculation.
            assert!(!signal.tool().name().is_empty());
        }
        // A weekly signal waits materially longer than a daily one.
        assert!(
            Signal::ServiceDecline.cooldown_hours(Cadence::Weekly)
                > Signal::ServiceDecline.cooldown_hours(Cadence::Daily)
        );
        assert_eq!(Cadence::from_name("daily"), Some(Cadence::Daily));
        assert_eq!(Cadence::from_name("hourly"), None);
    }

    /// The fingerprint tracks the finding, not its wording.
    #[test]
    fn a_fingerprint_changes_only_when_the_finding_does() {
        let base = CopilotAnswer::for_test("service_decline", "Hair Spa is down 40%", &["6 to 1"]);
        let same = CopilotAnswer::for_test("service_decline", "Hair Spa is down 40%", &["6 to 1"]);
        let different =
            CopilotAnswer::for_test("service_decline", "Hair Spa is down 60%", &["6 to 1"]);
        assert_eq!(fingerprint(&base), fingerprint(&same));
        assert_ne!(fingerprint(&base), fingerprint(&different));
    }

    /// A briefing on an empty branch is quiet rather than noisy, and reports
    /// what it suppressed.
    #[tokio::test]
    async fn an_empty_branch_produces_a_quiet_briefing() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase6_{}", Uuid::new_v4().simple());

        let briefing = build_briefing(
            &db,
            &tenant,
            "branch1",
            "owner",
            "user1",
            Cadence::Daily,
            false,
        )
        .await
        .expect("briefing builds");

        assert!(briefing.quiet, "an empty branch has nothing to report");
        assert!(
            !briefing.suppressed.is_empty(),
            "low-confidence findings must be reported as suppressed, not hidden"
        );
        assert!(signal_counts(&briefing).is_empty());
        cleanup(&db, &tenant).await;
    }

    /// The same signal must not notify twice.
    #[tokio::test]
    async fn an_unchanged_signal_is_not_raised_again() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase6_dedupe_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        // Record a signal as already raised, with a known fingerprint.
        signal_repository::record_raised(&db, &tenant, branch, "stock_risk", "print-a", "high")
            .await
            .expect("state recorded");

        let first = signal_repository::last_state(&db, &tenant, branch, "stock_risk")
            .await
            .expect("state loads")
            .expect("state exists");
        assert_eq!(first.fingerprint, "print-a");
        assert!(first.hours_since_raised < 1.0);

        // Raising the identical fingerprint again must not multiply the state.
        signal_repository::record_raised(&db, &tenant, branch, "stock_risk", "print-a", "high")
            .await
            .expect("state re-recorded");
        let rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::BIGINT FROM ai_signal_state WHERE tenant_id=$1 AND signal_key='stock_risk'",
        )
        .bind(&tenant)
        .fetch_one(&db)
        .await
        .expect("count runs");
        assert_eq!(rows, 1, "signal state is one row per signal, not one per raise");

        cleanup(&db, &tenant).await;
    }

    /// A preview must not consume the cooldown a scheduled run relies on.
    #[tokio::test]
    async fn a_preview_does_not_consume_the_cooldown() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase6_preview_{}", Uuid::new_v4().simple());

        build_briefing(&db, &tenant, "branch1", "owner", "user1", Cadence::Daily, false)
            .await
            .expect("preview builds");
        let rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM ai_signal_state WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count runs");
        assert_eq!(rows, 0, "a preview must record no signal state");

        cleanup(&db, &tenant).await;
    }

    /// A comparison covers exactly the branches it was given, and never widens.
    #[tokio::test]
    async fn a_comparison_covers_only_the_branches_supplied() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase6_cmp_{}", Uuid::new_v4().simple());
        let branches = vec![
            ("branch1".to_string(), "Andheri".to_string()),
            ("branch2".to_string(), "Bandra".to_string()),
        ];

        let rows = compare_branches(
            &db,
            &tenant,
            "owner",
            "user1",
            &branches,
            Signal::ServiceDecline,
        )
        .await
        .expect("comparison runs");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].branch_name, "Andheri");
        assert_eq!(rows[1].branch_name, "Bandra");

        // A role without rights to the underlying tool is refused outright.
        assert!(compare_branches(
            &db,
            &tenant,
            "frontdesk",
            "user2",
            &branches,
            Signal::MarginMovement,
        )
        .await
        .is_err());

        cleanup(&db, &tenant).await;
    }
}
