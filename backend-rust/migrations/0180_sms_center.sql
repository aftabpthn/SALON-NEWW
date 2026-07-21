ALTER TABLE benefit_notification_outbox
  DROP CONSTRAINT IF EXISTS benefit_notification_outbox_source_type_check;
ALTER TABLE benefit_notification_outbox
  ADD CONSTRAINT benefit_notification_outbox_source_type_check
  CHECK (source_type IN (
    'membership_reminder','package_alert','win_back','occasion_campaign',
    'membership_renewal','wallet_reminder','review_recovery','marketing_campaign',
    'sms_center_client','sms_center_staff','appointment_message',
    'appointment_notification','appointment_reminder'
  ));

ALTER TABLE pos_invoice_outbox
  DROP CONSTRAINT IF EXISTS pos_invoice_outbox_channel_check;
ALTER TABLE pos_invoice_outbox
  ADD CONSTRAINT pos_invoice_outbox_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'email'));

CREATE INDEX IF NOT EXISTS idx_notifications_sms_center
  ON notifications (tenant_id, branch_id, created_at DESC)
  WHERE notification_type = 'sms_center_campaign';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_sms_center_idempotency
  ON notifications (tenant_id, branch_id, (metadata_json->>'idempotencyKey'))
  WHERE notification_type = 'sms_center_campaign'
    AND metadata_json->>'idempotencyKey' <> '';
