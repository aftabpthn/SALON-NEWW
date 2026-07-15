ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'recorded',
  ADD COLUMN IF NOT EXISTS max_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wastage_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_threshold_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_status_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_status_check
  CHECK (status IN ('recorded', 'pending_approval', 'rejected')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_pending
  ON inventory_backbar_usage (tenant_id, branch_id, created_at DESC)
  WHERE status = 'pending_approval';
