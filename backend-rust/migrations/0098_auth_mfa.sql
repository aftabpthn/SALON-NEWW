CREATE TABLE IF NOT EXISTS auth_mfa_factors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  recovery_code_hashes JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_factors_enabled
  ON auth_mfa_factors(tenant_id, user_id)
  WHERE enabled = TRUE;
