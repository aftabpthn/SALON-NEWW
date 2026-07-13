CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  source_branch_id TEXT NOT NULL,
  destination_branch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  dispatched_by_user_id TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by_user_id TEXT,
  received_at TIMESTAMPTZ,
  cancelled_by_user_id TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_branch_id <> destination_branch_id),
  UNIQUE (tenant_id, source_branch_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
  source_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  destination_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_id, source_inventory_item_id),
  UNIQUE (transfer_id, destination_inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_source
  ON inventory_transfers (tenant_id, source_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_destination
  ON inventory_transfers (tenant_id, destination_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_lines_transfer
  ON inventory_transfer_lines (tenant_id, transfer_id);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS inventory_transfer_id TEXT REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_transfer_line_id TEXT REFERENCES inventory_transfer_lines(id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN ('sale', 'return', 'purchase', 'transfer_out', 'transfer_in', 'transfer_reversal')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_transfer_line
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, inventory_transfer_line_id, movement_type)
  WHERE inventory_transfer_line_id IS NOT NULL;
