CREATE TABLE IF NOT EXISTS multi_branch_approvals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish_central_masters')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_multi_branch_pending_action
  ON multi_branch_approvals (tenant_id, action)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_multi_branch_approval_queue
  ON multi_branch_approvals (tenant_id, status, created_at DESC);
