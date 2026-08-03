ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS customer_check_in_geofence_mode TEXT NOT NULL DEFAULT 'optional',
  ADD COLUMN IF NOT EXISTS customer_check_in_radius_meters INTEGER NOT NULL DEFAULT 300;

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_customer_check_in_geofence_mode_check;
ALTER TABLE branches ADD CONSTRAINT branches_customer_check_in_geofence_mode_check
  CHECK (customer_check_in_geofence_mode IN ('disabled', 'optional', 'required'));
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_customer_check_in_radius_meters_check;
ALTER TABLE branches ADD CONSTRAINT branches_customer_check_in_radius_meters_check
  CHECK (customer_check_in_radius_meters BETWEEN 25 AND 5000);

ALTER TABLE appointment_arrival_updates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer_app',
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_arrival_idempotency
  ON appointment_arrival_updates (tenant_id, branch_id, appointment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE fitness_kiosk_devices
  ADD COLUMN IF NOT EXISTS activation_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS allowed_branch_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS selected_branch_id TEXT,
  ADD COLUMN IF NOT EXISTS branding_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{"allowGroupCheckIn":true,"allowSameDayBooking":true,"allowAddOnRequest":true,"checkoutMode":"mirror","requireGeofence":true,"geofenceRadiusMeters":300}'::JSONB,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_fitness_kiosk_activation_code
  ON fitness_kiosk_devices (activation_code_hash)
  WHERE activation_code_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS kiosk_guest_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES fitness_kiosk_devices(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kiosk_guest_sessions_device
  ON kiosk_guest_sessions (device_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS kiosk_action_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES fitness_kiosk_devices(id) ON DELETE CASCADE,
  guest_session_id TEXT REFERENCES kiosk_guest_sessions(id) ON DELETE SET NULL,
  appointment_id TEXT,
  client_id TEXT,
  action TEXT NOT NULL,
  idempotency_key TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_action_events_scope
  ON kiosk_action_events (tenant_id, branch_id, device_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosk_action_idempotency
  ON kiosk_action_events (device_id, action, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
