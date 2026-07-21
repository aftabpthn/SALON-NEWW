CREATE TABLE IF NOT EXISTS staff_private_conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL REFERENCES users(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, staff_user_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS staff_private_conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES staff_private_conversations(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  participant_role TEXT NOT NULL CHECK (participant_role IN ('staff','owner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_private_chat_participant
  ON staff_private_conversation_participants(tenant_id, branch_id, user_id, conversation_id);

CREATE TABLE IF NOT EXISTS staff_private_chat_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES staff_private_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_private_chat_messages
  ON staff_private_chat_messages(tenant_id, branch_id, conversation_id, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_private_chat_idempotency
  ON staff_private_chat_messages(tenant_id, conversation_id, sender_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE staff_mobile_devices
  ADD COLUMN IF NOT EXISTS push_subscription_json JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE staff_schedules
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
