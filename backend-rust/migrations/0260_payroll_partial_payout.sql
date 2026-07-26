ALTER TABLE staff_payroll_runs
  DROP CONSTRAINT IF EXISTS staff_payroll_runs_status_check;
ALTER TABLE staff_payroll_runs
  ADD CONSTRAINT staff_payroll_runs_status_check
  CHECK (status IN ('calculated','reviewed','finalized','partially_paid','paid'));

ALTER TABLE staff_payroll_items
  ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending','held','succeeded','failed')),
  ADD COLUMN IF NOT EXISTS payout_hold_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS held_by TEXT,
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

ALTER TABLE staff_payroll_payouts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'succeeded'
    CHECK (status IN ('succeeded','failed')),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS staff_payroll_payout_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  payroll_item_id TEXT NOT NULL REFERENCES staff_payroll_items(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','upi','other')),
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
  failure_reason TEXT NOT NULL DEFAULT '',
  attempted_by TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, payroll_run_id, staff_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_payout_attempts_item
  ON staff_payroll_payout_attempts(tenant_id, branch_id, payroll_run_id, staff_id, attempt_no DESC);
