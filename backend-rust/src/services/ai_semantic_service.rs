//! Semantic retrieval, and the indexer that keeps it current.
//!
//! The copilot's tools answer a fixed set of questions from SQL and refuse
//! everything else. That refusal is right for anything that states a number:
//! a figure must come from a query someone can audit, not from a model's
//! recollection. But it also means a question whose answer is sitting in a
//! service description or a client note gets nothing, because no keyword
//! matched a tool.
//!
//! This module fills exactly that gap, and nothing wider:
//!
//! * **Retrieval never outranks a tool.** It is consulted only when the
//!   dispatcher matched nothing at all. A question a tool can answer is still
//!   answered by the tool, so the evidence-first path is unchanged.
//! * **Retrieval returns passages, never conclusions.** Each result carries the
//!   row it came from. Nothing here computes a total, a trend or a
//!   recommendation — a passage is quoted material, and the caller can always
//!   trace it back.
//! * **The same scope chain applies.** A passage carries the permission domain
//!   of its source, and search filters on the domains the login may read,
//!   inside the branches its grants resolved to. Retrieval cannot reach data a
//!   tool would have refused.
//!
//! Without an embedding provider the layer is simply off: `embed` returns
//! `None`, search returns nothing, and the assistant behaves exactly as it did
//! before. A retrieval layer that degraded into guessing would be worse than no
//! retrieval at all, so there is no fallback path here — unlike predictions,
//! where a deterministic fallback over real history is still honest arithmetic.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::ai_semantic_repository::{self as repository, NewDocument, SourceRow},
    services::{
        ai_scope_service::{self, AiDomain, ScopeRequest},
        ai_tool_dispatcher,
        auth_service::AuthClaims,
    },
};

/// Width of the configured embedding model. The vector column is declared at
/// this width, so a model of a different width is rejected rather than stored
/// in a form no index could serve.
pub const EMBEDDING_DIMENSIONS: usize = 1536;

/// Source rows read per kind per worker cycle.
const SOURCE_PAGE: i64 = 500;
/// Documents embedded per worker cycle. Bounded because each one is a paid
/// provider call, and an unbounded first pass over a large tenant would spend
/// the budget in a single cycle.
const EMBED_BATCH: i64 = 128;
/// Texts per embedding request.
const EMBED_CHUNK: usize = 32;

/// Passages returned for one question.
const SEARCH_LIMIT: i64 = 5;
/// Below this cosine similarity a passage is not about the question. Returning
/// weak matches would put unrelated text in front of the model and invite it to
/// build an answer out of them.
const MIN_SIMILARITY: f64 = 0.34;

/// Longest passage indexed or returned. Long notes are truncated rather than
/// split: a half-note retrieved with its source attached is useful, whereas
/// chunk boundaries invented here would need their own reassembly rules.
const MAX_CONTENT_CHARS: usize = 1_500;

/// A passage as it reaches the caller.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticPassage {
    pub source_kind: String,
    pub source_id: String,
    pub subject_id: String,
    pub title: String,
    pub content: String,
    /// Rounded to two places: the extra digits are noise from an approximate
    /// index and would read as precision the score does not have.
    pub similarity: f64,
}

/// Where the embedding provider lives, if it is configured at all.
///
/// Mirrors `ai_prediction_service::ProviderConfig` so both AI paths describe an
/// absent provider identically, and so a test can assert the off state without
/// building a whole settings object.
#[derive(Debug, Clone, Copy)]
pub struct EmbeddingProvider<'a> {
    url: Option<&'a str>,
    token: Option<&'a str>,
}

impl<'a> EmbeddingProvider<'a> {
    pub fn from_settings(settings: &'a Settings) -> Self {
        Self {
            url: settings.ai_service_url.as_deref(),
            token: settings.ai_service_token.as_deref(),
        }
    }

    /// Built from a provider handle a caller already resolved.
    ///
    /// The concierge pipeline carries the AI service URL and token through its
    /// own endpoint type; taking them directly means retrieval cannot end up
    /// pointed at a different service than the one answering the message.
    pub fn new(url: Option<&'a str>, token: Option<&'a str>) -> Self {
        Self { url, token }
    }

