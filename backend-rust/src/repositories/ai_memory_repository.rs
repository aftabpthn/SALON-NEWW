//! Persistence for copilot memory.
//!
//! Every read here filters on `expires_at > NOW()` rather than relying on the
//! retention sweep having run. The sweep deletes; the reads decide what is
//! *live*. Keeping those separate means a worker that is late, wedged or
//! switched off cannot cause an expired note to be recalled — the worst it can
//! do is leave a row on disk slightly longer than intended.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// A note as it is recalled.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNote {
    pub id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub source: String,
    pub content: String,
    pub sensitive: bool,
    pub recorded_by: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    /// Set when the client said this is wrong. While it is set and unresolved
    /// the note is withheld from every recall path.
    pub disputed_at: Option<DateTime<Utc>>,
    pub dispute_reason: String,
    pub dispute_resolved_at: Option<DateTime<Utc>>,
    /// `corrected` when the salon agreed and removed it, `upheld` when they
    /// kept it. Empty while a dispute is open or was never raised.
    pub dispute_outcome: String,
}

/// Records a note, or extends the one that already says the same thing.
///
/// Re-recording an existing fact moves its expiry out rather than stacking a
/// duplicate: two rows saying "prefers ammonia-free colour" would both come
/// back on recall and read as two separate pieces of evidence.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_note(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subject_kind: &str,
    subject_id: &str,
    source: &str,
    content: &str,
    sensitive: bool,
    recorded_by: &str,
    expires_at: DateTime<Utc>,
) -> Result<MemoryNote, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_memory_notes(
              tenant_id,branch_id,subject_kind,subject_id,source,content,
              sensitive,recorded_by,expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (tenant_id,branch_id,subject_kind,subject_id,content) DO UPDATE
              SET expires_at=EXCLUDED.expires_at,
                  sensitive=EXCLUDED.sensitive,
                  source=EXCLUDED.source,
                  recorded_by=EXCLUDED.recorded_by,
                  updated_at=NOW()
            RETURNING id,subject_kind,subject_id,source,content,sensitive,
                      recorded_by,expires_at,created_at,disputed_at,dispute_reason,
                      dispute_resolved_at,dispute_outcome"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(source)
    .bind(content)
    .bind(sensitive)
    .bind(recorded_by)
    .bind(expires_at)
    .fetch_one(db)
    .await
}

/// One subject's live notes, newest first.
///
/// `include_sensitive` is a parameter rather than a filter applied afterwards,
/// so a caller that must not see a health note never receives it in the first
/// place.
pub async fn notes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subject_kind: &str,
    subject_id: &str,
    include_sensitive: bool,
    limit: i64,
) -> Result<Vec<MemoryNote>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,subject_kind,subject_id,source,content,sensitive,
                  recorded_by,expires_at,created_at,disputed_at,dispute_reason,
                  dispute_resolved_at,dispute_outcome
             FROM ai_memory_notes
            WHERE tenant_id=$1 AND branch_id=$2
              AND subject_kind=$3 AND subject_id=$4
              AND expires_at > NOW()
              AND ($5 OR sensitive = FALSE)
              -- A note the client has contested stops being recalled the moment
              -- they say so, before anybody reviews it. Waiting would mean
              -- acting on something we have just been told is wrong.
              AND (disputed_at IS NULL OR dispute_resolved_at IS NOT NULL)
            ORDER BY created_at DESC
            LIMIT $6"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(include_sensitive)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Marks notes as having actually been used.
///
/// Recall is what makes a note worth its retention, so this is the signal that
/// tells a stale note from a useful one when the two look identical on disk.
pub async fn touch_recalled(db: &PgPool, ids: &[String]) -> Result<(), sqlx::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query("UPDATE ai_memory_notes SET last_recalled_at=NOW() WHERE id = ANY($1::TEXT[])")
        .bind(ids)
        .execute(db)
        .await
        .map(|_| ())
}

