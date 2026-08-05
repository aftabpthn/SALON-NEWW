-- Earned autonomy for copilot actions.
--
-- Until now every copilot action stopped at a person, and for anything that
-- moves money or reaches a client it always will. But three of the fourteen
-- kinds only write a to-do — a follow-up, a coaching task, a membership
-- check-in. For those, asking for a click on the four-hundredth identical
-- proposal is not a safety control; it is a habit that trains people to click
-- without reading, which makes every *other* confirmation weaker.
--
-- Autonomy here is earned, granted, bounded and reversible, and all four are
-- required at once:
--
-- * **Earned.** The branch's own approval history has to show that people
--   agree with this kind of proposal. The bar is measured from decisions
--   already made, so it cannot be asserted into existence by configuration.
-- * **Granted.** An owner or admin still switches it on per action kind. A
--   measured hit rate is evidence, not consent, and nothing becomes autonomous
--   because a threshold happened to be crossed.
-- * **Bounded.** Only kinds the code already completes on approval are
--   eligible. The rest route to a screen, and a screen with nobody at it is not
--   an action.
-- * **Reversible.** Every autonomous execution carries an undo deadline. An
--   undo does not merely reverse the write: it revokes the grant, so the kind
--   goes back to asking until it earns the right again.

CREATE TABLE IF NOT EXISTS ai_action_autonomy (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- Deliberately narrower than the draft allow-list. These are the only kinds
  -- `executes_on_approval` completes; everything else hands off to a screen, so
  -- there is nothing for autonomy to do.
  action_type TEXT NOT NULL CHECK (action_type IN (
    'create_follow_up_task',
    'create_coaching_task',
    'create_membership_follow_up'
  )),
  -- The grant. Off is the only default: a kind that has earned the right still
  -- does nothing until a person turns it on.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_by TEXT NOT NULL DEFAULT '',
  enabled_at TIMESTAMPTZ,
  -- Set when an autonomous run was undone. While this is in the future the kind
  -- asks for confirmation again regardless of what its approval history says,
  -- which is what stops a bad run being re-earned within the same afternoon.
  suspended_until TIMESTAMPTZ,
  suspended_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_action_autonomy_scope UNIQUE (tenant_id, branch_id, action_type),
  -- An enabled grant has to say who granted it and when. An anonymous grant
  -- would leave nobody accountable for an action nobody clicked.
  CONSTRAINT ck_ai_action_autonomy_granted CHECK (
    enabled = FALSE OR (enabled_by <> '' AND enabled_at IS NOT NULL)
  ),
  CONSTRAINT ck_ai_action_autonomy_suspended CHECK (
    suspended_until IS NULL OR suspended_reason <> ''
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_action_autonomy_scope
  ON ai_action_autonomy (tenant_id, branch_id, action_type);

-- How a decision was reached, and how to take it back.
ALTER TABLE ai_action_drafts
  -- 'human' for every draft a person confirmed or cancelled, which is what all
  -- existing rows are. 'autonomous' only ever appears on a run that met the
  -- earned-and-granted bar above.
  ADD COLUMN IF NOT EXISTS decision_mode TEXT NOT NULL DEFAULT 'human',
  -- Until this instant the run can be undone by anyone who could have refused
  -- it. After it, the record stands and the undo route refuses.
  ADD COLUMN IF NOT EXISTS undo_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS undo_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_action_drafts
  DROP CONSTRAINT IF EXISTS ck_ai_action_drafts_decision_mode;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ck_ai_action_drafts_decision_mode
  CHECK (decision_mode IN ('human','autonomous')) NOT VALID;

-- An undone run must record who undid it. Without that the reversal is
-- indistinguishable from the write never having happened, which is exactly the
-- history an autonomous system must not be able to lose.
ALTER TABLE ai_action_drafts
  DROP CONSTRAINT IF EXISTS ck_ai_action_drafts_undone_attributed;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ck_ai_action_drafts_undone_attributed
  CHECK (undone_at IS NULL OR undone_by <> '') NOT VALID;

-- Only an autonomous run has an undo window. A human approval is already a
-- decision someone made and owns.
ALTER TABLE ai_action_drafts
  DROP CONSTRAINT IF EXISTS ck_ai_action_drafts_undo_window;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ck_ai_action_drafts_undo_window
  CHECK (undo_deadline IS NULL OR decision_mode = 'autonomous') NOT VALID;

-- The eligibility read: recent decisions for one kind in one branch.
CREATE INDEX IF NOT EXISTS idx_ai_action_drafts_decisions
  ON ai_action_drafts (tenant_id, branch_id, action_type, decided_at DESC)
  WHERE decided_at IS NOT NULL;

-- The undo route's lookup, and the operator question "what did it do today".
CREATE INDEX IF NOT EXISTS idx_ai_action_drafts_autonomous
  ON ai_action_drafts (tenant_id, branch_id, decided_at DESC)
  WHERE decision_mode = 'autonomous';

-- Two new audit events. `autonomous` records a run the copilot decided on its
-- own; `undone` records a person taking one back. Both belong in the same audit
-- table as every human decision, because an autonomous system whose actions are
-- filed somewhere separate is one nobody reviews alongside the rest.
ALTER TABLE ai_action_audit
  DROP CONSTRAINT IF EXISTS ai_action_audit_event_check;
ALTER TABLE ai_action_audit
  ADD CONSTRAINT ai_action_audit_event_check
  CHECK (event IN (
    'drafted','confirmed','approved','cancelled','refused','replayed','failed',
    'autonomous','undone'
  )) NOT VALID;
