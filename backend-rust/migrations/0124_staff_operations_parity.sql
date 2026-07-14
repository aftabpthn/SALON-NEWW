CREATE TABLE IF NOT EXISTS staff_shift_swap_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL REFERENCES staff_schedules(id) ON DELETE CASCADE,
  from_staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  to_staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (from_staff_id <> to_staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_shift_swaps_scope
  ON staff_shift_swap_requests(tenant_id, branch_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_shift_swap_pending
  ON staff_shift_swap_requests(tenant_id, branch_id, schedule_id)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS staff_branch_transfer_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  source_branch_id TEXT NOT NULL,
  target_branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  transfer_type TEXT NOT NULL CHECK (transfer_type IN ('permanent','deputation')),
  valid_from DATE,
  valid_until DATE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (source_branch_id <> target_branch_id),
  CHECK (
    (transfer_type='permanent' AND valid_from IS NULL AND valid_until IS NULL)
    OR
    (transfer_type='deputation' AND valid_from IS NOT NULL AND valid_until >= valid_from)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_branch_transfers_scope
  ON staff_branch_transfer_requests(tenant_id, source_branch_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_branch_transfer_pending
  ON staff_branch_transfer_requests(tenant_id, staff_id)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS staff_skill_licenses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  license_number TEXT NOT NULL DEFAULT '',
  issued_on DATE,
  expires_on DATE,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','expired')),
  document_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS idx_staff_skill_licenses_scope
  ON staff_skill_licenses(tenant_id, branch_id, staff_id, expires_on, verification_status);

CREATE TABLE IF NOT EXISTS staff_performance_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  score INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  strengths TEXT NOT NULL DEFAULT '',
  improvement_areas TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  employee_comments TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared','acknowledged','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  shared_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_staff_performance_reviews_scope
  ON staff_performance_reviews(tenant_id, branch_id, staff_id, period_end DESC, status);