/// Forgets one note outright.
pub async fn delete_note(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    note_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query("DELETE FROM ai_memory_notes WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(note_id)
        .execute(db)
        .await
        .map(|result| result.rows_affected() == 1)
}

/// Forgets everything about one subject, for a request to be forgotten.
pub async fn forget_subject(
    db: &PgPool,
    tenant_id: &str,
    subject_kind: &str,
    subject_id: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query(
        "DELETE FROM ai_memory_notes WHERE tenant_id=$1 AND subject_kind=$2 AND subject_id=$3",
    )
    .bind(tenant_id)
    .bind(subject_kind)
    .bind(subject_id)
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}

/// Deletes notes that have expired, and notes about clients the CRM no longer
/// holds.
///
/// The second half is an anti-join rather than a hook on the delete paths: a
/// client can leave through deletion, deactivation or a merge, and a rule that
/// depended on every one of those remembering to call this would eventually
/// miss one. Returns how many rows went.
pub async fn purge_expired(db: &PgPool) -> Result<u64, sqlx::Error> {
    let expired = sqlx::query("DELETE FROM ai_memory_notes WHERE expires_at <= NOW()")
        .execute(db)
        .await?
        .rows_affected();

    let orphaned = sqlx::query(
        r#"DELETE FROM ai_memory_notes note
            WHERE note.subject_kind='client'
              AND NOT EXISTS (
                SELECT 1 FROM clients client
                 WHERE client.id=note.subject_id
                   AND client.tenant_id=note.tenant_id
                   AND client.active=TRUE
                   AND client.merged_into_client_id IS NULL
              )"#,
    )
    .execute(db)
    .await?
    .rows_affected();

    Ok(expired + orphaned)
}

/// Everything remembered about the clients one customer account is linked to.
///
/// A customer account can be linked to a client record in more than one branch,
/// so this reads across the link table rather than taking a branch. Sensitive
/// notes are excluded outright: a client asking what is remembered about them is
/// entitled to see it, but a portal page is not the place to surface a health
/// note that a staff member wrote and may not have discussed with them.
pub async fn notes_for_account(
    db: &PgPool,
    account_id: &str,
    limit: i64,
) -> Result<Vec<MemoryNote>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT note.id,note.subject_kind,note.subject_id,note.source,note.content,
                  note.sensitive,note.recorded_by,note.expires_at,note.created_at,
                  note.disputed_at,note.dispute_reason,note.dispute_resolved_at,
                  note.dispute_outcome
             FROM ai_memory_notes note
             JOIN customer_account_clients link
               ON link.tenant_id=note.tenant_id
              AND link.branch_id=note.branch_id
              AND link.client_id=note.subject_id
            WHERE link.account_id=$1
              AND note.subject_kind='client'
              AND note.sensitive = FALSE
              AND note.expires_at > NOW()
            ORDER BY note.created_at DESC
            LIMIT $2"#,
    )
    .bind(account_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Forgets everything remembered about the clients an account is linked to.
///
/// Scoped through the same link table as the read, so an account can only
/// delete its own. Removing memory is never the dangerous direction, which is
/// why this is a customer-facing capability at all.
pub async fn forget_for_account(db: &PgPool, account_id: &str) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM ai_memory_notes note
            USING customer_account_clients link
            WHERE link.account_id=$1
              AND link.tenant_id=note.tenant_id
              AND link.branch_id=note.branch_id
              AND link.client_id=note.subject_id
              AND note.subject_kind='client'"#,
    )
    .bind(account_id)
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}

/// Records a client's dispute, scoped through their own account link.
///
/// The scoping is in the `WHERE` clause rather than a prior read, so an account
/// cannot dispute a note about somebody else even by guessing its id. Returns
/// false when there was nothing of theirs to dispute, or a dispute was already
/// open on it.
pub async fn raise_dispute(
    db: &PgPool,
    account_id: &str,
    note_id: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_memory_notes note
              SET disputed_at=NOW(), dispute_reason=$3,
                  dispute_resolved_at=NULL, dispute_resolved_by='', dispute_outcome='',
                  updated_at=NOW()
             FROM customer_account_clients link
            WHERE link.account_id=$1
              AND link.tenant_id=note.tenant_id
              AND link.branch_id=note.branch_id
              AND link.client_id=note.subject_id
              AND note.id=$2
              AND note.subject_kind='client'
              AND note.disputed_at IS NULL"#,
    )
    .bind(account_id)
    .bind(note_id)
    .bind(reason)
    .execute(db)
    .await
    .map(|result| result.rows_affected() == 1)
}

/// Disputes a branch has not looked at yet.
pub async fn open_disputes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<MemoryNote>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,subject_kind,subject_id,source,content,sensitive,
                  recorded_by,expires_at,created_at,disputed_at,dispute_reason,
                  dispute_resolved_at,dispute_outcome
             FROM ai_memory_notes
            WHERE tenant_id=$1 AND branch_id=$2
              AND disputed_at IS NOT NULL AND dispute_resolved_at IS NULL
            ORDER BY disputed_at DESC
            LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Closes a dispute as upheld, returning the note to use.
///
/// The dispute stays on the row rather than being cleared: a note that was
/// contested and kept is visibly different from one nobody ever questioned, and
/// that difference is worth keeping.
pub async fn uphold_dispute(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    note_id: &str,
    resolved_by: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_memory_notes
              SET dispute_resolved_at=NOW(), dispute_resolved_by=$4,
                  dispute_outcome='upheld', updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
              AND disputed_at IS NOT NULL AND dispute_resolved_at IS NULL"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(note_id)
    .bind(resolved_by)
    .execute(db)
    .await
    .map(|result| result.rows_affected() == 1)
}

/// Removes ordinary notes nobody has needed in a long time.
///
/// A note occupies one of a subject's twenty slots whether or not it is ever
/// useful, so a preference nobody has recalled in half a year is holding a slot
/// something current could use. Recall is the signal: a note that has never been
/// recalled since it was written, or not recalled in the staleness window, has
/// not earned its place.
///
/// Sensitive notes are exempt, and that exemption is the point rather than an
/// oversight. An allergy is not less true because no conversation happened to
/// surface it, and deleting one quietly because a chatbot never mentioned it
/// would be actively harmful. Those already expire on their own shorter clock.
pub async fn prune_unrecalled(db: &PgPool, stale_days: i32) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM ai_memory_notes
            WHERE sensitive = FALSE
              AND (
                (last_recalled_at IS NULL
                   AND created_at < NOW() - MAKE_INTERVAL(days => $1))
                OR last_recalled_at < NOW() - MAKE_INTERVAL(days => $1)
              )"#,
    )
    .bind(stale_days)
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}

/// How many live notes a subject already has, so a cap can be enforced before
/// another is written.
pub async fn live_note_count(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    subject_kind: &str,
    subject_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COUNT(*)::BIGINT FROM ai_memory_notes
            WHERE tenant_id=$1 AND branch_id=$2 AND subject_kind=$3 AND subject_id=$4
              AND expires_at > NOW()"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(subject_kind)
    .bind(subject_id)
    .fetch_one(db)
    .await
}
