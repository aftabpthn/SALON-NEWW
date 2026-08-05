//! Copilot memory: facts somebody chose to keep, recalled across sessions.
//!
//! The semantic index answers "what does the CRM say about this topic". It
//! cannot answer "what did Priya tell us she wants", because that is not a
//! similarity question — it is an exact fact a person decided to keep, and it
//! has to come back the same way every time.
//!
//! Four rules, and each of them is a rule about somebody else's personal
//! information rather than a design preference:
//!
//! * **Memory is recorded, never inferred.** There is no code path by which a
//!   model writes here. A wrong inference stored as durable memory would be
//!   recalled as fact indefinitely and nobody would know where it came from, so
//!   a person writes every note and the row says which person.
//! * **Everything expires.** The retention is chosen at write time, capped, and
//!   enforced on every read rather than trusted to the sweep. A worker that is
//!   late cannot cause an expired note to be recalled.
//! * **Sensitive notes are narrower.** A salon legitimately records an allergy.
//!   Recording it is not the risk; keeping it for a year and repeating it back
//!   over WhatsApp is. Those are kept for a shorter period and never leave the
//!   signed-in app.
//! * **Memory follows its subject.** A client who is deleted, deactivated or
//!   merged takes their notes with them, reconciled on a schedule rather than
//!   through a hook every delete path has to remember.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_memory_repository::{self as repository, MemoryNote},
    services::{
        ai_scope_service::{self, AiDomain},
        auth_service::AuthClaims,
    },
};

/// Default life of an ordinary note.
pub const DEFAULT_RETENTION_DAYS: i64 = 365;

/// Ceiling on any note's life. A caller may ask for less, never more: a note
/// nobody has revisited in two years is a guess about a person, not a fact.
pub const MAX_RETENTION_DAYS: i64 = 730;

/// Life of a note marked sensitive. Deliberately far shorter — the case for
/// keeping health information is an operational one, and operational needs
/// expire.
pub const SENSITIVE_RETENTION_DAYS: i64 = 180;

/// Live notes one subject may hold. A cap rather than a warning: unbounded
/// memory about a person is a profile, and a profile is not what this is for.
pub const MAX_NOTES_PER_SUBJECT: i64 = 20;

/// Notes handed to the assistant for one conversation.
pub const RECALL_LIMIT: i64 = 8;

/// How long an ordinary note may go unrecalled before it is pruned.
///
/// A subject has twenty slots, and a note nobody has needed in half a year is
/// holding one that something current could use. Sensitive notes are exempt:
/// an allergy is not less true because no conversation happened to surface it.
pub const STALE_UNRECALLED_DAYS: i32 = 180;

/// Who or what a note is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubjectKind {
    Client,
    User,
}

impl SubjectKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Client => "client",
            Self::User => "user",
        }
    }

    pub fn from_name(value: &str) -> Option<Self> {
        match value {
            "client" => Some(Self::Client),
            "user" => Some(Self::User),
            _ => None,
        }
    }

    /// The permission domain that governs reading and writing this subject.
    ///
    /// A user's own working preference is not client data and is not gated on
    /// the clients domain; a note about a client is, exactly as a client tool
    /// answer would be.
    fn domain(self) -> Option<AiDomain> {
        match self {
            Self::Client => Some(AiDomain::Clients),
            Self::User => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordNoteRequest {
    pub subject_kind: String,
    pub subject_id: String,
    pub content: String,
    /// `stated_by_client` or `recorded_by_staff`. There is deliberately no
    /// value for a model-derived note.
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub sensitive: bool,
    /// Requested retention. Clamped to the cap for the note's sensitivity.
    #[serde(default)]
    pub retention_days: Option<i64>,
}

/// What the caller gets back, including how long the note will actually last.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedNote {
    #[serde(flatten)]
    pub note: MemoryNote,
    /// Stated because the requested retention is clamped, and a caller that
    /// asked for five years should be told it got one.
    pub retention_statement: String,
}

fn retention_for(sensitive: bool, requested: Option<i64>) -> Duration {
    let ceiling = if sensitive {
        SENSITIVE_RETENTION_DAYS
    } else {
        MAX_RETENTION_DAYS
    };
    let default = if sensitive {
        SENSITIVE_RETENTION_DAYS
    } else {
        DEFAULT_RETENTION_DAYS
    };
    let days = requested.unwrap_or(default).clamp(1, ceiling);
    Duration::days(days)
}

fn normalize_source(value: &str) -> Result<&'static str, AppError> {
    match value.trim() {
        "stated_by_client" => Ok("stated_by_client"),
        "" | "recorded_by_staff" => Ok("recorded_by_staff"),
        // Named explicitly so the refusal explains the rule rather than just
        // rejecting an unknown string.
        "inferred" | "model" | "ai" => Err(AppError::validation(
            "memory records what someone said, not what the assistant concluded",
        )),
        _ => Err(AppError::validation("that memory source is not recognised")),
    }
}

