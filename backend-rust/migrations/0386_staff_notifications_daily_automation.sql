ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_staff_event
  ON notifications(tenant_id,branch_id,user_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_staff_visible
  ON notifications(tenant_id,branch_id,user_id,created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE staff_notification_preferences
  ADD COLUMN IF NOT EXISTS working_day_only BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS web_push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS fcm_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS apns_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS muted_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS daily_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS daily_end_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS daily_start_time TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS daily_end_time TIME NOT NULL DEFAULT '20:00';

CREATE TABLE IF NOT EXISTS mobile_push_delivery_attempt_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES mobile_push_deliveries(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES staff_mobile_devices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(delivery_id,attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_attempt_staff_scope
  ON mobile_push_delivery_attempt_logs(tenant_id,branch_id,device_id,created_at DESC);
