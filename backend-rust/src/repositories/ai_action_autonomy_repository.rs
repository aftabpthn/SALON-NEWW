//! Persistence for earned autonomy.
//!
//! Two things live here and they are deliberately separate. The *grant* is
//! configuration: a row someone wrote. The *record* is history: decisions
//! people already made, which nothing in this module can edit. Eligibility is
//! computed from the second and can never be asserted through the first.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// The stored grant for one action kind in one branch.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyGrant {
    pub action_type: String,
    pub enabled: bool,
    pub enabled_by: String,
    pub enabled_at: Option<DateTime<Utc>>,
    pub suspended_until: Option<DateTime<Utc>>,
    pub suspended_reason: String,
}

/// Decisions already taken for one action kind, from which the bar is measured.
#[derive(Debug, Clone, FromRow)]
pub struct DecisionRecord {
    pub decided: i64,
    pub approved: i64,
    /// Autonomous runs that were undone. Any at all blocks the kind: a reversal
    /// is the clearest possible statement that the proposal was wrong.
    pub undone: i64,
}

/// The grant for one kind, or `None` when nobody has ever configured it.
pub async fn grant(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
) -> Result<Option<AutonomyGrant>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT action_type, enabled, enabled_by, enabled_at, suspended_until, suspended_reason
             FROM ai_action_autonomy
            WHERE tenant_id=$1 AND branch_id=$2 AND action_type=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_type)
    .fetch_optional(db)
    .await
}

/// Every grant in a branch, for the settings screen.
pub async fn grants(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AutonomyGrant>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT action_type, enabled, enabled_by, enabled_at, suspended_until, suspended_reason
             FROM ai_action_autonomy
            WHERE tenant_id=$1 AND branch_id=$2
            ORDER BY action_type"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

/// Turns a kind's grant on or off.
///
/// Enabling always clears a suspension: the person switching it back on is
/// making that call knowingly, and leaving an invisible suspension in place
/// would mean the toggle silently did nothing.
pub async fn set_enabled(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
    enabled: bool,
    actor_user_id: &str,
) -> Result<AutonomyGrant, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_action_autonomy(
              tenant_id,branch_id,action_type,enabled,enabled_by,enabled_at,
              suspended_until,suspended_reason)
            VALUES ($1,$2,$3,$4,
                    CASE WHEN $4 THEN $5 ELSE '' END,
                    CASE WHEN $4 THEN NOW() ELSE NULL END,
                    NULL,'')
            ON CONFLICT (tenant_id,branch_id,action_type) DO UPDATE
              SET enabled=EXCLUDED.enabled,
                  enabled_by=EXCLUDED.enabled_by,
                  enabled_at=EXCLUDED.enabled_at,
                  suspended_until=NULL,
                  suspended_reason='',
                  updated_at=NOW()
            RETURNING action_type, enabled, enabled_by, enabled_at, suspended_until, suspended_reason"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_type)
    .bind(enabled)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

/// Suspends a kind after an undo, and withdraws the grant with it.
///
/// Both at once on purpose. Clearing only the suspension date later would put a
/// kind straight back into autonomous operation without anyone re-deciding; the
/// person who wants it back has to switch it on again.
pub async fn suspend(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
    until: DateTime<Utc>,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ai_action_autonomy(
              tenant_id,branch_id,action_type,enabled,enabled_by,enabled_at,
              suspended_until,suspended_reason)
            VALUES ($1,$2,$3,FALSE,'',NULL,$4,$5)
            ON CONFLICT (tenant_id,branch_id,action_type) DO UPDATE
              SET enabled=FALSE,
                  enabled_by='',
                  enabled_at=NULL,
                  suspended_until=EXCLUDED.suspended_until,
                  suspended_reason=EXCLUDED.suspended_reason,
                  updated_at=NOW()"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_type)
    .bind(until)
    .bind(reason)
    .execute(db)
    .await
    .map(|_| ())
}

/// The branch's own decision history for one kind, over a recent window.
///
/// Counts decisions, not drafts: a proposal still sitting unanswered says
/// nothing about whether people agree with it, and counting it either way would
/// let an unattended queue move the bar.
pub async fn decisions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
    window_days: i32,
) -> Result<DecisionRecord, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT AS decided,
                  COUNT(*) FILTER (WHERE status IN ('approved','executed'))::BIGINT AS approved,
                  COUNT(*) FILTER (WHERE undone_at IS NOT NULL)::BIGINT AS undone
             FROM ai_action_drafts
            WHERE tenant_id=$1 AND branch_id=$2 AND action_type=$3
              AND decided_at IS NOT NULL
              -- 'approved' is the current vocabulary; 'executed' is pre-0308
              -- data the CHECK still permits. A decision is either, or a refusal.
              AND status IN ('approved','executed','cancelled')
              AND decided_at >= NOW() - MAKE_INTERVAL(days => $4)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_type)
    .bind(window_days)
    .fetch_one(db)
    .await
}

/// Marks a draft as having been decided by the copilot rather than a person,
/// and opens its undo window.
pub async fn mark_autonomous(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    undo_deadline: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_action_drafts
              SET decision_mode='autonomous', undo_deadline=$4
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(undo_deadline)
    .execute(db)
    .await
    .map(|_| ())
}

/// Records an undo, but only for an autonomous run still inside its window and
/// not already undone.
///
/// The conditions live in the `WHERE` clause rather than in a prior read so
/// that two people clicking undo at once cannot both succeed — the second finds
/// nothing to update and is told so.
pub async fn mark_undone(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    actor_user_id: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_action_drafts
              SET undone_at=NOW(), undone_by=$4, undo_reason=$5
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND decision_mode='autonomous'
              AND status IN ('approved','executed')
              AND undone_at IS NULL
              AND undo_deadline IS NOT NULL
              AND undo_deadline > NOW()"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(actor_user_id)
    .bind(reason)
    .execute(db)
    .await
    .map(|result| result.rows_affected() == 1)
}

/// Autonomous runs still inside their undo window, newest first.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRun {
    pub id: String,
    pub action_type: String,
    pub summary: String,
    pub decided_at: Option<DateTime<Utc>>,
    pub undo_deadline: Option<DateTime<Utc>>,
}

pub async fn undoable_runs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<AutonomousRun>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, action_type, summary, decided_at, undo_deadline
             FROM ai_action_drafts
            WHERE tenant_id=$1 AND branch_id=$2
              AND decision_mode='autonomous'
              AND status IN ('approved','executed')
              AND undone_at IS NULL
              AND undo_deadline IS NOT NULL
              AND undo_deadline > NOW()
            ORDER BY decided_at DESC
            LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit)
    .fetch_all(db)
    .await
}
