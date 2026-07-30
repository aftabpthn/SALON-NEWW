CREATE TABLE IF NOT EXISTS saas_support_email_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES saas_support_tickets(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES saas_support_messages(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  outbound_message_id TEXT NOT NULL,
  in_reply_to TEXT NOT NULL DEFAULT '',
  references_header TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id),
  UNIQUE (outbound_message_id)
);
CREATE INDEX IF NOT EXISTS idx_saas_support_email_outbox_due
  ON saas_support_email_outbox(status,next_attempt_at,created_at)
  WHERE status IN ('queued','failed');
