CREATE TABLE IF NOT EXISTS security_approval_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(details_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_security_approval_requests_scope
  ON security_approval_requests (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS security_access_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'ip' CHECK (rule_type = 'ip'),
  match_value TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'watch'
    CHECK (effect IN ('allow', 'watch', 'deny')),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by TEXT NOT NULL,
  disabled_by TEXT,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status = 'active' OR (disabled_by IS NOT NULL AND disabled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_security_access_rules_scope
  ON security_access_rules (tenant_id, branch_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_security_access_rules_active_match
  ON security_access_rules (tenant_id, branch_id, rule_type, match_value)
  WHERE status = 'active';
