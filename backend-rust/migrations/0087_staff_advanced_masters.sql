CREATE TABLE IF NOT EXISTS staff_incentive_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('service','product','membership','branch_admin','admin','all_transaction')),
  assignee_type TEXT NOT NULL CHECK (assignee_type IN ('staff','branch','standard')),
  assignee_id TEXT NOT NULL DEFAULT '',
  assignee_name TEXT NOT NULL DEFAULT '',
  role_scope TEXT NOT NULL CHECK (role_scope IN ('operator','admin','all')),
  slabs JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(slabs) = 'array'),
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, target_type, assignee_type, assignee_id, role_scope)
);

CREATE INDEX IF NOT EXISTS idx_staff_incentive_rules_scope
  ON staff_incentive_rules(tenant_id, branch_id, target_type, active, assignee_id);

CREATE TABLE IF NOT EXISTS staff_payroll_adjustment_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fine','allowance','deduction')),
  name TEXT NOT NULL,
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','late_count','absent_day','half_day','short_hours','no_clock_out','weekend_penalty','sandwich_penalty','unpaid_week_off','fixed')),
  trigger_count INTEGER NOT NULL DEFAULT 1 CHECK (trigger_count > 0),
  application_mode TEXT NOT NULL DEFAULT 'per_occurrence' CHECK (application_mode IN ('per_occurrence','fixed')),
  auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, kind, name)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_adjustment_rules_scope
  ON staff_payroll_adjustment_rules(tenant_id, branch_id, kind, active);

CREATE TABLE IF NOT EXISTS staff_payroll_structures (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provident_fund JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(provident_fund) = 'object'),
  professional_tax JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(professional_tax) = 'object'),
  esic JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(esic) = 'object'),
  tds JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(tds) = 'object'),
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_structures_scope
  ON staff_payroll_structures(tenant_id, branch_id, active);
