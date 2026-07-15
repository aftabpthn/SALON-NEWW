ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS stock_after_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_idempotency_key TEXT;

ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN ('sale', 'return', 'purchase', 'transfer_out', 'transfer_in', 'transfer_reversal', 'adjustment')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_adjustment_key
  ON inventory_stock_ledger (tenant_id, branch_id, adjustment_idempotency_key)
  WHERE adjustment_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_item
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, created_at DESC);
