CREATE TABLE IF NOT EXISTS client_master_definitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('categories','sources','preferences','consultation-templates','feedback-definitions','custom-segments')),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  description TEXT NOT NULL DEFAULT '',
  definition_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(definition_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, kind, code)
);

CREATE INDEX IF NOT EXISTS idx_client_master_definitions_scope
  ON client_master_definitions (tenant_id, branch_id, kind, status, name);

CREATE TABLE IF NOT EXISTS client_master_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  master_id TEXT NOT NULL REFERENCES client_master_definitions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created','updated')),
  version INTEGER NOT NULL CHECK (version > 0),
  before_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  after_json JSONB NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_master_audit_scope
  ON client_master_audit_events (tenant_id, branch_id, master_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_discount_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  segments TEXT[] NOT NULL DEFAULT '{}',
  service_categories TEXT[] NOT NULL DEFAULT '{}',
  min_lifetime_value_paise BIGINT NOT NULL DEFAULT 0 CHECK (min_lifetime_value_paise >= 0),
  max_discount_bps INTEGER NOT NULL CHECK (max_discount_bps BETWEEN 1 AND 10000),
  clv_budget_bps INTEGER NOT NULL DEFAULT 500 CHECK (clv_budget_bps BETWEEN 0 AND 10000),
  approval_above_bps INTEGER NOT NULL DEFAULT 0 CHECK (approval_above_bps BETWEEN 0 AND 10000),
  membership_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  wallet_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_discount_rules_scope
  ON client_discount_rules (tenant_id, branch_id, active, priority, created_at);

CREATE TABLE IF NOT EXISTS client_discount_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  rule_id TEXT REFERENCES client_discount_rules(id) ON DELETE SET NULL,
  service_category TEXT NOT NULL,
  segment TEXT NOT NULL,
  subtotal_paise BIGINT NOT NULL CHECK (subtotal_paise > 0),
  lifetime_value_paise BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_value_paise >= 0),
  requested_discount_bps INTEGER NOT NULL CHECK (requested_discount_bps BETWEEN 1 AND 10000),
  approved_discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (approved_discount_bps BETWEEN 0 AND 10000),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  remaining_clv_budget_paise BIGINT NOT NULL DEFAULT 0 CHECK (remaining_clv_budget_paise >= 0),
  has_membership BOOLEAN NOT NULL DEFAULT FALSE,
  has_wallet_balance BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('approved','approval_required','rejected')),
  reasons_json JSONB NOT NULL CHECK (JSONB_TYPEOF(reasons_json) = 'array'),
  decided_by TEXT NOT NULL,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_discount_decisions_client
  ON client_discount_decisions (tenant_id, branch_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_win_back_offers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  decision_id TEXT REFERENCES client_discount_decisions(id) ON DELETE SET NULL,
  offer_code TEXT NOT NULL,
  title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
  offered_discount_bps INTEGER NOT NULL CHECK (offered_discount_bps BETWEEN 1 AND 10000),
  discount_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_cost_paise >= 0),
  return_window_days INTEGER NOT NULL DEFAULT 30 CHECK (return_window_days BETWEEN 1 AND 180),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','returned','expired')),
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  redeemed_sale_id TEXT,
  returned_at TIMESTAMPTZ,
  return_sale_id TEXT,
  revenue_after_return_paise BIGINT NOT NULL DEFAULT 0 CHECK (revenue_after_return_paise >= 0),
  offer_roi_bps BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, offer_code)
);

CREATE INDEX IF NOT EXISTS idx_client_win_back_offers_client
  ON client_win_back_offers (tenant_id, branch_id, client_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_win_back_offers_open
  ON client_win_back_offers (status, issued_at)
  WHERE status IN ('issued','redeemed');
