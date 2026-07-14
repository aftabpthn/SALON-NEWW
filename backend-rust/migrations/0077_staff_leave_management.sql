CREATE TABLE IF NOT EXISTS staff_leave_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','casual','special','unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(reason) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(review_note) <= 500),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_requests_scope_status
  ON staff_leave_requests(tenant_id, branch_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_staff_leave_requests_staff_period
  ON staff_leave_requests(tenant_id, branch_id, staff_id, start_date, end_date);
