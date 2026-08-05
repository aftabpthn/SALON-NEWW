-- Durable recall for the copilot: what a client told us, kept on purpose.
--
-- The semantic index (0421) answers "what does the CRM say about this topic".
-- It cannot answer "what did Priya tell us she wants", because that is not a
-- similarity question — it is an exact fact somebody chose to keep, and it has
-- to come back the same way every time.
--
-- Four rules are enforced by this schema rather than by convention, because
-- every one of them is a rule about somebody else's personal information:
--
-- * **Memory is recorded, never inferred.** `source` has no value meaning "the
--   model concluded this". A wrong inference written into durable memory would
--   be recalled as fact forever, and nobody would know where it came from. A
--   person writes these, and the row says which person.
-- * **Everything expires.** `expires_at` is NOT NULL and capped, so there is no
--   way to write a note that outlives its own usefulness. A preference stated
--   three years ago is not a preference, it is a guess.
-- * **Memory follows its subject.** A client who is deleted, deactivated or
--   merged takes their notes with them; the reconciliation runs on a schedule
--   rather than relying on every delete path remembering to call it.
-- * **Sensitive notes are marked and kept shorter.** Salons legitimately record
--   an allergy. Recording it is not the risk; keeping it indefinitely, and
--   handing it to every channel, is.

CREATE TABLE IF NOT EXISTS ai_memory_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- What the note is about. A `user` note is an operator's own working
  -- preference; a `client` note is personal information about someone else and
  -- carries every rule below.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('client','user')),
  subject_id TEXT NOT NULL,
  -- Where the fact came from. Deliberately no model-derived option: see above.
  source TEXT NOT NULL CHECK (source IN ('stated_by_client','recorded_by_staff')),
  content TEXT NOT NULL CHECK (BTRIM(content) <> '' AND LENGTH(content) <= 500),
  -- Health, allergy or anything else a person would not expect repeated back to
  -- them over WhatsApp. Kept for a shorter period and never sent to an external
  -- channel.
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by TEXT NOT NULL CHECK (BTRIM(recorded_by) <> ''),
  -- When the note stops being recalled. Never null: a note with no end date is
  -- a note nobody ever decided to keep.
  expires_at TIMESTAMPTZ NOT NULL,
  -- Moved whenever the note is actually used, so a note that never helps can be
  -- told apart from one that does.
  last_recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The same fact twice is one fact. Re-recording it extends the expiry rather
  -- than stacking duplicates that would all come back together on recall.
  CONSTRAINT ai_memory_notes_unique UNIQUE (tenant_id, branch_id, subject_kind, subject_id, content),
  -- A note cannot be born expired, which would make it invisible and
  -- undeletable-looking at the same time.
  CONSTRAINT ck_ai_memory_notes_expiry CHECK (expires_at > created_at)
);

-- The recall path: one subject's live notes, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_memory_notes_subject
  ON ai_memory_notes (tenant_id, branch_id, subject_kind, subject_id, created_at DESC);

-- The retention sweep.
CREATE INDEX IF NOT EXISTS idx_ai_memory_notes_expiry
  ON ai_memory_notes (expires_at);
