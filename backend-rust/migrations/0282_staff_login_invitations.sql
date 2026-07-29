CREATE TABLE staff_login_invitations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id TEXT,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  revoked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX idx_staff_login_invitations_staff
  ON staff_login_invitations (tenant_id, branch_id, staff_id, created_at DESC);

CREATE UNIQUE INDEX uq_staff_login_invitations_pending
  ON staff_login_invitations (tenant_id, branch_id, staff_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
