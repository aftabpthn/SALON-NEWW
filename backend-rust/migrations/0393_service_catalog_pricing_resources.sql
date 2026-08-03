ALTER TABLE services
  ADD COLUMN IF NOT EXISTS processing_time_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_time_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fee_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_percent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_cutoff_hours INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_fee_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_allocation_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS channel_availability_json JSONB NOT NULL DEFAULT '{"crm":true,"webstore":true,"kiosk":true,"staffApp":true,"customerApp":true}'::JSONB,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_phase4_time;
ALTER TABLE services ADD CONSTRAINT ck_services_phase4_time CHECK (
  processing_time_minutes BETWEEN 0 AND 1440 AND recovery_time_minutes BETWEEN 0 AND 1440
);
ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_phase4_money;
ALTER TABLE services ADD CONSTRAINT ck_services_phase4_money CHECK (
  other_fee_paise BETWEEN 0 AND 100000000
  AND cancellation_fee_paise BETWEEN 0 AND 100000000
  AND deposit_percent BETWEEN 0 AND 100
  AND cancellation_cutoff_hours BETWEEN 0 AND 8760
  AND commission_bps BETWEEN 0 AND 10000
);
ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_phase4_channels;
ALTER TABLE services ADD CONSTRAINT ck_services_phase4_channels CHECK (
  jsonb_typeof(channel_availability_json)='object'
  AND channel_availability_json ?& ARRAY['crm','webstore','kiosk','staffApp','customerApp']
);

CREATE TABLE IF NOT EXISTS service_audience_prices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('guest','membership','package')),
  audience_id TEXT NOT NULL,
  price_paise BIGINT NOT NULL CHECK (price_paise BETWEEN 0 AND 100000000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, service_id, audience_type, audience_id)
);
CREATE INDEX IF NOT EXISTS idx_service_audience_prices_scope
  ON service_audience_prices(tenant_id,branch_id,service_id,audience_type,audience_id)
  WHERE active=TRUE;

ALTER TABLE appointment_resources
  ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appointment_resources DROP CONSTRAINT IF EXISTS ck_appointment_resources_capacity;
ALTER TABLE appointment_resources ADD CONSTRAINT ck_appointment_resources_capacity
  CHECK (capacity BETWEEN 1 AND 100);
ALTER TABLE appointment_resources DROP CONSTRAINT IF EXISTS ck_appointment_resources_kind;
ALTER TABLE appointment_resources ADD CONSTRAINT ck_appointment_resources_kind
  CHECK (kind IN ('chair','workstation','room','bed','machine','equipment'));

CREATE TABLE IF NOT EXISTS service_resource_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES appointment_resources(id) ON DELETE RESTRICT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, service_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_service_resource_requirements_scope
  ON service_resource_requirements(tenant_id,branch_id,service_id,required);

ALTER TABLE service_price_rules
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS min_demand_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_price_rules DROP CONSTRAINT IF EXISTS ck_service_price_rules_channel;
ALTER TABLE service_price_rules ADD CONSTRAINT ck_service_price_rules_channel
  CHECK (channel IN ('all','crm','webstore','kiosk','staffApp','customerApp'));
ALTER TABLE service_price_rules DROP CONSTRAINT IF EXISTS ck_service_price_rules_demand;
ALTER TABLE service_price_rules ADD CONSTRAINT ck_service_price_rules_demand
  CHECK (min_demand_percent BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS service_catalog_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  actor_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, service_id, version)
);
CREATE INDEX IF NOT EXISTS idx_service_catalog_versions_scope
  ON service_catalog_versions(tenant_id,branch_id,service_id,version DESC);

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_chair_room_no_overlap;

CREATE OR REPLACE FUNCTION enforce_appointment_resource_capacity()
RETURNS TRIGGER AS $$
DECLARE
  allowed_capacity INTEGER;
  overlapping_count BIGINT;
BEGIN
  IF NEW.chair_room_id IS NULL OR NEW.status IN ('cancelled','no-show') THEN
    RETURN NEW;
  END IF;

  SELECT resource.capacity INTO allowed_capacity
  FROM appointment_resources resource
  WHERE resource.id=NEW.chair_room_id
    AND resource.tenant_id=NEW.tenant_id
    AND resource.branch_id=NEW.branch_id
    AND resource.active=TRUE
  FOR UPDATE;

  IF allowed_capacity IS NULL THEN
    RAISE EXCEPTION 'selected appointment resource is unavailable' USING ERRCODE='23514';
  END IF;

  SELECT COUNT(*) INTO overlapping_count
  FROM appointments appointment
  WHERE appointment.tenant_id=NEW.tenant_id
    AND appointment.branch_id=NEW.branch_id
    AND appointment.chair_room_id=NEW.chair_room_id
    AND appointment.id<>NEW.id
    AND appointment.status NOT IN ('cancelled','no-show')
    AND appointment.start_at<NEW.end_at
    AND appointment.end_at>NEW.start_at;

  IF overlapping_count>=allowed_capacity THEN
    RAISE EXCEPTION 'appointment resource capacity is full' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_resource_capacity_guard ON appointments;
CREATE TRIGGER appointments_resource_capacity_guard
BEFORE INSERT OR UPDATE OF tenant_id,branch_id,chair_room_id,start_at,end_at,status
ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_resource_capacity();

CREATE OR REPLACE FUNCTION sync_single_service_booked_quote()
RETURNS TRIGGER AS $$
DECLARE selected_service_id TEXT;
BEGIN
  IF NEW.booked_total_paise>0
     AND jsonb_array_length(COALESCE(NULLIF(NEW.service_ids_json,''),'[]')::JSONB)=1 THEN
    selected_service_id := COALESCE(NULLIF(NEW.service_ids_json,''),'[]')::JSONB->>0;
    UPDATE appointments
       SET booked_service_prices_json=jsonb_build_object(selected_service_id,NEW.booked_total_paise)
     WHERE id=NEW.id AND booked_service_prices_json<>jsonb_build_object(selected_service_id,NEW.booked_total_paise);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_single_service_quote_snapshot ON appointments;
CREATE TRIGGER appointments_single_service_quote_snapshot
AFTER INSERT OR UPDATE OF service_ids_json,booked_total_paise
ON appointments FOR EACH ROW EXECUTE FUNCTION sync_single_service_booked_quote();
