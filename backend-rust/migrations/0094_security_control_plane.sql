CREATE TABLE IF NOT EXISTS security_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  policy_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  source_ip TEXT,
  user_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS security_blocklist (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ip_address TEXT,
  user_id TEXT,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  blocked_until TIMESTAMPTZ,
  unblocked_at TIMESTAMPTZ,
  unblocked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (COALESCE(BTRIM(ip_address), '') <> '' OR COALESCE(BTRIM(user_id), '') <> '')
);

CREATE INDEX IF NOT EXISTS idx_security_settings_scope
  ON security_settings (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_security_alerts_scope_status
  ON security_alerts (tenant_id, branch_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_blocklist_scope_active
  ON security_blocklist (tenant_id, branch_id, unblocked_at, blocked_until);
