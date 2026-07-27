-- Feature-key entitlement engine: richer subscription lifecycle states,
-- per-plan lifecycle policies, and audited subscription overrides.

-- 1. Allow the full lifecycle on saas_subscriptions.
--    'paused' is kept for backward compatibility and treated as 'suspended'.
ALTER TABLE saas_subscriptions DROP CONSTRAINT IF EXISTS saas_subscriptions_status_check;
ALTER TABLE saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_status_check
  CHECK (status IN ('trialing','active','past_due','grace','paused','suspended','cancelled','expired'));

-- Keep exactly one current subscription per tenant scope across the states
-- that still bind the tenant to a plan.
DROP INDEX IF EXISTS idx_saas_subscription_one_current;
CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_subscription_one_current
  ON saas_subscriptions(tenant_id,branch_id)
  WHERE status IN ('trialing','active','past_due','grace','paused','suspended');

-- 2. Per-plan lifecycle policies.
ALTER TABLE saas_plans
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER NOT NULL DEFAULT 7
    CHECK (grace_period_days >= 0),
  ADD COLUMN IF NOT EXISTS suspension_policy TEXT NOT NULL DEFAULT 'read_only'
    CHECK (suspension_policy IN ('read_only','blocked')),
  ADD COLUMN IF NOT EXISTS retention_window_days INTEGER NOT NULL DEFAULT 30
    CHECK (retention_window_days >= 0);

-- 3. Audited subscription overrides: platform actors can temporarily force an
--    effective status for a tenant. Reason, expiry, and actor are mandatory;
--    rows are never deleted, only revoked.
CREATE TABLE IF NOT EXISTS saas_subscription_overrides (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
  override_status TEXT NOT NULL
    CHECK (override_status IN ('trialing','active','past_due','grace','suspended','cancelled','expired')),
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_saas_subscription_overrides_tenant
  ON saas_subscription_overrides(tenant_id, expires_at DESC);
