ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS close_requested_by_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS close_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_active_session
  ON cash_drawer_sessions (tenant_id, branch_id, business_date)
  WHERE status IN ('open', 'pending_approval');

CREATE TABLE IF NOT EXISTS cash_drawer_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_audit_events_session
  ON cash_drawer_audit_events (tenant_id, branch_id, drawer_session_id, created_at DESC);
