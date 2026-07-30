CREATE TABLE IF NOT EXISTS staff_salary_advances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  requested_amount_paise BIGINT NOT NULL CHECK (requested_amount_paise > 0),
  approved_amount_paise BIGINT CHECK (approved_amount_paise IS NULL OR approved_amount_paise > 0),
  disbursed_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (disbursed_amount_paise >= 0),
  outstanding_paise BIGINT NOT NULL DEFAULT 0 CHECK (outstanding_paise >= 0),
  installment_count INTEGER NOT NULL DEFAULT 1 CHECK (installment_count > 0),
  installment_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (installment_amount_paise >= 0),
  pending_carry_forward_paise BIGINT NOT NULL DEFAULT 0 CHECK (pending_carry_forward_paise >= 0),
  recovery_start_period DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','rejected','approved','disbursed','recovering','waived','closed','cancelled'
  )),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  disbursed_by TEXT,
  disbursed_at TIMESTAMPTZ,
  disbursement_method TEXT CHECK (disbursement_method IS NULL OR disbursement_method IN ('cash','bank','upi','other')),
  disbursement_reference TEXT NOT NULL DEFAULT '',
  disbursement_idempotency_key TEXT,
  waived_by TEXT,
  waived_at TIMESTAMPTZ,
  waiver_reason TEXT NOT NULL DEFAULT '',
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (approved_amount_paise IS NULL OR approved_amount_paise <= requested_amount_paise)
);

CREATE INDEX IF NOT EXISTS idx_staff_salary_advances_scope
  ON staff_salary_advances(tenant_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_salary_advances_staff
  ON staff_salary_advances(tenant_id, branch_id, staff_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_salary_advances_disbursement_key
  ON staff_salary_advances(tenant_id, branch_id, disbursement_idempotency_key)
  WHERE disbursement_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_advance_recoveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  advance_id TEXT NOT NULL REFERENCES staff_salary_advances(id) ON DELETE RESTRICT,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  payroll_item_id TEXT NOT NULL REFERENCES staff_payroll_items(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scheduled_paise BIGINT NOT NULL DEFAULT 0 CHECK (scheduled_paise >= 0),
  recovered_paise BIGINT NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
  carried_forward_paise BIGINT NOT NULL DEFAULT 0 CHECK (carried_forward_paise >= 0),
  outstanding_after_paise BIGINT NOT NULL DEFAULT 0 CHECK (outstanding_after_paise >= 0),
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, payroll_item_id, advance_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_advance_recoveries_run
  ON staff_advance_recoveries(tenant_id, branch_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_staff_advance_recoveries_advance
  ON staff_advance_recoveries(tenant_id, branch_id, advance_id);
