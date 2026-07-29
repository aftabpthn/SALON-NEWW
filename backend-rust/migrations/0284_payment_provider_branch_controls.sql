CREATE TABLE IF NOT EXISTS payment_provider_branch_controls (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider <> ''),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_branch_controls_enabled
  ON payment_provider_branch_controls (tenant_id, branch_id, enabled, provider);
