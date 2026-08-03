-- Governed AI Workforce: opt-in policy, request controls and immutable evaluation evidence.

ALTER TABLE ai_governance_settings
  ALTER COLUMN enabled SET DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_action_owner_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS max_requests_per_minute INTEGER NOT NULL DEFAULT 60
    CHECK (max_requests_per_minute BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS max_latency_ms INTEGER NOT NULL DEFAULT 15000
    CHECK (max_latency_ms BETWEEN 500 AND 60000),
  ADD COLUMN IF NOT EXISTS monthly_cost_budget_paise BIGINT NOT NULL DEFAULT 0
    CHECK (monthly_cost_budget_paise >= 0),
  ADD COLUMN IF NOT EXISTS evaluation_retention_days INTEGER NOT NULL DEFAULT 90
    CHECK (evaluation_retention_days BETWEEN 1 AND 3650),
  ADD COLUMN IF NOT EXISTS model_allowlist JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(model_allowlist)='array');

UPDATE ai_governance_settings
   SET default_action_owner_user_id=updated_by
 WHERE enabled=TRUE AND default_action_owner_user_id='' AND updated_by<>'';

CREATE TABLE IF NOT EXISTS ai_workforce_request_windows (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,window_started_at)
);

CREATE TABLE IF NOT EXISTS ai_workforce_evaluations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  dataset_digest TEXT NOT NULL,
  production_data_used BOOLEAN NOT NULL DEFAULT FALSE CHECK (production_data_used=FALSE),
  model_name TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  unsafe_prompt_tests_passed BOOLEAN NOT NULL,
  hallucination_tests_passed BOOLEAN NOT NULL,
  unauthorized_action_tests_passed BOOLEAN NOT NULL,
  baseline_metric_bps INTEGER CHECK (baseline_metric_bps BETWEEN -1000000 AND 1000000),
  observed_metric_bps INTEGER CHECK (observed_metric_bps BETWEEN -1000000 AND 1000000),
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(evidence)='array'),
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_workforce_evaluations_scope
  ON ai_workforce_evaluations(tenant_id,branch_id,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_workforce_policy_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  before_policy JSONB NOT NULL DEFAULT '{}'::JSONB,
  after_policy JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_workforce_policy_audit_scope
  ON ai_workforce_policy_audit(tenant_id,branch_id,created_at DESC);

ALTER TABLE ai_copilot_alerts
  ADD COLUMN IF NOT EXISTS evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS action_owner_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE ai_copilot_approvals
  ADD COLUMN IF NOT EXISTS evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS action_owner_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model_name TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_action_drafts
  ADD COLUMN IF NOT EXISTS evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS action_owner_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE OR REPLACE FUNCTION prevent_ai_workforce_evidence_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI workforce evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_workforce_evaluation_immutable ON ai_workforce_evaluations;
CREATE TRIGGER trg_ai_workforce_evaluation_immutable
BEFORE UPDATE OR DELETE ON ai_workforce_evaluations
FOR EACH ROW EXECUTE FUNCTION prevent_ai_workforce_evidence_mutation();

DROP TRIGGER IF EXISTS trg_ai_workforce_policy_audit_immutable ON ai_workforce_policy_audit;
CREATE TRIGGER trg_ai_workforce_policy_audit_immutable
BEFORE UPDATE OR DELETE ON ai_workforce_policy_audit
FOR EACH ROW EXECUTE FUNCTION prevent_ai_workforce_evidence_mutation();
