CREATE TABLE IF NOT EXISTS staff_self_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  manager_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_self_feedback_scope
  ON staff_self_feedback(tenant_id, branch_id, staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_self_feedback_status
  ON staff_self_feedback(tenant_id, branch_id, status, created_at DESC);