/// Checks the caller may touch this subject's memory at all.
fn require_access(
    claims: &AuthClaims,
    kind: SubjectKind,
    subject_id: &str,
) -> Result<(), AppError> {
    if let Some(domain) = kind.domain() {
        ai_scope_service::require_domain(claims, domain)?;
    }
    // A user note belongs to that user. Reading another operator's working
    // preferences is not a client-data question, so it is not covered by the
    // domain check above and is refused here instead.
    if kind == SubjectKind::User && subject_id != claims.sub {
        return Err(AppError::forbidden(
            "you can only read and write your own copilot preferences",
        ));
    }
    Ok(())
}

/// Records a fact, or extends the one that already says it.
pub async fn record(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    request: RecordNoteRequest,
) -> Result<RecordedNote, AppError> {
    let kind = SubjectKind::from_name(request.subject_kind.trim())
        .ok_or_else(|| AppError::validation("memory is kept about a client or a user"))?;
    let subject_id = request.subject_id.trim();
    if subject_id.is_empty() {
        return Err(AppError::validation("a memory note needs a subject"));
    }
    require_access(claims, kind, subject_id)?;

    let source = normalize_source(&request.source)?;
    let content: String = request.content.trim().chars().take(500).collect();
    if content.is_empty() {
        return Err(AppError::validation("a memory note needs content"));
    }

    // Checked before the write rather than trimmed after it, so the cap is a
    // refusal a person sees rather than an older note silently disappearing.
    let existing = repository::live_note_count(db, tenant_id, branch_id, kind.name(), subject_id)
        .await
        .map_err(|_| AppError::internal("failed to count existing memory"))?;
    if existing >= MAX_NOTES_PER_SUBJECT {
        return Err(AppError::validation(format!(
            "this subject already has the maximum of {MAX_NOTES_PER_SUBJECT} remembered notes; remove one before adding another"
        )));
    }

    let retention = retention_for(request.sensitive, request.retention_days);
    let expires_at = Utc::now() + retention;
    let note = repository::upsert_note(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        subject_id,
        source,
        &content,
        request.sensitive,
        &claims.sub,
        expires_at,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to record a memory note");
        AppError::internal("failed to record that memory")
    })?;

    let days = retention.num_days();
    Ok(RecordedNote {
        note,
        retention_statement: format!(
            "Kept for {days} days, until {}. It is deleted automatically after that, and immediately if the client is removed.",
            expires_at.format("%d %b %Y")
        ),
    })
}

/// One subject's live notes.
pub async fn recall(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    subject_kind: &str,
    subject_id: &str,
) -> Result<Vec<MemoryNote>, AppError> {
    let kind = SubjectKind::from_name(subject_kind.trim())
        .ok_or_else(|| AppError::validation("memory is kept about a client or a user"))?;
    require_access(claims, kind, subject_id.trim())?;

    let notes = repository::notes(
        db,
        tenant_id,
        branch_id,
        kind.name(),
        subject_id.trim(),
        // A signed-in operator who may read clients may see a sensitive note;
        // the restriction that matters is on channels, applied in `for_channel`.
        true,
        MAX_NOTES_PER_SUBJECT,
    )
    .await
    .map_err(|_| AppError::internal("failed to read that memory"))?;
    Ok(notes)
}

