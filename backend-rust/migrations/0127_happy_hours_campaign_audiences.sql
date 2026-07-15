CREATE TABLE IF NOT EXISTS pos_happy_hour_audiences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  audience_key TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  criteria_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  estimate_count BIGINT NOT NULL DEFAULT 0,
  previewed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, audience_key)
);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_audiences_scope
  ON pos_happy_hour_audiences (tenant_id, branch_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS pos_happy_hour_campaign_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  audience_id TEXT NOT NULL REFERENCES pos_happy_hour_audiences(id) ON DELETE RESTRICT,
  rule_id TEXT NOT NULL REFERENCES pos_happy_hour_rules(id) ON DELETE RESTRICT,
  coupon_id TEXT REFERENCES pos_coupons(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_campaign_links_scope
  ON pos_happy_hour_campaign_links (tenant_id, branch_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_campaign_links_rule
  ON pos_happy_hour_campaign_links (tenant_id, branch_id, rule_id);
