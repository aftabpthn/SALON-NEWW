CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  points_required INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant_branch ON memberships(tenant_id, branch_id, active);
CREATE INDEX IF NOT EXISTS idx_memberships_search ON memberships(tenant_id, branch_id, LOWER(name));

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise BIGINT NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 0,
  service_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_packages_tenant_branch ON packages(tenant_id, branch_id, active);
CREATE INDEX IF NOT EXISTS idx_packages_search ON packages(tenant_id, branch_id, LOWER(name));
