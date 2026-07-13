CREATE TABLE IF NOT EXISTS staff_role_assignments (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, role_id)
);

CREATE TABLE IF NOT EXISTS staff_catalog_assignments (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('service','product','membership','package')),
  item_id TEXT NOT NULL,
  commission_percent INTEGER CHECK (commission_percent IS NULL OR commission_percent BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (staff_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS staff_commission_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('all','service','product','membership','package')),
  rate_percent INTEGER NOT NULL CHECK (rate_percent BETWEEN 0 AND 100),
  effective_from DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_pay_rates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('hourly','daily','monthly')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  effective_from DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_leave_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','casual','special','unpaid')),
  annual_days INTEGER NOT NULL CHECK (annual_days >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_catalog_assignments_scope
  ON staff_catalog_assignments(tenant_id, branch_id, staff_id, item_type);
CREATE INDEX IF NOT EXISTS idx_staff_commission_rules_scope
  ON staff_commission_rules(tenant_id, branch_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_pay_rates_scope
  ON staff_pay_rates(tenant_id, branch_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_leave_policies_scope
  ON staff_leave_policies(tenant_id, branch_id, staff_id);
CREATE TABLE IF NOT EXISTS staff_profiles (
  staff_id TEXT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  mandatory_break_minutes INTEGER CHECK (mandatory_break_minutes IS NULL OR mandatory_break_minutes >= 0),
  work_tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_work_hours INTEGER CHECK (max_work_hours IS NULL OR max_work_hours >= 0),
  target_revenue_paise BIGINT CHECK (target_revenue_paise IS NULL OR target_revenue_paise >= 0),
  vacation_days INTEGER CHECK (vacation_days IS NULL OR vacation_days >= 0),
  special_leave_days INTEGER CHECK (special_leave_days IS NULL OR special_leave_days >= 0),
  tenure_start_date DATE,
  booking_interval_minutes INTEGER CHECK (booking_interval_minutes IS NULL OR booking_interval_minutes >= 0),
  restrict_booking_to_returning_guests BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_tenant_branch
  ON staff_profiles(tenant_id, branch_id, staff_id);
