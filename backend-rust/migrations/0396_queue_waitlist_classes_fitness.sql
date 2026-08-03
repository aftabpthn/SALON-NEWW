ALTER TABLE appointment_waitlist
  ADD COLUMN IF NOT EXISTS notification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (notification_attempts BETWEEN 0 AND 20),
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;

ALTER TABLE appointment_waitlist_offers
  ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 3);

ALTER TABLE appointment_waitlist_offers
  DROP CONSTRAINT IF EXISTS appointment_waitlist_offers_waitlist_id_source_appointment_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_offer_attempt
  ON appointment_waitlist_offers(waitlist_id,source_appointment_id,attempt_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_single_active_slot_offer
  ON appointment_waitlist_offers(tenant_id,branch_id,source_appointment_id)
  WHERE status='offered';

CREATE TABLE IF NOT EXISTS walk_in_queue_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  service_ids_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(service_ids_json)='array'),
  requested_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  assigned_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','in_service','completed','cancelled','no_show')),
  estimated_start_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes)<=1000),
  idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_walk_in_queue_active
  ON walk_in_queue_entries(tenant_id,branch_id,status,priority DESC,checked_in_at,id)
  WHERE status IN ('waiting','called','in_service');

CREATE TABLE IF NOT EXISTS fitness_class_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 160),
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 10 AND 480),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  waitlist_capacity INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_capacity BETWEEN 0 AND 5000),
  room_resource_id TEXT REFERENCES appointment_resources(id) ON DELETE RESTRICT,
  late_booking_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_booking_minutes BETWEEN 0 AND 1440),
  late_cancel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_cancel_minutes BETWEEN 0 AND 43200),
  late_cancel_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (late_cancel_fee_paise BETWEEN 0 AND 100000000),
  no_show_fee_paise BIGINT NOT NULL DEFAULT 0 CHECK (no_show_fee_paise BETWEEN 0 AND 100000000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,name)
);

CREATE TABLE IF NOT EXISTS fitness_class_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES fitness_class_templates(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE RESTRICT,
  instructor_staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  room_resource_id TEXT REFERENCES appointment_resources(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at>starts_at),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  recurrence_key TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,recurrence_key)
);
CREATE INDEX IF NOT EXISTS idx_fitness_sessions_schedule
  ON fitness_class_sessions(tenant_id,branch_id,starts_at,status);

CREATE TABLE IF NOT EXISTS fitness_class_registrations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES fitness_class_sessions(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('booked','waitlisted','checked_in','attended','cancelled','late_cancel','no_show')),
  waitlist_position INTEGER,
  client_membership_id TEXT REFERENCES client_memberships(id) ON DELETE RESTRICT,
  client_package_credit_id TEXT REFERENCES client_package_credits(id) ON DELETE RESTRICT,
  credit_consumed_at TIMESTAMPTZ,
  credit_reversed_at TIMESTAMPTZ,
  booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  attended_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes)<=1000),
  idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,session_id,client_id),
  UNIQUE (tenant_id,branch_id,idempotency_key),
  CHECK (NOT (client_membership_id IS NOT NULL AND client_package_credit_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_fitness_registration_roster
  ON fitness_class_registrations(tenant_id,branch_id,session_id,status,waitlist_position,booked_at,id);

CREATE TABLE IF NOT EXISTS fitness_class_fee_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  registration_id TEXT NOT NULL REFERENCES fitness_class_registrations(id) ON DELETE RESTRICT,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('late_cancel','no_show')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 0 AND 100000000),
  status TEXT NOT NULL CHECK (status IN ('pending','charged','waived','reversed')),
  reason TEXT NOT NULL DEFAULT '' CHECK (char_length(reason)<=1000),
  actor_user_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,registration_id,fee_type),
  UNIQUE (tenant_id,branch_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS fitness_amenities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('amenity','locker')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,name)
);

CREATE TABLE IF NOT EXISTS fitness_locker_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  locker_id TEXT NOT NULL REFERENCES fitness_amenities(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  session_id TEXT REFERENCES fitness_class_sessions(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  assigned_by TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fitness_locker_active_assignment
  ON fitness_locker_assignments(tenant_id,branch_id,locker_id)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS fitness_challenges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 160),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL CHECK (ends_on>=starts_on),
  target_value NUMERIC(14,2) NOT NULL CHECK (target_value>0),
  metric TEXT NOT NULL CHECK (metric IN ('classes','visits','minutes','custom')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fitness_challenge_participants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES fitness_challenges(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  progress_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (progress_value>=0),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id,branch_id,challenge_id,client_id)
);

CREATE TABLE IF NOT EXISTS fitness_kiosk_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 120),
  token_hash TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fitness_operation_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fitness_events_entity
  ON fitness_operation_events(tenant_id,branch_id,entity_type,entity_id,created_at DESC);

CREATE OR REPLACE FUNCTION enforce_fitness_class_capacity()
RETURNS TRIGGER AS $$
DECLARE allowed_capacity INTEGER;
DECLARE occupied INTEGER;
BEGIN
  IF NEW.status NOT IN ('booked','checked_in','attended') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    CONCAT_WS(':','fitness-class-capacity',NEW.tenant_id,NEW.branch_id,NEW.session_id),0
  ));
  SELECT capacity INTO allowed_capacity
    FROM fitness_class_sessions
   WHERE id=NEW.session_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
   FOR UPDATE;
  IF allowed_capacity IS NULL THEN RAISE EXCEPTION 'class session not found' USING ERRCODE='23503'; END IF;
  SELECT COUNT(*) INTO occupied
    FROM fitness_class_registrations
   WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND session_id=NEW.session_id
     AND status IN ('booked','checked_in','attended') AND id<>NEW.id;
  IF occupied>=allowed_capacity THEN
    RAISE EXCEPTION 'class capacity exceeded' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fitness_class_capacity_guard ON fitness_class_registrations;
CREATE TRIGGER fitness_class_capacity_guard
BEFORE INSERT OR UPDATE OF status,session_id ON fitness_class_registrations
FOR EACH ROW EXECUTE FUNCTION enforce_fitness_class_capacity();
