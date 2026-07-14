CREATE TABLE IF NOT EXISTS staff_coaching_goals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL,
  metric_unit TEXT NOT NULL CHECK (metric_unit IN ('count','percent','minutes','paise')),
  target_value BIGINT NOT NULL CHECK (target_value > 0),
  current_value BIGINT CHECK (current_value IS NULL OR current_value >= 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_coaching_goals_scope
  ON staff_coaching_goals(tenant_id, branch_id, staff_id, status, due_date);

ALTER TABLE staff_tasks
  ADD COLUMN IF NOT EXISTS coaching_goal_id TEXT REFERENCES staff_coaching_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_tasks_coaching_goal
  ON staff_tasks(tenant_id, branch_id, coaching_goal_id)
  WHERE coaching_goal_id IS NOT NULL;
