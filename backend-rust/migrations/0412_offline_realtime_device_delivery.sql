CREATE TABLE IF NOT EXISTS staff_mobile_device_telemetry (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_uid TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('web','android','ios')),
  app_version TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('launch','resume','network_change')),
  network_type TEXT NOT NULL DEFAULT 'unknown',
  online BOOLEAN NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata_json)='object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_mobile_device_telemetry_scope
  ON staff_mobile_device_telemetry(tenant_id,branch_id,device_uid,occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_staff_mobile_telemetry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'staff mobile telemetry is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_mobile_telemetry_immutable ON staff_mobile_device_telemetry;
CREATE TRIGGER trg_staff_mobile_telemetry_immutable
BEFORE UPDATE OR DELETE ON staff_mobile_device_telemetry
FOR EACH ROW EXECUTE FUNCTION prevent_staff_mobile_telemetry_mutation();
