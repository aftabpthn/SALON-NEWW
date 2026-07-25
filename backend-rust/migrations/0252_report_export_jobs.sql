CREATE TABLE IF NOT EXISTS report_export_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_json JSONB NOT NULL,
  report_type TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'json',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','expired')),
  output_bytes BYTEA,
  content_type TEXT NOT NULL DEFAULT 'application/json',
  file_name TEXT NOT NULL DEFAULT 'report.json',
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, created_by, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_report_export_jobs_due ON report_export_jobs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_report_export_jobs_scope ON report_export_jobs (tenant_id, branch_id, created_at DESC);
