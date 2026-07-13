ALTER TABLE pos_invoice_refunds
  ADD COLUMN IF NOT EXISTS credit_note_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_credit_notes
  ADD COLUMN IF NOT EXISTS refund_id TEXT REFERENCES pos_invoice_refunds(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_credit_notes_refund
  ON pos_credit_notes (tenant_id, branch_id, refund_id)
  WHERE refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_gateway_refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL REFERENCES pos_invoice_refunds(id) ON DELETE CASCADE,
  pos_payment_id TEXT NOT NULL REFERENCES pos_payments(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  provider_refund_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  idempotency_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pos_gateway_refunds_payment
  ON pos_gateway_refunds (tenant_id, branch_id, pos_payment_id, created_at DESC);