    /// No provider: indexing and retrieval are both inert.
    pub fn unconfigured() -> Self {
        Self {
            url: None,
            token: None,
        }
    }

    pub fn is_configured(&self) -> bool {
        self.url.is_some() && self.token.is_some()
    }
}

/// Which CRM table a passage came from, and therefore what may read it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Service,
    Package,
    Membership,
    ClientNote,
}

impl SourceKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Package => "package",
            Self::Membership => "membership",
            Self::ClientNote => "client_note",
        }
    }

    /// The permission domain of the source row.
    ///
    /// Written by the indexer from the table it read, never inferred from the
    /// text: a domain guessed from content could be wrong, and a wrong domain
    /// here is a permission bypass rather than a bad search result.
    pub fn domain(self) -> AiDomain {
        match self {
            Self::Service => AiDomain::Services,
            Self::Package => AiDomain::Packages,
            Self::Membership => AiDomain::Memberships,
            Self::ClientNote => AiDomain::Clients,
        }
    }

    pub fn all() -> [Self; 4] {
        [
            Self::Service,
            Self::Package,
            Self::Membership,
            Self::ClientNote,
        ]
    }
}

#[derive(Debug, Deserialize)]
struct ProviderEmbedding {
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct ProviderEmbeddingResponse {
    model: String,
    embeddings: Vec<ProviderEmbedding>,
}

#[derive(Debug, Deserialize)]
struct ProviderEnvelope<T> {
    success: bool,
    data: Option<T>,
}

/// Embeds a batch of texts, or returns `None` when the provider cannot be used.
///
/// `None` covers every failure mode on purpose — unconfigured, unreachable,
/// wrong width, malformed reply. There is nothing useful a caller could do
/// differently between them, and treating "no provider" and "provider broke"
/// the same means an outage degrades to the pre-retrieval behaviour instead of
/// to a partially indexed corpus that looks complete.
pub async fn embed(
    provider: EmbeddingProvider<'_>,
    texts: &[String],
) -> Option<(String, Vec<Vec<f32>>)> {
    if texts.is_empty() {
        return None;
    }
    let url = provider.url?;
    let token = provider.token?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .ok()?;
    let response = client
        .post(format!("{}/api/v1/embeddings", url.trim_end_matches('/')))
        .bearer_auth(token)
        .json(&serde_json::json!({ "texts": texts }))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let envelope = response
        .json::<ProviderEnvelope<ProviderEmbeddingResponse>>()
        .await
        .ok()?;
    let data = envelope.data.filter(|_| envelope.success)?;

    // One vector per text, in order, at the declared width. Anything else and
    // the vectors cannot be matched back to their documents with confidence, so
    // none of them is stored.
    if data.embeddings.len() != texts.len() {
        tracing::warn!(
            requested = texts.len(),
            returned = data.embeddings.len(),
            "embedding provider returned a different number of vectors than requested"
        );
        return None;
    }
    if data.model.trim().is_empty() {
        return None;
    }
    let vectors: Vec<Vec<f32>> = data
        .embeddings
        .into_iter()
        .map(|item| item.embedding)
        .collect();
    if vectors.iter().any(|v| v.len() != EMBEDDING_DIMENSIONS) {
        tracing::error!(
            model = %data.model,
            expected = EMBEDDING_DIMENSIONS,
            "embedding width does not match the vector column; refusing to index"
        );
        return None;
    }
    Some((data.model, vectors))
}

/// pgvector's text form, which the repository casts with `::vector`.
fn vector_literal(values: &[f32]) -> String {
    let mut out = String::with_capacity(values.len() * 12 + 2);
    out.push('[');
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&format!("{value}"));
    }
    out.push(']');
    out
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Trims a passage to the indexed length, on a character boundary.
fn truncate(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.chars().count() <= MAX_CONTENT_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(MAX_CONTENT_CHARS).collect()
}

