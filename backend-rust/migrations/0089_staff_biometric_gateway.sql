CREATE TABLE IF NOT EXISTS staff_biometric_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('zkteco','realtime_biometrics','mantra','essl','suprema','camera','rfid','qr','nfc','manual')),
  device_code TEXT NOT NULL,
  device_name TEXT NOT NULL,
  connection_mode TEXT NOT NULL DEFAULT 'gateway' CHECK (connection_mode IN ('gateway','offline_sync','browser_camera','manual')),
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','online','offline','degraded')),
  last_seen_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, device_code)
);

CREATE INDEX IF NOT EXISTS idx_staff_biometric_devices_scope
  ON staff_biometric_devices(tenant_id, branch_id, active, provider);

CREATE TABLE IF NOT EXISTS staff_biometric_gateways (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  gateway_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  provider_scope JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(provider_scope) = 'array'),
  version_label TEXT NOT NULL DEFAULT '',
  health_status TEXT NOT NULL DEFAULT 'registered' CHECK (health_status IN ('registered','online','offline','degraded','revoked')),
  last_seen_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, gateway_code)
);

CREATE INDEX IF NOT EXISTS idx_staff_biometric_gateways_scope
  ON staff_biometric_gateways(tenant_id, branch_id, active, health_status);

CREATE TABLE IF NOT EXISTS staff_biometric_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES staff_biometric_devices(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, device_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_biometric_mappings_scope
  ON staff_biometric_mappings(tenant_id, branch_id, status, staff_id);

CREATE TABLE IF NOT EXISTS staff_biometric_consents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'attendance',
  status TEXT NOT NULL CHECK (status IN ('granted','withdrawn','deletion_requested')),
  granted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, staff_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_staff_biometric_consents_scope
  ON staff_biometric_consents(tenant_id, branch_id, status, staff_id);

CREATE TABLE IF NOT EXISTS staff_biometric_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  gateway_id TEXT NOT NULL REFERENCES staff_biometric_gateways(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL REFERENCES staff_biometric_devices(id) ON DELETE RESTRICT,
  staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  external_user_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  punch_type TEXT NOT NULL CHECK (punch_type IN ('clock_in','clock_out')),
  punch_at TIMESTAMPTZ NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','rejected')),
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, gateway_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_biometric_events_scope
  ON staff_biometric_events(tenant_id, branch_id, punch_at DESC, status, staff_id);
