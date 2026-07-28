-- Predictive intelligence runs and their outputs.
--
-- Mirrors the shape inventory_reorder_forecast_runs already proved: the run
-- records the model version and the history window the features were built
-- from, and each prediction carries its own confidence and sufficiency. A
-- prediction is only meaningful alongside the inputs and model that produced
-- it, so the two are stored together and never overwritten in place.

CREATE TABLE IF NOT EXISTS ai_prediction_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  prediction_kind TEXT NOT NULL CHECK (prediction_kind IN (
    'client_churn_risk',
    'client_return_window',
    'no_show_risk',
    'service_demand',
    'appointment_load',
    'staff_utilization',
    'inventory_reorder_risk',
    'membership_renewal_risk',
    'revenue_forecast'
  )),
  -- Which engine produced it: the Python model, or the deterministic fallback.
  model_version TEXT NOT NULL,
  computed_by TEXT NOT NULL DEFAULT 'python' CHECK (computed_by IN ('python','rust_fallback')),
  -- The history window the features were derived from.
  history_start DATE NOT NULL,
  history_end DATE NOT NULL,
  -- Digest of the feature set. Identical inputs must produce an identical
  -- digest, which is what makes a run reproducible after the fact.
  feature_digest TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::JSONB,
  requested_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_prediction_runs_window CHECK (history_end >= history_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_scope
  ON ai_prediction_runs (tenant_id, branch_id, prediction_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_predictions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES ai_prediction_runs(id) ON DELETE CASCADE,
  -- What the prediction is about: a client, staff member, service, item, or
  -- the branch itself. Kept as text rather than a foreign key because the
  -- subject type varies by prediction kind.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('client','staff','service','inventory_item','membership','branch')),
  subject_id TEXT NOT NULL DEFAULT '',
  subject_name TEXT NOT NULL DEFAULT '',
  -- A range, never a single false-precision point.
  lower_value NUMERIC(14,2) NOT NULL,
  upper_value NUMERIC(14,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  -- How many observations backed it, and whether that cleared the minimum.
  sample_size INTEGER NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  data_sufficient BOOLEAN NOT NULL DEFAULT FALSE,
  signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_predictions_range CHECK (upper_value >= lower_value)
);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_run
  ON ai_predictions (tenant_id, branch_id, run_id);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_subject
  ON ai_predictions (tenant_id, branch_id, subject_kind, subject_id, created_at DESC);