/// Notes safe to put in front of the assistant on a given channel.
///
/// The web app is a signed-in operator looking at a client record. WhatsApp and
/// voice reach the client themselves, or someone holding their phone, so a
/// sensitive note never goes there — being right about an allergy is no comfort
/// if it was repeated to the wrong person.
pub async fn for_channel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    channel: &str,
) -> Vec<MemoryNote> {
    if client_id.trim().is_empty() {
        return Vec::new();
    }
    let include_sensitive = channel == "web";
    let notes = match repository::notes(
        db,
        tenant_id,
        branch_id,
        SubjectKind::Client.name(),
        client_id,
        include_sensitive,
        RECALL_LIMIT,
    )
    .await
    {
        Ok(notes) => notes,
        Err(error) => {
            tracing::warn!(%error, "failed to recall client memory; continuing without it");
            return Vec::new();
        }
    };

    let ids: Vec<String> = notes.iter().map(|note| note.id.clone()).collect();
    if let Err(error) = repository::touch_recalled(db, &ids).await {
        tracing::warn!(%error, "failed to record a memory recall");
    }
    notes
}

/// Forgets one note.
pub async fn forget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    note_id: &str,
) -> Result<(), AppError> {
    // Removing memory is never the dangerous direction, so this is gated on the
    // clients domain alone rather than on ownership of the note.
    ai_scope_service::require_domain(claims, AiDomain::Clients)?;
    let removed = repository::delete_note(db, tenant_id, branch_id, note_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to remove that memory"))?;
    if !removed {
        return Err(AppError::not_found("that memory note was not found"));
    }
    Ok(())
}

/// Forgets everything about one client.
pub async fn forget_client(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    client_id: &str,
) -> Result<u64, AppError> {
    ai_scope_service::require_domain(claims, AiDomain::Clients)?;
    repository::forget_subject(db, tenant_id, SubjectKind::Client.name(), client_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to remove that client's memory"))
}

/// What a client can see is remembered about them, through their own portal.
///
/// Read-only in the sense that a client cannot edit a note — a memory they
/// could rewrite would stop being a record of what was said. They can delete
/// it, though: it is information about them, and removing it is never the
/// dangerous direction.
pub async fn for_customer_account(
    db: &PgPool,
    account_id: &str,
) -> Result<Vec<MemoryNote>, AppError> {
    repository::notes_for_account(db, account_id.trim(), MAX_NOTES_PER_SUBJECT)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to read a customer's own memory");
            AppError::internal("failed to read what is remembered about you")
        })
}

/// A client asking to be forgotten, from their own portal.
pub async fn forget_for_customer_account(db: &PgPool, account_id: &str) -> Result<u64, AppError> {
    let removed = repository::forget_for_account(db, account_id.trim())
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to forget a customer's memory on request");
            AppError::internal("failed to remove what is remembered about you")
        })?;
    tracing::info!(removed, "customer erased their own copilot memory");
    Ok(removed)
}

/// A client saying a remembered fact is wrong.
///
/// Erasing was already available and stays the safe fallback, but a silent
/// deletion teaches the salon nothing — they lose the note and never learn it
/// was wrong, so whoever wrote it writes the same thing again next month. A
/// dispute keeps the fact that something was contested, which is the part worth
/// having. The note stops being recalled immediately, before anyone reviews it.
pub async fn dispute_for_customer_account(
    db: &PgPool,
    account_id: &str,
    note_id: &str,
    reason: &str,
) -> Result<(), AppError> {
    let reason: String = reason.trim().chars().take(500).collect();
    let raised = repository::raise_dispute(db, account_id.trim(), note_id.trim(), &reason)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to record a memory dispute");
            AppError::internal("failed to record that")
        })?;
    if !raised {
        return Err(AppError::not_found(
            "that note was not found, or you have already told us about it",
        ));
    }
    tracing::info!("a customer disputed something remembered about them");
    Ok(())
}

