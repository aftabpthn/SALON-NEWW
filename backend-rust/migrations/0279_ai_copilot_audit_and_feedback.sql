-- AI copilot tool-call audit and answer feedback.

CREATE TABLE IF NOT EXISTS ai_copilot_tool_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL,
  redacted_question TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_copilot_tool_audit_outcome_check
    CHECK (outcome IN ('allowed','forbidden','failed'))
);

CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_scope
  ON ai_copilot_tool_audit (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_user
  ON ai_copilot_tool_audit (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_refused
  ON ai_copilot_tool_audit (tenant_id, outcome, created_at DESC)
  WHERE outcome <> 'allowed';

CREATE TABLE IF NOT EXISTS ai_copilot_feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES ai_concierge_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  helpful BOOLEAN NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  tool TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_copilot_feedback_message_user
  ON ai_copilot_feedback (message_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_feedback_tool
  ON ai_copilot_feedback (tenant_id, tool, helpful, created_at DESC);
