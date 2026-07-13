CREATE TABLE IF NOT EXISTS due_recovery_followups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'follow_up',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_due_recovery_followups_sale
  ON due_recovery_followups (tenant_id, branch_id, sale_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_parity_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  test_case TEXT NOT NULL,
  legacy_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rust_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rust_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_parity_runs_created
  ON pos_parity_runs (tenant_id, branch_id, created_at DESC);
