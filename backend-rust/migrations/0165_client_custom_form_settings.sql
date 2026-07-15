CREATE TABLE IF NOT EXISTS client_custom_form_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_client_custom_form_settings_scope
  ON client_custom_form_settings (tenant_id, branch_id);
