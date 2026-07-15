ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  normalized_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone_verified_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  communication_preferences JSONB NOT NULL DEFAULT '{"preferredChannel":"none","whatsappOptIn":false,"smsOptIn":false,"emailOptIn":false}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_phone
  ON customer_accounts (normalized_phone) WHERE normalized_phone <> '' AND status <> 'deleted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_email
  ON customer_accounts (LOWER(email)) WHERE email <> '' AND status <> 'deleted';

CREATE TABLE IF NOT EXISTS customer_account_clients (
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, tenant_id, branch_id),
  UNIQUE (tenant_id, branch_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_account_clients_client
  ON customer_account_clients (tenant_id, branch_id, client_id);

CREATE TABLE IF NOT EXISTS customer_verification_challenges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  account_id TEXT REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT '',
  branch_id TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL CHECK (target_type IN ('phone','email')),
  target TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','change_phone','change_email')),
  code_hash TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_challenges_lookup
  ON customer_verification_challenges (target_type, target, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_account
  ON customer_sessions (account_id, revoked_at, expires_at DESC);

CREATE TABLE IF NOT EXISTS customer_security_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_security_events_account
  ON customer_security_events (account_id, created_at DESC);
