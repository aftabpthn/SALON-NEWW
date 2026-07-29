-- Record the data scope a prediction run was produced under.
--
-- A stored run already says which model scored it and from what window. Without
-- the scope it does not say *whose* data it read, so a run made by a single
-- branch manager and one made across a whole region are indistinguishable after
-- the fact. These columns close that gap for the audit path.

ALTER TABLE ai_prediction_runs
  ADD COLUMN IF NOT EXISTS scope_level TEXT NOT NULL DEFAULT 'branch',
  ADD COLUMN IF NOT EXISTS scope_label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scope_branch_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS requested_role TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_prediction_runs
  DROP CONSTRAINT IF EXISTS ck_ai_prediction_runs_scope_level;
ALTER TABLE ai_prediction_runs
  ADD CONSTRAINT ck_ai_prediction_runs_scope_level
  CHECK (scope_level IN ('tenant','region','zone','cluster','branch','self')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_ai_prediction_runs_scope_audit
  ON ai_prediction_runs (tenant_id, scope_level, prediction_kind, created_at DESC);
