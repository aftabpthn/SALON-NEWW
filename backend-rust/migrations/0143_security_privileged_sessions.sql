CREATE TABLE IF NOT EXISTS security_privileged_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  action_scope TEXT NOT NULL DEFAULT 'sensitive_action',
  verification_method TEXT NOT NULL CHECK (verification_method IN ('mfa', 'password')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, user_id, session_id, action_scope)
);

CREATE INDEX IF NOT EXISTS idx_security_privileged_sessions_active
  ON security_privileged_sessions (tenant_id, branch_id, user_id, session_id, expires_at DESC)
  WHERE revoked_at IS NULL;
