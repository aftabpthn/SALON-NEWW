ALTER TABLE staff_mobile_devices
  ADD COLUMN IF NOT EXISTS push_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS push_token_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS push_registered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staff_mobile_push_scope
  ON staff_mobile_devices(tenant_id, branch_id, active, push_enabled)
  WHERE push_token_ciphertext IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_chat_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  reply_to_message_id TEXT REFERENCES team_chat_messages(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_chat_scope_created
  ON team_chat_messages(tenant_id, branch_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_chat_idempotency
  ON team_chat_messages(tenant_id, branch_id, sender_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_push_deliveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES staff_mobile_devices(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (tenant_id, device_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_due
  ON mobile_push_deliveries(status, next_attempt_at, created_at)
  WHERE status IN ('pending','failed');
