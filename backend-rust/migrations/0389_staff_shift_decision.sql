ALTER TABLE staff_shift_swap_requests
  ADD COLUMN IF NOT EXISTS target_decision TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS target_decision_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_decided_by TEXT,
  ADD COLUMN IF NOT EXISTS target_decided_at TIMESTAMPTZ;

ALTER TABLE staff_shift_swap_requests
  DROP CONSTRAINT IF EXISTS staff_shift_swap_requests_target_decision_check;
ALTER TABLE staff_shift_swap_requests
  ADD CONSTRAINT staff_shift_swap_requests_target_decision_check
  CHECK (target_decision IN ('pending','accepted','rejected'));

CREATE INDEX IF NOT EXISTS idx_staff_shift_swap_target_inbox
  ON staff_shift_swap_requests(tenant_id,branch_id,to_staff_id,target_decision,created_at DESC);
