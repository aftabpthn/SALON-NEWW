ALTER TABLE profit_action_queue
  DROP CONSTRAINT IF EXISTS profit_action_queue_tenant_id_branch_id_source_type_source__key;

ALTER TABLE profit_action_queue
  ADD COLUMN IF NOT EXISTS action_key TEXT,
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS rule_key TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS baseline_impact_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_impact_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_impact_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recurrence_key TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generated_by TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_observed_at TIMESTAMPTZ;

UPDATE profit_action_queue
SET action_key = 'legacy:' || source_type || ':' || source_id,
    owner_user_id = COALESCE(owner_user_id, created_by_user_id),
    sla_minutes = COALESCE(
      sla_minutes,
      CASE priority WHEN 'high' THEN 1440 WHEN 'medium' THEN 4320 ELSE 10080 END
    ),
    due_at = COALESCE(
      due_at,
      created_at + MAKE_INTERVAL(mins => CASE priority WHEN 'high' THEN 1440 WHEN 'medium' THEN 4320 ELSE 10080 END)
    ),
    evidence_json = CASE WHEN evidence_json = '{}'::JSONB THEN payload_json ELSE evidence_json END,
    baseline_impact_paise = CASE WHEN baseline_impact_paise = 0 THEN impact_paise ELSE baseline_impact_paise END,
    expected_impact_paise = CASE WHEN expected_impact_paise = 0 THEN impact_paise ELSE expected_impact_paise END,
    recurrence_key = COALESCE(recurrence_key, 'legacy:' || source_type || ':' || action_type),
    generated_by = CASE WHEN governance_decision_id IS NULL THEN 'manual' ELSE 'governance' END,
    last_observed_at = COALESCE(last_observed_at, updated_at)
WHERE action_key IS NULL;

ALTER TABLE profit_action_queue
  ALTER COLUMN action_key SET NOT NULL;

ALTER TABLE profit_action_queue
  DROP CONSTRAINT IF EXISTS profit_action_queue_action_key_length,
  ADD CONSTRAINT profit_action_queue_action_key_length CHECK (LENGTH(action_key) BETWEEN 1 AND 128),
  DROP CONSTRAINT IF EXISTS profit_action_queue_period_order,
  ADD CONSTRAINT profit_action_queue_period_order CHECK (
    (period_start IS NULL AND period_end IS NULL)
    OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= period_end)
  ),
  DROP CONSTRAINT IF EXISTS profit_action_queue_rule_key_length,
  ADD CONSTRAINT profit_action_queue_rule_key_length CHECK (LENGTH(rule_key) BETWEEN 1 AND 64),
  DROP CONSTRAINT IF EXISTS profit_action_queue_sla_minutes_check,
  ADD CONSTRAINT profit_action_queue_sla_minutes_check CHECK (sla_minutes IS NULL OR sla_minutes > 0),
  DROP CONSTRAINT IF EXISTS profit_action_queue_notes_length,
  ADD CONSTRAINT profit_action_queue_notes_length CHECK (LENGTH(notes) <= 4000),
  DROP CONSTRAINT IF EXISTS profit_action_queue_evidence_object,
  ADD CONSTRAINT profit_action_queue_evidence_object CHECK (jsonb_typeof(evidence_json) = 'object'),
  DROP CONSTRAINT IF EXISTS profit_action_queue_impact_tracking,
  ADD CONSTRAINT profit_action_queue_impact_tracking CHECK (
    baseline_impact_paise >= 0 AND expected_impact_paise >= 0 AND realized_impact_paise >= 0
  ),
  DROP CONSTRAINT IF EXISTS profit_action_queue_occurrence_check,
  ADD CONSTRAINT profit_action_queue_occurrence_check CHECK (occurrence_number > 0),
  DROP CONSTRAINT IF EXISTS profit_action_queue_generated_by_check,
  ADD CONSTRAINT profit_action_queue_generated_by_check CHECK (generated_by IN ('manual','governance','automated_scan'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_action_queue_period_key
  ON profit_action_queue (tenant_id, branch_id, action_key);

CREATE INDEX IF NOT EXISTS idx_profit_action_queue_owner_sla
  ON profit_action_queue (tenant_id, branch_id, owner_user_id, due_at)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS idx_profit_action_queue_recurrence
  ON profit_action_queue (tenant_id, branch_id, recurrence_key, occurrence_number DESC);

CREATE TABLE IF NOT EXISTS profit_action_scan_state (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_period_start DATE,
  last_period_end DATE,
  last_action_count INTEGER NOT NULL DEFAULT 0 CHECK (last_action_count >= 0),
  last_error TEXT NOT NULL DEFAULT '' CHECK (LENGTH(last_error) <= 1000),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_profit_action_scan_due
  ON profit_action_scan_state (next_scan_at, locked_until);
