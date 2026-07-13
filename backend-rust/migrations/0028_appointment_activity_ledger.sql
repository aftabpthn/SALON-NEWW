ALTER TABLE appointment_activity
  ADD COLUMN IF NOT EXISTS branch_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staff_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_group TEXT NOT NULL DEFAULT 'change',
  ADD COLUMN IF NOT EXISTS changed_by TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS changed_by_role TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS old_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS new_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_action TEXT NOT NULL DEFAULT '';

UPDATE appointment_activity aa
SET branch_id = a.branch_id,
    client_id = a.client_id,
    staff_id = a.staff_id,
    source = COALESCE(NULLIF(a.source_channel, ''), NULLIF(a.source, ''), 'system')
FROM appointments a
WHERE a.id = aa.appointment_id
  AND a.tenant_id = aa.tenant_id
  AND aa.branch_id = '';

CREATE INDEX IF NOT EXISTS idx_appointment_activity_tenant_branch_time
  ON appointment_activity(tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_activity_client_time
  ON appointment_activity(tenant_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_activity_staff_time
  ON appointment_activity(tenant_id, staff_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_appointment_activity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'appointment activity events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_activity_immutable ON appointment_activity;
CREATE TRIGGER appointment_activity_immutable
  BEFORE UPDATE OR DELETE ON appointment_activity
  FOR EACH ROW EXECUTE FUNCTION prevent_appointment_activity_mutation();
