CREATE TABLE IF NOT EXISTS security_incident_playbooks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  playbook_key TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),
  checklist_json JSONB NOT NULL
    CHECK (
      JSONB_TYPEOF(checklist_json) = 'array'
      AND JSONB_ARRAY_LENGTH(checklist_json) BETWEEN 1 AND 20
    ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by TEXT NOT NULL,
  disabled_by TEXT,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status = 'active' OR (disabled_by IS NOT NULL AND disabled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_security_incident_playbooks_scope
  ON security_incident_playbooks (tenant_id, branch_id, status, severity, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_security_incident_playbooks_active_key
  ON security_incident_playbooks (tenant_id, branch_id, playbook_key)
  WHERE status = 'active';
