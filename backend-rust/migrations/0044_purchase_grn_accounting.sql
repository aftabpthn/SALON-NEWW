CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_gstin TEXT NOT NULL DEFAULT '',
  supplier_state_code TEXT NOT NULL DEFAULT '',
  supplier_invoice_number TEXT NOT NULL,
  received_date DATE NOT NULL,
  taxable_paise BIGINT NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise BIGINT NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key),
  UNIQUE (tenant_id, branch_id, supplier_gstin, supplier_invoice_number),
  CHECK (cgst_paise + sgst_paise + igst_paise + taxable_paise = total_paise)
);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  gst_percent INTEGER NOT NULL CHECK (gst_percent BETWEEN 0 AND 100),
  taxable_paise BIGINT NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise BIGINT NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_receipt_id, inventory_item_id),
  CHECK (cgst_paise + sgst_paise + igst_paise + taxable_paise = total_paise)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_branch_date
  ON purchase_receipts (tenant_id, branch_id, received_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_receipt
  ON purchase_receipt_lines (tenant_id, branch_id, purchase_receipt_id);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS purchase_receipt_id TEXT REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_receipt_line_id TEXT REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_ledger ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE inventory_stock_ledger ALTER COLUMN sale_line_id DROP NOT NULL;
ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN ('sale', 'return', 'purchase')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_purchase_line
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, purchase_receipt_line_id, movement_type)
  WHERE purchase_receipt_line_id IS NOT NULL;
