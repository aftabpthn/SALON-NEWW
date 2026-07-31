ALTER TABLE travel_zones
  ADD COLUMN IF NOT EXISTS max_distance_meters INTEGER CHECK (max_distance_meters IS NULL OR max_distance_meters >= 0),
  ADD COLUMN IF NOT EXISTS base_surcharge_paise BIGINT NOT NULL DEFAULT 0 CHECK (base_surcharge_paise >= 0),
  ADD COLUMN IF NOT EXISTS per_km_surcharge_paise BIGINT NOT NULL DEFAULT 0 CHECK (per_km_surcharge_paise >= 0),
  ADD COLUMN IF NOT EXISTS staff_per_km_paise BIGINT NOT NULL DEFAULT 0 CHECK (staff_per_km_paise >= 0),
  ADD COLUMN IF NOT EXISTS sla_minutes INTEGER NOT NULL DEFAULT 120 CHECK (sla_minutes BETWEEN 1 AND 1440);

CREATE TABLE IF NOT EXISTS client_service_addresses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Service address',
  address TEXT NOT NULL CHECK (LENGTH(TRIM(address)) > 0),
  latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  geocode_provider TEXT,
  verified_at TIMESTAMPTZ,
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_service_address_default
  ON client_service_addresses(tenant_id, branch_id, client_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_client_service_addresses_scope
  ON client_service_addresses(tenant_id, branch_id, client_id);

CREATE TABLE IF NOT EXISTS marketplace_connections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (LENGTH(TRIM(provider)) > 0),
  display_name TEXT NOT NULL CHECK (LENGTH(TRIM(display_name)) > 0),
  external_account_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','error')),
  secret_ciphertext TEXT NOT NULL,
  secret_last_four TEXT NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS marketplace_webhook_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','completed','failed','duplicate')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  field_job_id TEXT REFERENCES field_jobs(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (connection_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_webhook_retry
  ON marketplace_webhook_events(status, next_attempt_at) WHERE status='failed';

ALTER TABLE field_jobs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','appointment','marketplace')),
  ADD COLUMN IF NOT EXISTS service_ids_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS destination_latitude DOUBLE PRECISION CHECK (destination_latitude IS NULL OR destination_latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS destination_longitude DOUBLE PRECISION CHECK (destination_longitude IS NULL OR destination_longitude BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS route_distance_meters INTEGER CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0),
  ADD COLUMN IF NOT EXISTS route_duration_seconds INTEGER CHECK (route_duration_seconds IS NULL OR route_duration_seconds >= 0),
  ADD COLUMN IF NOT EXISTS remaining_eta_seconds INTEGER CHECK (remaining_eta_seconds IS NULL OR remaining_eta_seconds >= 0),
  ADD COLUMN IF NOT EXISTS route_provider TEXT,
  ADD COLUMN IF NOT EXISTS route_calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distance_surcharge_paise BIGINT NOT NULL DEFAULT 0 CHECK (distance_surcharge_paise >= 0),
  ADD COLUMN IF NOT EXISTS staff_travel_pay_paise BIGINT NOT NULL DEFAULT 0 CHECK (staff_travel_pay_paise >= 0),
  ADD COLUMN IF NOT EXISTS travel_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (travel_cost_paise >= 0),
  ADD COLUMN IF NOT EXISTS marketplace_commission_paise BIGINT NOT NULL DEFAULT 0 CHECK (marketplace_commission_paise >= 0),
  ADD COLUMN IF NOT EXISTS marketplace_connection_id TEXT REFERENCES marketplace_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_booking_id TEXT,
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_location_latitude DOUBLE PRECISION CHECK (last_location_latitude IS NULL OR last_location_latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS last_location_longitude DOUBLE PRECISION CHECK (last_location_longitude IS NULL OR last_location_longitude BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS last_location_accuracy_meters DOUBLE PRECISION CHECK (last_location_accuracy_meters IS NULL OR last_location_accuracy_meters >= 0),
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_json JSONB,
  ADD COLUMN IF NOT EXISTS proof_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE field_jobs DROP CONSTRAINT IF EXISTS field_jobs_status_check;
ALTER TABLE field_jobs ADD CONSTRAINT field_jobs_status_check
  CHECK (status IN ('created','assigned','accepted','en_route','arrived','completed','cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_jobs_appointment
  ON field_jobs(tenant_id, branch_id, appointment_id) WHERE appointment_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_jobs_marketplace_booking
  ON field_jobs(marketplace_connection_id, external_booking_id) WHERE marketplace_connection_id IS NOT NULL AND external_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_jobs_dispatch
  ON field_jobs(tenant_id, branch_id, status, priority, sla_due_at);

CREATE TABLE IF NOT EXISTS field_job_location_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  field_job_id TEXT NOT NULL REFERENCES field_jobs(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_job_location_recent
  ON field_job_location_events(tenant_id, branch_id, field_job_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS field_job_tracking_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  field_job_id TEXT NOT NULL REFERENCES field_jobs(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_job_tracking_scope
  ON field_job_tracking_links(tenant_id, branch_id, field_job_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS field_job_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  field_job_id TEXT NOT NULL REFERENCES field_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_job_events_timeline
  ON field_job_events(tenant_id, branch_id, field_job_id, created_at DESC);
