ALTER TABLE staff_lifecycle_cases
  ADD COLUMN IF NOT EXISTS final_settlement_payroll_run_id TEXT REFERENCES staff_payroll_runs(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_staff_lifecycle_settlement_payroll
  ON staff_lifecycle_cases(tenant_id, branch_id, final_settlement_payroll_run_id)
  WHERE final_settlement_payroll_run_id IS NOT NULL;
