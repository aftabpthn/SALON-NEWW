ALTER TABLE staff_notification_queue
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  ADD COLUMN IF NOT EXISTS max_delivery_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_delivery_attempts > 0),
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_staff_notification_queue_retry
  ON staff_notification_queue(tenant_id, branch_id, status, next_attempt_at, created_at)
  WHERE status IN ('queued','approved','failed');
