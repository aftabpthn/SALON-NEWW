CREATE TABLE IF NOT EXISTS security_trusted_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trusted' CHECK (status IN ('trusted', 'revoked')),
  trusted_at TIMESTAMPTZ,
  trusted_by TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, user_id, device_id),
  CHECK (BTRIM(device_id) <> '')
);

CREATE INDEX IF NOT EXISTS idx_security_trusted_devices_scope
  ON security_trusted_devices (tenant_id, branch_id, user_id, status);
