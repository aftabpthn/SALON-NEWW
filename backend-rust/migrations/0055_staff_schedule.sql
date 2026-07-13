CREATE TABLE IF NOT EXISTS staff_schedules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  shift1_start TIME,
  shift1_end TIME,
  shift2_start TIME,
  shift2_end TIME,
  status TEXT NOT NULL DEFAULT 'not_set' CHECK (status IN (
    'working','annual_leave','jury_duty','leave','sick_leave','special_leave',
    'weekly_off','working_other_center','not_set'
  )),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT staff_schedule_shift1_pair CHECK ((shift1_start IS NULL) = (shift1_end IS NULL)),
  CONSTRAINT staff_schedule_shift2_pair CHECK ((shift2_start IS NULL) = (shift2_end IS NULL)),
  CONSTRAINT staff_schedule_shift1_order CHECK (shift1_start IS NULL OR shift1_start < shift1_end),
  CONSTRAINT staff_schedule_shift2_order CHECK (shift2_start IS NULL OR shift2_start < shift2_end),
  UNIQUE (tenant_id, branch_id, staff_id, schedule_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedules_scope_date
  ON staff_schedules(tenant_id, branch_id, schedule_date, staff_id);

