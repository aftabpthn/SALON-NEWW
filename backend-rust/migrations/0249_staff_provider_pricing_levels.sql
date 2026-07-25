CREATE TABLE IF NOT EXISTS staff_pricing_levels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_staff_pricing_levels_scope
  ON staff_pricing_levels(tenant_id, branch_id, active, rank, name);

ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS pricing_level_id TEXT REFERENCES staff_pricing_levels(id);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_pricing_level
  ON staff_profiles(tenant_id, branch_id, pricing_level_id);

CREATE TABLE IF NOT EXISTS service_pricing_level_prices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pricing_level_id TEXT NOT NULL REFERENCES staff_pricing_levels(id) ON DELETE CASCADE,
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, service_id, pricing_level_id)
);

CREATE INDEX IF NOT EXISTS idx_service_pricing_level_prices_scope
  ON service_pricing_level_prices(tenant_id, branch_id, service_id, pricing_level_id, active);
