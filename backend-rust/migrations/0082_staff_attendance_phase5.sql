ALTER TABLE staff_attendance_rules
  ADD COLUMN IF NOT EXISTS deduct_breaks BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (minimum_overtime_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS overtime_rounding_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_rounding_minutes IN (0,5,10,15,30,60)),
  ADD COLUMN IF NOT EXISTS maximum_overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (maximum_overtime_minutes BETWEEN 0 AND 1440);

ALTER TABLE staff_attendance_records
  ADD COLUMN IF NOT EXISTS manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('present','absent','half_day','leave','special_leave','weekly_off')),
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  ADD COLUMN IF NOT EXISTS correction_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS corrected_by TEXT,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS staff_attendance_breaks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  attendance_id TEXT NOT NULL REFERENCES staff_attendance_records(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  comments TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT staff_attendance_break_order CHECK (ended_at >= started_at),
  UNIQUE (attendance_id, started_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_breaks_scope
  ON staff_attendance_breaks(tenant_id, branch_id, staff_id, started_at);

-- ponytail: protected PostgreSQL byte storage keeps uploads real without a second storage stack;
-- move payloads to S3 when measured document volume makes database storage expensive.
CREATE TABLE IF NOT EXISTS staff_files (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('photo','document')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  content BYTEA NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_files_scope
  ON staff_files(tenant_id, branch_id, staff_id, created_at DESC);
