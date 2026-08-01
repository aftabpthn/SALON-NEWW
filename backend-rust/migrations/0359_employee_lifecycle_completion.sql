ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS probation_end_date DATE,
  ADD COLUMN IF NOT EXISTS confirmation_date DATE,
  ADD COLUMN IF NOT EXISTS notice_period_start_date DATE,
  ADD COLUMN IF NOT EXISTS last_working_date DATE,
  ADD COLUMN IF NOT EXISTS employment_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_employment_status_check;
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_employment_status_check
  CHECK (employment_status IN ('probation','confirmed','notice_period','terminated'));
ALTER TABLE staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_employment_version_check;
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_employment_version_check CHECK (employment_version > 0);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_employment_scope
  ON staff_profiles(tenant_id, branch_id, employment_status, probation_end_date, last_working_date);

ALTER TABLE staff_lifecycle_cases
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS final_settlement_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_updated_at TIMESTAMPTZ;

UPDATE staff_lifecycle_cases
SET settlement_status=CASE WHEN case_type='offboarding' AND status='completed' THEN 'ready'
                           WHEN case_type='offboarding' THEN 'pending' ELSE 'not_required' END
WHERE settlement_status='not_required';

ALTER TABLE staff_lifecycle_cases DROP CONSTRAINT IF EXISTS staff_lifecycle_cases_settlement_status_check;
ALTER TABLE staff_lifecycle_cases ADD CONSTRAINT staff_lifecycle_cases_settlement_status_check
  CHECK (settlement_status IN ('not_required','pending','ready','completed'));
ALTER TABLE staff_lifecycle_cases DROP CONSTRAINT IF EXISTS staff_lifecycle_cases_settlement_pair_check;
ALTER TABLE staff_lifecycle_cases ADD CONSTRAINT staff_lifecycle_cases_settlement_pair_check
  CHECK (case_type='offboarding' OR settlement_status='not_required');

CREATE INDEX IF NOT EXISTS idx_staff_lifecycle_settlement_scope
  ON staff_lifecycle_cases(tenant_id, branch_id, settlement_status, effective_date DESC)
  WHERE case_type='offboarding';
