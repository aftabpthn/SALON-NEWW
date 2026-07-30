CREATE TABLE IF NOT EXISTS tenant_domain_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_domain_mappings_domain
  ON tenant_domain_mappings(LOWER(domain));
CREATE INDEX IF NOT EXISTS idx_tenant_domain_mappings_tenant
  ON tenant_domain_mappings(tenant_id, verified);

CREATE TABLE IF NOT EXISTS saas_onboarding_requests (
  idempotency_key TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
  domain_mapping_id TEXT REFERENCES tenant_domain_mappings(id),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_onboarding_tenant
  ON saas_onboarding_requests(tenant_id, created_at DESC);
