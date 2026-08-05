-- A client saying "that is not right" about what we remember.
--
-- Erasing was already possible, and it is the safe fallback. But a silent
-- deletion tells the salon nothing: they lose the note and never learn it was
-- wrong, so whoever wrote it writes the same thing again next month. A dispute
-- keeps the fact that something was contested, which is the part worth having.
--
-- Two rules the schema carries:
--
-- * **A disputed note stops being recalled the moment it is disputed**, before
--   anybody reviews it. Waiting for a person would mean the assistant kept
--   acting on something the client has just told us is wrong, for however long
--   the queue takes. Withholding first and reviewing after is the only order
--   that is defensible.
-- * **A client never edits the content.** They may say it is wrong; they may
--   erase it. Rewriting it would turn a record of what was said into whatever
--   the last person wanted it to say, and then it is evidence of nothing.
--
-- Resolution is deliberately two-valued. `corrected` means the salon agreed and
-- the note goes. `upheld` means they did not, and the note returns to use — but
-- the dispute stays on the row, so a note that has been contested and kept is
-- visibly different from one nobody ever questioned.

ALTER TABLE ai_memory_notes
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ,
  -- The client's own words, when they gave any. Optional: "this is wrong" with
  -- no elaboration is still a dispute worth acting on.
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dispute_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_resolved_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dispute_outcome TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_memory_notes
  DROP CONSTRAINT IF EXISTS ck_ai_memory_notes_dispute_outcome;
ALTER TABLE ai_memory_notes
  ADD CONSTRAINT ck_ai_memory_notes_dispute_outcome
  CHECK (dispute_outcome IN ('','corrected','upheld')) NOT VALID;

-- A resolution has to belong to a dispute, and has to name who resolved it.
-- Otherwise "reviewed" is a claim with nobody behind it.
ALTER TABLE ai_memory_notes
  DROP CONSTRAINT IF EXISTS ck_ai_memory_notes_dispute_resolution;
ALTER TABLE ai_memory_notes
  ADD CONSTRAINT ck_ai_memory_notes_dispute_resolution
  CHECK (
    dispute_resolved_at IS NULL
    OR (disputed_at IS NOT NULL AND dispute_resolved_by <> '' AND dispute_outcome <> '')
  ) NOT VALID;

-- The staff queue: what a client has contested and nobody has looked at yet.
CREATE INDEX IF NOT EXISTS idx_ai_memory_notes_open_disputes
  ON ai_memory_notes (tenant_id, branch_id, disputed_at DESC)
  WHERE disputed_at IS NOT NULL AND dispute_resolved_at IS NULL;
