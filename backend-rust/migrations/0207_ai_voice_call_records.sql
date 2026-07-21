CREATE TABLE IF NOT EXISTS ai_voice_call_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'voice',
  provider_call_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  caller_phone TEXT NOT NULL DEFAULT '',
  normalized_caller_phone TEXT NOT NULL DEFAULT '',
  salon_phone TEXT NOT NULL DEFAULT '',
  staff_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','ringing','answered','completed','missed','busy','failed','abandoned')),
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  ring_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (ring_duration_seconds >= 0),
  conversation_duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (conversation_duration_seconds >= 0),
  recording_url TEXT NOT NULL DEFAULT '',
  transcript_available BOOLEAN NOT NULL DEFAULT FALSE,
  ai_session_id TEXT REFERENCES ai_concierge_sessions(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES marketing_leads(id) ON DELETE SET NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  pos_sale_id TEXT REFERENCES pos_sales(id) ON DELETE SET NULL,
  ai_summary TEXT NOT NULL DEFAULT '',
  ai_intent TEXT NOT NULL DEFAULT '',
  ai_action_type TEXT NOT NULL DEFAULT '',
  callback_required BOOLEAN NOT NULL DEFAULT FALSE,
  callback_due_at TIMESTAMPTZ,
  lost_reason TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, provider, provider_call_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_voice_call_records_scope
  ON ai_voice_call_records(tenant_id, branch_id, started_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_voice_call_records_phone
  ON ai_voice_call_records(tenant_id, branch_id, normalized_caller_phone, created_at DESC)
  WHERE normalized_caller_phone <> '';

CREATE INDEX IF NOT EXISTS idx_ai_voice_call_records_status
  ON ai_voice_call_records(tenant_id, branch_id, status, created_at DESC);