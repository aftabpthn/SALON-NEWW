ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS package_redemptions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS client_package_credits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL DEFAULT '',
  total_qty INTEGER NOT NULL DEFAULT 0,
  remaining_qty INTEGER NOT NULL DEFAULT 0,
  expires_at DATE,
  source_sale_id TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_package_credits_client
  ON client_package_credits (tenant_id, branch_id, client_id, active);

CREATE INDEX IF NOT EXISTS idx_client_package_credits_package
  ON client_package_credits (tenant_id, branch_id, package_id);

CREATE INDEX IF NOT EXISTS idx_client_package_credits_source_sale
  ON client_package_credits (tenant_id, branch_id, source_sale_id);

CREATE TABLE IF NOT EXISTS pos_package_redemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_package_credit_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_package_redemptions_sale
  ON pos_package_redemptions (tenant_id, branch_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_pos_package_redemptions_client
  ON pos_package_redemptions (tenant_id, branch_id, client_id);
