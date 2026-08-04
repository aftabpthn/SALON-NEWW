-- Automatic lead scoring.
--
-- marketing_leads.score has existed since 0199 but nothing ever wrote to it:
-- it was a number a user typed in, and every consumer downstream — the priority
-- queue in lead_advice, the follow-up cadence, the ordering of the lead list —
-- treated it as signal. A field nobody maintains reads as "score 0" for most
-- rows, which pushed real leads to the bottom of the queue.
--
-- The score stays on marketing_leads so existing readers keep working unchanged.
-- What is added here is the provenance around it: whether a human set it, when
-- it was last computed, and which factors produced it.

ALTER TABLE marketing_leads
  -- A manual score is a deliberate judgement and the worker must never
  -- overwrite it. Rows stay 'manual' until scoring claims them, so existing
  -- data keeps whatever a user already entered.
  ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (score_source IN ('manual', 'auto')),
  ADD COLUMN IF NOT EXISTS score_computed_at TIMESTAMPTZ,
  -- The factor breakdown that produced the score: one entry per contribution,
  -- with its label, points and the evidence behind it. Stored rather than
  -- recomputed on read so the number a user saw can always be explained, even
  -- after the underlying activity has moved on.
  ADD COLUMN IF NOT EXISTS score_factors_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Which scoring policy produced the value. Kept alongside the score so a
  -- policy change is visible in the data instead of silently reinterpreting
  -- history.
  ADD COLUMN IF NOT EXISTS score_model_version TEXT NOT NULL DEFAULT '';

-- The worker claims the least recently scored open leads in a branch, so the
-- ordering columns are the ones it filters and sorts on.
CREATE INDEX IF NOT EXISTS idx_marketing_leads_scoring_due
  ON marketing_leads (tenant_id, branch_id, score_computed_at NULLS FIRST)
  WHERE stage NOT IN ('converted', 'lost');

-- Per-source conversion rates are derived from the tenant's own history rather
-- than fixed weights, and that history is read on every scoring pass.
CREATE INDEX IF NOT EXISTS idx_marketing_leads_source_outcome
  ON marketing_leads (tenant_id, branch_id, source, stage);
