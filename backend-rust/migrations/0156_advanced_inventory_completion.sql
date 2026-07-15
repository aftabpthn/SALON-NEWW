ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS barcode TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS batch_tracked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_barcode
  ON inventory_items (tenant_id, branch_id, LOWER(BTRIM(barcode)))
  WHERE BTRIM(barcode) <> '';

ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS batch_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS batch_barcode TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  batch_number TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  expiry_date DATE,
  received_date DATE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, inventory_item_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry
  ON inventory_batches (tenant_id, branch_id, expiry_date, inventory_item_id)
  WHERE quantity > 0;

CREATE TABLE IF NOT EXISTS inventory_batch_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  stock_ledger_id TEXT NOT NULL REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, stock_ledger_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_movements_ledger
  ON inventory_batch_movements (tenant_id, branch_id, stock_ledger_id);

CREATE TABLE IF NOT EXISTS inventory_kit_components (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kit_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  component_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kit_inventory_item_id <> component_inventory_item_id),
  UNIQUE (tenant_id, branch_id, kit_inventory_item_id, component_inventory_item_id)
);

CREATE TABLE IF NOT EXISTS inventory_kit_assemblies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kit_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  idempotency_key TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS kit_assembly_id TEXT REFERENCES inventory_kit_assemblies(id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN (
    'sale', 'return', 'purchase', 'purchase_return',
    'transfer_out', 'transfer_in', 'transfer_reversal',
    'adjustment', 'consumption', 'kit_component_out', 'kit_assembly_in'
  )) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_kit_movement
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, kit_assembly_id, movement_type)
  WHERE kit_assembly_id IS NOT NULL;
