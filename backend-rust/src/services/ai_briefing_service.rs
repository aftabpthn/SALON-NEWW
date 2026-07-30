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

use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_signal_repository as signal_repository,
    services::{
        ai_copilot_tools::{self, CopilotAnswer, CopilotTool, ToolActor, ToolMatch, ToolScope},
        ai_scope_service::{self, AiDomain, ScopeRequest}, ai_tool_dispatcher,
        auth_service::AuthClaims,
    },
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

/// A person's decision about a signal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalDecisionRequest {
    /// `acknowledge`, `snooze` or `dismiss`.
    pub decision: String,
    /// Hours to stay quiet for. Only read for a snooze.
    #[serde(default)]
    pub snooze_hours: i64,
}

/// What a decision changed, returned so the caller can show it back.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalDecision {
    pub signal: String,
    pub status: String,
    pub snoozed_until: Option<chrono::DateTime<chrono::Utc>>,
    /// True when a materially different finding will still raise. Always true:
    /// a decision silences the finding that was seen, not the signal forever.
    pub reopens_on_change: bool,
}

/// Longest a signal may be silenced without being looked at again.
const MAX_SNOOZE_HOURS: i64 = 24 * 30;

/// Records acknowledge, snooze or dismiss against a signal.
///
/// This never changes any business data — it only decides whether the briefing
/// says this again. Acting on the finding stays with the CRM screen the alert
/// deep-links to.
pub async fn decide_signal_authorized(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    signal: Signal,
    request: &SignalDecisionRequest,
) -> Result<SignalDecision, AppError> {
    // Same gate the briefing itself uses, so a signal cannot be decided by
    // someone who could not have been shown it.
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, &ScopeRequest {
        branch_id: Some(branch_id.to_string()), ..Default::default()
    }).await?;
    scope.require_branch(branch_id)?;
    if !ai_scope_service::domain_allowed(claims, ai_tool_dispatcher::tool_domain(signal.tool())) {
        return Err(AppError::forbidden(
            "this briefing signal is not available for your permissions",
        ));
    }
    let (status, snoozed_until) = match request.decision.trim().to_ascii_lowercase().as_str() {
        "acknowledge" | "acknowledged" => ("acknowledged", None),
        "dismiss" | "dismissed" => ("dismissed", None),
        "snooze" | "snoozed" => {
            let hours = if request.snooze_hours <= 0 {
                24
            } else {
                request.snooze_hours
            };
            if hours > MAX_SNOOZE_HOURS {
                return Err(AppError::validation(
                    "a signal cannot be snoozed for more than 30 days",
                ));
            }
            ("snoozed", Some(Utc::now() + Duration::hours(hours)))
        }
        _ => {
            return Err(AppError::validation(
                "decision must be acknowledge, snooze or dismiss",
            ));
        }
    };

    let record = signal_repository::set_signal_status(
        db,
        tenant_id,
        branch_id,
        signal.key(),
        status,
        snoozed_until,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to record the signal decision"))?
    .ok_or_else(|| AppError::not_found("that signal has not been raised for this branch"))?;

    Ok(SignalDecision {
        signal: signal.key().to_string(),
        status: record.status,
        snoozed_until,
        reopens_on_change: true,
    })
}

/// Builds a briefing for one branch, applying every suppression.
///
/// `persist` decides whether this run records that the signals were raised. An
/// on-demand preview passes false so that reading the briefing does not consume
/// the cooldown a scheduled run depends on.
/// A one-branch scope for the scheduled briefing.
///
/// The briefing already runs per branch against branches the caller was shown,
/// so it builds its scope explicitly rather than re-resolving grants per tool.
fn briefing_scope(branch_id: &str, branch_name: &str, financials_visible: bool, allowed_domains: Vec<AiDomain>) -> ToolScope {
    ToolScope {
        branch_ids: vec![branch_id.to_string()],
        primary_branch_id: branch_id.to_string(),
        label: branch_name.to_string(),
        financials_visible,
        allowed_domains,
        disclosure: crate::services::ai_scope_service::ScopeDisclosure {
            label: branch_name.to_string(),
            branch_count: 1,
            branches_read: vec![branch_name.to_string()],
            ..Default::default()
        },
    }
}

