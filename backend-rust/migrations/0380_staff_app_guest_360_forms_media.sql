ALTER TABLE client_notes
  ADD COLUMN IF NOT EXISTS appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'branch_staff';

ALTER TABLE client_notes DROP CONSTRAINT IF EXISTS client_notes_visibility_check;
ALTER TABLE client_notes ADD CONSTRAINT client_notes_visibility_check
  CHECK (visibility IN ('assigned_staff','branch_staff','management'));

ALTER TABLE client_form_definitions
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'guest',
  ADD COLUMN IF NOT EXISTS scope_ids_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS valid_for_days INTEGER,
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS staff_mode_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS guest_mode_allowed BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE client_form_definitions DROP CONSTRAINT IF EXISTS client_form_definitions_scope_type_check;
ALTER TABLE client_form_definitions ADD CONSTRAINT client_form_definitions_scope_type_check
  CHECK (scope_type IN ('guest','service','membership','package','tag'));
ALTER TABLE client_form_definitions DROP CONSTRAINT IF EXISTS client_form_definitions_scope_ids_check;
ALTER TABLE client_form_definitions ADD CONSTRAINT client_form_definitions_scope_ids_check
  CHECK (JSONB_TYPEOF(scope_ids_json)='array');
ALTER TABLE client_form_definitions DROP CONSTRAINT IF EXISTS client_form_definitions_validity_check;
ALTER TABLE client_form_definitions ADD CONSTRAINT client_form_definitions_validity_check
  CHECK (valid_for_days IS NULL OR valid_for_days BETWEEN 1 AND 3650);
ALTER TABLE client_form_definitions DROP CONSTRAINT IF EXISTS client_form_definitions_mode_check;
ALTER TABLE client_form_definitions ADD CONSTRAINT client_form_definitions_mode_check
  CHECK (staff_mode_allowed OR guest_mode_allowed);

ALTER TABLE client_form_submissions
  ADD COLUMN IF NOT EXISTS appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS membership_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS package_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrects_submission_id TEXT REFERENCES client_form_submissions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE client_form_submissions
SET finalized_at=COALESCE(finalized_at,submitted_at), updated_at=COALESCE(updated_at,submitted_at)
WHERE status='submitted';

ALTER TABLE client_form_submissions DROP CONSTRAINT IF EXISTS client_form_submissions_mode_check;
ALTER TABLE client_form_submissions ADD CONSTRAINT client_form_submissions_mode_check
  CHECK (mode IN ('staff','guest'));
ALTER TABLE client_form_submissions DROP CONSTRAINT IF EXISTS client_form_submissions_status_check;
ALTER TABLE client_form_submissions ADD CONSTRAINT client_form_submissions_status_check
  CHECK (status IN ('draft','submitted'));
ALTER TABLE client_form_submissions DROP CONSTRAINT IF EXISTS client_form_submissions_version_check;
ALTER TABLE client_form_submissions ADD CONSTRAINT client_form_submissions_version_check CHECK (version > 0);
ALTER TABLE client_form_submissions DROP CONSTRAINT IF EXISTS client_form_submissions_finalized_check;
ALTER TABLE client_form_submissions ADD CONSTRAINT client_form_submissions_finalized_check
  CHECK ((status='draft' AND finalized_at IS NULL) OR (status='submitted' AND finalized_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_client_form_submissions_appointment
  ON client_form_submissions(tenant_id,branch_id,appointment_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_form_submissions_correction
  ON client_form_submissions(tenant_id,branch_id,corrects_submission_id)
  WHERE corrects_submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_form_review_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES client_form_submissions(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved','correction_required')),
  note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_form_reviews_submission
  ON client_form_review_events(tenant_id,branch_id,submission_id,created_at DESC);

ALTER TABLE client_consent_events DROP CONSTRAINT IF EXISTS client_consent_events_channel_check;
ALTER TABLE client_consent_events ADD CONSTRAINT client_consent_events_channel_check
  CHECK (channel IN ('whatsapp','sms','email','photos'));

ALTER TABLE client_treatment_photos
  ADD COLUMN IF NOT EXISTS service_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consent_event_id TEXT REFERENCES client_consent_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE client_treatment_photos DROP CONSTRAINT IF EXISTS client_treatment_photos_photo_type_check;
ALTER TABLE client_treatment_photos ADD CONSTRAINT client_treatment_photos_photo_type_check
  CHECK (photo_type IN ('profile','before','after','other'));
ALTER TABLE client_treatment_photos DROP CONSTRAINT IF EXISTS client_treatment_photos_scan_status_check;
ALTER TABLE client_treatment_photos ADD CONSTRAINT client_treatment_photos_scan_status_check
  CHECK (scan_status='clean');

CREATE INDEX IF NOT EXISTS idx_client_treatment_photos_appointment
  ON client_treatment_photos(tenant_id,branch_id,appointment_id,created_at DESC)
  WHERE appointment_id IS NOT NULL;
