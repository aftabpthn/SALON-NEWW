ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pos_sales_operational
  ON pos_sales (tenant_id, branch_id, created_at DESC)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS pos_invoice_delete_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  invoice_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by_user_id TEXT NOT NULL,
  decided_by_user_id TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_invoice_delete_request_reason_required
    CHECK (CHAR_LENGTH(BTRIM(reason)) BETWEEN 3 AND 500),
  CONSTRAINT pos_invoice_delete_request_decision_actor
    CHECK (status = 'pending' OR (decided_by_user_id <> '' AND decided_at IS NOT NULL)),
  CONSTRAINT pos_invoice_delete_request_separation_of_duties
    CHECK (status = 'pending' OR requested_by_user_id <> decided_by_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_invoice_delete_request_pending
  ON pos_invoice_delete_requests (tenant_id, branch_id, sale_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pos_invoice_delete_requests_scope
  ON pos_invoice_delete_requests (tenant_id, branch_id, status, requested_at DESC);
