CREATE TABLE IF NOT EXISTS staff_roster_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  entries_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(entries_json) = 'array'),
  metrics_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metrics_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  created_by TEXT NOT NULL,
  published_by TEXT,
  published_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_staff_roster_drafts_scope
  ON staff_roster_drafts(tenant_id, branch_id, period_start DESC, status);

CREATE TABLE IF NOT EXISTS staff_manpower_forecasts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  history_start DATE NOT NULL,
  history_end DATE NOT NULL,
  projected_demand_minutes BIGINT NOT NULL CHECK (projected_demand_minutes >= 0),
  available_capacity_minutes BIGINT CHECK (available_capacity_minutes IS NULL OR available_capacity_minutes >= 0),
  required_staff_count INTEGER CHECK (required_staff_count IS NULL OR required_staff_count >= 0),
  shortage_staff_count INTEGER CHECK (shortage_staff_count IS NULL OR shortage_staff_count >= 0),
  confidence TEXT NOT NULL CHECK (confidence IN ('no_data','low','medium','high')),
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(evidence_json) = 'object'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CHECK (history_end >= history_start)
);

CREATE INDEX IF NOT EXISTS idx_staff_manpower_forecasts_scope
  ON staff_manpower_forecasts(tenant_id, branch_id, period_start DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_replacement_recommendations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  absent_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  recommended_staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  ranked_options_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(ranked_options_json) = 'array'),
  confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(decision_reason) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_replacements_scope
  ON staff_replacement_recommendations(tenant_id, branch_id, status, created_at DESC);
