-- Acknowledge, snooze and dismiss for proactive signals.
--
-- Without these a briefing can only be read, never answered: the same finding
-- returns every cycle until the underlying number moves, which is how an alert
-- feed becomes noise people stop reading.
--
-- Dismissal is deliberately tied to the fingerprint rather than being permanent.
-- Silencing "stock is short" forever would also silence it when a different,
-- worse shortage appears, so a materially changed finding raises again.

ALTER TABLE ai_signal_state
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  -- The finding the decision was made against, so a changed finding is not
  -- silenced by a decision taken about a different one.
  ADD COLUMN IF NOT EXISTS decided_fingerprint TEXT NOT NULL DEFAULT '',
  -- The figures behind the last raise, kept so an acknowledged signal can still
  -- be reviewed after the fact.
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE ai_signal_state DROP CONSTRAINT IF EXISTS ck_ai_signal_state_status;
ALTER TABLE ai_signal_state
  ADD CONSTRAINT ck_ai_signal_state_status
  CHECK (status IN ('open','acknowledged','snoozed','dismissed')) NOT VALID;

ALTER TABLE ai_signal_state DROP CONSTRAINT IF EXISTS ck_ai_signal_state_snooze_window;
ALTER TABLE ai_signal_state
  ADD CONSTRAINT ck_ai_signal_state_snooze_window
  CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_ai_signal_state_status
  ON ai_signal_state (tenant_id, branch_id, status, snoozed_until);
