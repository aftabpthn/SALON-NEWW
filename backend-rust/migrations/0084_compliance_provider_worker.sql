ALTER TABLE pos_compliance_jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS provider_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE pos_compliance_jobs DROP CONSTRAINT IF EXISTS pos_compliance_jobs_status_check;
ALTER TABLE pos_compliance_jobs
  ADD CONSTRAINT pos_compliance_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'submitted', 'failed', 'cancelled')) NOT VALID;

DROP INDEX IF EXISTS idx_pos_compliance_jobs_due;
CREATE INDEX idx_pos_compliance_jobs_due
  ON pos_compliance_jobs (status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'processing');
