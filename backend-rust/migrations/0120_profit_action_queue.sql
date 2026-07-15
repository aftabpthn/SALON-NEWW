CREATE TABLE IF NOT EXISTS profit_action_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  governance_decision_id TEXT UNIQUE
    REFERENCES profit_governance_decisions(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (LENGTH(action_type) BETWEEN 1 AND 64),
  title TEXT NOT NULL CHECK (LENGTH(title) BETWEEN 1 AND 120),
  message TEXT NOT NULL DEFAULT '' CHECK (LENGTH(message) <= 500),
  impact_paise BIGINT NOT NULL DEFAULT 0 CHECK (impact_paise >= 0),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','completed','dismissed')),
  source_type TEXT NOT NULL CHECK (LENGTH(source_type) BETWEEN 1 AND 64),
  source_id TEXT NOT NULL CHECK (LENGTH(source_id) BETWEEN 1 AND 128),
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(payload_json) = 'object'),
  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  completed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_profit_action_queue_scope
  ON profit_action_queue
    (tenant_id, branch_id, status, priority, updated_at DESC);

ALTER TABLE profit_governance_audit_events
  DROP CONSTRAINT IF EXISTS profit_governance_audit_events_event_type_check;

ALTER TABLE profit_governance_audit_events
  ADD CONSTRAINT profit_governance_audit_events_event_type_check CHECK (
    event_type IN (
      'rule_saved','evaluated','approval_requested','approved','rejected',
      'action_created','action_approved','action_completed','action_dismissed'
    )
  );
