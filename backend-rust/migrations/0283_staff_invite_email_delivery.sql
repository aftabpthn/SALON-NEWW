ALTER TABLE staff_login_invitations
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN delivery_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN provider_message_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_delivery_error TEXT NOT NULL DEFAULT '',
  ADD COLUMN last_sent_at TIMESTAMPTZ,
  ADD COLUMN delivered_at TIMESTAMPTZ,
  ADD COLUMN bounced_at TIMESTAMPTZ,
  ADD CONSTRAINT staff_login_invitations_delivery_status_check
    CHECK (delivery_status IN ('manual', 'sent', 'delivered', 'bounced', 'failed'));

CREATE UNIQUE INDEX uq_staff_login_invitations_provider_message
  ON staff_login_invitations (provider_message_id)
  WHERE provider_message_id <> '';
