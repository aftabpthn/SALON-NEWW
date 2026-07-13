ALTER TABLE pos_invoice_action_history
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'recorded',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_action_history_idempotency
  ON pos_invoice_action_history (tenant_id, branch_id, sale_id, idempotency_key)
  WHERE idempotency_key <> '';

ALTER TABLE pos_invoice_action_history
  ADD CONSTRAINT pos_invoice_action_history_action_contract
  CHECK (action IN ('print', 'download', 'pdf', 'basic', 'send', 'resend', 'whatsapp', 'email')) NOT VALID;

ALTER TABLE pos_invoice_action_history
  ADD CONSTRAINT pos_invoice_action_history_status_contract
  CHECK (status IN ('recorded', 'queued', 'sent', 'failed')) NOT VALID;
