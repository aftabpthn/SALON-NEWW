CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  sale_line_id TEXT NOT NULL REFERENCES pos_sale_lines(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'return')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_paise BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, inventory_item_id, sale_line_id, movement_type)
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_sale
  ON inventory_stock_ledger (tenant_id, branch_id, sale_id, created_at DESC);
