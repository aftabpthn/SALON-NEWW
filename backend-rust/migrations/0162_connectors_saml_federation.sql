ALTER TABLE auth_oidc_states DROP CONSTRAINT IF EXISTS auth_oidc_states_provider_check;
ALTER TABLE auth_oidc_states
  ADD CONSTRAINT auth_oidc_states_provider_check
  CHECK (provider IN ('google', 'microsoft', 'saml'));

ALTER TABLE auth_external_identities DROP CONSTRAINT IF EXISTS auth_external_identities_provider_check;
ALTER TABLE auth_external_identities
  ADD CONSTRAINT auth_external_identities_provider_check
  CHECK (provider IN ('google', 'microsoft', 'saml'));

ALTER TABLE auth_sso_policies
  ADD COLUMN IF NOT EXISTS saml_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  state_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks','xero','netsuite','google')),
  actor_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_uri TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_oauth_states_expiry
  ON integration_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS integration_connector_connections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks','xero','netsuite','google')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','disconnected')),
  external_account_id TEXT NOT NULL DEFAULT '',
  external_account_name TEXT NOT NULL DEFAULT '',
  access_token_ciphertext TEXT NOT NULL DEFAULT '',
  refresh_token_ciphertext TEXT NOT NULL DEFAULT '',
  token_expires_at TIMESTAMPTZ,
  scopes_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,provider)
);
CREATE INDEX IF NOT EXISTS idx_integration_connector_scope
  ON integration_connector_connections(tenant_id,branch_id,status,provider);

CREATE TABLE IF NOT EXISTS integration_connector_sync_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES integration_connector_connections(id),
  provider TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual','scheduled','oauth_callback')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_connector_jobs_due
  ON integration_connector_sync_jobs(status,next_attempt_at,created_at)
  WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_integration_connector_jobs_scope
  ON integration_connector_sync_jobs(tenant_id,branch_id,created_at DESC);
