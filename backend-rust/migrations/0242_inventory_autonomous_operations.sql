CREATE TABLE IF NOT EXISTS inventory_automation_policies (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_transfer_drafts BOOLEAN NOT NULL DEFAULT TRUE,
  auto_po_drafts BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_budget_paise BIGINT NOT NULL DEFAULT 0 CHECK (monthly_budget_paise >= 0),
  expiry_rescue_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_rescue_days BETWEEN 1 AND 365),
  run_interval_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (run_interval_minutes BETWEEN 60 AND 10080),
  escalation_minutes INTEGER NOT NULL DEFAULT 240 CHECK (escalation_minutes BETWEEN 30 AND 10080),
  min_confidence_bps INTEGER NOT NULL DEFAULT 7000 CHECK (min_confidence_bps BETWEEN 0 AND 10000),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_automation_policies_due
  ON inventory_automation_policies (next_run_at)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS inventory_automation_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('transfer_draft','po_draft','expiry_rescue','reconciliation')),
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','rejected','completed','failed')),
  dedupe_key TEXT NOT NULL CHECK (BTRIM(dedupe_key) <> ''),
  title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
  rationale TEXT NOT NULL,
  confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  estimated_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_paise >= 0),
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_automation_actions_queue
  ON inventory_automation_actions (tenant_id, branch_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_automation_notification
  ON notifications (tenant_id, branch_id, notification_type, resource_id)
  WHERE notification_type IN ('inventory_automation','inventory_automation_escalation');
