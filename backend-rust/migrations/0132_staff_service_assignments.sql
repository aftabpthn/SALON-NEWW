CREATE TABLE IF NOT EXISTS staff_service_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_service_assignments_service
  ON staff_service_assignments (tenant_id, branch_id, service_id);

CREATE INDEX IF NOT EXISTS idx_staff_service_assignments_staff
  ON staff_service_assignments (tenant_id, branch_id, staff_id);
