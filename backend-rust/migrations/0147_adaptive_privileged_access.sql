CREATE TABLE IF NOT EXISTS security_temporary_elevations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions_json JSONB NOT NULL CHECK (JSONB_TYPEOF(permissions_json) = 'array'),
  source TEXT NOT NULL CHECK (source IN ('approval', 'break_glass')),
  approval_id TEXT REFERENCES security_approval_requests(id),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (BTRIM(reason) <> ''),
  CHECK (expires_at > created_at),
  CHECK ((source = 'approval' AND approval_id IS NOT NULL) OR source = 'break_glass')
);

CREATE INDEX IF NOT EXISTS idx_security_temporary_elevations_active
  ON security_temporary_elevations (tenant_id, branch_id, user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_security_temporary_elevation_approval
  ON security_temporary_elevations (approval_id)
  WHERE approval_id IS NOT NULL;
