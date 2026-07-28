-- AI copilot tool-call audit and answer feedback.
--
-- Every copilot tool call is recorded: who asked, in which tenant and branch,
-- which tool ran, whether it was allowed, and how much data it returned. The
-- question itself is stored redacted so the audit trail does not become a new
-- place where client contact details accumulate.

CREATE TABLE IF NOT EXISTS ai_copilot_tool_audit (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id     TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  user_role     TEXT NOT NULL,
  session_id    TEXT NOT NULL DEFAULT '',
  tool          TEXT NOT NULL,
  -- 'allowed', 'forbidden' or 'failed'.
  outcome       TEXT NOT NULL,
  -- Question with contact details stripped; never the raw text.
  redacted_question TEXT NOT NULL DEFAULT '',
  -- Rows the tool read, so unusual volume is visible.
  row_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_copilot_tool_audit_outcome_check
    CHECK (outcome IN ('allowed','forbidden','failed'))
);

CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_scope
  ON ai_copilot_tool_audit (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_user
  ON ai_copilot_tool_audit (tenant_id, user_id, created_at DESC);
-- Refused attempts are the ones a reviewer looks for first.
CREATE INDEX IF NOT EXISTS idx_ai_copilot_tool_audit_refused
  ON ai_copilot_tool_audit (tenant_id, outcome, created_at DESC)
  WHERE outcome <> 'allowed';

-- Was the answer useful? One verdict per user per assistant message.
CREATE TABLE IF NOT EXISTS ai_copilot_feedback (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id   TEXT NOT NULL,
  branch_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL REFERENCES ai_concierge_messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  helpful     BOOLEAN NOT NULL,
  -- Optional free text, redacted before storage.
  note        TEXT NOT NULL DEFAULT '',
  tool        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

-- One vote per user per message; a second vote replaces the first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_copilot_feedback_message_user
  ON ai_copilot_feedback (message_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_feedback_tool
  ON ai_copilot_feedback (tenant_id, tool, helpful, created_at DESC);
