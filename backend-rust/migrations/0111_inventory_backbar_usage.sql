CREATE TABLE IF NOT EXISTS inventory_backbar_usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  service_id TEXT REFERENCES services(id) ON DELETE RESTRICT,
  staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  unit TEXT NOT NULL,
  expected_quantity INTEGER NOT NULL DEFAULT 0 CHECK (expected_quantity >= 0),
  actual_quantity INTEGER NOT NULL CHECK (actual_quantity > 0),
  notes TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_date
  ON inventory_backbar_usage (tenant_id, branch_id, created_at DESC);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS backbar_usage_id TEXT REFERENCES inventory_backbar_usage(id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN ('sale', 'return', 'purchase', 'transfer_out', 'transfer_in', 'transfer_reversal', 'adjustment', 'consumption')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_backbar_usage
  ON inventory_stock_ledger (tenant_id, branch_id, backbar_usage_id)
  WHERE backbar_usage_id IS NOT NULL;
