CREATE TABLE IF NOT EXISTS service_variants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta_paise BIGINT NOT NULL DEFAULT 0,
  duration_delta_minutes INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_service_variants_scope
  ON service_variants (tenant_id, branch_id, service_id, active);

CREATE TABLE IF NOT EXISTS service_addons (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_paise BIGINT NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_service_addons_scope
  ON service_addons (tenant_id, branch_id, service_id, active);

CREATE TABLE IF NOT EXISTS service_staff_prices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, service_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_service_staff_prices_scope
  ON service_staff_prices (tenant_id, branch_id, service_id, staff_id, active);

CREATE TABLE IF NOT EXISTS service_price_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  adjustment_bps INTEGER NOT NULL CHECK (adjustment_bps BETWEEN -5000 AND 10000),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT service_price_rule_days CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  CONSTRAINT service_price_rule_window CHECK (start_time <> end_time),
  UNIQUE (tenant_id, branch_id, service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_service_price_rules_scope
  ON service_price_rules (tenant_id, branch_id, service_id, active, priority DESC);
