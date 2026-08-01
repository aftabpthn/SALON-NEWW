CREATE TABLE IF NOT EXISTS staff_goal_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (LENGTH(description) <= 2000),
  key_results_json JSONB NOT NULL CHECK (JSONB_TYPEOF(key_results_json)='array' AND JSONB_ARRAY_LENGTH(key_results_json) BETWEEN 1 AND 20),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id,branch_id,name)
);

CREATE INDEX IF NOT EXISTS idx_staff_goal_templates_scope
  ON staff_goal_templates(tenant_id,branch_id,active,name);

ALTER TABLE staff_performance_reviews
  DROP CONSTRAINT IF EXISTS staff_performance_reviews_status_check;

ALTER TABLE staff_performance_reviews
  ADD COLUMN IF NOT EXISTS appraisal_cycle_id TEXT REFERENCES staff_appraisal_cycles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS goal_template_id TEXT REFERENCES staff_goal_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS key_results_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (JSONB_TYPEOF(key_results_json)='array'),
  ADD COLUMN IF NOT EXISTS self_score INTEGER CHECK (self_score IS NULL OR self_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS self_comments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS self_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_score INTEGER CHECK (manager_score IS NULL OR manager_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS manager_comments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calibrated_score INTEGER CHECK (calibrated_score IS NULL OR calibrated_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS calibration_comments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS calibrated_by TEXT,
  ADD COLUMN IF NOT EXISTS calibrated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_score INTEGER CHECK (final_score IS NULL OR final_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS final_rating TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coaching_goal_id TEXT REFERENCES staff_coaching_goals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS incentive_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (incentive_amount_paise >= 0),
  ADD COLUMN IF NOT EXISTS incentive_evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (JSONB_TYPEOF(incentive_evidence_json)='array'),
  ADD COLUMN IF NOT EXISTS contribution_profit_paise BIGINT,
  ADD COLUMN IF NOT EXISTS profitability_guard_passed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_actor_user_id TEXT NOT NULL DEFAULT '';

ALTER TABLE staff_performance_reviews
  ADD CONSTRAINT staff_performance_reviews_status_check CHECK (status IN (
    'draft','shared','closed','self_review_pending','manager_review_pending',
    'calibration','approval_pending','approved','acknowledged'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_appraisal_cycle_employee
  ON staff_performance_reviews(tenant_id,branch_id,appraisal_cycle_id,staff_id)
  WHERE appraisal_cycle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_appraisal_reviews_cycle
  ON staff_performance_reviews(tenant_id,branch_id,appraisal_cycle_id,status,staff_id)
  WHERE appraisal_cycle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_appraisal_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appraisal_review_id TEXT NOT NULL REFERENCES staff_performance_reviews(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_appraisal_history_scope
  ON staff_appraisal_history(tenant_id,branch_id,appraisal_review_id,created_at,id);

CREATE OR REPLACE FUNCTION capture_staff_appraisal_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO staff_appraisal_history(tenant_id,branch_id,appraisal_review_id,action,actor_user_id,snapshot_json)
  VALUES(NEW.tenant_id,NEW.branch_id,NEW.id,NEW.status,NEW.last_actor_user_id,TO_JSONB(NEW));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_appraisal_history ON staff_performance_reviews;
CREATE TRIGGER trg_staff_appraisal_history
AFTER INSERT OR UPDATE ON staff_performance_reviews
FOR EACH ROW WHEN (NEW.appraisal_cycle_id IS NOT NULL)
EXECUTE FUNCTION capture_staff_appraisal_history();

CREATE OR REPLACE FUNCTION reject_staff_appraisal_history_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff appraisal history is immutable';
END $$;

DROP TRIGGER IF EXISTS trg_staff_appraisal_history_immutable ON staff_appraisal_history;
CREATE TRIGGER trg_staff_appraisal_history_immutable
BEFORE UPDATE OR DELETE ON staff_appraisal_history
FOR EACH ROW EXECUTE FUNCTION reject_staff_appraisal_history_mutation();
