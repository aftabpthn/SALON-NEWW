CREATE TABLE IF NOT EXISTS service_booking_guards (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  consultation_form_definition_id TEXT REFERENCES client_form_definitions(id) ON DELETE SET NULL,
  requires_consultation BOOLEAN NOT NULL DEFAULT FALSE,
  requires_patch_test BOOLEAN NOT NULL DEFAULT FALSE,
  patch_test_valid_days INTEGER NOT NULL DEFAULT 30 CHECK (patch_test_valid_days BETWEEN 1 AND 365),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, service_id),
  CHECK (
    NOT (requires_consultation OR requires_patch_test)
    OR consultation_form_definition_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS appointment_arrival_updates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  eta_minutes INTEGER NOT NULL CHECK (eta_minutes BETWEEN 0 AND 240),
  status TEXT NOT NULL CHECK (status IN ('arriving','arrived','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_arrival_updates_current
  ON appointment_arrival_updates (tenant_id, branch_id, appointment_id, updated_at DESC);
