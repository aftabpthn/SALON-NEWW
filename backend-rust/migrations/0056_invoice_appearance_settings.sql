CREATE TABLE IF NOT EXISTS invoice_appearance_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

