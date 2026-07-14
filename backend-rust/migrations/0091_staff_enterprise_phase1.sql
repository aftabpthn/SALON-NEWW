CREATE TABLE IF NOT EXISTS staff_approval_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  policy_key TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  request_type TEXT NOT NULL,
  amount_threshold_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_threshold_paise >= 0),
  steps JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(steps) = 'array'),
  escalation_hours INTEGER NOT NULL DEFAULT 24 CHECK (escalation_hours > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, policy_key)
);

CREATE TABLE IF NOT EXISTS staff_approval_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  policy_id TEXT REFERENCES staff_approval_policies(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','escalated','cancelled')),
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step > 0),
  steps JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(steps) = 'array'),
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(payload_json) = 'object'),
  requested_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_approval_requests_scope
  ON staff_approval_requests(tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_approval_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  approval_request_id TEXT NOT NULL REFERENCES staff_approval_requests(id) ON DELETE CASCADE,
  step_order INTEGER,
  action TEXT NOT NULL CHECK (action IN ('requested','approved','rejected','escalated','cancelled')),
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  comments TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_approval_actions_request
  ON staff_approval_actions(tenant_id, branch_id, approval_request_id, created_at);

CREATE TABLE IF NOT EXISTS staff_payroll_statutory_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('provident_fund','esic','professional_tax','tds','gratuity','bonus')),
  state_code TEXT NOT NULL DEFAULT '',
  rule_json JSONB NOT NULL CHECK (jsonb_typeof(rule_json) = 'object'),
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (tenant_id, branch_id, rule_type, state_code, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_staff_statutory_rules_scope
  ON staff_payroll_statutory_rules(tenant_id, branch_id, active, effective_from DESC);

CREATE TABLE IF NOT EXISTS staff_payroll_statutory_calculations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  payroll_item_id TEXT NOT NULL REFERENCES staff_payroll_items(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_paise BIGINT NOT NULL CHECK (gross_paise >= 0),
  employee_deduction_paise BIGINT NOT NULL DEFAULT 0 CHECK (employee_deduction_paise >= 0),
  employer_contribution_paise BIGINT NOT NULL DEFAULT 0 CHECK (employer_contribution_paise >= 0),
  accrual_paise BIGINT NOT NULL DEFAULT 0 CHECK (accrual_paise >= 0),
  breakdown_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(breakdown_json) = 'object'),
  calculated_by TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, payroll_item_id)
);

CREATE TABLE IF NOT EXISTS staff_salary_revisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('hourly','daily','monthly')),
  old_amount_paise BIGINT CHECK (old_amount_paise IS NULL OR old_amount_paise >= 0),
  new_amount_paise BIGINT NOT NULL CHECK (new_amount_paise > 0),
  effective_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_salary_revisions_scope
  ON staff_salary_revisions(tenant_id, branch_id, staff_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS staff_tip_payouts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payout_reference TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (tenant_id, branch_id, payout_reference)
);

CREATE TABLE IF NOT EXISTS staff_tip_payout_items (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payout_id TEXT NOT NULL REFERENCES staff_tip_payouts(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  PRIMARY KEY (tenant_id, branch_id, sale_id)
);
