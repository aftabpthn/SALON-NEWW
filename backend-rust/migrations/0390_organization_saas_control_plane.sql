ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'salon',
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_business_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_business_type_check
  CHECK (business_type IN ('salon','spa','medspa','fitness','barbershop','wellness','multi_vertical'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_lifecycle_version_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_version_check CHECK (lifecycle_version > 0);

CREATE TABLE IF NOT EXISTS organization_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES organization_brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_currency_code_check;
ALTER TABLE branches ADD CONSTRAINT branches_currency_code_check
  CHECK (currency_code ~ '^[A-Z]{3}$');

CREATE INDEX IF NOT EXISTS idx_branches_tenant_brand
  ON branches (tenant_id, brand_id, region_name, active);

CREATE TABLE IF NOT EXISTS organization_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES organization_brands(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_organization_departments_scope
  ON organization_departments (tenant_id, branch_id, brand_id, active, name);

CREATE TABLE IF NOT EXISTS organization_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('business_unit','revenue_center')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_units_scope_code
  ON organization_units (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::UUID), kind, code);
CREATE INDEX IF NOT EXISTS idx_organization_units_scope
  ON organization_units (tenant_id, branch_id, kind, active, name);

CREATE TABLE IF NOT EXISTS branch_operating_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at TIME,
  closes_at TIME,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((closed AND opens_at IS NULL AND closes_at IS NULL)
    OR (NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)),
  UNIQUE (tenant_id, branch_id, weekday)
);

CREATE TABLE IF NOT EXISTS branch_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at TIME,
  closes_at TIME,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((closed AND opens_at IS NULL AND closes_at IS NULL)
    OR (NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)),
  UNIQUE (tenant_id, branch_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_branch_holidays_scope
  ON branch_holidays (tenant_id, branch_id, holiday_date);

CREATE TABLE IF NOT EXISTS organization_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  config_key TEXT NOT NULL,
  value_json JSONB NOT NULL CHECK (jsonb_typeof(value_json)='object'),
  version INTEGER NOT NULL CHECK (version > 0),
  allow_location_override BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL DEFAULT '',
  source_version INTEGER,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, config_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_config_active_central
  ON organization_config_versions (tenant_id, config_key) WHERE branch_id IS NULL AND active=TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_config_active_location
  ON organization_config_versions (tenant_id, branch_id, config_key) WHERE branch_id IS NOT NULL AND active=TRUE;
CREATE INDEX IF NOT EXISTS idx_organization_config_history
  ON organization_config_versions (tenant_id, branch_id, config_key, version DESC);

CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  expires_at TIMESTAMPTZ,
  reason TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_feature_overrides_effective
  ON tenant_feature_overrides (tenant_id, feature_key, expires_at);

CREATE TABLE IF NOT EXISTS saas_usage_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  included_quantity BIGINT NOT NULL DEFAULT 0 CHECK (included_quantity >= 0),
  hard_limit_quantity BIGINT CHECK (hard_limit_quantity IS NULL OR hard_limit_quantity >= included_quantity),
  overage_unit_paise BIGINT NOT NULL DEFAULT 0 CHECK (overage_unit_paise >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, subscription_id, metric)
);

ALTER TABLE saas_usage_events
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS communication_channel TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_cost_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

ALTER TABLE saas_usage_events DROP CONSTRAINT IF EXISTS saas_usage_events_unit_cost_check;
ALTER TABLE saas_usage_events ADD CONSTRAINT saas_usage_events_unit_cost_check
  CHECK (unit_cost_paise >= 0);
ALTER TABLE saas_usage_events DROP CONSTRAINT IF EXISTS saas_usage_events_currency_check;
ALTER TABLE saas_usage_events ADD CONSTRAINT saas_usage_events_currency_check
  CHECK (currency ~ '^[A-Z]{3}$');

CREATE INDEX IF NOT EXISTS idx_saas_usage_provider_cost
  ON saas_usage_events (tenant_id, subscription_id, provider, communication_channel, occurred_at);
