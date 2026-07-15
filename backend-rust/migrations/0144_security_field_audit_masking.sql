CREATE TABLE IF NOT EXISTS security_field_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_group TEXT NOT NULL,
  field_name TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('view', 'export', 'mask', 'blocked_export')),
  masking_applied BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_field_audit_events_scope_time
  ON security_field_audit_events (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_field_audit_events_entity
  ON security_field_audit_events (tenant_id, branch_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_field_audit_events_field
  ON security_field_audit_events (tenant_id, branch_id, field_group, field_name, created_at DESC);