/// Reads one source kind and records its rows in the corpus.
async fn collect_source(db: &PgPool, kind: SourceKind) -> Result<usize, AppError> {
    let mut cursor = String::new();
    let mut seen = 0_usize;
    loop {
        let rows: Vec<SourceRow> = match kind {
            SourceKind::Service => repository::service_sources(db, &cursor, SOURCE_PAGE).await,
            SourceKind::Package => repository::package_sources(db, &cursor, SOURCE_PAGE).await,
            SourceKind::Membership => {
                repository::membership_sources(db, &cursor, SOURCE_PAGE).await
            }
            SourceKind::ClientNote => {
                repository::client_note_sources(db, &cursor, SOURCE_PAGE).await
            }
        }
        .map_err(|error| {
            tracing::error!(%error, kind = kind.name(), "failed to read semantic index source");
            AppError::internal("failed to read a semantic index source")
        })?;

        if rows.is_empty() {
            break;
        }
        cursor = rows
            .last()
            .map(|row| row.source_id.clone())
            .unwrap_or_default();
        let page = rows.len();
        seen += page;

        for row in rows {
            let content = truncate(&row.content);
            if content.is_empty() {
                continue;
            }
            let document = NewDocument {
                tenant_id: row.tenant_id,
                branch_id: row.branch_id,
                source_kind: kind.name().into(),
                source_id: row.source_id,
                domain: kind.domain().as_str().into(),
                subject_id: row.subject_id,
                title: truncate(&row.title),
                content_hash: content_hash(&content),
                content,
            };
            if let Err(error) = repository::upsert_document(db, &document).await {
                // One bad row must not stop the corpus from tracking the rest.
                tracing::warn!(%error, kind = kind.name(), "failed to record a semantic document");
            }
        }

        if (page as i64) < SOURCE_PAGE {
            break;
        }
    }
    Ok(seen)
}

/// Keeps the corpus in step with the CRM and embeds whatever is queued.
///
/// Runs whether or not a provider is configured: the corpus is still worth
/// tracking, and deletions especially must keep happening, so that turning a
/// provider on later does not index rows that have since been removed.
pub async fn run_semantic_index_worker(
    db: &PgPool,
    provider: EmbeddingProvider<'_>,
) -> Result<usize, AppError> {
    for kind in SourceKind::all() {
        collect_source(db, kind).await?;
    }

    // Reconciliation runs every cycle, not only when something changed. A note
    // deleted or made private in the CRM has to leave the index on the next
    // pass regardless of whether anything else moved.
    let removed = reconcile_deletions(db).await;
    if removed > 0 {
        tracing::info!(removed, "removed semantic documents whose source is gone");
    }

    if !provider.is_configured() {
        return Ok(0);
    }

    let pending = repository::pending_documents(db, EMBED_BATCH)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to list documents awaiting embedding");
            AppError::internal("failed to list documents awaiting embedding")
        })?;

    let mut embedded = 0_usize;
    for chunk in pending.chunks(EMBED_CHUNK) {
        let texts: Vec<String> = chunk.iter().map(|item| item.content.clone()).collect();
        let Some((model, vectors)) = embed(provider, &texts).await else {
            // The provider is unusable right now. Stopping leaves the rest
            // queued for the next cycle, which is what the pending state is for.
            tracing::warn!("embedding provider unavailable; leaving documents queued");
            break;
        };
        for (document, vector) in chunk.iter().zip(vectors) {
            if let Err(error) =
                repository::store_embedding(db, &document.id, &model, &vector_literal(&vector))
                    .await
            {
                tracing::warn!(%error, document_id = %document.id, "failed to store an embedding");
                continue;
            }
            embedded += 1;
        }
    }
    Ok(embedded)
}

