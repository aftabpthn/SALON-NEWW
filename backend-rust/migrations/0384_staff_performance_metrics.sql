CREATE TABLE IF NOT EXISTS staff_performance_metric_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  visible_metric_keys JSONB NOT NULL DEFAULT '[]'::JSONB,
  custom_metrics JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id),
  CHECK (JSONB_TYPEOF(visible_metric_keys) = 'array'),
  CHECK (JSONB_TYPEOF(custom_metrics) = 'array')
);

