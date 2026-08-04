//! Persistence for the semantic index.
//!
//! Vectors are bound as text and cast with `::vector` rather than through a
//! dedicated pgvector client type. The corpus is small enough per tenant that
//! the parse cost is irrelevant next to the embedding call that produced the
//! vector, and it keeps the semantic layer from adding a driver-level
//! dependency to a stack the project deliberately keeps narrow.

use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// A source row as the indexer found it, before it has a vector.
pub struct NewDocument {
    pub tenant_id: String,
    pub branch_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub domain: String,
    pub subject_id: String,
    pub title: String,
    pub content: String,
    pub content_hash: String,
}

/// A document waiting to be embedded.
#[derive(Debug, Clone, FromRow)]
pub struct PendingDocument {
    pub id: String,
    pub content: String,
}

/// A passage that came back from a similarity search.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedPassage {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub domain: String,
    pub subject_id: String,
    pub title: String,
    pub content: String,
    /// Cosine similarity in `0.0..=1.0`; higher is closer.
    pub similarity: f64,
}

/// Records a source row in the corpus, queueing it for embedding when its
/// content is new or has changed.
///
/// Unchanged content is left completely alone — not even `updated_at` moves —
/// so a worker pass over a stable corpus writes nothing and costs no provider
/// calls. Changed content nulls the vector, which is what puts the row back on
/// the queue.
pub async fn upsert_document(db: &PgPool, document: &NewDocument) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ai_semantic_documents(
              tenant_id,branch_id,source_kind,source_id,domain,subject_id,title,content,content_hash
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (tenant_id,branch_id,source_kind,source_id) DO UPDATE
              SET domain=EXCLUDED.domain,
                  subject_id=EXCLUDED.subject_id,
                  title=EXCLUDED.title,
                  content=EXCLUDED.content,
                  content_hash=EXCLUDED.content_hash,
                  embedding=NULL,
                  embedding_model='',
                  indexed_at=NULL,
                  updated_at=NOW()
            WHERE ai_semantic_documents.content_hash <> EXCLUDED.content_hash"#,
    )
    .bind(&document.tenant_id)
    .bind(&document.branch_id)
    .bind(&document.source_kind)
    .bind(&document.source_id)
    .bind(&document.domain)
    .bind(&document.subject_id)
    .bind(&document.title)
    .bind(&document.content)
    .bind(&document.content_hash)
    .execute(db)
    .await
    .map(|_| ())
}

/// Documents still waiting for a vector, oldest first.
pub async fn pending_documents(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<PendingDocument>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, content
             FROM ai_semantic_documents
            WHERE embedding IS NULL
            ORDER BY created_at, id
            LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Attaches a vector to a document.
///
/// Only fills a row that is still waiting, so a slow embedding response cannot
/// overwrite a newer edit that re-queued the same document in the meantime.
pub async fn store_embedding(
    db: &PgPool,
    document_id: &str,
    model: &str,
    embedding: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE ai_semantic_documents
              SET embedding=$3::vector, embedding_model=$2, indexed_at=NOW(), updated_at=NOW()
            WHERE id=$1 AND embedding IS NULL"#,
    )
    .bind(document_id)
    .bind(model)
    .bind(embedding)
    .execute(db)
    .await
    .map(|_| ())
}

/// Drops indexed passages whose source row no longer exists or no longer
/// qualifies for indexing.
///
/// A deleted client note that stayed searchable would make the index a way to
/// read something the CRM has already removed, so this runs every cycle and not
/// only when something is known to have changed.
///
/// The check is an anti-join against the source table rather than a comparison
/// with the ids the indexer happened to read. The indexer reads in bounded
/// pages; handing it the deletion decision would mean everything past the page
/// boundary looked absent and got dropped on every pass.
pub async fn delete_absent_services(db: &PgPool) -> Result<u64, sqlx::Error> {
    delete_absent(
        db,
        "service",
        r#"SELECT 1 FROM services source
            WHERE source.id=document.source_id
              AND source.tenant_id=document.tenant_id
              AND source.branch_id=document.branch_id
              AND source.active=TRUE AND BTRIM(source.name) <> ''"#,
    )
    .await
}

pub async fn delete_absent_packages(db: &PgPool) -> Result<u64, sqlx::Error> {
    delete_absent(
        db,
        "package",
        r#"SELECT 1 FROM packages source
            WHERE source.id=document.source_id
              AND source.tenant_id=document.tenant_id
              AND source.branch_id=document.branch_id
              AND source.active=TRUE AND BTRIM(source.name) <> ''"#,
    )
    .await
}

pub async fn delete_absent_memberships(db: &PgPool) -> Result<u64, sqlx::Error> {
    delete_absent(
        db,
        "membership",
        r#"SELECT 1 FROM memberships source
            WHERE source.id=document.source_id
              AND source.tenant_id=document.tenant_id
              AND source.branch_id=document.branch_id
              AND source.active=TRUE AND BTRIM(source.name) <> ''"#,
    )
    .await
}

/// Note deletion also covers a note whose visibility was tightened after it was
/// indexed, and a client who was deactivated or merged away.
pub async fn delete_absent_client_notes(db: &PgPool) -> Result<u64, sqlx::Error> {
    delete_absent(
        db,
        "client_note",
        r#"SELECT 1 FROM client_notes source
             JOIN clients client ON client.tenant_id=source.tenant_id AND client.id=source.client_id
            WHERE source.id=document.source_id
              AND source.tenant_id=document.tenant_id
              AND source.branch_id=document.branch_id
              AND source.visibility='branch_staff'
              AND BTRIM(source.note) <> ''
              AND client.active=TRUE
              AND client.merged_into_client_id IS NULL"#,
    )
    .await
}

