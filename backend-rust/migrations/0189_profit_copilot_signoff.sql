CREATE TABLE IF NOT EXISTS profit_copilot_recommendation_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_ids TEXT[] NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  recommendation_key TEXT NOT NULL,
  fact_schema_version TEXT NOT NULL,
  fact_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  impact_paise BIGINT NOT NULL CHECK (impact_paise >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evaluation_status TEXT NOT NULL CHECK (evaluation_status IN ('passed','failed')),
  evaluation_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, fact_hash, recommendation_key)
);

CREATE INDEX IF NOT EXISTS idx_profit_copilot_versions_scope
  ON profit_copilot_recommendation_versions
  (tenant_id, period_start DESC, period_end DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profit_copilot_versions_branches
  ON profit_copilot_recommendation_versions USING GIN (branch_ids);

CREATE TABLE IF NOT EXISTS profit_copilot_feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  recommendation_version_id TEXT NOT NULL
    REFERENCES profit_copilot_recommendation_versions(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  comment TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_copilot_feedback_version
  ON profit_copilot_feedback (tenant_id, recommendation_version_id, created_at DESC);
