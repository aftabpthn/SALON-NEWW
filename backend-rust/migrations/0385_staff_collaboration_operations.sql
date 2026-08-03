-- Phase 10: collaboration, record-linked tasks, surveys, and company content.

ALTER TABLE staff_private_conversations
  ADD COLUMN IF NOT EXISTS conversation_type TEXT NOT NULL DEFAULT 'private-owner',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE staff_private_conversations
  DROP CONSTRAINT IF EXISTS staff_private_conversations_conversation_type_check;
ALTER TABLE staff_private_conversations
  ADD CONSTRAINT staff_private_conversations_conversation_type_check
  CHECK (conversation_type IN ('private-owner','direct','group','broadcast'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_chat_conversation_idempotency
  ON staff_private_conversations(tenant_id,branch_id,created_by,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE staff_private_conversation_participants
  DROP CONSTRAINT IF EXISTS staff_private_conversation_participants_participant_role_check;
ALTER TABLE staff_private_conversation_participants
  ADD CONSTRAINT staff_private_conversation_participants_participant_role_check
  CHECK (participant_role IN ('staff','owner','manager','member'));
ALTER TABLE staff_private_conversation_participants
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS staff_chat_attachments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  content BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_chat_attachment_scope
  ON staff_chat_attachments(tenant_id,branch_id,uploaded_by,expires_at);

ALTER TABLE staff_private_chat_messages
  ADD COLUMN IF NOT EXISTS share_type TEXT,
  ADD COLUMN IF NOT EXISTS share_id TEXT,
  ADD COLUMN IF NOT EXISTS attachment_id TEXT REFERENCES staff_chat_attachments(id),
  ADD COLUMN IF NOT EXISTS reply_to_message_id TEXT;
ALTER TABLE staff_private_chat_messages
  ADD CONSTRAINT staff_private_chat_messages_share_check
  CHECK ((share_type IS NULL AND share_id IS NULL) OR
         (share_type IN ('appointment','invoice','guest') AND share_id IS NOT NULL)) NOT VALID;

ALTER TABLE team_chat_messages
  ADD COLUMN IF NOT EXISTS share_type TEXT,
  ADD COLUMN IF NOT EXISTS share_id TEXT,
  ADD COLUMN IF NOT EXISTS attachment_id TEXT REFERENCES staff_chat_attachments(id);
ALTER TABLE team_chat_messages
  ADD CONSTRAINT team_chat_messages_share_check
  CHECK ((share_type IS NULL AND share_id IS NULL) OR
         (share_type IN ('appointment','invoice','guest') AND share_id IS NOT NULL)) NOT VALID;

CREATE TABLE IF NOT EXISTS team_chat_read_state (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,user_id)
);

ALTER TABLE staff_tasks
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS appointment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_staff_tasks_linked_record
  ON staff_tasks(tenant_id,branch_id,client_id,appointment_id)
  WHERE client_id IS NOT NULL OR appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_surveys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  questions_json JSONB NOT NULL CHECK (jsonb_typeof(questions_json)='array'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_surveys_current
  ON staff_surveys(tenant_id,branch_id,status,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS staff_survey_responses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  survey_id TEXT NOT NULL REFERENCES staff_surveys(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  answers_json JSONB NOT NULL CHECK (jsonb_typeof(answers_json)='object'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,survey_id,staff_id)
);

ALTER TABLE staff_rule_documents
  DROP CONSTRAINT IF EXISTS staff_rule_documents_document_type_check;
ALTER TABLE staff_rule_documents
  ADD CONSTRAINT staff_rule_documents_document_type_check
  CHECK (document_type IN ('rule','sop','policy','course','document','announcement'));
ALTER TABLE staff_rule_documents
  DROP CONSTRAINT IF EXISTS staff_rule_documents_category_check;
ALTER TABLE staff_rule_documents
  ADD CONSTRAINT staff_rule_documents_category_check
  CHECK (category IN ('service','hygiene','attendance','behavior','safety','company','training'));
