CREATE TABLE IF NOT EXISTS pos_happy_hour_context_suggestions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  offer_type TEXT NOT NULL CHECK (offer_type IN ('bundle','channel','lead_time','weather_event','member_wallet')),
  service_category TEXT NOT NULL,
  signal_date DATE NOT NULL,
  hour_slot SMALLINT NOT NULL CHECK (hour_slot BETWEEN 0 AND 23),
  service_price_paise BIGINT NOT NULL CHECK (service_price_paise >= 0),
  base_discount_bps INTEGER NOT NULL CHECK (base_discount_bps BETWEEN 0 AND 4000),
  suggested_discount_bps INTEGER NOT NULL CHECK (suggested_discount_bps BETWEEN 0 AND 4000),
  campaign_angle TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  reasons_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','approved','paused','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_context_suggestions_scope
  ON pos_happy_hour_context_suggestions (tenant_id, branch_id, offer_type, status, created_at DESC);