pub async fn build_briefing_authorized(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    cadence: Cadence,
    persist: bool,
) -> Result<Briefing, AppError> {
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, &ScopeRequest {
        branch_id: Some(branch_id.to_string()), ..Default::default()
    }).await?;
    scope.require_branch(branch_id)?;
    let branch_name = scope.branches.iter().find(|branch| branch.branch_id == branch_id)
        .map(|branch| branch.branch_name.as_str()).unwrap_or(branch_id);
    let actor = ToolActor::new(&claims.sub, &claims.role);
    let mut sections = Vec::new();
    let mut suppressed = Vec::new();

    for signal in Signal::all() {
        let tool = signal.tool();
        // Role gating is the tool's own, so a briefing can never show a reader
        // something they could not have asked for.
        if !ai_scope_service::domain_allowed(claims, ai_tool_dispatcher::tool_domain(tool)) {
            continue;
        }
        let matched = ToolMatch {
            tool,
            subject_candidates: Vec::new(),
        };
        let Ok(answer) = ai_copilot_tools::run(
            db,
            tenant_id,
            &briefing_scope(branch_id, branch_name,
                ai_scope_service::domain_allowed(claims, AiDomain::Finance),
                AiDomain::ALL.into_iter().filter(|domain| ai_scope_service::domain_allowed(claims, *domain)).collect()),
            &actor,
            &matched,
        )
        .await
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
            // A person's decision outranks the cooldown, but only for the
            // finding they actually saw. A materially changed finding raises
            // again rather than staying silenced by an old dismissal.
            let same_finding = previous.decided_fingerprint == print;
            if same_finding && previous.status == "dismissed" {
                suppressed.push(format!("{}: dismissed by a user", signal.key()));
                continue;
            }
            if same_finding && previous.snooze_active {
                suppressed.push(format!("{}: snoozed by a user", signal.key()));
                continue;
            }
            if same_finding && previous.status == "acknowledged" {
                suppressed.push(format!("{}: already acknowledged", signal.key()));
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
pub async fn compare_branches_authorized(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    signal: Signal,
) -> Result<Vec<BranchComparisonRow>, AppError> {
    let tool = signal.tool();
    if !ai_scope_service::domain_allowed(claims, ai_tool_dispatcher::tool_domain(tool)) {
        return Err(AppError::forbidden(
            "this comparison is not available for your permissions",
        ));
    }
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, &ScopeRequest::default()).await?;
    let actor = ToolActor::new(&claims.sub, &claims.role);
    let mut rows = Vec::new();
    for branch in &scope.branches {
        let branch_id = &branch.branch_id;
        let branch_name = &branch.branch_name;
        let matched = ToolMatch {
            tool,
            subject_candidates: Vec::new(),
        };
        let row = match ai_copilot_tools::run(
            db,
            tenant_id,
            &briefing_scope(branch_id, branch_name,
                ai_scope_service::domain_allowed(claims, AiDomain::Finance),
                AiDomain::ALL.into_iter().filter(|domain| ai_scope_service::domain_allowed(claims, *domain)).collect()),
            &actor,
            &matched,
        )
        .await
        {
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

#[cfg(test)]
fn legacy_claims(tenant_id: &str, branch_id: Option<&str>, role: &str, user_id: &str) -> AuthClaims {
    let permissions: &[&str] = match role.to_ascii_lowercase().as_str() {
        "owner" | "admin" | "manager" => &["tenant.read", "finance.read"],
        "frontdesk" | "receptionist" => &["appointments.read", "clients.read", "services.read", "memberships.read"],
        "inventorymanager" => &["inventory.read"], "staff" => &["staff.read"], _ => &[],
    };
    let mut claims = crate::services::ai_tool_dispatcher::tests_support::claims(role, permissions, &[]);
    claims.tenant_id = tenant_id.to_string();
    claims.branch_id = branch_id.map(str::to_string);
    claims.sub = user_id.to_string();
    claims
}

#[cfg(test)]
async fn build_briefing(db: &PgPool, tenant_id: &str, branch_id: &str, role: &str, user_id: &str, cadence: Cadence, persist: bool) -> Result<Briefing, AppError> {
    build_briefing_authorized(db, tenant_id, branch_id, &legacy_claims(tenant_id, Some(branch_id), role, user_id), cadence, persist).await
}

#[cfg(test)]
async fn compare_branches(db: &PgPool, tenant_id: &str, role: &str, user_id: &str, branches: &[(String, String)], signal: Signal) -> Result<Vec<BranchComparisonRow>, AppError> {
    compare_branches_authorized(db, tenant_id, &legacy_claims(tenant_id, branches.first().map(|branch| branch.0.as_str()), role, user_id), signal).await
}

#[cfg(test)]
async fn decide_signal(db: &PgPool, tenant_id: &str, branch_id: &str, role: &str, user_id: &str, signal: Signal, request: &SignalDecisionRequest) -> Result<SignalDecision, AppError> {
    decide_signal_authorized(db, tenant_id, branch_id, &legacy_claims(tenant_id, Some(branch_id), role, user_id), signal, request).await
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
        // The worker has no signed-in user. Explicit read-only grants keep it
        // on the same domain checks as interactive users.
        let system_claims = AuthClaims {
            sub: "system".into(), tenant_id: branch.tenant_id.clone(), branch_id: Some(branch.branch_id.clone()),
            role: "system".into(), role_id: None,
            permissions: AiDomain::ALL.into_iter().map(|domain| domain.required_permission().to_string()).collect(),
            denied_permissions: Vec::new(), masked_fields: Vec::new(), max_discount_paise: None,
            max_refund_paise: None, max_cash_movement_paise: None, permission_version: 0,
            session_id: "ai-briefing-worker".into(), mfa_enrollment_required: false,
            token_type: "system".into(), jti: "ai-briefing-worker".into(), iat: 0, exp: usize::MAX,
        };
        let briefing = match build_briefing_authorized(
            db,
            &branch.tenant_id,
            &branch.branch_id,
            &system_claims,
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

#[cfg(test)]
mod briefing_signal_decision_tests {
    use super::*;
    use sqlx::PgPool;

    /// Every section the phase asks a briefing to cover.
    #[test]
    fn the_briefing_covers_every_required_section() {
        let keys: Vec<&str> = Signal::all().into_iter().map(|signal| signal.key()).collect();
        for required in [
            "margin_movement",          // revenue and profit anomalies
            "service_decline",          // service demand changes
            "staff_performance",        // staff capacity or performance risks
            "client_churn_opportunity", // client churn opportunities
            "membership_expiry",        // membership renewals
            "stock_risk",               // inventory shortage and wastage
        ] {
            assert!(keys.contains(&required), "briefing is missing {required}");
        }
        // Daily is the morning owner briefing; weekly is the review cadence.
        assert!(Cadence::from_name("daily").is_some());
        assert!(Cadence::from_name("weekly").is_some());
    }

    #[test]
    fn a_weekly_signal_stays_quiet_longer_than_a_daily_one() {
        for signal in Signal::all() {
            assert!(
                signal.cooldown_hours(Cadence::Weekly) >= signal.cooldown_hours(Cadence::Daily),
                "{} must not be noisier weekly than daily",
                signal.key()
            );
        }
    }

    #[test]
    fn a_snooze_cannot_silence_a_signal_indefinitely() {
        assert_eq!(MAX_SNOOZE_HOURS, 24 * 30);
    }

    async fn seed(db: &PgPool) -> (String, String) {
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
        (tenant_id, branch_id)
    }

    /// Raise a signal so there is something to decide about.
    async fn raise(db: &PgPool, tenant_id: &str, branch_id: &str, fingerprint: &str) {
        signal_repository::record_raised(
            db,
            tenant_id,
            branch_id,
            Signal::StockRisk.key(),
            fingerprint,
            "high",
        )
        .await
        .unwrap();
    }

    #[sqlx::test]
    async fn a_signal_can_be_acknowledged_snoozed_and_dismissed(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        raise(&pool, &tenant_id, &branch_id, "print-1").await;

        for (decision, expected) in [
            ("acknowledge", "acknowledged"),
            ("snooze", "snoozed"),
            ("dismiss", "dismissed"),
        ] {
            let result = decide_signal(
                &pool,
                &tenant_id,
                &branch_id,
                "owner",
                "user-1",
                Signal::StockRisk,
                &SignalDecisionRequest {
                    decision: decision.into(),
                    snooze_hours: 12,
                },
            )
            .await
            .unwrap_or_else(|error| panic!("{decision} should be accepted: {error:?}"));
            assert_eq!(result.status, expected);
            assert!(result.reopens_on_change);
        }
    }

    #[sqlx::test]
    async fn a_snooze_records_when_it_ends(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        raise(&pool, &tenant_id, &branch_id, "print-1").await;

        let result = decide_signal(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            "user-1",
            Signal::StockRisk,
            &SignalDecisionRequest {
                decision: "snooze".into(),
                snooze_hours: 6,
            },
        )
        .await
        .expect("snooze accepted");
        let until = result.snoozed_until.expect("a snooze has an end");
        assert!(until > Utc::now(), "the snooze window must be in the future");
    }

    #[sqlx::test]
    async fn an_over_long_snooze_is_refused(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        raise(&pool, &tenant_id, &branch_id, "print-1").await;

        let error = decide_signal(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            "user-1",
            Signal::StockRisk,
            &SignalDecisionRequest {
                decision: "snooze".into(),
                snooze_hours: MAX_SNOOZE_HOURS + 1,
            },
        )
        .await
        .expect_err("an unbounded snooze must be refused");
        assert!(format!("{error:?}").contains("30 days"));
    }

    /// A decision must attach to the finding that was seen, so a different,
    /// possibly worse, finding is not silenced by it.
    #[sqlx::test]
    async fn a_decision_is_recorded_against_the_finding_it_was_made_about(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        raise(&pool, &tenant_id, &branch_id, "print-1").await;
        decide_signal(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            "user-1",
            Signal::StockRisk,
            &SignalDecisionRequest {
                decision: "dismiss".into(),
                snooze_hours: 0,
            },
        )
        .await
        .expect("dismissed");

        let state = signal_repository::last_state(
            &pool,
            &tenant_id,
            &branch_id,
            Signal::StockRisk.key(),
        )
        .await
        .unwrap()
        .expect("state exists");
        assert_eq!(state.status, "dismissed");
        assert_eq!(state.decided_fingerprint, "print-1");

        // The same condition changing produces a different fingerprint, which
        // no longer matches the dismissal.
        raise(&pool, &tenant_id, &branch_id, "print-2").await;
        let changed = signal_repository::last_state(
            &pool,
            &tenant_id,
            &branch_id,
            Signal::StockRisk.key(),
        )
        .await
        .unwrap()
        .expect("state exists");
        assert_eq!(changed.fingerprint, "print-2");
        assert_ne!(
            changed.decided_fingerprint, changed.fingerprint,
            "a changed finding must not stay silenced by an old dismissal"
        );
    }

    #[sqlx::test]
    async fn deciding_a_signal_that_was_never_raised_is_a_not_found(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let error = decide_signal(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            "user-1",
            Signal::StockRisk,
            &SignalDecisionRequest {
                decision: "acknowledge".into(),
                snooze_hours: 0,
            },
        )
        .await
        .expect_err("there is nothing to decide about");
        assert!(format!("{error:?}").contains("not been raised"));
    }

    #[sqlx::test]
    async fn a_role_that_cannot_see_a_signal_cannot_decide_it(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        raise(&pool, &tenant_id, &branch_id, "print-1").await;
        let error = decide_signal(
            &pool,
            &tenant_id,
            &branch_id,
            "receptionist",
            "user-2",
            Signal::MarginMovement,
            &SignalDecisionRequest {
                decision: "dismiss".into(),
                snooze_hours: 0,
            },
        )
        .await
        .expect_err("a margin signal is not front-desk information");
        assert!(format!("{error:?}").to_lowercase().contains("not available"));
    }
}
