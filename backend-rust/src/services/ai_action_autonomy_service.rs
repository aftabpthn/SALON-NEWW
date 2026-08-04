//! Earned autonomy: when the copilot may act without asking first.
//!
//! Every copilot action has always stopped at a person, and for anything that
//! moves money or reaches a client it always will — `ALWAYS_EXPLICIT_APPROVAL`
//! is not reachable from here. But three kinds only write a to-do, and asking
//! for a click on the four-hundredth identical follow-up task is not a safety
//! control. It is a habit that teaches people to click without reading, which
//! makes every other confirmation in the product weaker.
//!
//! Four conditions must hold at once, and each blocks on its own:
//!
//! * **Eligible.** Only kinds `ActionKind::executes_on_approval` already
//!   completes. Everything else routes to a screen, and a screen with nobody at
//!   it is not an action.
//! * **Earned.** Measured from decisions this branch already made: enough of
//!   them, a high enough approval rate, and no undo in the window. This is
//!   computed from history, so it cannot be configured into existence.
//! * **Granted.** An owner or admin switched it on. A measured rate is
//!   evidence, not consent — nothing becomes autonomous merely because a
//!   threshold was crossed.
//! * **Not suspended.** An undo suspends the kind *and* withdraws the grant, so
//!   getting it back takes a person deciding again rather than time passing.
//!
//! Autonomy never gets its own execution path. An autonomous run goes through
//! the same `confirm_draft` a person's click goes through — same permission
//! re-check, same claim, same idempotency, same audit — so there is no second,
//! weaker way for the CRM to be written to.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_action_autonomy_repository::{self as repository, AutonomousRun},
    services::ai_action_service::ActionKind,
};

/// How far back the decision history is read. Long enough to accumulate a
/// sample, short enough that agreement from two quarters ago stops counting.
pub const DECISION_WINDOW_DAYS: i32 = 90;

/// Decisions needed before a kind can be considered earned at all.
///
/// Under this the approval rate is a coin flip described to two decimal places.
pub const MIN_DECISIONS: i64 = 20;

/// Approval rate a kind must clear, in percent — **strictly above**, not merely
/// equal to.
///
/// Set high deliberately. The question is not whether the copilot is usually
/// right; it is whether the confirmation step has stopped carrying information.
/// At exactly 95%, one decision in twenty is still a refusal, which is the
/// confirmation step doing its job — so equalling the bar is not clearing it.
pub const APPROVAL_BAR_PERCENT: f64 = 95.0;

/// How long an autonomous run stays reversible.
pub const UNDO_WINDOW_HOURS: i64 = 24;

/// How long a kind stays suspended after an undo.
///
/// The suspension is the smaller half of the penalty: the grant is withdrawn
/// outright, so the kind cannot return until a person switches it back on. The
/// window exists so that switching it on again in the same afternoon, before
/// anyone has looked at why, does not restore autonomy immediately.
pub const SUSPENSION_DAYS: i64 = 7;

/// Roles that may grant or withdraw autonomy.
///
/// Narrower than the roles that may confirm these actions by hand. Approving
/// one task is an operational decision; deciding that a class of task no longer
/// needs approving is a policy one.
const GRANTING_ROLES: &[&str] = &["owner", "admin"];

/// The kinds autonomy can ever apply to.
///
/// Derived from `executes_on_approval` rather than restated, so a kind that
/// stops completing on approval also stops being eligible without anyone having
/// to remember this list.
pub fn autonomy_capable(kind: ActionKind) -> bool {
    kind.executes_on_approval()
}

pub fn capable_kinds() -> Vec<ActionKind> {
    ActionKind::all()
        .into_iter()
        .filter(|kind| autonomy_capable(*kind))
        .collect()
}

pub fn may_grant(role: &str) -> bool {
    GRANTING_ROLES.contains(&role.trim().to_ascii_lowercase().as_str())
}

