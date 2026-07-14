CREATE TABLE IF NOT EXISTS staff_categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_staff_categories_scope
  ON staff_categories(tenant_id, branch_id, active, name);

CREATE TABLE IF NOT EXISTS staff_shift_templates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  shift1_start TIME NOT NULL,
  shift1_end TIME NOT NULL,
  shift2_start TIME,
  shift2_end TIME,
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  weekly_off_days SMALLINT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT staff_shift_template_shift1_order CHECK (shift1_start < shift1_end),
  CONSTRAINT staff_shift_template_shift2_pair CHECK ((shift2_start IS NULL) = (shift2_end IS NULL)),
  CONSTRAINT staff_shift_template_shift2_order CHECK (shift2_start IS NULL OR shift2_start < shift2_end),
  CONSTRAINT staff_shift_template_weekdays CHECK (weekly_off_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_staff_shift_templates_scope
  ON staff_shift_templates(tenant_id, branch_id, active, name);

CREATE TABLE IF NOT EXISTS staff_attendance_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  half_day_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (half_day_after_minutes >= 0),
  absent_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (absent_after_minutes >= 0),
  overtime_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_after_minutes >= 0),
  early_leave_grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_leave_grace_minutes >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES staff_categories(id),
  ADD COLUMN IF NOT EXISTS shift_template_id TEXT REFERENCES staff_shift_templates(id);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_master_assignments
  ON staff_profiles(tenant_id, branch_id, category_id, shift_template_id);
