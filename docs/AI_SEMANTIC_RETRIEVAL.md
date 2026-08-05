# AI Semantic Retrieval

> **Status:** Active, provider-gated. Off unless `AI_PROVIDER=openai`.
> **Owner modules:** `backend-rust/src/services/ai_semantic_service.rs`,
> `backend-rust/src/repositories/ai_semantic_repository.rs`,
> migration `0421_ai_semantic_index.sql`, `ai-service/main.py`
> (`POST /api/v1/embeddings`).

## 1. Why this exists

`ai_copilot_tools` answers a fixed set of questions from SQL and refuses
everything else. That refusal is correct for anything that states a number — a
figure must come from a query someone can audit — but it also meant a question
whose answer was sitting in a service description or a client note got nothing,
because no keyword matched a tool.

Retrieval closes exactly that gap. It does not widen what the copilot may
answer, and it does not change how anything is answered today.

## 2. The three rules

**Retrieval never outranks a tool.** It is consulted only when the dispatcher
matched *nothing*. A question a tool answered is still answered by the tool, and
a `Forbidden` refusal is final — retrieving around a permission the caller does
not hold is precisely what must not happen.

**Retrieval returns passages, never conclusions.** Every result carries the row
it came from. Nothing in this path computes a total, a trend, a rate or a
recommendation. The provider instruction attached to retrieved passages is the
opposite of the one attached to tool evidence: *summarise what is written and
name the source; do not derive figures from prose.*

**The same scope chain applies.** A passage carries the permission domain of its
source table, written by the indexer and never inferred from the text. Search
filters on tenant, on the branches the login's grants resolved to, and on the
domains it may read — all in SQL. Ranking first and filtering afterwards would
let an unreadable passage consume a result slot, which leaks its existence
through the shape of the answer.

## 3. Hard dependency: pgvector

Migration `0421` runs `CREATE EXTENSION IF NOT EXISTS vector`.

- **Local / Docker:** `docker-compose.yml` now uses `pgvector/pgvector:pg16`,
  which is the stock PostgreSQL 16 image plus the extension. The plain
  `postgres:16` image can no longer run migrations.
- **Managed PostgreSQL 16 (including RDS):** the extension ships with the
  engine; the migration's `CREATE EXTENSION` is all that is needed. No instance
  or parameter-group change.

## 4. The corpus

| Source | Table | Domain | Filter |
| --- | --- | --- | --- |
| `service` | `services` | `services` | active, named |
| `package` | `packages` | `packages` | active, named |
| `membership` | `memberships` | `memberships` | active, named |
| `client_note` | `client_notes` | `clients` | `visibility='branch_staff'`, client active and unmerged |

`source_kind` is a closed list. Adding one means deciding its permission domain
and its deletion behaviour, which is a code change rather than configuration.

### What is deliberately not indexed

**AI Scribe transcripts.** `staff_ai_scribe_sessions` enforces consent and a
`transcript_retention_until` purge, and revoking consent deletes the transcript.
An embedded copy in a second table would survive both, defeating the guarantee
the Scribe schema exists to make. If transcripts are ever indexed, the retention
and revocation paths must delete from the index in the same transaction.

**Client notes with narrower visibility.** Only `branch_staff` notes are
indexed. `assigned_staff` and `management` notes never enter the corpus at all —
filtering them out at search time would still leave the text embedded in a table
another query path could reach.

## 5. The indexer

`run_semantic_index_worker` runs on the `ai_semantic_index` worker, hourly,
under the standard lease-plus-advisory-lock election. Each cycle:

1. **Collect.** Each source is read in pages of 500 by id cursor, truncated to
   1,500 characters, hashed, and upserted. Unchanged content is left completely
   untouched — not even `updated_at` moves — so a pass over a stable corpus
   writes nothing and costs nothing. Changed content nulls the vector, which is
   what puts the row back on the queue.
2. **Reconcile.** Documents whose source row no longer exists *or no longer
   qualifies* are deleted. This is an anti-join against the source table, not a
   comparison against the ids the indexer happened to read — a paged read cannot
   be trusted to decide deletions, or everything past the page boundary would be
   dropped on every pass. Reconciliation runs every cycle, including when no
   provider is configured, so a note deleted or restricted in the CRM stops
   being retrievable regardless of embedding state.
3. **Embed.** Up to 128 documents per cycle, in chunks of 32. The cap is
   deliberate: each call is billable, and an unbounded first pass over a large
   tenant would spend the budget in one cycle. A provider failure breaks the
   loop and leaves the rest queued.

`embedding IS NULL` *is* the work queue. There is no separate job table to drift
out of sync with the corpus.

## 6. Search

```
question → embed → filter (tenant, branches, domains, model) → cosine top-5
```

- **Similarity floor** of 0.34. Below it a passage is not about the question;
  returning weak matches would put unrelated text in front of the model and
  invite it to build an answer from it.
- **Model filter.** Vectors from a different `embedding_model` are excluded.
  They are not comparable, so a corpus mid-migration returns *fewer* results
  rather than wrong ones.
- **Index:** HNSW over `vector_cosine_ops`. HNSW rather than IVFFlat because it
  needs no training pass, which matters for a corpus that starts empty on every
  new tenant.

Search returns empty — never an error — whenever it cannot help: no provider, no
readable domain, no branch, nothing above the floor. It is a fallback path, and
an error there would turn "nothing to add" into a failed answer.

## 7. Degradation

Without `AI_PROVIDER=openai` the embeddings endpoint returns 503 and the whole
layer is inert. This is the one AI path in the system with **no local
fallback**, and that is intentional: elsewhere a deterministic fallback over
real history is still honest arithmetic, whereas a locally invented vector would
place passages at meaningless distances and retrieval would confidently return
nonsense.

The corpus is still tracked and reconciled without a provider, so switching one
on later does not index rows that have since been deleted.

## 8. API surface

Retrieved passages appear on `ConciergeResponse.retrieved` (omitted when empty),
each with `sourceKind`, `sourceId`, `subjectId`, `title`, `content` and
`similarity`. They are returned so a reply can be traced back to the rows it was
written from — a passage without its source is indistinguishable from something
the model made up.

## 9. Future roadmap

Per-client and per-user memory, once listed here, is delivered separately in
[AI_MEMORY.md](./AI_MEMORY.md). It deliberately does *not* sit on this schema:
recall of a stated fact must be exact and expiring, which is a different
problem from similarity search over a derived index.

- Index appointment and treatment history summaries once there is a derived,
  non-clinical form of them that carries no retention obligation.
Whether retrieval helps is now measured rather than assumed. A reply the
semantic layer contributed to is marked in its stored model name
(`…+retrieval`), and feedback on that message is labelled `semantic_retrieval`
**server-side** — a rate a caller can label its own votes with is not a
measurement. `GET /api/v1/ai/retrieval/helpfulness` reports it over the same
180-day window the prediction accuracy uses, and withholds the percentage below
20 ratings for the same reason.

Still open:

- Index appointment and treatment history summaries once there is a derived,
  non-clinical form of them that carries no retention obligation. Deliberately
  not started: without that form, indexing them would recreate exactly the
  problem that keeps Scribe transcripts out of the corpus.