async fn reconcile_deletions(db: &PgPool) -> u64 {
    let mut removed = 0_u64;
    let outcomes = [
        repository::delete_absent_services(db).await,
        repository::delete_absent_packages(db).await,
        repository::delete_absent_memberships(db).await,
        repository::delete_absent_client_notes(db).await,
    ];
    for outcome in outcomes {
        match outcome {
            Ok(count) => removed += count,
            Err(error) => {
                tracing::error!(%error, "failed to reconcile semantic index deletions");
            }
        }
    }
    removed
}

/// The domains this login may read, as the strings stored on a document.
///
/// Only the four the indexer actually writes are considered. Listing every
/// domain would let a future source kind become searchable before anyone
/// decided who may read it.
fn readable_domains(claims: &AuthClaims) -> Vec<String> {
    SourceKind::all()
        .into_iter()
        .map(SourceKind::domain)
        .filter(|domain| ai_scope_service::domain_allowed(claims, *domain))
        .map(|domain| domain.as_str().to_string())
        .collect()
}

/// Passages relevant to a question, inside what this login may read.
///
/// Returns empty rather than failing whenever retrieval cannot help — no
/// provider, no readable domain, nothing above the similarity floor. The caller
/// is a fallback path, and an error there would turn "we had nothing extra to
/// add" into a failed answer.
pub async fn search(
    db: &PgPool,
    provider: EmbeddingProvider<'_>,
    tenant_id: &str,
    claims: &AuthClaims,
    question: &str,
    scope_request: &ScopeRequest,
) -> Vec<SemanticPassage> {
    if question.trim().is_empty() || !provider.is_configured() {
        return Vec::new();
    }
    let domains = readable_domains(claims);
    if domains.is_empty() {
        return Vec::new();
    }

    // Scope first, exactly as the tool path does: the branches come from the
    // login's grants, never from the question or a header.
    let Ok(scope) = ai_tool_dispatcher::resolve(db, tenant_id, claims, scope_request).await else {
        return Vec::new();
    };
    let branch_ids = scope.branch_ids();
    if branch_ids.is_empty() {
        return Vec::new();
    }

    let Some((model, vectors)) = embed(provider, &[truncate(question)]).await else {
        return Vec::new();
    };
    let Some(vector) = vectors.first() else {
        return Vec::new();
    };

    match repository::search(
        db,
        tenant_id,
        &branch_ids,
        &domains,
        &vector_literal(vector),
        &model,
        MIN_SIMILARITY,
        SEARCH_LIMIT,
    )
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| SemanticPassage {
                source_kind: row.source_kind,
                source_id: row.source_id,
                subject_id: row.subject_id,
                title: row.title,
                content: row.content,
                similarity: (row.similarity * 100.0).round() / 100.0,
            })
            .collect(),
        Err(error) => {
            tracing::error!(%error, "semantic search failed");
            Vec::new()
        }
    }
}

/// How far back the retrieval helpfulness figure looks, matching the window the
/// prediction accuracy uses so the two read on the same terms.
pub const FEEDBACK_LOOKBACK_DAYS: i32 = 180;

/// Ratings needed before a helpfulness rate is stated, for the same reason a
/// prediction hit rate is withheld on a thin sample.
pub const MIN_RATINGS_FOR_RATE: i64 = 20;

/// Whether retrieval is actually helping, as a number rather than an impression.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalHelpfulness {
    pub rated: i64,
    pub helpful: i64,
    /// `None` below the rating floor.
    pub helpful_percent: Option<f64>,
    pub lookback_days: i32,
    /// The whole position in one sentence, so the number cannot be rendered
    /// without what it counts.
    pub statement: String,
}

