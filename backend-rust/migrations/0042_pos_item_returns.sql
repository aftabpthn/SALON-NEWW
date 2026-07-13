CREATE TABLE IF NOT EXISTS pos_invoice_refund_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  refund_id TEXT NOT NULL REFERENCES pos_invoice_refunds(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  sale_line_id TEXT NOT NULL REFERENCES pos_sale_lines(id),
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  restock_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (refund_id, sale_line_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_refund_lines_sale_line
  ON pos_invoice_refund_lines (tenant_id, branch_id, sale_id, sale_line_id);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS refund_id TEXT REFERENCES pos_invoice_refunds(id) ON DELETE CASCADE;

ALTER TABLE inventory_stock_ledger
  DROP CONSTRAINT IF EXISTS inventory_stock_ledger_tenant_id_branch_id_inventory_item_id_sale_line_id_movement_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_ledger_sale_once
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_line_id)
  WHERE movement_type = 'sale';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_ledger_return_once
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_line_id, refund_id)
  WHERE movement_type = 'return';