async fn delete_absent(
    db: &PgPool,
    source_kind: &str,
    still_qualifies: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query(&format!(
        r#"DELETE FROM ai_semantic_documents document
            WHERE document.source_kind=$1
              AND NOT EXISTS ({still_qualifies})"#
    ))
    .bind(source_kind)
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}

/// Nearest passages to a query vector, inside one tenant, its allowed branches
/// and the domains the caller may read.
///
/// Every one of those filters is applied in SQL rather than after the fact.
/// Ranking first and filtering afterwards would let a passage the caller may
/// not see consume one of the result slots, which leaks its existence through
/// the shape of the answer.
pub async fn search(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    domains: &[String],
    embedding: &str,
    model: &str,
    min_similarity: f64,
    limit: i64,
) -> Result<Vec<RetrievedPassage>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, source_kind, source_id, domain, subject_id, title, content,
                  (1 - (embedding <=> $4::vector))::FLOAT8 AS similarity
             FROM ai_semantic_documents
            WHERE tenant_id=$1
              AND branch_id=ANY($2::TEXT[])
              AND domain=ANY($3::TEXT[])
              AND embedding IS NOT NULL
              -- Vectors from a different model are not comparable to this
              -- query's, so a corpus mid-migration returns fewer results rather
              -- than wrong ones.
              AND embedding_model=$5
              AND (1 - (embedding <=> $4::vector)) >= $6
            ORDER BY embedding <=> $4::vector
            LIMIT $7"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(domains)
    .bind(embedding)
    .bind(model)
    .bind(min_similarity)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// How much of the corpus is indexed, for the worker's log line and for an
/// operator asking whether retrieval is actually live.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub total: i64,
    pub embedded: i64,
    pub pending: i64,
}

pub async fn index_status(db: &PgPool) -> Result<IndexStatus, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT COUNT(*)::BIGINT AS total,
                  COUNT(*) FILTER (WHERE embedding IS NOT NULL)::BIGINT AS embedded,
                  COUNT(*) FILTER (WHERE embedding IS NULL)::BIGINT AS pending
             FROM ai_semantic_documents"#,
    )
    .fetch_one(db)
    .await
}

// ---------------------------------------------------------------------------
// Source reads. Each returns the rows that belong in the corpus for one kind,
// already filtered to what may be indexed at all.
// ---------------------------------------------------------------------------

/// One source row, flattened to the text that will be embedded.
#[derive(Debug, Clone, FromRow)]
pub struct SourceRow {
    pub tenant_id: String,
    pub branch_id: String,
    pub source_id: String,
    pub subject_id: String,
    pub title: String,
    pub content: String,
}

pub async fn service_sources(
    db: &PgPool,
    after_id: &str,
    limit: i64,
) -> Result<Vec<SourceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT tenant_id, branch_id, id AS source_id, '' AS subject_id,
                  name AS title,
                  BTRIM(CONCAT_WS('. ', name, NULLIF(category,''),
                        'Duration ' || duration_minutes || ' minutes')) AS content
             FROM services
            WHERE active=TRUE AND BTRIM(name) <> '' AND id > $1
            ORDER BY id
            LIMIT $2"#,
    )
    .bind(after_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn package_sources(
    db: &PgPool,
    after_id: &str,
    limit: i64,
) -> Result<Vec<SourceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT tenant_id, branch_id, id AS source_id, '' AS subject_id,
                  name AS title,
                  BTRIM(CONCAT_WS('. ', name, NULLIF(description,''))) AS content
             FROM packages
            WHERE active=TRUE AND BTRIM(name) <> '' AND id > $1
            ORDER BY id
            LIMIT $2"#,
    )
    .bind(after_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn membership_sources(
    db: &PgPool,
    after_id: &str,
    limit: i64,
) -> Result<Vec<SourceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT tenant_id, branch_id, id AS source_id, '' AS subject_id,
                  name AS title, name AS content
             FROM memberships
            WHERE active=TRUE AND BTRIM(name) <> '' AND id > $1
            ORDER BY id
            LIMIT $2"#,
    )
    .bind(after_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Client notes, excluding anything the CRM itself restricts.
///
/// `visibility` is honoured here rather than at retrieval time. A note the
/// author marked private must never enter the corpus at all: filtering it out
/// of search results would still leave it embedded in a table that a future
/// query path could reach.
pub async fn client_note_sources(
    db: &PgPool,
    after_id: &str,
    limit: i64,
) -> Result<Vec<SourceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT note.tenant_id, note.branch_id, note.id AS source_id,
                  note.client_id AS subject_id,
                  COALESCE(NULLIF(note.note_type,''),'note') AS title,
                  note.note AS content
             FROM client_notes note
             JOIN clients client ON client.tenant_id=note.tenant_id AND client.id=note.client_id
            WHERE note.visibility='branch_staff'
              AND BTRIM(note.note) <> ''
              AND client.active=TRUE
              AND client.merged_into_client_id IS NULL
              AND note.id > $1
            ORDER BY note.id
            LIMIT $2"#,
    )
    .bind(after_id)
    .bind(limit)
    .fetch_all(db)
    .await
}