/// Measured helpfulness of retrieval-backed replies.
///
/// Counts only replies the semantic layer contributed to, attributed
/// server-side from what the reply was actually built from — a rate anyone can
/// label their own votes with is not a measurement.
pub async fn helpfulness(
    db: &PgPool,
    tenant_id: &str,
    claims: &AuthClaims,
    scope_request: &ScopeRequest,
) -> Result<RetrievalHelpfulness, AppError> {
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, scope_request).await?;
    let branch_ids = scope.branch_ids();
    let record = repository::retrieval_feedback(db, tenant_id, &branch_ids, FEEDBACK_LOOKBACK_DAYS)
        .await
        .map_err(|_| AppError::internal("failed to read retrieval feedback"))?;

    let rate = (record.rated >= MIN_RATINGS_FOR_RATE)
        .then(|| (record.helpful as f64 / record.rated as f64) * 100.0);
    let statement = match rate {
        Some(percent) => format!(
            "{percent:.0}% of {} rated answers that used stored CRM text were marked helpful over the last {FEEDBACK_LOOKBACK_DAYS} days.",
            record.rated
        ),
        None => format!(
            "Not enough answers have been rated to say whether retrieval helps: {} of the {MIN_RATINGS_FOR_RATE} needed.",
            record.rated
        ),
    };

    Ok(RetrievalHelpfulness {
        rated: record.rated,
        helpful: record.helpful,
        helpful_percent: rate,
        lookback_days: FEEDBACK_LOOKBACK_DAYS,
        statement,
    })
}

/// How much of the corpus is embedded, for operators.
pub async fn index_status(db: &PgPool) -> Result<repository::IndexStatus, AppError> {
    repository::index_status(db)
        .await
        .map_err(|_| AppError::internal("failed to read the semantic index status"))
}

/// What keeps retrieval from becoming a second, weaker answer path.
#[cfg(test)]
mod semantic_tests {
    use super::*;
    use crate::services::auth_service::AuthClaims;

    fn claims(role: &str, permissions: &[&str]) -> AuthClaims {
        crate::services::ai_tool_dispatcher::tests_support::claims(role, permissions, &[])
    }

    fn claims_denied(role: &str, denied: &[&str]) -> AuthClaims {
        crate::services::ai_tool_dispatcher::tests_support::claims(role, &[], denied)
    }

    #[test]
    fn an_unconfigured_provider_leaves_the_layer_off() {
        let provider = EmbeddingProvider::unconfigured();
        assert!(!provider.is_configured());
    }

    /// The vector column has a fixed width, so a passage's domain and a vector's
    /// width are both decided before anything is stored.
    #[test]
    fn every_source_kind_declares_a_domain() {
        for kind in SourceKind::all() {
            let domain = kind.domain();
            assert!(
                !domain.as_str().is_empty(),
                "{} must declare a permission domain",
                kind.name()
            );
        }
    }

    /// A client note is gated on the clients domain, not on the service domain
    /// its text might mention. Otherwise a note quoting a haircut would become
    /// readable by anyone allowed to see the service catalogue.
    #[test]
    fn a_client_note_is_gated_on_the_clients_domain() {
        assert_eq!(SourceKind::ClientNote.domain(), AiDomain::Clients);
        assert_eq!(SourceKind::Service.domain(), AiDomain::Services);
    }

    /// Retrieval offers exactly the domains the login may already read through
    /// a tool — never a wider set, and never a domain nothing indexes.
    #[test]
    fn readable_domains_follow_the_logins_grants() {
        let front_desk = claims("receptionist", &["clients.read"]);
        let domains = readable_domains(&front_desk);
        assert!(domains.contains(&"clients".to_string()));

        // Only the four kinds the indexer writes can ever appear, whatever else
        // the login holds; a domain with no corpus must not become searchable.
        let indexed: Vec<String> = SourceKind::all()
            .into_iter()
            .map(|kind| kind.domain().as_str().to_string())
            .collect();
        for domain in &domains {
            assert!(indexed.contains(domain), "{domain} has no indexed source");
        }
    }

    /// An explicit denial removes the domain from retrieval, so a login that
    /// cannot open a client through a tool cannot read a client note through
    /// search either.
    #[test]
    fn a_denied_permission_removes_its_domain_from_retrieval() {
        let restricted = claims_denied("receptionist", &["clients.read"]);
        assert!(!readable_domains(&restricted).contains(&"clients".to_string()));
    }

