CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  staff_id TEXT DEFAULT '',
  service_ids_json TEXT DEFAULT '[]',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  notes TEXT DEFAULT '',
  source_channel TEXT DEFAULT 'manual',
  source TEXT DEFAULT 'manual',
  booking_group_id TEXT DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch ON appointments(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_at ON appointments(start_at);

CREATE TABLE IF NOT EXISTS appointment_activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_status TEXT DEFAULT '',
  new_status TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_activity_tenant ON appointment_activity(tenant_id, appointment_id, created_at);

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  service_ids_json TEXT DEFAULT '[]',
  preferred_slot_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_waitlist_tenant ON appointment_waitlist(tenant_id, branch_id, status);

CREATE TABLE IF NOT EXISTS appointment_blackouts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  blackout_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'maintenance',
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_blackouts_tenant ON appointment_blackouts(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS booking_wizard_state (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT DEFAULT '',
  step BIGINT NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_wizard_tenant ON booking_wizard_state(tenant_id);

CREATE TABLE IF NOT EXISTS booking_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'booking-group',
  members_json TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planning',
  consolidated_billing BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_groups_tenant ON booking_groups(tenant_id, branch_id, status);

CREATE TABLE IF NOT EXISTS smart_booking_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_touchups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  service_ids_json TEXT DEFAULT '[]',
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_touchups_tenant_appointment
  ON appointment_touchups(tenant_id, appointment_id);

CREATE TABLE IF NOT EXISTS appointment_calendar_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_calendar_tokens_tenant_scope
  ON appointment_calendar_tokens(tenant_id, scope, scope_id);
