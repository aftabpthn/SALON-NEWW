-- An explicit claim state, so confirmation is exactly-once.
--
-- Previously the CRM write ran before the draft transition was won. Two
-- concurrent confirmations could both pass the "is it still a draft" check,
-- both create a real CRM record, and only then race for the single approval —
-- leaving one task orphaned and unreferenced.
--
-- 'executing' is claimed atomically before any write. Only the winner proceeds;
-- a failure releases the claim so the draft can be retried rather than being
-- stranded.

ALTER TABLE ai_action_drafts DROP CONSTRAINT IF EXISTS ai_action_drafts_status_check;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ai_action_drafts_status_check
  CHECK (status IN ('draft','executing','approved','executed','cancelled')) NOT VALID;

-- 'executing' is undecided: the claim has been taken but no approval has been
-- recorded, so `decided_at` is still null and must be allowed to be.
ALTER TABLE ai_action_drafts DROP CONSTRAINT IF EXISTS ai_action_drafts_decided;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ai_action_drafts_decided CHECK (
    (status IN ('draft','executing') AND decided_at IS NULL)
    OR (status NOT IN ('draft','executing') AND decided_at IS NOT NULL)
  ) NOT VALID;

-- A claim records who took it and when, so a stuck claim is diagnosable.
ALTER TABLE ai_action_drafts
  ADD COLUMN IF NOT EXISTS claimed_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_action_drafts_executing
  ON ai_action_drafts (tenant_id, branch_id, claimed_at)
  WHERE status = 'executing';
