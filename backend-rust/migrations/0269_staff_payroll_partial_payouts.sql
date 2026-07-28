ALTER TABLE staff_payroll_runs DROP CONSTRAINT IF EXISTS staff_payroll_runs_status_check;
ALTER TABLE staff_payroll_runs ADD CONSTRAINT staff_payroll_runs_status_check
  CHECK (status IN ('calculated','reviewed','finalized','partially_paid','paid'));

CREATE TABLE IF NOT EXISTS staff_payroll_payout_states (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE RESTRICT,
  payroll_item_id TEXT NOT NULL REFERENCES staff_payroll_items(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','held','processing','failed','paid')),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','upi','other')),
  reference TEXT NOT NULL DEFAULT '',
  hold_reason TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  held_by TEXT,
  held_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_payout_states_run
  ON staff_payroll_payout_states(tenant_id, branch_id, payroll_run_id, status);

CREATE TABLE IF NOT EXISTS staff_payroll_payout_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE RESTRICT,
  payout_state_id TEXT NOT NULL REFERENCES staff_payroll_payout_states(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','succeeded','failed')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','upi','other')),
  reference TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, payroll_run_id, staff_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_payout_attempts_state
  ON staff_payroll_payout_attempts(tenant_id, branch_id, payout_state_id, created_at DESC);
