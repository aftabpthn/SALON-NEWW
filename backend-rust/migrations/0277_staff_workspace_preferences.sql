CREATE TABLE IF NOT EXISTS staff_workspace_preferences (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  workspace_name TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  locale TEXT NOT NULL DEFAULT 'en-IN',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  time_format TEXT NOT NULL DEFAULT 'HH:mm',
  compact_mode BOOLEAN NOT NULL DEFAULT FALSE,
  staff_hints BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, branch_id, staff_id)
);
