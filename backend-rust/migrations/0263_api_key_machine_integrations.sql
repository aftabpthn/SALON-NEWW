-- API keys are machine-integration credentials only. Each key records the
-- integration it belongs to, its own rate limit, an optional IP allowlist,
-- and where it was last used from. Secrets stay hashed; only the prefix is
-- ever readable.
ALTER TABLE integration_api_keys
  ADD COLUMN IF NOT EXISTS integration_type TEXT NOT NULL DEFAULT 'external_reporting'
    CHECK (integration_type IN (
      'attendance_device',
      'accounting_export',
      'payroll_provider',
      'messaging_provider',
      'ai_service',
      'external_reporting'
    )),
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 120
    CHECK (rate_limit_per_minute > 0 AND rate_limit_per_minute <= 100000),
  ADD COLUMN IF NOT EXISTS ip_allowlist_json JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(ip_allowlist_json) = 'array'),
  ADD COLUMN IF NOT EXISTS last_used_ip TEXT,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_scope
  ON integration_api_keys(tenant_id, branch_id, status, integration_type);
