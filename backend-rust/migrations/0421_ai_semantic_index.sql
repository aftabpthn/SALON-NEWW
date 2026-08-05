-- Semantic retrieval over CRM text the copilot's tools cannot reach.
--
-- The tool dispatcher answers a fixed set of questions extremely well and
-- refuses everything else. That refusal is correct for anything involving
-- money or a decision, but it also means a question whose answer is sitting in
-- a service description or a client note goes unanswered because no keyword
-- matched. This table is the index that closes that gap without loosening the
-- tool path: retrieval returns *passages with sources*, never a computed
-- figure, so a tool answer stays the only thing that can state a number.
--
-- Three properties this schema enforces rather than assumes:
--
-- * **A passage carries its own permission domain.** Retrieval filters on
--   `domain` using the same `ai_scope_service` grants the tools check, so a
--   receptionist cannot reach a passage from a domain they may not read. A
--   domain column that could be wrong would be worse than no retrieval at all,
--   which is why it is written by the indexer from the source table, never
--   inferred from the text.
-- * **The index is derived, never authoritative.** Every row points back at the
--   row it came from. Nothing here is the only copy of anything, so the whole
--   table can be dropped and rebuilt.
-- * **A queued row is one with no embedding.** `embedding IS NULL` is the work
--   queue; changing the source content nulls it again. There is no separate
--   job table to drift out of sync with the corpus.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ai_semantic_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- Which CRM table this passage was built from. Deliberately a closed list:
  -- adding a source means deciding its permission domain and its deletion
  -- behaviour, which is a code change, not a configuration one.
  source_kind TEXT NOT NULL CHECK (source_kind IN ('service','package','membership','client_note')),
  source_id TEXT NOT NULL,
  -- The permission domain of the source row, mirroring ai_scope_service::AiDomain.
  domain TEXT NOT NULL CHECK (domain IN (
    'appointments','pos','staff','clients','services','inventory',
    'memberships','packages','marketing','finance','reviews',
    'geo_comparison','forecasting'
  )),
  -- The CRM entity the passage is about, when it is about one — a client id for
  -- a note. Lets a retrieved passage be tied back to a subject without parsing.
  subject_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  -- Digest of the content as indexed. Unchanged content is never re-embedded,
  -- which is what keeps the worker's provider spend proportional to edits
  -- rather than to corpus size.
  content_hash TEXT NOT NULL,
  -- The model that produced the vector. Stored per row because a corpus
  -- part-way through a model change holds two populations, and mixing them in
  -- one similarity search would silently return nonsense.
  embedding_model TEXT NOT NULL DEFAULT '',
  -- 1536 dimensions matches the configured embedding model. A vector column
  -- must have a fixed width to be indexable, so a model of a different width is
  -- rejected by the writer rather than silently truncated.
  embedding vector(1536),
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One passage per source row. Re-indexing updates in place, so the corpus
  -- cannot accumulate stale duplicates of an edited note.
  CONSTRAINT ai_semantic_documents_source UNIQUE (tenant_id, branch_id, source_kind, source_id)
);

-- An embedded row must say which model embedded it, or a later model change
-- could not tell which population a vector belongs to.
ALTER TABLE ai_semantic_documents
  DROP CONSTRAINT IF EXISTS ck_ai_semantic_documents_model;
ALTER TABLE ai_semantic_documents
  ADD CONSTRAINT ck_ai_semantic_documents_model
  CHECK (embedding IS NULL OR embedding_model <> '') NOT VALID;

-- The indexer's queue: rows still waiting for a vector. Partial, so it stays
-- proportional to the backlog rather than to the corpus.
CREATE INDEX IF NOT EXISTS idx_ai_semantic_documents_pending
  ON ai_semantic_documents (created_at)
  WHERE embedding IS NULL;

-- The reconciliation and per-source reads.
CREATE INDEX IF NOT EXISTS idx_ai_semantic_documents_source_kind
  ON ai_semantic_documents (tenant_id, branch_id, source_kind, source_id);

-- Approximate nearest neighbour over cosine distance. HNSW rather than IVFFlat
-- because it needs no training pass, which matters for a corpus that starts
-- empty on every new tenant.
CREATE INDEX IF NOT EXISTS idx_ai_semantic_documents_embedding
  ON ai_semantic_documents USING hnsw (embedding vector_cosine_ops);
