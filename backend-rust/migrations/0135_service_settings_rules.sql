CREATE TABLE IF NOT EXISTS service_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_services_scope_lower_name
  ON services (tenant_id, branch_id, LOWER(name));