/// Why a kind is not acting on its own, when it is not.
///
/// Ordered from most to least fundamental, because a caller shows one reason
/// and the most fundamental one is the useful one: telling someone their
/// approval rate is 91% is noise if the kind could never be autonomous anyway.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutonomyBlock {
    NotCapable,
    Suspended,
    NotEnabled,
    TooFewDecisions,
    ApprovalRateTooLow,
    RecentlyUndone,
}

impl AutonomyBlock {
    pub fn name(self) -> &'static str {
        match self {
            Self::NotCapable => "not_capable",
            Self::Suspended => "suspended",
            Self::NotEnabled => "not_enabled",
            Self::TooFewDecisions => "too_few_decisions",
            Self::ApprovalRateTooLow => "approval_rate_too_low",
            Self::RecentlyUndone => "recently_undone",
        }
    }
}

/// Where one action kind stands, in full.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyStatus {
    pub action_type: String,
    /// Whether this kind could ever act on its own.
    pub capable: bool,
    /// Whether the measured history clears the bar right now.
    pub earned: bool,
    /// Whether a person has switched it on.
    pub enabled: bool,
    /// `earned && enabled && !suspended`: whether the next proposal will run.
    pub autonomous: bool,
    pub decided: i64,
    pub approved: i64,
    pub undone: i64,
    /// `None` below `MIN_DECISIONS`, for the same reason a prediction hit rate
    /// is withheld on a thin sample.
    pub approval_percent: Option<f64>,
    pub window_days: i32,
    pub suspended_until: Option<DateTime<Utc>>,
    pub suspended_reason: String,
    pub enabled_by: String,
    pub enabled_at: Option<DateTime<Utc>>,
    pub blocked_by: Option<String>,
    /// The whole position in one sentence, so a caller cannot render the state
    /// without the reason for it.
    pub statement: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyGrantRequest {
    pub action_type: String,
    pub enabled: bool,
}

/// Percentage of decisions that were approvals, withheld on a thin sample.
fn approval_percent(decided: i64, approved: i64) -> Option<f64> {
    if decided < MIN_DECISIONS {
        return None;
    }
    Some((approved as f64 / decided as f64) * 100.0)
}

/// The single reason a kind is not autonomous, or `None` when it is.
fn blocking_reason(
    kind: ActionKind,
    enabled: bool,
    suspended: bool,
    decided: i64,
    approved: i64,
    undone: i64,
) -> Option<AutonomyBlock> {
    if !autonomy_capable(kind) {
        return Some(AutonomyBlock::NotCapable);
    }
    if suspended {
        return Some(AutonomyBlock::Suspended);
    }
    // An undo is checked before the grant, because "this was reversed" is worth
    // saying even to someone looking at a kind they have not switched on.
    if undone > 0 {
        return Some(AutonomyBlock::RecentlyUndone);
    }
    if decided < MIN_DECISIONS {
        return Some(AutonomyBlock::TooFewDecisions);
    }
    match approval_percent(decided, approved) {
        Some(percent) if percent <= APPROVAL_BAR_PERCENT => {
            return Some(AutonomyBlock::ApprovalRateTooLow)
        }
        None => return Some(AutonomyBlock::TooFewDecisions),
        _ => {}
    }
    if !enabled {
        return Some(AutonomyBlock::NotEnabled);
    }
    None
}

