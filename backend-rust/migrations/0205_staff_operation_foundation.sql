CREATE TABLE IF NOT EXISTS staff_operation_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'opening_checklist',
      'closing_checklist',
      'tool_sanitization',
      'stock_linen_check',
      'cleaning_task',
      'staff_meeting',
      'performance_review',
      'training_session',
      'deep_cleaning',
      'hygiene_audit',
      'custom'
    )
  ),
  frequency TEXT NOT NULL DEFAULT 'custom'
    CHECK (frequency IN ('daily','weekly','fortnightly','monthly','custom')),
  checklist_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (JSONB_TYPEOF(checklist_json) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_staff_operation_templates_scope
  ON staff_operation_templates(tenant_id, branch_id, active, operation_type, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_operation_templates_name
  ON staff_operation_templates(tenant_id, branch_id, LOWER(name));

CREATE TABLE IF NOT EXISTS staff_operation_schedules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  template_id TEXT REFERENCES staff_operation_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'opening_checklist',
      'closing_checklist',
      'tool_sanitization',
      'stock_linen_check',
      'cleaning_task',
      'staff_meeting',
      'performance_review',
      'training_session',
      'deep_cleaning',
      'hygiene_audit',
      'custom'
    )
  ),
  frequency TEXT NOT NULL DEFAULT 'custom'
    CHECK (frequency IN ('daily','weekly','fortnightly','monthly','custom')),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  assigned_staff_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  owner_user_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','missed','cancelled')),
  checklist_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (JSONB_TYPEOF(assigned_staff_ids) = 'array'),
  CHECK (JSONB_TYPEOF(checklist_json) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_staff_operation_schedules_scope
  ON staff_operation_schedules(tenant_id, branch_id, scheduled_date, status);

CREATE INDEX IF NOT EXISTS idx_staff_operation_schedules_type
  ON staff_operation_schedules(tenant_id, branch_id, operation_type, scheduled_date DESC);

CREATE TABLE IF NOT EXISTS staff_operation_tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES staff_operation_schedules(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  task_title TEXT NOT NULL CHECK (BTRIM(task_title) <> ''),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','missed','cancelled','approved','rejected')),
  proof_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_operation_tasks_operation
  ON staff_operation_tasks(tenant_id, branch_id, operation_id, status);

CREATE INDEX IF NOT EXISTS idx_staff_operation_tasks_staff
  ON staff_operation_tasks(tenant_id, branch_id, staff_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_operation_attendance (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES staff_operation_schedules(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','present','absent','late','excused')),
  recorded_by TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, operation_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_operation_attendance_operation
  ON staff_operation_attendance(tenant_id, branch_id, operation_id, status);

CREATE INDEX IF NOT EXISTS idx_staff_operation_attendance_staff
  ON staff_operation_attendance(tenant_id, branch_id, staff_id, recorded_at DESC);
