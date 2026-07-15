CREATE TABLE IF NOT EXISTS auth_oidc_states (
  state_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_oidc_states_expiry
  ON auth_oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS auth_external_identities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider, subject),
  UNIQUE (tenant_id, provider, user_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_external_identities_user
  ON auth_external_identities(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS auth_sso_handoffs (
  code_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sso_handoffs_expiry
  ON auth_sso_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS auth_scim_tokens (
  tenant_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  last_four TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_scim_users (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_scim_users_external_id
  ON auth_scim_users(tenant_id, external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';
