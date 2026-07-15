CREATE TABLE IF NOT EXISTS franchise_policies (
  tenant_id TEXT PRIMARY KEY,
  central_branch_id TEXT NOT NULL,
  allowed_override_fields TEXT[] NOT NULL DEFAULT ARRAY['pricePaise','durationMinutes','active']::TEXT[],
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS royalty_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS royalty_minimum_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_royalty_bps_check;
ALTER TABLE branches ADD CONSTRAINT branches_royalty_bps_check
  CHECK (royalty_bps BETWEEN 0 AND 10000);
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_royalty_minimum_check;
ALTER TABLE branches ADD CONSTRAINT branches_royalty_minimum_check
  CHECK (royalty_minimum_paise >= 0);

ALTER TABLE services ADD COLUMN IF NOT EXISTS central_master_service_id TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS franchise_override_fields TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_central_master_branch
  ON services (tenant_id, branch_id, central_master_service_id)
  WHERE central_master_service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_central_master
  ON services (tenant_id, central_master_service_id)
  WHERE central_master_service_id IS NOT NULL;

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS central_master_item_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_central_master_branch
  ON inventory_items (tenant_id, branch_id, central_master_item_id)
  WHERE central_master_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_central_master
  ON inventory_items (tenant_id, central_master_item_id)
  WHERE central_master_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS franchise_royalty_statements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  gross_sales_paise BIGINT NOT NULL CHECK (gross_sales_paise >= 0),
  royalty_bps INTEGER NOT NULL CHECK (royalty_bps BETWEEN 0 AND 10000),
  minimum_paise BIGINT NOT NULL CHECK (minimum_paise >= 0),
  royalty_paise BIGINT NOT NULL CHECK (royalty_paise >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid')),
  journal_entry_id TEXT,
  payment_journal_entry_id TEXT,
  created_by TEXT NOT NULL,
  paid_by TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_franchise_royalty_scope
  ON franchise_royalty_statements (tenant_id, branch_id, period_start DESC);
