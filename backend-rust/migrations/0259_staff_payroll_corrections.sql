CREATE TABLE IF NOT EXISTS staff_payroll_corrections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  original_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  correction_type TEXT NOT NULL CHECK (correction_type IN ('arrear','recovery')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','rejected','approved','posted','cancelled'
  )),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','upi','other')),
  payment_reference TEXT NOT NULL DEFAULT '',
  posting_idempotency_key TEXT,
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (correction_type != 'arrear' OR status != 'posted' OR payment_method IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_corrections_run
  ON staff_payroll_corrections(tenant_id, branch_id, original_run_id);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_corrections_staff
  ON staff_payroll_corrections(tenant_id, branch_id, staff_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_payroll_corrections_posting_key
  ON staff_payroll_corrections(tenant_id, branch_id, posting_idempotency_key)
  WHERE posting_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_payroll_correction_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  correction_id TEXT NOT NULL REFERENCES staff_payroll_corrections(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_correction_events_correction
  ON staff_payroll_correction_events(tenant_id, branch_id, correction_id, created_at);
