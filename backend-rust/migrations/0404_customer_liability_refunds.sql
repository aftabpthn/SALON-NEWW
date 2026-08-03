ALTER TABLE customer_liability_lifecycle_events
  DROP CONSTRAINT IF EXISTS customer_liability_lifecycle_events_action_check;

ALTER TABLE customer_liability_lifecycle_events
  ADD CONSTRAINT customer_liability_lifecycle_events_action_check
  CHECK (action IN ('freeze','resume','transfer','reload','refund'));
