CREATE TABLE IF NOT EXISTS staff_tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT 'general' CHECK (task_type IN ('general','training','follow_up','compliance','performance')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','completed','cancelled')),
  assigned_by TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_tasks_scope
  ON staff_tasks(tenant_id, branch_id, status, due_at, staff_id);

CREATE TABLE IF NOT EXISTS staff_task_comments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES staff_tasks(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL DEFAULT '',
  comment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_task_comments_scope
  ON staff_task_comments(tenant_id, branch_id, task_id, created_at);
