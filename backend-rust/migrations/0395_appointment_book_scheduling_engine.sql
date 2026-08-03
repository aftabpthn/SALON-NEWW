ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_staff_preference_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_staff_preference_check
  CHECK (staff_preference IN ('any','preferred','required','first_available','gender_female','gender_male'));

CREATE TABLE IF NOT EXISTS appointment_fee_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('cancellation','no_show')),
  configured_paise BIGINT NOT NULL DEFAULT 0 CHECK (configured_paise BETWEEN 0 AND 100000000),
  status TEXT NOT NULL CHECK (status IN ('pending','charged','waived','reversed')),
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,appointment_id,fee_type),
  UNIQUE (tenant_id,branch_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_appointment_fee_events_scope
  ON appointment_fee_events(tenant_id,branch_id,status,created_at DESC);

-- Replaced by the capacity-aware guard introduced in migration 0393.
DROP TRIGGER IF EXISTS appointments_resource_overlap_guard ON appointments;

CREATE OR REPLACE FUNCTION appointment_staff_busy_windows(
  scoped_tenant TEXT,
  scoped_branch TEXT,
  service_ids TEXT,
  starts TIMESTAMPTZ,
  ends TIMESTAMPTZ
) RETURNS TABLE(window_start TIMESTAMPTZ, window_end TIMESTAMPTZ) AS $$
DECLARE
  service_count INTEGER;
  service_duration INTEGER;
  processing_minutes INTEGER;
  cleanup_minutes INTEGER;
  active_end TIMESTAMPTZ;
  cleanup_start TIMESTAMPTZ;
BEGIN
  SELECT jsonb_array_length(COALESCE(NULLIF(service_ids,''),'[]')::JSONB)
    INTO service_count;
  IF service_count<>1 THEN
    RETURN QUERY SELECT starts,ends;
    RETURN;
  END IF;

  SELECT service.duration_minutes,
         COALESCE(NULLIF(service.processing_time_minutes,0),service.wait_time_minutes,0),
         COALESCE(service.cleanup_time_minutes,0)+COALESCE(service.buffer_time_minutes,0)
    INTO service_duration,processing_minutes,cleanup_minutes
    FROM services service
   WHERE service.tenant_id=scoped_tenant
     AND service.branch_id=scoped_branch
     AND service.id=COALESCE(NULLIF(service_ids,''),'[]')::JSONB->>0;

  IF COALESCE(service_duration,0)<=0 OR COALESCE(processing_minutes,0)<=0 THEN
    RETURN QUERY SELECT starts,ends;
    RETURN;
  END IF;

  active_end:=LEAST(starts+make_interval(mins=>service_duration),ends);
  cleanup_start:=GREATEST(ends-make_interval(mins=>GREATEST(COALESCE(cleanup_minutes,0),0)),starts);
  IF active_end>=cleanup_start THEN
    RETURN QUERY SELECT starts,ends;
    RETURN;
  END IF;
  RETURN QUERY SELECT starts,active_end;
  IF cleanup_start<ends THEN
    RETURN QUERY SELECT cleanup_start,ends;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION enforce_appointment_staff_capacity()
RETURNS TRIGGER AS $$
DECLARE overlap_allowed BOOLEAN:=FALSE;
BEGIN
  IF BTRIM(COALESCE(NEW.staff_id,''))='' OR NEW.status IN ('cancelled','no-show') THEN
    RETURN NEW;
  END IF;
  SELECT allow_overlap INTO overlap_allowed
    FROM appointment_branch_settings
   WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id;
  IF COALESCE(overlap_allowed,FALSE) THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    CONCAT_WS(':','appointment-staff',NEW.tenant_id,NEW.branch_id,NEW.staff_id),0
  ));
  IF EXISTS (
    SELECT 1
      FROM appointments existing
      CROSS JOIN LATERAL appointment_staff_busy_windows(
        existing.tenant_id,existing.branch_id,existing.service_ids_json,existing.start_at,existing.end_at
      ) current_window
      CROSS JOIN LATERAL appointment_staff_busy_windows(
        NEW.tenant_id,NEW.branch_id,NEW.service_ids_json,NEW.start_at,NEW.end_at
      ) requested_window
     WHERE existing.tenant_id=NEW.tenant_id
       AND existing.branch_id=NEW.branch_id
       AND existing.staff_id=NEW.staff_id
       AND existing.id<>NEW.id
       AND existing.status NOT IN ('cancelled','no-show')
       AND existing.start_at<NEW.end_at
       AND existing.end_at>NEW.start_at
       AND requested_window.window_start<current_window.window_end
       AND requested_window.window_end>current_window.window_start
  ) THEN
    RAISE EXCEPTION 'staff is already booked for the active service time' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_staff_capacity_guard ON appointments;
CREATE TRIGGER appointments_staff_capacity_guard
BEFORE INSERT OR UPDATE OF tenant_id,branch_id,staff_id,service_ids_json,start_at,end_at,status
ON appointments FOR EACH ROW EXECUTE FUNCTION enforce_appointment_staff_capacity();
