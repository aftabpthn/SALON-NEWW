CREATE TABLE IF NOT EXISTS staff_payroll_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (cycle = 'monthly'),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','reviewed','finalized','paid')),
  gross_paise BIGINT NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  deductions_paise BIGINT NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  net_paise BIGINT NOT NULL DEFAULT 0 CHECK (net_paise >= 0),
  staff_count INTEGER NOT NULL DEFAULT 0 CHECK (staff_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  created_by TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  finalized_by TEXT,
  finalized_at TIMESTAMPTZ,
  paid_by TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, cycle, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_runs_scope
  ON staff_payroll_runs(tenant_id, branch_id, period_start DESC, period_end DESC);

CREATE TABLE IF NOT EXISTS staff_payroll_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  staff_name TEXT NOT NULL,
  employee_code TEXT,
  pay_rate_type TEXT CHECK (pay_rate_type IS NULL OR pay_rate_type IN ('hourly','daily','monthly')),
  pay_rate_paise BIGINT CHECK (pay_rate_paise IS NULL OR pay_rate_paise >= 0),
  attendance_days_x2 INTEGER NOT NULL DEFAULT 0 CHECK (attendance_days_x2 >= 0),
  paid_leave_days_x2 INTEGER NOT NULL DEFAULT 0 CHECK (paid_leave_days_x2 >= 0),
  weekly_off_days_x2 INTEGER NOT NULL DEFAULT 0 CHECK (weekly_off_days_x2 >= 0),
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  earned_salary_paise BIGINT NOT NULL DEFAULT 0 CHECK (earned_salary_paise >= 0),
  overtime_paise BIGINT NOT NULL DEFAULT 0 CHECK (overtime_paise >= 0),
  commission_paise BIGINT NOT NULL DEFAULT 0 CHECK (commission_paise >= 0),
  adjustment_paise BIGINT NOT NULL DEFAULT 0,
  penalty_paise BIGINT NOT NULL DEFAULT 0 CHECK (penalty_paise >= 0),
  gross_paise BIGINT NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  deductions_paise BIGINT NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  net_paise BIGINT NOT NULL DEFAULT 0 CHECK (net_paise >= 0),
  validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  calculation_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','reviewed','finalized','paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (payroll_run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_items_scope
  ON staff_payroll_items(tenant_id, branch_id, payroll_run_id, staff_id);

CREATE TABLE IF NOT EXISTS staff_payroll_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_events_run
  ON staff_payroll_events(tenant_id, branch_id, payroll_run_id, created_at DESC);
