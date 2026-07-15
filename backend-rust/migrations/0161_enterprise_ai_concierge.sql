CREATE TABLE IF NOT EXISTS ai_governance_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_channels JSONB NOT NULL DEFAULT '["web"]'::JSONB,
  require_booking_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  redact_sensitive_data BOOLEAN NOT NULL DEFAULT TRUE,
  transcript_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (transcript_retention_days BETWEEN 1 AND 3650),
  prompt_version TEXT NOT NULL DEFAULT 'receptionist-v1',
  booking_url TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS ai_concierge_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web','whatsapp','voice')),
  external_thread_id TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  user_id TEXT REFERENCES users(id),
  locale TEXT NOT NULL DEFAULT 'en-IN',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','handoff','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, channel, external_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_concierge_sessions_scope
  ON ai_concierge_sessions(tenant_id, branch_id, status, updated_at DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_concierge_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES ai_concierge_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  provider TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  safety_flags JSONB NOT NULL DEFAULT '[]'::JSONB,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_concierge_messages_session
  ON ai_concierge_messages(tenant_id, branch_id, session_id, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_concierge_provider_message
  ON ai_concierge_messages(tenant_id, branch_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_concierge_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES ai_concierge_sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES ai_concierge_messages(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('booking_draft','human_handoff')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed')),
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_concierge_actions_scope
  ON ai_concierge_actions(tenant_id, branch_id, status, created_at DESC);
