CREATE TABLE IF NOT EXISTS pos_invoice_correction_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  original_snapshot JSONB NOT NULL,
  proposed_lines JSONB NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  decided_by_user_id TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_invoice_correction_pending
  ON pos_invoice_correction_requests (tenant_id, branch_id, sale_id)
  WHERE status='pending';

CREATE INDEX IF NOT EXISTS idx_pos_invoice_correction_scope
  ON pos_invoice_correction_requests (tenant_id, branch_id, status, requested_at DESC);
