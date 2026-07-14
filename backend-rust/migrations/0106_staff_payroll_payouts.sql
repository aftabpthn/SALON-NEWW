CREATE TABLE IF NOT EXISTS staff_payroll_payouts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE RESTRICT,
  payroll_item_id TEXT NOT NULL REFERENCES staff_payroll_items(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  base_pay_paise BIGINT NOT NULL CHECK (base_pay_paise >= 0),
  commission_paise BIGINT NOT NULL CHECK (commission_paise >= 0),
  adjustment_paise BIGINT NOT NULL,
  deductions_paise BIGINT NOT NULL CHECK (deductions_paise >= 0),
  net_paise BIGINT NOT NULL CHECK (net_paise >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','upi','other')),
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_payouts_scope
  ON staff_payroll_payouts (tenant_id, branch_id, payroll_run_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_payouts_retry
  ON staff_payroll_payouts (tenant_id, branch_id, payroll_run_id, idempotency_key);
