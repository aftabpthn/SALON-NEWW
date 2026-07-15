CREATE TABLE IF NOT EXISTS staff_holidays (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 120),
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_holidays_scope_date
  ON staff_holidays (tenant_id, branch_id, holiday_date, active);

ALTER TABLE staff_payroll_items
  ADD COLUMN IF NOT EXISTS holiday_days_x2 INTEGER NOT NULL DEFAULT 0
  CHECK (holiday_days_x2 >= 0);
