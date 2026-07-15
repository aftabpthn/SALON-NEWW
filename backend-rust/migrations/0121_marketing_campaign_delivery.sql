ALTER TABLE benefit_notification_outbox
  DROP CONSTRAINT IF EXISTS benefit_notification_outbox_source_type_check;
ALTER TABLE benefit_notification_outbox
  ADD CONSTRAINT benefit_notification_outbox_source_type_check
  CHECK (source_type IN (
    'membership_reminder','package_alert','win_back','occasion_campaign',
    'membership_renewal','wallet_reminder','review_recovery','marketing_campaign'
  ));

ALTER TABLE benefit_notification_outbox
  DROP CONSTRAINT IF EXISTS benefit_notification_outbox_channel_check;
ALTER TABLE benefit_notification_outbox
  ADD CONSTRAINT benefit_notification_outbox_channel_check
  CHECK (channel IN ('whatsapp','sms','email'));

CREATE INDEX IF NOT EXISTS idx_notifications_marketing_schedule
  ON notifications (notification_type, ((metadata_json->>'status')), created_at)
  WHERE notification_type='marketing_campaign'
    AND metadata_json->>'status'='scheduled'
    AND metadata_json ? 'scheduledAt';