    /// With nothing readable, retrieval is not merely empty — it never runs, so
    /// no question text is sent to the embedding provider on behalf of a login
    /// that could not have been shown a single passage.
    #[test]
    fn a_login_with_no_readable_domain_retrieves_nothing() {
        let nobody = claims_denied(
            "staff",
            &[
                "clients.read",
                "services.read",
                "packages.read",
                "memberships.read",
            ],
        );
        assert!(readable_domains(&nobody).is_empty());
    }

    #[test]
    fn a_vector_is_rendered_in_pgvectors_own_text_form() {
        assert_eq!(vector_literal(&[1.0, -0.5, 0.25]), "[1,-0.5,0.25]");
        assert_eq!(vector_literal(&[]), "[]");
    }

    /// Identical content must hash identically, or every worker pass would
    /// re-embed the whole corpus and bill for it.
    #[test]
    fn identical_content_hashes_identically() {
        assert_eq!(
            content_hash("Balayage touch-up"),
            content_hash("Balayage touch-up")
        );
        assert_ne!(content_hash("Balayage touch-up"), content_hash("Balayage"));
    }

    /// Truncation must not split a multi-byte character, which would produce
    /// invalid text for both the provider and the database.
    #[test]
    fn truncation_respects_character_boundaries() {
        let long = "हेयर".repeat(1_000);
        let cut = truncate(&long);
        assert_eq!(cut.chars().count(), MAX_CONTENT_CHARS);
    }

    #[test]
    fn short_content_is_returned_trimmed_and_whole() {
        assert_eq!(truncate("  keratin treatment  "), "keratin treatment");
    }

    /// The floor exists so unrelated text never reaches the model. If it were
    /// zero, every question would retrieve the five nearest passages in the
    /// corpus however irrelevant they were.
    #[test]
    fn the_similarity_floor_excludes_unrelated_passages() {
        assert!(MIN_SIMILARITY > 0.0);
        assert!(MIN_SIMILARITY < 1.0);
    }

    // -----------------------------------------------------------------------
    // The indexer and search, against a real database. These need
    // `DATABASE_URL` and skip without it. No embedding provider is needed:
    // vectors are written directly, which is what lets the retrieval filters be
    // tested independently of what any model would return.
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

    /// A vector pointing at one axis, so similarity between two of them is
    /// predictable without involving a model.
    fn axis_vector(axis: usize) -> Vec<f32> {
        let mut values = vec![0.0_f32; EMBEDDING_DIMENSIONS];
        values[axis % EMBEDDING_DIMENSIONS] = 1.0;
        values
    }

