CREATE TABLE IF NOT EXISTS membership_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS membership_reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT REFERENCES client_memberships(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  reminder_type TEXT NOT NULL DEFAULT 'renewal' CHECK (reminder_type IN ('renewal','reward_expiry')),
  due_on DATE NOT NULL,
  days_before INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','approved','sent','dismissed')),
  message TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, client_membership_id, reminder_type, due_on)
);

CREATE INDEX IF NOT EXISTS idx_membership_reminders_scope_status
  ON membership_reminders (tenant_id, branch_id, status, due_on);

CREATE TABLE IF NOT EXISTS membership_risk_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  membership_id TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'reviewed' CHECK (review_status IN ('pending','reviewed','dismissed')),
  note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, signal_id)
);

CREATE TABLE IF NOT EXISTS membership_reward_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  source_sale_id TEXT NOT NULL DEFAULT '',
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earned','redeemed','reversed','adjusted')),
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  expires_at DATE,
  staff_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_reward_ledger_client
  ON membership_reward_ledger (tenant_id, branch_id, client_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_reward_ledger_sale_type
  ON membership_reward_ledger (tenant_id, branch_id, source_sale_id, transaction_type)
  WHERE source_sale_id <> '';

CREATE TABLE IF NOT EXISTS membership_self_service_tokens (
  token TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  client_membership_id TEXT REFERENCES client_memberships(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_self_service_tokens_scope
  ON membership_self_service_tokens (tenant_id, branch_id, client_id, expires_at DESC);

ALTER TABLE membership_self_service_requests
  DROP CONSTRAINT IF EXISTS membership_self_service_requests_request_type_check;

ALTER TABLE membership_self_service_requests
  ADD CONSTRAINT membership_self_service_requests_request_type_check
  CHECK (request_type IN ('renew','cancel','upgrade','downgrade','payment_method_update','credit_adjustment'));

ALTER TABLE membership_self_service_requests
  ADD COLUMN IF NOT EXISTS credit_delta INTEGER NOT NULL DEFAULT 0;
