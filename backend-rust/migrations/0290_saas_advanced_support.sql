ALTER TABLE saas_support_tickets
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS requester_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS queue_key TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id TEXT REFERENCES saas_support_tickets(id),
  ADD COLUMN IF NOT EXISTS duplicate_of_ticket_id TEXT REFERENCES saas_support_tickets(id),
  ADD COLUMN IF NOT EXISTS reopened_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS csat_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_support_message_at TIMESTAMPTZ;

ALTER TABLE saas_support_tickets DROP CONSTRAINT IF EXISTS saas_support_tickets_source_check;
ALTER TABLE saas_support_tickets ADD CONSTRAINT saas_support_tickets_source_check
  CHECK (source IN ('portal','email'));
ALTER TABLE saas_support_tickets DROP CONSTRAINT IF EXISTS saas_support_tickets_queue_key_check;
ALTER TABLE saas_support_tickets ADD CONSTRAINT saas_support_tickets_queue_key_check
  CHECK (queue_key IN ('billing','technical','account','data','security','general'));
ALTER TABLE saas_support_tickets DROP CONSTRAINT IF EXISTS saas_support_tickets_escalation_level_check;
ALTER TABLE saas_support_tickets ADD CONSTRAINT saas_support_tickets_escalation_level_check
  CHECK (escalation_level BETWEEN 0 AND 2);

UPDATE saas_support_tickets
   SET queue_key=CASE category WHEN 'other' THEN 'general' ELSE category END,
       last_customer_message_at=COALESCE(
         (SELECT MAX(created_at) FROM saas_support_messages m
           WHERE m.ticket_id=saas_support_tickets.id AND m.author_type='customer'),
         created_at
       ),
       last_support_message_at=(
         SELECT MAX(created_at) FROM saas_support_messages m
          WHERE m.ticket_id=saas_support_tickets.id AND m.author_type='support'
       );

ALTER TABLE saas_support_messages
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS external_event_id TEXT,
  ADD COLUMN IF NOT EXISTS email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS sender_email TEXT NOT NULL DEFAULT '';

ALTER TABLE saas_support_messages DROP CONSTRAINT IF EXISTS saas_support_messages_source_check;
ALTER TABLE saas_support_messages ADD CONSTRAINT saas_support_messages_source_check
  CHECK (source IN ('portal','email','system'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_support_message_external_event
  ON saas_support_messages(external_event_id)
  WHERE external_event_id IS NOT NULL AND external_event_id<>'';
CREATE INDEX IF NOT EXISTS idx_saas_support_message_thread
  ON saas_support_messages(email_message_id)
  WHERE email_message_id IS NOT NULL AND email_message_id<>'';
CREATE INDEX IF NOT EXISTS idx_saas_support_queue
  ON saas_support_tickets(queue_key,status,assigned_to,severity,resolution_due_at,created_at DESC)
  WHERE merged_into_ticket_id IS NULL;

CREATE TABLE IF NOT EXISTS saas_support_attachments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES saas_support_tickets(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES saas_support_messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer','internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id,sha256,file_name)
);
CREATE INDEX IF NOT EXISTS idx_saas_support_attachments_ticket
  ON saas_support_attachments(tenant_id,branch_id,ticket_id,created_at);

CREATE TABLE IF NOT EXISTS saas_support_csat (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES saas_support_tickets(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_saas_support_csat_scope
  ON saas_support_csat(tenant_id,branch_id,submitted_at DESC);

CREATE TABLE IF NOT EXISTS saas_support_email_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  provider TEXT NOT NULL DEFAULT 'ses',
  provider_event_id TEXT NOT NULL,
  ses_message_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  ticket_id TEXT REFERENCES saas_support_tickets(id),
  message_id TEXT REFERENCES saas_support_messages(id),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error_message TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider,provider_event_id),
  UNIQUE (provider,ses_message_id)
);

CREATE TABLE IF NOT EXISTS saas_support_escalation_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  run_key TEXT NOT NULL UNIQUE,
  escalated_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
