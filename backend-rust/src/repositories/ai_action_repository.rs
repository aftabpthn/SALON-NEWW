//! Persistence for approval-gated action drafts.
//!
//! Every query is scoped by tenant and branch, and the state transitions are
//! conditional: a draft only moves out of `draft` if it is still in `draft`, so
//! two concurrent confirmations cannot both approve it.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ActionDraftRecord {
    pub id: String,
    pub action_type: String,
    pub status: String,
    pub summary: String,
    pub requires_confirmation: bool,
    pub payload: Value,
    pub refresh_targets: Value,
    pub result: Value,
    pub created_at: DateTime<Utc>,
}

const COLUMNS: &str = "id,action_type,status,summary,requires_confirmation,payload,refresh_targets,result,created_at";

#[allow(clippy::too_many_arguments)]
pub async fn create_draft(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    action_type: &str,
    summary: &str,
    requires_confirmation: bool,
    payload: &Value,
    refresh_targets: &Value,
    created_by: &str,
) -> Result<ActionDraftRecord, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"INSERT INTO ai_action_drafts(
              tenant_id,branch_id,action_type,summary,requires_confirmation,
              payload,refresh_targets,created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING {COLUMNS}"#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(action_type)
    .bind(summary)
    .bind(requires_confirmation)
    .bind(payload)
    .bind(refresh_targets)
    .bind(created_by)
    .fetch_one(db)
    .await
}

pub async fn by_id(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
) -> Result<Option<ActionDraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM ai_action_drafts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .fetch_optional(db)
    .await
}

/// Looks up what a previously used confirmation key produced.
///
/// Scoped to the tenant and branch; the service also binds the key to the
/// requested draft before returning a replay.
pub async fn by_idempotency_key(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<ActionDraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM ai_action_drafts WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await
}

/// Atomically claims a draft for execution.
///
/// The claim serves two purposes. It takes the draft out of reach of
/// cancellation, which only touches `status='draft'`, so a confirmation that
/// has begun cannot be cancelled out from under itself. And it records who is
/// executing and since when, so a claim that never finished is visible.
///
/// `executing` is deliberately re-claimable. A process that crashes between the
/// CRM write and the approval leaves the row claimed forever otherwise, and a
/// timeout would only trade that for a guess. Exactly-once does not rest on the
/// claim being exclusive: it rests on the CRM record carrying the draft's
/// identity under a unique index, so a re-run finds the existing record instead
/// of writing a second one. What stays exclusive is the *approval* — only one
/// caller can move the row to `approved`.
pub async fn claim_for_execution(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    claimed_by: &str,
) -> Result<Option<ActionDraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"UPDATE ai_action_drafts
              SET status='executing',claimed_by=$4,claimed_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND status IN ('draft','executing')
            RETURNING {COLUMNS}"#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(claimed_by)
    .fetch_optional(db)
    .await
}

/// Release a claim after a failed CRM write, so the draft can be retried.
///
/// The draft goes back to `draft` rather than to a failed terminal state: the
/// write did not happen, so there is nothing to record except that it is once
/// again undecided.
pub async fn release_claim(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_action_drafts
              SET status='draft',claimed_by='',claimed_at=NULL
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='executing'"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .execute(db)
    .await?;
    Ok(())
}

/// Records approval, but only if the row is still undecided.
///
/// Accepts `executing` as well as `draft` so the caller that won
/// `claim_for_execution` can finalise its own claim. Returns `None` when the
/// row was already decided, which is how a lost race is detected rather than
/// silently approving twice.
pub async fn mark_approved(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    idempotency_key: &str,
    result: &Value,
    decided_by: &str,
) -> Result<Option<ActionDraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"UPDATE ai_action_drafts
              SET status='approved',
                  idempotency_key=$4,
                  result=$5,
                  decided_by=$6,
                  decided_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND status IN ('draft','executing')
            RETURNING {COLUMNS}"#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(idempotency_key)
    .bind(result)
    .bind(decided_by)
    .fetch_optional(db)
    .await
}

pub async fn cancel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
    decided_by: &str,
) -> Result<Option<ActionDraftRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"UPDATE ai_action_drafts
              SET status='cancelled', decided_by=$4, decided_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND status='draft'
            RETURNING {COLUMNS}"#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(decided_by)
    .fetch_optional(db)
    .await
}

/// Appends an audit entry. Never updates, so the trail cannot be rewritten.
#[allow(clippy::too_many_arguments)]
pub async fn record_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: Option<&str>,
    action_type: &str,
    event: &str,
    actor_id: &str,
    actor_role: &str,
    detail: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ai_action_audit(
              tenant_id,branch_id,draft_id,action_type,event,actor_id,actor_role,detail
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .bind(action_type)
    .bind(event)
    .bind(actor_id)
    .bind(actor_role)
    .bind(detail)
    .execute(db)
    .await
    .map(|_| ())
}
