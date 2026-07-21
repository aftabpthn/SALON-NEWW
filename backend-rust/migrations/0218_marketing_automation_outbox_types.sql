ALTER TABLE benefit_notification_outbox
  DROP CONSTRAINT IF EXISTS benefit_notification_outbox_source_type_check;
ALTER TABLE benefit_notification_outbox
  ADD CONSTRAINT benefit_notification_outbox_source_type_check
  CHECK (source_type IN (
    'membership_reminder','package_alert','win_back','occasion_campaign',
    'membership_renewal','wallet_reminder','review_recovery','marketing_campaign',
    'sms_center_client','sms_center_staff','appointment_message',
    'appointment_notification','appointment_reminder','marketing_test',
    'no_show_recovery','post_visit_thank_you','service_rebooking',
    'new_client_second_visit','abandoned_booking','last_minute_empty_slot',
    'slow_day_campaign','loyal_client_reward'
  ));