    async fn insert_service(db: &PgPool, tenant: &str, branch: &str, name: &str) -> String {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
               VALUES ($1,$2,$3,$4,'Hair',45,100000,TRUE)"#,
        )
        .bind(&id)
        .bind(tenant)
        .bind(branch)
        .bind(name)
        .execute(db)
        .await
        .expect("service is seeded");
        id
    }

    /// Attaches a vector to a document the indexer already created.
    ///
    /// Deliberately an UPDATE that leaves `content` and `content_hash` alone. A
    /// hand-written document would differ from what the indexer computes, and
    /// the next indexer pass — which runs globally, from any parallel test —
    /// would treat it as edited content and clear the vector again.
    async fn attach_vector(
        db: &PgPool,
        tenant: &str,
        source_id: &str,
        domain: &str,
        embedding: &str,
        model: &str,
    ) {
        let updated = sqlx::query(
            r#"UPDATE ai_semantic_documents
                  SET embedding=$4::vector, embedding_model=$5, domain=$3, indexed_at=NOW()
                WHERE tenant_id=$1 AND source_id=$2"#,
        )
        .bind(tenant)
        .bind(source_id)
        .bind(domain)
        .bind(embedding)
        .bind(model)
        .execute(db)
        .await
        .expect("vector is attached");
        assert_eq!(
            updated.rows_affected(),
            1,
            "the indexer should have created exactly one document for this source"
        );
    }

    async fn document_of(
        db: &PgPool,
        tenant: &str,
        source_id: &str,
    ) -> Option<(String, String, Option<String>)> {
        sqlx::query_as(
            r#"SELECT content, domain, embedding_model
                 FROM ai_semantic_documents
                WHERE tenant_id=$1 AND source_id=$2"#,
        )
        .bind(tenant)
        .bind(source_id)
        .fetch_optional(db)
        .await
        .expect("document is readable")
        .map(|(content, domain, model): (String, String, String)| (content, domain, Some(model)))
    }

    /// The indexer records a live service, and drops it once the CRM does.
    #[tokio::test]
    async fn the_corpus_follows_the_crm_in_both_directions() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let service_id = insert_service(&db, &tenant, branch, "Keratin smoothing").await;

        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");

        let (content, domain, _) = document_of(&db, &tenant, &service_id)
            .await
            .expect("the service was indexed");
        assert!(content.contains("Keratin smoothing"));
        assert_eq!(
            domain, "services",
            "a service is gated on the services domain"
        );

        // Deactivating it in the CRM must take it out of the corpus, not merely
        // stop it being refreshed.
        sqlx::query("UPDATE services SET active=FALSE WHERE id=$1")
            .bind(&service_id)
            .execute(&db)
            .await
            .expect("service is deactivated");

        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs again");

        assert!(
            document_of(&db, &tenant, &service_id).await.is_none(),
            "a deactivated service must leave the index"
        );
    }

    /// Editing the source re-queues the document, so a stale vector can never
    /// keep serving text that has since changed.
    #[tokio::test]
    async fn edited_content_is_requeued_and_unchanged_content_is_left_alone() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let service_id = insert_service(&db, &tenant, branch, "Balayage").await;

        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");

        // Stand in for the embedding step.
        sqlx::query(
            r#"UPDATE ai_semantic_documents
                  SET embedding=$2::vector, embedding_model='test-model', indexed_at=NOW()
                WHERE tenant_id=$1"#,
        )
        .bind(&tenant)
        .bind(vector_literal(&axis_vector(0)))
        .execute(&db)
        .await
        .expect("embedding is stored");

        // A pass over unchanged content must not disturb the vector, or every
        // cycle would re-embed the whole corpus.
        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");
        let (_, _, model) = document_of(&db, &tenant, &service_id)
            .await
            .expect("document survives");
        assert_eq!(model.as_deref(), Some("test-model"));

        // Renaming it changes the content, which must clear the vector.
        sqlx::query("UPDATE services SET name=$2 WHERE id=$1")
            .bind(&service_id)
            .bind("Balayage with gloss")
            .execute(&db)
            .await
            .expect("service is renamed");

        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");

        let (content, _, model) = document_of(&db, &tenant, &service_id)
            .await
            .expect("document survives the edit");
        assert!(content.contains("Balayage with gloss"));
        assert_eq!(
            model.as_deref(),
            Some(""),
            "edited content must go back on the embedding queue"
        );
    }

    /// A note the author restricted must never enter the corpus. Filtering it
    /// at search time would still leave the text embedded in a table another
    /// query path could reach.
    #[tokio::test]
    async fn a_restricted_client_note_is_never_indexed() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        let client_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,active)
               VALUES ($1,$2,$3,'Priya','S',TRUE)"#,
        )
        .bind(&client_id)
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("client is seeded");

        let open_note = Uuid::new_v4().to_string();
        let private_note = Uuid::new_v4().to_string();
        for (id, visibility) in [(&open_note, "branch_staff"), (&private_note, "management")] {
            sqlx::query(
                r#"INSERT INTO client_notes(id,tenant_id,branch_id,client_id,note,visibility)
                   VALUES ($1,$2,$3,$4,'Prefers ammonia-free colour',$5)"#,
            )
            .bind(id)
            .bind(&tenant)
            .bind(branch)
            .bind(&client_id)
            .bind(visibility)
            .execute(&db)
            .await
            .expect("note is seeded");
        }

        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");

        assert!(document_of(&db, &tenant, &open_note).await.is_some());
        assert!(
            document_of(&db, &tenant, &private_note).await.is_none(),
            "a private note must never be indexed"
        );

        // Tightening visibility after indexing must also remove it.
        sqlx::query("UPDATE client_notes SET visibility='management' WHERE id=$1")
            .bind(&open_note)
            .execute(&db)
            .await
            .expect("visibility is tightened");
        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs again");
        assert!(
            document_of(&db, &tenant, &open_note).await.is_none(),
            "a note made private must leave the index"
        );
    }

    /// Search is filtered in SQL by tenant, branch and domain. This asserts all
    /// three at once against a corpus that contains a near-identical passage
    /// behind each boundary.
    #[tokio::test]
    async fn search_never_crosses_tenant_branch_or_domain() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let other_tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let query = vector_literal(&axis_vector(1));

        // Four passages, all at the same distance from the query vector.
        let rows = [
            (tenant.as_str(), "branch1", "services", "mine"),
            (tenant.as_str(), "branch2", "services", "other branch"),
            (tenant.as_str(), "branch1", "finance", "other domain"),
            (other_tenant.as_str(), "branch1", "services", "other tenant"),
        ];
        // Real service rows, indexed the way production would index them.
        // Reconciliation deletes documents whose source is gone and runs
        // globally, so a hand-written orphan would be swept away by any
        // parallel test's indexer pass.
        let mut sources = Vec::new();
        for (row_tenant, branch, domain, title) in rows {
            sources.push((
                row_tenant,
                insert_service(&db, row_tenant, branch, title).await,
                domain,
            ));
        }
        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");
        for (row_tenant, source_id, domain) in &sources {
            attach_vector(&db, row_tenant, source_id, domain, &query, "test-model").await;
        }

        let found = repository::search(
            &db,
            &tenant,
            &["branch1".to_string()],
            &["services".to_string()],
            &query,
            "test-model",
            MIN_SIMILARITY,
            10,
        )
        .await
        .expect("search runs");

        assert_eq!(found.len(), 1, "only the in-scope passage may be returned");
        assert_eq!(found[0].title, "mine");
        assert!(found[0].similarity > 0.99);
    }

    /// Vectors from a different model are not comparable, so a corpus part-way
    /// through a model change returns fewer results rather than wrong ones.
    #[tokio::test]
    async fn passages_from_another_model_are_not_returned() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());
        let query = vector_literal(&axis_vector(2));

        let source_id = insert_service(&db, &tenant, "branch1", "Old model passage").await;
        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");
        attach_vector(
            &db,
            &tenant,
            &source_id,
            "services",
            &query,
            "previous-model",
        )
        .await;

        let found = repository::search(
            &db,
            &tenant,
            &["branch1".to_string()],
            &["services".to_string()],
            &query,
            "current-model",
            MIN_SIMILARITY,
            10,
        )
        .await
        .expect("search runs");
        assert!(found.is_empty());
    }

    /// A passage that is merely present must not be returned for an unrelated
    /// question. Orthogonal vectors sit at similarity zero, well under the floor.
    #[tokio::test]
    async fn an_unrelated_passage_stays_below_the_similarity_floor() {
        let Some(db) = connect().await else { return };
        let tenant = format!("semantic_{}", Uuid::new_v4().simple());

        let source_id = insert_service(&db, &tenant, "branch1", "Unrelated passage").await;
        run_semantic_index_worker(&db, EmbeddingProvider::unconfigured())
            .await
            .expect("indexer runs");
        attach_vector(
            &db,
            &tenant,
            &source_id,
            "services",
            &vector_literal(&axis_vector(3)),
            "test-model",
        )
        .await;

        let found = repository::search(
            &db,
            &tenant,
            &["branch1".to_string()],
            &["services".to_string()],
            &vector_literal(&axis_vector(4)),
            "test-model",
            MIN_SIMILARITY,
            10,
        )
        .await
        .expect("search runs");
        assert!(
            found.is_empty(),
            "an unrelated passage must not be retrieved"
        );
    }
}