fn statement(
    status_kind: ActionKind,
    block: Option<AutonomyBlock>,
    decided: i64,
    approved: i64,
) -> String {
    let label = status_kind.name().replace('_', " ");
    match block {
        None => format!(
            "Running without confirmation: {approved} of the last {decided} proposals were approved, and an owner has switched this on. Every run can be undone for {UNDO_WINDOW_HOURS} hours."
        ),
        Some(AutonomyBlock::NotCapable) => format!(
            "{label} always opens its own CRM screen, so it is never completed by the copilot."
        ),
        Some(AutonomyBlock::Suspended) => format!(
            "Paused after a run was undone. An owner has to switch this back on once the reason has been checked."
        ),
        Some(AutonomyBlock::RecentlyUndone) => format!(
            "A run in the last {DECISION_WINDOW_DAYS} days was undone, so confirmation is required until that falls out of the window."
        ),
        Some(AutonomyBlock::TooFewDecisions) => format!(
            "Not enough decisions yet to judge: {decided} of the {MIN_DECISIONS} needed in the last {DECISION_WINDOW_DAYS} days."
        ),
        Some(AutonomyBlock::ApprovalRateTooLow) => format!(
            "People still change their mind about these: {approved} of {decided} were approved, and more than {APPROVAL_BAR_PERCENT:.0}% is required."
        ),
        Some(AutonomyBlock::NotEnabled) => format!(
            "Eligible — {approved} of the last {decided} proposals were approved — but an owner has not switched it on."
        ),
    }
}

/// Where one kind stands in one branch.
pub async fn status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: ActionKind,
) -> Result<AutonomyStatus, AppError> {
    let grant = repository::grant(db, tenant_id, branch_id, kind.name())
        .await
        .map_err(|error| {
            tracing::error!(%error, action = kind.name(), "failed to read the autonomy grant");
            AppError::internal("failed to read the autonomy setting")
        })?;
    let history = repository::decisions(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        DECISION_WINDOW_DAYS,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, action = kind.name(), "failed to read the decision history");
        AppError::internal("failed to read the action decision history")
    })?;

    let now = Utc::now();
    let suspended_until = grant.as_ref().and_then(|row| row.suspended_until);
    let suspended = suspended_until.is_some_and(|until| until > now);
    let enabled = grant.as_ref().is_some_and(|row| row.enabled);

    let block = blocking_reason(
        kind,
        enabled,
        suspended,
        history.decided,
        history.approved,
        history.undone,
    );
    // "Earned" is the measured half alone: it stays true for a kind nobody has
    // switched on, which is what lets the settings screen show that the option
    // is available rather than hiding it until someone guesses.
    let earned = !matches!(
        block,
        Some(AutonomyBlock::NotCapable)
            | Some(AutonomyBlock::Suspended)
            | Some(AutonomyBlock::RecentlyUndone)
            | Some(AutonomyBlock::TooFewDecisions)
            | Some(AutonomyBlock::ApprovalRateTooLow)
    );

    Ok(AutonomyStatus {
        action_type: kind.name().into(),
        capable: autonomy_capable(kind),
        earned,
        enabled,
        autonomous: block.is_none(),
        decided: history.decided,
        approved: history.approved,
        undone: history.undone,
        approval_percent: approval_percent(history.decided, history.approved),
        window_days: DECISION_WINDOW_DAYS,
        suspended_until,
        suspended_reason: grant
            .as_ref()
            .map(|row| row.suspended_reason.clone())
            .unwrap_or_default(),
        enabled_by: grant
            .as_ref()
            .map(|row| row.enabled_by.clone())
            .unwrap_or_default(),
        enabled_at: grant.as_ref().and_then(|row| row.enabled_at),
        blocked_by: block.map(|reason| reason.name().to_string()),
        statement: statement(kind, block, history.decided, history.approved),
    })
}

/// Every autonomy-capable kind's standing, for the settings screen.
pub async fn statuses(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AutonomyStatus>, AppError> {
    let mut rows = Vec::new();
    for kind in capable_kinds() {
        rows.push(status(db, tenant_id, branch_id, kind).await?);
    }
    Ok(rows)
}

/// Whether the next proposal of this kind may run without asking.
///
/// Deliberately returns a plain `bool` and swallows read failures as `false`:
/// this is consulted on the drafting path, and a database hiccup must produce a
/// confirmation prompt rather than either an error or an unreviewed write.
pub async fn may_run_without_confirmation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: ActionKind,
) -> bool {
    if !autonomy_capable(kind) {
        return false;
    }
    match status(db, tenant_id, branch_id, kind).await {
        Ok(status) => status.autonomous,
        Err(error) => {
            tracing::warn!(
                action = kind.name(),
                error = error.message(),
                "could not read autonomy status; asking for confirmation"
            );
            false
        }
    }
}

