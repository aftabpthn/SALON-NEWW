ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS host_client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_surprise BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS virtual_meeting_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS service_mode TEXT NOT NULL DEFAULT 'sequential',
  ADD COLUMN IF NOT EXISTS segment_label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS service_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_seconds BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_from_staff_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_booking_type_check,
  DROP CONSTRAINT IF EXISTS appointments_service_mode_check,
  DROP CONSTRAINT IF EXISTS appointments_execution_status_check,
  DROP CONSTRAINT IF EXISTS appointments_sequence_no_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_booking_type_check CHECK (booking_type IN ('standard','couple','group','large_group','day_package')),
  ADD CONSTRAINT appointments_service_mode_check CHECK (service_mode IN ('sequential','gap','parallel','segmented')),
  ADD CONSTRAINT appointments_execution_status_check CHECK (execution_status IN ('not_started','in_service','paused','completed')),
  ADD CONSTRAINT appointments_sequence_no_check CHECK (sequence_no BETWEEN 1 AND 100);

ALTER TABLE booking_groups
  ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS host_client_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE smart_booking_requests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS appointment_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decided_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decision_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_smart_booking_requests_inbox
  ON smart_booking_requests(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_execution_queue
  ON appointments(tenant_id,branch_id,status,start_at)
  WHERE status IN ('confirmed','arrived','waiting','in-service','paused');
