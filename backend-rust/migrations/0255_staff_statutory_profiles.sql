CREATE TABLE IF NOT EXISTS staff_statutory_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  uan TEXT NOT NULL DEFAULT '',
  esic_number TEXT NOT NULL DEFAULT '',
  pan_number TEXT NOT NULL DEFAULT '',
  pt_state_code TEXT NOT NULL DEFAULT '',
  pf_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  esic_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_statutory_profiles_scope
  ON staff_statutory_profiles(tenant_id, branch_id);
