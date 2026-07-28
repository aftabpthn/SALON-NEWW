CREATE TABLE IF NOT EXISTS staff_service_targets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('staff','job_title')),
  assignment_label TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  target_count BIGINT NOT NULL CHECK (target_count > 0),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reward_type TEXT NOT NULL DEFAULT 'none' CHECK (reward_type IN ('none','bonus','gift','other')),
  reward_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (reward_amount_paise >= 0),
  reward_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_service_targets_active_window
  ON staff_service_targets(tenant_id,branch_id,staff_id,service_id,starts_on,ends_on)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_staff_service_targets_scope
  ON staff_service_targets(tenant_id,branch_id,staff_id,status,starts_on,ends_on);