/// Grants or withdraws autonomy for one kind.
pub async fn set_grant(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    user_id: &str,
    request: AutonomyGrantRequest,
) -> Result<AutonomyStatus, AppError> {
    if !may_grant(role) {
        return Err(AppError::forbidden(
            "only an owner or admin can change whether the copilot acts without confirmation",
        ));
    }
    let kind = ActionKind::from_name(request.action_type.trim())
        .filter(|kind| autonomy_capable(*kind))
        .ok_or_else(|| {
            AppError::validation(
                "that action always opens its own CRM screen, so it cannot run without confirmation",
            )
        })?;

    repository::set_enabled(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        request.enabled,
        user_id,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, action = kind.name(), "failed to store the autonomy grant");
        AppError::internal("failed to save the autonomy setting")
    })?;

    tracing::info!(
        tenant_id,
        branch_id,
        action = kind.name(),
        enabled = request.enabled,
        actor = user_id,
        "copilot autonomy grant changed"
    );
    status(db, tenant_id, branch_id, kind).await
}

/// Records that an autonomous run was undone, and takes the grant away.
///
/// The caller reverses the CRM write first; this closes the record and applies
/// the consequence. Returns `false` when there was nothing to undo — the window
/// closed, someone else undid it, or the run was a person's decision, which is
/// theirs and not reversible through this path.
pub async fn record_undo(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    kind: ActionKind,
    user_id: &str,
    reason: &str,
) -> Result<bool, AppError> {
    let undone = repository::mark_undone(db, tenant_id, branch_id, draft_id, user_id, reason)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to record an autonomy undo");
            AppError::internal("failed to record the undo")
        })?;
    if !undone {
        return Ok(false);
    }

    let until = Utc::now() + Duration::days(SUSPENSION_DAYS);
    if let Err(error) = repository::suspend(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        until,
        "an autonomous run was undone",
    )
    .await
    {
        // The reversal itself already landed. Failing to suspend must be loud,
        // but it must not report the undo as having failed when it did not.
        tracing::error!(%error, action = kind.name(), "undo recorded but autonomy was not suspended");
    }
    tracing::warn!(
        tenant_id,
        branch_id,
        action = kind.name(),
        actor = user_id,
        "autonomous run undone; autonomy withdrawn for this action"
    );
    Ok(true)
}

