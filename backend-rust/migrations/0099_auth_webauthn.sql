CREATE TABLE IF NOT EXISTS auth_webauthn_credentials (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  passkey_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_webauthn_credentials_user
  ON auth_webauthn_credentials(tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('registration', 'authentication')),
  state_json JSONB NOT NULL,
  label TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_webauthn_challenges_expiry
  ON auth_webauthn_challenges(expires_at);