/// What clients have contested and nobody has reviewed yet.
pub async fn open_disputes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
) -> Result<Vec<MemoryNote>, AppError> {
    ai_scope_service::require_domain(claims, AiDomain::Clients)?;
    repository::open_disputes(db, tenant_id, branch_id, MAX_NOTES_PER_SUBJECT)
        .await
        .map_err(|_| AppError::internal("failed to read disputed memory"))
}

/// What the salon decided about a contested note.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDisputeRequest {
    /// `corrected` when the client was right and the note goes; `upheld` when
    /// the salon is keeping it. Deliberately only two: "leave it open" is not a
    /// resolution, it is the state it is already in.
    pub outcome: String,
}

/// Closes a dispute.
///
/// `corrected` deletes the note, because agreeing it is wrong and keeping it
/// anyway would be the worst of both. `upheld` returns it to use but leaves the
/// dispute on the record, so a note that was contested and kept stays visibly
/// different from one nobody questioned.
pub async fn resolve_dispute(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    note_id: &str,
    request: ResolveDisputeRequest,
) -> Result<(), AppError> {
    ai_scope_service::require_domain(claims, AiDomain::Clients)?;
    match request.outcome.trim() {
        "corrected" => {
            let removed = repository::delete_note(db, tenant_id, branch_id, note_id.trim())
                .await
                .map_err(|_| AppError::internal("failed to remove that memory"))?;
            if !removed {
                return Err(AppError::not_found("that memory note was not found"));
            }
            Ok(())
        }
        "upheld" => {
            let closed =
                repository::uphold_dispute(db, tenant_id, branch_id, note_id.trim(), &claims.sub)
                    .await
                    .map_err(|_| AppError::internal("failed to close that dispute"))?;
            if !closed {
                return Err(AppError::not_found(
                    "that note has no open dispute to close",
                ));
            }
            Ok(())
        }
        _ => Err(AppError::validation(
            "a dispute is resolved as corrected or upheld",
        )),
    }
}

/// Deletes expired notes and notes about clients the CRM no longer holds.
///
/// Runs on the existing AI retention cycle, alongside transcript purging: it is
/// the same class of obligation and belongs on the same clock rather than on a
/// second one somebody has to remember exists.
pub async fn purge_expired(db: &PgPool) -> Result<u64, AppError> {
    let purged = repository::purge_expired(db)
        .await
        .map_err(|_| AppError::internal("failed to apply memory retention"))?;

    // Staleness pruning is part of retention, not a separate feature: keeping a
    // note nobody has needed in half a year is keeping personal information for
    // no reason, which is the thing retention exists to prevent.
    let pruned = repository::prune_unrecalled(db, STALE_UNRECALLED_DAYS)
        .await
        .map_err(|_| AppError::internal("failed to prune unrecalled memory"))?;
    if pruned > 0 {
        tracing::info!(pruned, "pruned memory notes nobody had recalled");
    }
    Ok(purged + pruned)
}

/// The rules that make keeping notes about a person defensible.
#[cfg(test)]
mod memory_tests {
    use super::*;

    fn claims(role: &str, permissions: &[&str]) -> AuthClaims {
        crate::services::ai_tool_dispatcher::tests_support::claims(role, permissions, &[])
    }

    /// The rule the whole module rests on: there is no way to write a note the
    /// assistant concluded on its own.
    #[test]
    fn a_model_derived_note_cannot_be_recorded() {
        for attempt in ["inferred", "model", "ai"] {
            let refused = normalize_source(attempt);
            assert!(refused.is_err(), "{attempt} must be refused");
            assert!(refused
                .unwrap_err()
                .message()
                .contains("not what the assistant concluded"));
        }
    }

    #[test]
    fn a_recorded_source_defaults_to_the_person_who_wrote_it() {
        assert_eq!(normalize_source("").unwrap(), "recorded_by_staff");
        assert_eq!(
            normalize_source("stated_by_client").unwrap(),
            "stated_by_client"
        );
        assert!(normalize_source("something_else").is_err());
    }

    /// A caller cannot ask for a longer life than the cap, whatever it sends.
    #[test]
    fn retention_is_capped_however_much_is_requested() {
        assert_eq!(
            retention_for(false, Some(10_000)).num_days(),
            MAX_RETENTION_DAYS
        );
        assert_eq!(
            retention_for(true, Some(10_000)).num_days(),
            SENSITIVE_RETENTION_DAYS,
            "a sensitive note is capped harder than an ordinary one"
        );
    }

