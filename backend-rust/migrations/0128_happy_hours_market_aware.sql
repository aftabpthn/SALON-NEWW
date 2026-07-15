CREATE TABLE IF NOT EXISTS pos_market_price_observations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_category TEXT NOT NULL,
  competitor_name TEXT NOT NULL,
  observed_price_paise BIGINT NOT NULL CHECK (observed_price_paise > 0),
  observed_on DATE NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_market_price_observations_scope
  ON pos_market_price_observations (tenant_id, branch_id, service_category, active, observed_on DESC);

CREATE TABLE IF NOT EXISTS pos_happy_hour_market_suggestions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_category TEXT NOT NULL,
  signal_date DATE NOT NULL,
  hour_slot SMALLINT NOT NULL CHECK (hour_slot BETWEEN 0 AND 23),
  our_price_paise BIGINT NOT NULL,
  base_discount_bps INTEGER NOT NULL,
  max_discount_bps INTEGER NOT NULL,
  benchmark_source TEXT NOT NULL,
  market_avg_paise BIGINT NOT NULL,
  market_min_paise BIGINT NOT NULL,
  market_max_paise BIGINT NOT NULL,
  observation_count BIGINT NOT NULL,
  scheduled_staff BIGINT NOT NULL,
  appointment_count BIGINT NOT NULL,
  occupancy_bps BIGINT NOT NULL,
  price_gap_bps BIGINT NOT NULL,
  market_position TEXT NOT NULL,
  campaign_angle TEXT NOT NULL,
  suggested_discount_bps INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'paused', 'archived')),
  reasons_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_market_suggestions_scope
  ON pos_happy_hour_market_suggestions (tenant_id, branch_id, status, created_at DESC);
