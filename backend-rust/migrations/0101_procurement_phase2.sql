CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  gstin TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_scope
  ON suppliers (tenant_id, branch_id, active, name);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','partially_received','received','cancelled')),
  expected_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  taxable_paise BIGINT NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  tax_paise BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise BIGINT NOT NULL DEFAULT 0 CHECK (total_paise = taxable_paise + tax_paise),
  created_by TEXT NOT NULL,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_scope
  ON purchase_orders (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  gst_percent INTEGER NOT NULL DEFAULT 0 CHECK (gst_percent BETWEEN 0 AND 100),
  taxable_paise BIGINT NOT NULL CHECK (taxable_paise >= 0),
  tax_paise BIGINT NOT NULL CHECK (tax_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise = taxable_paise + tax_paise),
  UNIQUE (purchase_order_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order
  ON purchase_order_lines (tenant_id, branch_id, purchase_order_id);

ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_supplier_due
  ON purchase_receipts (tenant_id, branch_id, supplier_id, due_date);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  taxable_paise BIGINT NOT NULL CHECK (taxable_paise > 0),
  tax_paise BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise = taxable_paise + tax_paise),
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  purchase_receipt_line_id TEXT NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  taxable_paise BIGINT NOT NULL CHECK (taxable_paise > 0),
  tax_paise BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise = taxable_paise + tax_paise)
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_receipt
  ON purchase_returns (tenant_id, branch_id, purchase_receipt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','upi','card','other')),
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_receipt
  ON supplier_payments (tenant_id, branch_id, purchase_receipt_id, paid_at DESC);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS purchase_return_id TEXT REFERENCES purchase_returns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_return_line_id TEXT REFERENCES purchase_return_lines(id) ON DELETE RESTRICT;

ALTER TABLE inventory_stock_ledger DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN ('sale','return','purchase','transfer_out','transfer_in','transfer_reversal','adjustment','purchase_return')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_purchase_return_line
  ON inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, purchase_return_line_id, movement_type)
  WHERE purchase_return_line_id IS NOT NULL;
