CREATE TABLE IF NOT EXISTS pos_happy_hour_auto_sunset_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  expire_past_end_date BOOLEAN NOT NULL DEFAULT TRUE,
  pause_coupons_at_usage_limit BOOLEAN NOT NULL DEFAULT TRUE,
  review_no_end_date_after_days INTEGER NOT NULL DEFAULT 30 CHECK (review_no_end_date_after_days BETWEEN 1 AND 365),
  auto_apply_expired BOOLEAN NOT NULL DEFAULT TRUE,
  auto_apply_usage_limit BOOLEAN NOT NULL DEFAULT TRUE,
  auto_apply_stale BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS pos_happy_hour_auto_sunset_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  offer_type TEXT NOT NULL CHECK (offer_type IN ('rule','coupon')),
  offer_id TEXT NOT NULL,
  offer_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('expire_coupon','pause_coupon','review_stale_rule','review_stale_coupon')),
  reason TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','applied','skipped')),
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','job')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, signature)
);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_auto_sunset_decisions_scope
  ON pos_happy_hour_auto_sunset_decisions (tenant_id, branch_id, status, severity, decided_at DESC);