    /// And cannot ask for zero or a negative life, which would write a note
    /// that is invisible the moment it exists.
    #[test]
    fn retention_is_at_least_a_day() {
        assert_eq!(retention_for(false, Some(0)).num_days(), 1);
        assert_eq!(retention_for(false, Some(-30)).num_days(), 1);
    }

    #[test]
    fn a_sensitive_note_is_kept_for_less_by_default() {
        assert_eq!(
            retention_for(false, None).num_days(),
            DEFAULT_RETENTION_DAYS
        );
        assert_eq!(
            retention_for(true, None).num_days(),
            SENSITIVE_RETENTION_DAYS
        );
        assert!(SENSITIVE_RETENTION_DAYS < DEFAULT_RETENTION_DAYS);
    }

    /// Client memory is client data, and is gated exactly as a client tool is.
    #[test]
    fn client_memory_needs_the_clients_domain() {
        let allowed = claims("receptionist", &["clients.read"]);
        assert!(require_access(&allowed, SubjectKind::Client, "client-1").is_ok());

        let denied = crate::services::ai_tool_dispatcher::tests_support::claims(
            "receptionist",
            &[],
            &["clients.read"],
        );
        assert!(require_access(&denied, SubjectKind::Client, "client-1").is_err());
    }

    /// A user's own preferences are theirs. Reading someone else's is refused
    /// even for a login that may read every client in the branch.
    #[test]
    fn a_user_note_belongs_to_that_user_alone() {
        let owner = claims("owner", &["clients.read"]);
        assert!(require_access(&owner, SubjectKind::User, &owner.sub).is_ok());
        assert!(require_access(&owner, SubjectKind::User, "somebody-else").is_err());
    }

    // -----------------------------------------------------------------------
    // Retention against a real database, which is the half that actually
    // protects anyone. Needs `DATABASE_URL`; skips without it.
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

