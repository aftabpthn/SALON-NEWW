CREATE TABLE IF NOT EXISTS staff_face_attendance_policies (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_radius_meters INTEGER NOT NULL DEFAULT 200 CHECK (allowed_radius_meters BETWEEN 25 AND 5000),
  device_mode TEXT NOT NULL DEFAULT 'approved' CHECK (device_mode IN ('off','pending','approved')),
  network_mode TEXT NOT NULL DEFAULT 'optional' CHECK (network_mode IN ('off','optional','required')),
  ip_allowlist_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(ip_allowlist_json) = 'array'),
  liveness_mode TEXT NOT NULL DEFAULT 'basic' CHECK (liveness_mode IN ('none','basic','provider')),
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

ALTER TABLE staff_mobile_devices
  ADD COLUMN IF NOT EXISTS trust_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS trusted_by TEXT,
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trust_note TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_mobile_devices_trust_status_check') THEN
    ALTER TABLE staff_mobile_devices ADD CONSTRAINT staff_mobile_devices_trust_status_check
      CHECK (trust_status IN ('pending','approved','rejected','revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_mobile_devices_trust
  ON staff_mobile_devices(tenant_id, branch_id, staff_id, trust_status, active);

CREATE TABLE IF NOT EXISTS staff_face_attendance_exceptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_uid TEXT NOT NULL DEFAULT '',
  source_ip TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  accuracy_meters DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION,
  reason_code TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','resolved')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_face_attendance_exceptions_queue
  ON staff_face_attendance_exceptions(tenant_id, branch_id, status, created_at DESC);