/// Autonomous runs a person can still take back.
pub async fn undoable(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AutonomousRun>, AppError> {
    repository::undoable_runs(db, tenant_id, branch_id, 50)
        .await
        .map_err(|_| AppError::internal("failed to list reversible copilot runs"))
}

/// When an autonomous run stops being reversible.
pub fn undo_deadline_from(decided_at: DateTime<Utc>) -> DateTime<Utc> {
    decided_at + Duration::hours(UNDO_WINDOW_HOURS)
}

/// The guarantees that make acting without a click safe.
#[cfg(test)]
mod autonomy_tests {
    use super::*;

    /// The boundary that matters most: nothing on the always-explicit list can
    /// be reached from here, whatever the approval history says.
    #[test]
    fn nothing_that_moves_money_or_reaches_a_client_is_ever_capable() {
        for kind in ActionKind::all() {
            if !autonomy_capable(kind) {
                continue;
            }
            assert!(
                !crate::services::ai_action_service::ALWAYS_EXPLICIT_APPROVAL
                    .iter()
                    .any(|reserved| kind.name().contains(reserved)),
                "{} must never run without confirmation",
                kind.name()
            );
        }
    }

    /// Only the three task-shaped kinds are eligible. If this changes, it must
    /// be because `executes_on_approval` changed — which is a deliberate act.
    #[test]
    fn only_task_shaped_kinds_are_capable() {
        let capable: Vec<&str> = capable_kinds().iter().map(|kind| kind.name()).collect();
        assert_eq!(
            capable,
            vec![
                "create_follow_up_task",
                "create_coaching_task",
                "create_membership_follow_up"
            ]
        );
    }

    /// Navigation kinds complete nothing, so autonomy over them would be
    /// meaningless as well as unsafe.
    #[test]
    fn a_kind_that_only_opens_a_screen_is_never_capable() {
        assert!(!autonomy_capable(ActionKind::OpenClientProfile));
        assert!(!autonomy_capable(ActionKind::ContinueBilling));
        assert!(!autonomy_capable(ActionKind::CreateOfferDraft));
    }

    #[test]
    fn only_an_owner_or_admin_may_grant_autonomy() {
        assert!(may_grant("owner"));
        assert!(may_grant("Admin"));
        assert!(!may_grant("manager"));
        assert!(!may_grant("receptionist"));
        assert!(!may_grant("staff"));
    }

    fn block(
        enabled: bool,
        suspended: bool,
        decided: i64,
        approved: i64,
        undone: i64,
    ) -> Option<AutonomyBlock> {
        blocking_reason(
            ActionKind::CreateFollowUpTask,
            enabled,
            suspended,
            decided,
            approved,
            undone,
        )
    }

    #[test]
    fn a_clean_record_with_a_grant_runs_without_confirmation() {
        assert_eq!(block(true, false, 40, 40, 0), None);
    }

    /// Being right is not consent. A kind with a perfect record still waits for
    /// someone to switch it on.
    #[test]
    fn a_perfect_record_alone_does_not_grant_autonomy() {
        assert_eq!(
            block(false, false, 100, 100, 0),
            Some(AutonomyBlock::NotEnabled)
        );
    }

    /// And consent is not evidence. Switching it on cannot skip the bar.
    #[test]
    fn a_grant_alone_does_not_create_autonomy() {
        assert_eq!(
            block(true, false, 4, 4, 0),
            Some(AutonomyBlock::TooFewDecisions)
        );
        assert_eq!(
            block(true, false, 40, 30, 0),
            Some(AutonomyBlock::ApprovalRateTooLow)
        );
    }

    /// One refusal in twenty is enough to say the confirmation step still
    /// carries information, so equalling the bar does not clear it.
    #[test]
    fn the_approval_bar_sits_just_above_one_refusal_in_twenty() {
        assert_eq!(block(true, false, 20, 20, 0), None);
        assert_eq!(
            block(true, false, 20, 19, 0),
            Some(AutonomyBlock::ApprovalRateTooLow),
            "exactly 95% is one refusal in twenty, which is not yet earned"
        );
        // A larger sample can carry a refusal and still clear the bar, because
        // what is measured is the rate, not the raw count.
        assert_eq!(block(true, false, 100, 96, 0), None);
        assert_eq!(
            block(true, false, 100, 95, 0),
            Some(AutonomyBlock::ApprovalRateTooLow)
        );
    }

    /// A single undo blocks the kind even with an otherwise spotless record: a
    /// reversal is the clearest statement that the proposal was wrong.
    #[test]
    fn one_undo_blocks_the_kind_despite_a_spotless_record() {
        assert_eq!(
            block(true, false, 200, 200, 1),
            Some(AutonomyBlock::RecentlyUndone)
        );
    }

    /// A suspension outranks everything except capability, so a grant restored
    /// too soon does not restore autonomy with it.
    #[test]
    fn a_suspension_outranks_a_restored_grant() {
        assert_eq!(
            block(true, true, 200, 200, 0),
            Some(AutonomyBlock::Suspended)
        );
    }

    #[test]
    fn an_incapable_kind_is_blocked_before_anything_else_is_considered() {
        assert_eq!(
            blocking_reason(ActionKind::OpenClientProfile, true, false, 500, 500, 0),
            Some(AutonomyBlock::NotCapable)
        );
    }

    /// A rate is withheld on a thin sample, exactly as a prediction's is.
    #[test]
    fn an_approval_rate_is_not_stated_from_too_few_decisions() {
        assert!(approval_percent(MIN_DECISIONS - 1, 19).is_none());
        assert_eq!(approval_percent(MIN_DECISIONS, 19), Some(95.0));
    }

    /// Whatever the state, the sentence explains it — a caller cannot render
    /// "off" without the reason.
    #[test]
    fn every_state_explains_itself() {
        for reason in [
            None,
            Some(AutonomyBlock::NotCapable),
            Some(AutonomyBlock::Suspended),
            Some(AutonomyBlock::NotEnabled),
            Some(AutonomyBlock::TooFewDecisions),
            Some(AutonomyBlock::ApprovalRateTooLow),
            Some(AutonomyBlock::RecentlyUndone),
        ] {
            let sentence = statement(ActionKind::CreateFollowUpTask, reason, 40, 39);
            assert!(!sentence.is_empty());
            assert!(sentence.ends_with('.'), "{sentence}");
        }
    }

    // -----------------------------------------------------------------------
    // The whole loop, against a real database: earn it, run without asking,
    // take it back, and go back to asking. Needs `DATABASE_URL`; skips without.
    // -----------------------------------------------------------------------

    use crate::services::ai_action_service::{self, CreateDraftRequest};
    use sqlx::postgres::PgPoolOptions;
    use sqlx::PgPool;

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    /// Seeds an isolated tenant and branch.
    ///
    /// Scope ids are set explicitly rather than left blank and looked up
    /// afterwards: a shared test database accumulates rows with blank scope
    /// ids, and a lookup by one of those matches every other test's tenant.
    async fn seed(db: &PgPool) -> (String, String) {
        let tenant_scope = format!("autonomy-t-{}", uuid::Uuid::new_v4().simple());
        let branch_scope = format!("autonomy-b-{}", uuid::Uuid::new_v4().simple());
        sqlx::query("INSERT INTO tenants(name,scope_id) VALUES('Autonomy Salon',$1)")
            .bind(&tenant_scope)
            .execute(db)
            .await
            .expect("tenant is seeded");
        sqlx::query(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),'Main',$2,'South','Hyderabad','Central',TRUE)"#,
        )
        .bind(&tenant_scope)
        .bind(&branch_scope)
        .execute(db)
        .await
        .expect("branch is seeded");
        (tenant_scope, branch_scope)
    }

    /// Writes decisions people already made, which is the only thing that can
    /// make a kind earned.
    async fn seed_decisions(db: &PgPool, tenant: &str, branch: &str, approved: i64, refused: i64) {
        for index in 0..(approved + refused) {
            let status = if index < approved {
                "approved"
            } else {
                "cancelled"
            };
            sqlx::query(
                r#"INSERT INTO ai_action_drafts(
                      tenant_id,branch_id,action_type,status,summary,requires_confirmation,
                      created_by,decided_by,decided_at)
                   VALUES ($1,$2,'create_follow_up_task',$3,'historic',TRUE,'seed','seed',NOW())"#,
            )
            .bind(tenant)
            .bind(branch)
            .bind(status)
            .execute(db)
            .await
            .expect("decision is seeded");
        }
    }

    async fn draft_follow_up(
        db: &PgPool,
        tenant: &str,
        branch: &str,
    ) -> super::super::ai_action_service::ActionDraft {
        ai_action_service::create_draft(
            db,
            tenant,
            branch,
            "manager",
            "user-1",
            CreateDraftRequest {
                action_type: "create_follow_up_task".into(),
                payload: serde_json::json!({"title":"Call Priya about her colour"}),
                summary: "Follow up with Priya".into(),
                evidence: vec!["Last visit 60 days ago".into()],
                source_refs: Vec::new(),
            },
        )
        .await
        .expect("draft is created")
    }

    /// The default. A capable kind with no record still asks, because nothing
    /// has been earned yet.
    #[tokio::test]
    async fn a_capable_kind_with_no_record_still_asks() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;

        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(
            draft.status, "draft",
            "nothing is earned yet, so it must ask"
        );
    }

    /// Evidence without consent changes nothing: a spotless record still waits
    /// for an owner to switch it on.
    #[tokio::test]
    async fn a_perfect_record_without_a_grant_still_asks() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        seed_decisions(&db, &tenant, &branch, 40, 0).await;

        let status = status(&db, &tenant, &branch, ActionKind::CreateFollowUpTask)
            .await
            .expect("status reads");
        assert!(status.earned, "the record clears the bar");
        assert!(!status.autonomous, "but nobody has switched it on");
        assert_eq!(status.blocked_by.as_deref(), Some("not_enabled"));

        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(draft.status, "draft");
    }

    /// And consent without evidence changes nothing either.
    #[tokio::test]
    async fn a_grant_without_a_record_still_asks() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        set_grant(
            &db,
            &tenant,
            &branch,
            "owner",
            "owner-1",
            AutonomyGrantRequest {
                action_type: "create_follow_up_task".into(),
                enabled: true,
            },
        )
        .await
        .expect("grant is stored");

        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(
            draft.status, "draft",
            "a grant cannot skip the measured bar"
        );
    }

    /// Earned and granted: the proposal completes, is marked as the copilot's
    /// own decision, and opens an undo window.
    #[tokio::test]
    async fn an_earned_and_granted_kind_runs_without_confirmation() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        seed_decisions(&db, &tenant, &branch, 40, 0).await;
        set_grant(
            &db,
            &tenant,
            &branch,
            "owner",
            "owner-1",
            AutonomyGrantRequest {
                action_type: "create_follow_up_task".into(),
                enabled: true,
            },
        )
        .await
        .expect("grant is stored");

        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(draft.status, "approved", "it ran without being asked");

        let (mode, deadline, task_status): (String, Option<DateTime<Utc>>, Option<String>) =
            sqlx::query_as(
                r#"SELECT d.decision_mode, d.undo_deadline,
                          (SELECT t.status FROM staff_tasks t WHERE t.origin_action_draft_id=d.id)
                     FROM ai_action_drafts d WHERE d.id=$1"#,
            )
            .bind(&draft.id)
            .fetch_one(&db)
            .await
            .expect("the run is readable");
        assert_eq!(mode, "autonomous");
        assert!(deadline.is_some(), "an autonomous run must be reversible");
        assert_eq!(
            task_status.as_deref(),
            Some("open"),
            "the CRM task itself must actually exist"
        );
    }

    /// The undo is the review step moved after the fact: it reverses the write,
    /// takes the grant away, and puts the kind back to asking.
    #[tokio::test]
    async fn an_undo_reverses_the_task_and_withdraws_the_grant() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        seed_decisions(&db, &tenant, &branch, 40, 0).await;
        set_grant(
            &db,
            &tenant,
            &branch,
            "owner",
            "owner-1",
            AutonomyGrantRequest {
                action_type: "create_follow_up_task".into(),
                enabled: true,
            },
        )
        .await
        .expect("grant is stored");
        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(draft.status, "approved");

        ai_action_service::undo_draft(
            &db,
            &tenant,
            &branch,
            "manager",
            "user-2",
            &draft.id,
            "not needed",
        )
        .await
        .expect("the run is undone");

        let task_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM staff_tasks WHERE origin_action_draft_id=$1")
                .bind(&draft.id)
                .fetch_optional(&db)
                .await
                .expect("task is readable")
                .flatten();
        assert_eq!(
            task_status.as_deref(),
            Some("cancelled"),
            "the CRM write must actually be reversed"
        );

        let after = status(&db, &tenant, &branch, ActionKind::CreateFollowUpTask)
            .await
            .expect("status reads");
        assert!(!after.enabled, "the grant is withdrawn by the undo");
        assert!(!after.autonomous);
        assert_eq!(after.blocked_by.as_deref(), Some("suspended"));

        // And the very next proposal asks again.
        let next = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(next.status, "draft");
    }

    /// Undoing twice must not double-count as two reversals, and the second
    /// caller is told rather than silently succeeding.
    #[tokio::test]
    async fn a_run_can_only_be_undone_once() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        seed_decisions(&db, &tenant, &branch, 40, 0).await;
        set_grant(
            &db,
            &tenant,
            &branch,
            "owner",
            "owner-1",
            AutonomyGrantRequest {
                action_type: "create_follow_up_task".into(),
                enabled: true,
            },
        )
        .await
        .expect("grant is stored");
        let draft = draft_follow_up(&db, &tenant, &branch).await;

        ai_action_service::undo_draft(&db, &tenant, &branch, "manager", "user-2", &draft.id, "")
            .await
            .expect("first undo lands");
        let second = ai_action_service::undo_draft(
            &db, &tenant, &branch, "manager", "user-3", &draft.id, "",
        )
        .await;
        assert!(second.is_err(), "a run cannot be undone twice");
    }

    /// A human decision is theirs, and is not reversible through the autonomy
    /// path however recent it was.
    #[tokio::test]
    async fn a_human_approval_cannot_be_undone_through_this_path() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        let draft = draft_follow_up(&db, &tenant, &branch).await;
        assert_eq!(draft.status, "draft");

        ai_action_service::confirm_draft(
            &db,
            &tenant,
            &branch,
            "manager",
            "user-1",
            &draft.id,
            ai_action_service::ConfirmDraftRequest {
                idempotency_key: "human-key-1".into(),
            },
        )
        .await
        .expect("a person confirms it");

        let undone = ai_action_service::undo_draft(
            &db, &tenant, &branch, "manager", "user-2", &draft.id, "",
        )
        .await;
        assert!(
            undone.is_err(),
            "a person's decision is not the copilot's to reverse"
        );
    }

    /// A kind that only opens a screen cannot be granted autonomy at all, so
    /// the boundary cannot be crossed through configuration.
    #[tokio::test]
    async fn an_incapable_kind_cannot_be_granted_autonomy() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;

        for action_type in [
            "open_client_profile",
            "create_offer_draft",
            "continue_billing",
        ] {
            let refused = set_grant(
                &db,
                &tenant,
                &branch,
                "owner",
                "owner-1",
                AutonomyGrantRequest {
                    action_type: action_type.into(),
                    enabled: true,
                },
            )
            .await;
            assert!(refused.is_err(), "{action_type} must not be grantable");
        }
    }

    /// Granting is policy, not an operational click, so a manager cannot do it
    /// even though they may confirm these actions by hand all day.
    #[tokio::test]
    async fn a_manager_cannot_grant_autonomy() {
        let Some(db) = connect().await else { return };
        let (tenant, branch) = seed(&db).await;
        let refused = set_grant(
            &db,
            &tenant,
            &branch,
            "manager",
            "manager-1",
            AutonomyGrantRequest {
                action_type: "create_follow_up_task".into(),
                enabled: true,
            },
        )
        .await;
        assert!(refused.is_err());
    }

    #[test]
    fn the_undo_window_is_a_day_from_the_decision() {
        let decided = Utc::now();
        assert_eq!(
            undo_deadline_from(decided) - decided,
            Duration::hours(UNDO_WINDOW_HOURS)
        );
    }
}