    async fn seed_client(db: &PgPool, tenant: &str, branch: &str) -> String {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,active)
               VALUES ($1,$2,$3,'Priya','S',TRUE)"#,
        )
        .bind(&id)
        .bind(tenant)
        .bind(branch)
        .execute(db)
        .await
        .expect("client is seeded");
        id
    }

    async fn write_note(
        db: &PgPool,
        tenant: &str,
        branch: &str,
        client: &str,
        content: &str,
        sensitive: bool,
        expires_in_days: i64,
    ) {
        repository::upsert_note(
            db,
            tenant,
            branch,
            "client",
            client,
            "stated_by_client",
            content,
            sensitive,
            "staff-1",
            Utc::now() + Duration::days(expires_in_days),
        )
        .await
        .expect("note is written");
    }

    /// An expired note is not recalled, whether or not the sweep has run. The
    /// reads decide what is live; the sweep only reclaims disk.
    #[tokio::test]
    async fn an_expired_note_is_never_recalled_even_before_the_sweep() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;

        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers morning slots",
            false,
            30,
        )
        .await;
        // An old note whose life has run out. Both timestamps move, because
        // `ck_ai_memory_notes_expiry` refuses a note that expires before it was
        // created — a note cannot be born expired.
        sqlx::query(
            r#"UPDATE ai_memory_notes
                  SET created_at=NOW() - INTERVAL '400 days',
                      expires_at=NOW() - INTERVAL '1 day'
                WHERE tenant_id=$1"#,
        )
        .bind(&tenant)
        .execute(&db)
        .await
        .expect("note is expired");

        let recalled = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs");
        assert!(recalled.is_empty(), "an expired note must not come back");

        // And the sweep then reclaims it.
        purge_expired(&db).await.expect("sweep runs");
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_memory_notes WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count reads");
        assert_eq!(remaining, 0);
    }

    /// Memory follows its subject: a client who leaves takes their notes with
    /// them, without any delete path having to remember to call this.
    #[tokio::test]
    async fn a_departed_clients_memory_is_reconciled_away() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 30).await;

        sqlx::query("UPDATE clients SET active=FALSE WHERE id=$1")
            .bind(&client)
            .execute(&db)
            .await
            .expect("client is deactivated");

        purge_expired(&db).await.expect("sweep runs");
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_memory_notes WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count reads");
        assert_eq!(remaining, 0, "a deactivated client keeps no memory");
    }

    /// A sensitive note never leaves the signed-in app. Being right about an
    /// allergy is no comfort if it was repeated to whoever holds the phone.
    #[tokio::test]
    async fn a_sensitive_note_never_reaches_an_external_channel() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 30).await;
        write_note(&db, &tenant, branch, &client, "Prefers Saturday", false, 30).await;

        let on_web = for_channel(&db, &tenant, branch, &client, "web").await;
        assert_eq!(on_web.len(), 2, "an operator on the web app sees both");

        for channel in ["whatsapp", "voice"] {
            let external = for_channel(&db, &tenant, branch, &client, channel).await;
            assert_eq!(
                external.len(),
                1,
                "{channel} must not carry the health note"
            );
            assert!(!external[0].sensitive);
        }
    }

    /// The same fact twice is one fact: re-recording extends it rather than
    /// stacking duplicates that would all come back together.
    #[tokio::test]
    async fn recording_the_same_fact_twice_extends_it_rather_than_duplicating() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;

        write_note(&db, &tenant, branch, &client, "Prefers Saturday", false, 30).await;
        write_note(&db, &tenant, branch, &client, "Prefers Saturday", false, 90).await;

        let notes = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs");
        assert_eq!(notes.len(), 1, "one fact is one row");
        assert!(
            notes[0].expires_at > Utc::now() + Duration::days(60),
            "re-recording pushes the expiry out"
        );
    }

    /// Memory is bounded. Unbounded notes about a person are a profile, and a
    /// profile is not what this is for.
    #[tokio::test]
    async fn a_subject_cannot_accumulate_unbounded_memory() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        let claims = claims("owner", &["clients.read"]);

        for index in 0..MAX_NOTES_PER_SUBJECT {
            record(
                &db,
                &tenant,
                branch,
                &claims,
                RecordNoteRequest {
                    subject_kind: "client".into(),
                    subject_id: client.clone(),
                    content: format!("Fact number {index}"),
                    source: String::new(),
                    sensitive: false,
                    retention_days: None,
                },
            )
            .await
            .expect("note is recorded");
        }

        let refused = record(
            &db,
            &tenant,
            branch,
            &claims,
            RecordNoteRequest {
                subject_kind: "client".into(),
                subject_id: client.clone(),
                content: "One too many".into(),
                source: String::new(),
                sensitive: false,
                retention_days: None,
            },
        )
        .await;
        assert!(
            refused.is_err(),
            "the cap is a refusal, not silent trimming"
        );
    }

    /// Forgetting on request removes everything, immediately.
    #[tokio::test]
    async fn a_client_can_be_forgotten_outright() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 100).await;

        let claims = claims("owner", &["clients.read"]);
        let removed = forget_client(&db, &tenant, &claims, &client)
            .await
            .expect("forget runs");
        assert_eq!(removed, 2);
        assert!(
            repository::notes(&db, &tenant, branch, "client", &client, true, 10)
                .await
                .expect("recall runs")
                .is_empty()
        );
    }

    /// A note nobody has needed in half a year gives up its slot. A sensitive
    /// one does not: an allergy is not less true because no conversation
    /// happened to surface it.
    #[tokio::test]
    async fn stale_notes_are_pruned_but_sensitive_ones_are_exempt() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;

        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            400,
        )
        .await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 100).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Parks in the side street",
            false,
            400,
        )
        .await;

        // Two have gone unrecalled for a year; one was used last week.
        sqlx::query(
            r#"UPDATE ai_memory_notes
                  SET created_at=NOW() - INTERVAL '365 days'
                WHERE tenant_id=$1"#,
        )
        .bind(&tenant)
        .execute(&db)
        .await
        .expect("notes are aged");
        sqlx::query(
            "UPDATE ai_memory_notes SET last_recalled_at=NOW() - INTERVAL '7 days' WHERE tenant_id=$1 AND content=$2",
        )
        .bind(&tenant)
        .bind("Parks in the side street")
        .execute(&db)
        .await
        .expect("one note is marked recalled");

        purge_expired(&db).await.expect("retention runs");

        let surviving: Vec<String> = sqlx::query_scalar(
            "SELECT content FROM ai_memory_notes WHERE tenant_id=$1 ORDER BY content",
        )
        .bind(&tenant)
        .fetch_all(&db)
        .await
        .expect("notes are readable");
        assert_eq!(
            surviving,
            vec![
                "Allergic to PPD".to_string(),
                "Parks in the side street".to_string()
            ],
            "only the unrecalled, non-sensitive note should be pruned"
        );
    }

    /// A note written yesterday is not stale, however little it has been used.
    #[tokio::test]
    async fn a_fresh_note_is_never_pruned_for_being_unrecalled() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(&db, &tenant, branch, &client, "Just recorded", false, 365).await;

        purge_expired(&db).await.expect("retention runs");
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_memory_notes WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count reads");
        assert_eq!(remaining, 1);
    }

    async fn link_account(db: &PgPool, tenant: &str, branch: &str, client: &str) -> String {
        let account_id: String = sqlx::query_scalar(
            "INSERT INTO customer_accounts(first_name,last_name) VALUES('Priya','S') RETURNING id",
        )
        .fetch_one(db)
        .await
        .expect("account is seeded");
        sqlx::query(
            r#"INSERT INTO customer_account_clients(account_id,tenant_id,branch_id,client_id)
               VALUES ($1,$2,$3,$4)"#,
        )
        .bind(&account_id)
        .bind(tenant)
        .bind(branch)
        .bind(client)
        .execute(db)
        .await
        .expect("account is linked");
        account_id
    }

    /// A client may see what is remembered about them — but a portal page is
    /// not where a health note a staff member wrote should surface.
    #[tokio::test]
    async fn a_customer_sees_their_own_memory_without_the_sensitive_notes() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 100).await;
        let account = link_account(&db, &tenant, branch, &client).await;

        let mine = for_customer_account(&db, &account)
            .await
            .expect("portal read runs");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].content, "Prefers Saturday");
    }

    /// And another customer's account reaches none of it.
    #[tokio::test]
    async fn a_customer_cannot_see_another_customers_memory() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let mine = seed_client(&db, &tenant, branch).await;
        let theirs = seed_client(&db, &tenant, "branch2").await;
        write_note(
            &db,
            &tenant,
            "branch2",
            &theirs,
            "Their preference",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, branch, &mine).await;

        let visible = for_customer_account(&db, &account)
            .await
            .expect("portal read runs");
        assert!(visible.is_empty());
    }

    /// Erasing is a customer's own right, and it is scoped to their link.
    #[tokio::test]
    async fn a_customer_can_erase_their_own_memory() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        write_note(&db, &tenant, branch, &client, "Allergic to PPD", true, 100).await;
        let account = link_account(&db, &tenant, branch, &client).await;

        let removed = forget_for_customer_account(&db, &account)
            .await
            .expect("erase runs");
        assert_eq!(removed, 2, "erasing takes the sensitive note too");

        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_memory_notes WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count reads");
        assert_eq!(remaining, 0);
    }

    /// The rule that matters most: a disputed note stops being used the moment
    /// the client says so, before anybody reviews it.
    #[tokio::test]
    async fn a_disputed_note_stops_being_recalled_immediately() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, branch, &client).await;
        let note_id = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs")[0]
            .id
            .clone();

        dispute_for_customer_account(&db, &account, &note_id, "I never said that")
            .await
            .expect("dispute is recorded");

        assert!(
            for_channel(&db, &tenant, branch, &client, "web")
                .await
                .is_empty(),
            "a contested note must not reach the assistant while it is open"
        );
        assert!(
            repository::notes(&db, &tenant, branch, "client", &client, true, 10)
                .await
                .expect("recall runs")
                .is_empty(),
            "nor any other recall path"
        );
    }

    /// The salon agreeing removes it; a note cannot be agreed-wrong and kept.
    #[tokio::test]
    async fn a_corrected_dispute_removes_the_note() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, branch, &client).await;
        let note_id = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs")[0]
            .id
            .clone();
        dispute_for_customer_account(&db, &account, &note_id, "")
            .await
            .expect("dispute is recorded");

        let claims = claims("owner", &["clients.read"]);
        resolve_dispute(
            &db,
            &tenant,
            branch,
            &claims,
            &note_id,
            ResolveDisputeRequest {
                outcome: "corrected".into(),
            },
        )
        .await
        .expect("dispute is resolved");

        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ai_memory_notes WHERE tenant_id=$1")
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .expect("count reads");
        assert_eq!(remaining, 0);
    }

    /// Upholding returns the note to use but keeps the dispute on the record: a
    /// note that was contested and kept is not the same as one nobody queried.
    #[tokio::test]
    async fn an_upheld_dispute_restores_the_note_but_keeps_the_record() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, branch, &client).await;
        let note_id = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs")[0]
            .id
            .clone();
        dispute_for_customer_account(&db, &account, &note_id, "not mine")
            .await
            .expect("dispute is recorded");

        let claims = claims("owner", &["clients.read"]);
        resolve_dispute(
            &db,
            &tenant,
            branch,
            &claims,
            &note_id,
            ResolveDisputeRequest {
                outcome: "upheld".into(),
            },
        )
        .await
        .expect("dispute is resolved");

        let notes = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs");
        assert_eq!(notes.len(), 1, "an upheld note is usable again");
        assert_eq!(notes[0].dispute_outcome, "upheld");
        assert_eq!(
            notes[0].dispute_reason, "not mine",
            "the client's words stay on the record"
        );
    }

    /// A dispute is scoped through the account's own link, so guessing an id
    /// belonging to somebody else does nothing.
    #[tokio::test]
    async fn a_customer_cannot_dispute_another_customers_note() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let mine = seed_client(&db, &tenant, "branch1").await;
        let theirs = seed_client(&db, &tenant, "branch2").await;
        write_note(
            &db,
            &tenant,
            "branch2",
            &theirs,
            "Their preference",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, "branch1", &mine).await;
        let note_id = repository::notes(&db, &tenant, "branch2", "client", &theirs, true, 10)
            .await
            .expect("recall runs")[0]
            .id
            .clone();

        let refused = dispute_for_customer_account(&db, &account, &note_id, "").await;
        assert!(refused.is_err());
        assert_eq!(
            repository::notes(&db, &tenant, "branch2", "client", &theirs, true, 10)
                .await
                .expect("recall runs")
                .len(),
            1,
            "it is still usable, because nothing happened to it"
        );
    }

    /// An open dispute reaches the staff queue with the client's own words.
    #[tokio::test]
    async fn an_open_dispute_appears_in_the_staff_queue() {
        let Some(db) = connect().await else { return };
        let tenant = format!("memory_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client = seed_client(&db, &tenant, branch).await;
        write_note(
            &db,
            &tenant,
            branch,
            &client,
            "Prefers Saturday",
            false,
            300,
        )
        .await;
        let account = link_account(&db, &tenant, branch, &client).await;
        let note_id = repository::notes(&db, &tenant, branch, "client", &client, true, 10)
            .await
            .expect("recall runs")[0]
            .id
            .clone();
        dispute_for_customer_account(&db, &account, &note_id, "I asked for Sundays")
            .await
            .expect("dispute is recorded");

        let claims = claims("owner", &["clients.read"]);
        let queue = open_disputes(&db, &tenant, branch, &claims)
            .await
            .expect("queue reads");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].dispute_reason, "I asked for Sundays");
        assert!(queue[0].dispute_resolved_at.is_none());
    }

    #[test]
    fn subject_kinds_round_trip_through_their_names() {
        for kind in [SubjectKind::Client, SubjectKind::User] {
            assert_eq!(SubjectKind::from_name(kind.name()), Some(kind));
        }
        assert!(SubjectKind::from_name("staff").is_none());
    }
}
