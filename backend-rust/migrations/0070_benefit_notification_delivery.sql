CREATE TABLE IF NOT EXISTS benefit_notification_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('membership_reminder','package_alert')),
  source_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  recipient TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, source_type, source_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_benefit_notification_outbox_due
  ON benefit_notification_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('queued','failed');

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS auto_renew_provider_cycle_end BIGINT NOT NULL DEFAULT 0;

ALTER TABLE membership_auto_renew_attempts
  ADD COLUMN IF NOT EXISTS provider_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
