CREATE TABLE IF NOT EXISTS pos_client_due_receipts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  method TEXT NOT NULL,
  method_reference TEXT NOT NULL DEFAULT '',
  requested_paise BIGINT NOT NULL,
  received_paise BIGINT NOT NULL DEFAULT 0,
  unpaid_before_paise BIGINT NOT NULL DEFAULT 0,
  unpaid_after_paise BIGINT NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  allocations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_client_due_receipts_amount_positive CHECK (requested_paise > 0),
  CONSTRAINT pos_client_due_receipts_received_non_negative CHECK (received_paise >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_client_due_receipts_idempotency
  ON pos_client_due_receipts (tenant_id, branch_id, client_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_pos_client_due_receipts_client_created
  ON pos_client_due_receipts (tenant_id, branch_id, client_id, created_at DESC);
