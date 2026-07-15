CREATE TABLE IF NOT EXISTS client_intelligence_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recency_days INTEGER NOT NULL CHECK (recency_days >= 0),
  frequency_count BIGINT NOT NULL CHECK (frequency_count >= 0),
  monetary_paise BIGINT NOT NULL CHECK (monetary_paise >= 0),
  recency_score SMALLINT NOT NULL CHECK (recency_score BETWEEN 1 AND 5),
  frequency_score SMALLINT NOT NULL CHECK (frequency_score BETWEEN 1 AND 5),
  monetary_score SMALLINT NOT NULL CHECK (monetary_score BETWEEN 1 AND 5),
  rfm_score SMALLINT NOT NULL CHECK (rfm_score BETWEEN 3 AND 15),
  segment TEXT NOT NULL,
  churn_risk_score SMALLINT NOT NULL CHECK (churn_risk_score BETWEEN 0 AND 100),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, client_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_client_intelligence_snapshot_scope
  ON client_intelligence_snapshots (tenant_id, branch_id, snapshot_date DESC, rfm_score DESC);
CREATE INDEX IF NOT EXISTS idx_client_intelligence_snapshot_lapsed
  ON client_intelligence_snapshots (tenant_id, branch_id, snapshot_date DESC, recency_days DESC);
