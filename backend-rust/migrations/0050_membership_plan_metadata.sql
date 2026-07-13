ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'discount',
  ADD COLUMN IF NOT EXISTS price_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS benefit_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_tenant_branch_code
  ON memberships (tenant_id, branch_id, LOWER(code))
  WHERE code <> '';
