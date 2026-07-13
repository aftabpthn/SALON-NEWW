CREATE TABLE IF NOT EXISTS pos_invoice_action_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_action_history_sale
  ON pos_invoice_action_history (tenant_id, branch_id, sale_id, created_at DESC);
