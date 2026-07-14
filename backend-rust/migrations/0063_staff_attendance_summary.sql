CREATE TABLE IF NOT EXISTS staff_attendance_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'clocked_in' CHECK (status IN (
    'clocked_in','clocked_out','present','absent','half_day','leave','special_leave','weekly_off'
  )),
  source TEXT NOT NULL DEFAULT 'manual',
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_leave_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_leave_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  penalty_paise BIGINT NOT NULL DEFAULT 0 CHECK (penalty_paise >= 0),
  comments TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, staff_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_scope_date
  ON staff_attendance_records(tenant_id, branch_id, business_date, staff_id);

CREATE TABLE IF NOT EXISTS staff_attendance_summary_adjustments (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  summary_year INTEGER NOT NULL CHECK (summary_year BETWEEN 2000 AND 2100),
  summary_month INTEGER NOT NULL CHECK (summary_month BETWEEN 1 AND 12),
  weekly_off_adjustment DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (weekly_off_adjustment BETWEEN -31 AND 31),
  special_leave_adjustment DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (special_leave_adjustment BETWEEN -31 AND 31),
  comments TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, staff_id, summary_year, summary_month)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_adjustments_scope
  ON staff_attendance_summary_adjustments(tenant_id, branch_id, summary_year, summary_month, staff_id);
