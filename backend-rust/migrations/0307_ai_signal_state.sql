-- Dedupe and cooldown state for proactive AI signals.
--
-- Delivery reuses the existing `notifications` table; this only records what has
-- already been said, so the same finding does not get announced twice.
--
-- Two different suppressions, deliberately kept apart:
--   * fingerprint — the signal says the same thing as last time, so repeating it
--     adds nothing however long ago that was.
--   * cooldown    — the signal has changed, but it was raised recently enough
--     that raising it again would be noise.

CREATE TABLE IF NOT EXISTS ai_signal_state (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- Stable identity of the signal, e.g. 'service_decline' or
  -- 'membership_expiry'. Not the finding itself.
  signal_key TEXT NOT NULL,
  -- Digest of the finding's substance. Equal fingerprints mean the signal is
  -- saying the same thing it said last time.
  fingerprint TEXT NOT NULL,
  -- Confidence the signal carried when it was last raised, so suppression
  -- decisions can be reviewed.
  confidence TEXT NOT NULL DEFAULT 'medium',
  notification_id TEXT,
  raised_count INTEGER NOT NULL DEFAULT 1 CHECK (raised_count > 0),
  first_raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_signal_state_scope
  ON ai_signal_state (tenant_id, branch_id, last_raised_at DESC);
