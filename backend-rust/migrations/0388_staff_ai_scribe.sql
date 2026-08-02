CREATE TABLE IF NOT EXISTS staff_ai_scribe_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL DEFAULT '',
  form_definition_id TEXT NOT NULL REFERENCES client_form_definitions(id) ON DELETE RESTRICT,
  form_submission_id TEXT REFERENCES client_form_submissions(id) ON DELETE RESTRICT,
  guest_participant BOOLEAN NOT NULL DEFAULT TRUE,
  consent_version TEXT NOT NULL DEFAULT 'staff-ai-scribe-v1',
  consent_status TEXT NOT NULL,
  consent_name TEXT NOT NULL DEFAULT '',
  consent_evidence_sha256 TEXT NOT NULL DEFAULT '',
  consent_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT 'en-IN',
  provider_error_code TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  structured_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  form_suggestions JSONB NOT NULL DEFAULT '[]'::JSONB,
  audio_retained BOOLEAN NOT NULL DEFAULT FALSE,
  audio_retention_until TIMESTAMPTZ,
  transcript_retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consent_status IN ('granted','refused','revoked')),
  CHECK (status IN ('consent_granted','refused','recording','processing','draft_ready','approved','revoked','discarded','failed')),
  CHECK (byte_size BETWEEN 0 AND 26214400),
  CHECK (duration_seconds BETWEEN 0 AND 5700),
  CHECK (version > 0),
  CHECK (audio_retained=FALSE AND audio_retention_until IS NULL),
  CHECK (JSONB_TYPEOF(structured_summary)='object'),
  CHECK (JSONB_TYPEOF(form_suggestions)='array')
);

CREATE INDEX IF NOT EXISTS idx_staff_ai_scribe_appointment
  ON staff_ai_scribe_sessions(tenant_id,branch_id,appointment_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_ai_scribe_submission
  ON staff_ai_scribe_sessions(tenant_id,branch_id,form_submission_id)
  WHERE form_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_ai_scribe_retention
  ON staff_ai_scribe_sessions(transcript_retention_until)
  WHERE transcript<>'';

CREATE TABLE IF NOT EXISTS staff_ai_scribe_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES staff_ai_scribe_sessions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (JSONB_TYPEOF(details_json)='object')
);

CREATE INDEX IF NOT EXISTS idx_staff_ai_scribe_events_session
  ON staff_ai_scribe_events(tenant_id,branch_id,session_id,created_at,id);

COMMENT ON COLUMN staff_ai_scribe_sessions.audio_retained IS
  'Phase 13 privacy policy: raw audio is processed in memory and never retained by AuraShine.';
