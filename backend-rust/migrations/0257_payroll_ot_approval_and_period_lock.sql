ALTER TABLE staff_attendance_records
  ADD COLUMN IF NOT EXISTS ot_approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ot_approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_overtime_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (approved_overtime_minutes >= 0),
  ADD COLUMN IF NOT EXISTS ot_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS ot_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staff_attendance_ot_pending
  ON staff_attendance_records(tenant_id, branch_id, ot_approval_status)
  WHERE overtime_minutes > 0;

CREATE TABLE IF NOT EXISTS staff_payroll_periods (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_month DATE NOT NULL CHECK (period_month = DATE_TRUNC('month', period_month)::DATE),
  cutoff_date DATE,
  correction_deadline DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
  lock_reason TEXT NOT NULL DEFAULT '',
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  reopen_reason TEXT NOT NULL DEFAULT '',
  reopened_by TEXT,
  reopened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_periods_scope
  ON staff_payroll_periods(tenant_id, branch_id, period_month DESC);

ALTER TABLE staff_payroll_items
  ADD COLUMN IF NOT EXISTS attendance_source_hash TEXT NOT NULL DEFAULT '';
