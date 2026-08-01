CREATE TABLE IF NOT EXISTS inventory_transfer_center_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  center_role TEXT NOT NULL DEFAULT 'branch'
    CHECK (center_role IN ('branch','warehouse','franchise')),
  default_retail_warehouse_branch_id TEXT,
  default_consumable_warehouse_branch_id TEXT,
  auto_checkout_transfers BOOLEAN NOT NULL DEFAULT FALSE,
  cannot_raise_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id),
  CHECK (default_retail_warehouse_branch_id IS NULL OR default_retail_warehouse_branch_id<>branch_id),
  CHECK (default_consumable_warehouse_branch_id IS NULL OR default_consumable_warehouse_branch_id<>branch_id)
);

ALTER TABLE inventory_transfers
  ADD COLUMN IF NOT EXISTS transfer_number TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS parent_transfer_id TEXT REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS return_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS raised_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS raised_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT NOT NULL DEFAULT '';

UPDATE inventory_transfers
SET transfer_number=COALESCE(NULLIF(transfer_number,''),'TO-LEGACY-'||UPPER(SUBSTRING(id,1,8))),
    created_by_user_id=COALESCE(NULLIF(created_by_user_id,''),dispatched_by_user_id);

ALTER TABLE inventory_transfers ALTER COLUMN transfer_number SET NOT NULL;
ALTER TABLE inventory_transfers ALTER COLUMN created_by_user_id SET NOT NULL;
ALTER TABLE inventory_transfers ALTER COLUMN dispatched_by_user_id DROP NOT NULL;
ALTER TABLE inventory_transfers ALTER COLUMN dispatched_at DROP NOT NULL;
ALTER TABLE inventory_transfers DROP CONSTRAINT IF EXISTS inventory_transfers_status_check;
ALTER TABLE inventory_transfers ADD CONSTRAINT inventory_transfers_status_check CHECK (
  status IN ('draft','raised','approved','dispatched','in_transit','partially_received','received','cancelled','rejected')
);
ALTER TABLE inventory_transfers DROP CONSTRAINT IF EXISTS inventory_transfers_mode_check;
ALTER TABLE inventory_transfers ADD CONSTRAINT inventory_transfers_mode_check CHECK (
  mode IN ('push','pull','franchise_purchase','return')
);
ALTER TABLE inventory_transfers DROP CONSTRAINT IF EXISTS inventory_transfers_return_reason_check;
ALTER TABLE inventory_transfers ADD CONSTRAINT inventory_transfers_return_reason_check CHECK (
  (mode='return' AND return_reason IN ('damaged','expired','mismatch','other'))
  OR (mode<>'return' AND return_reason='')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transfers_number
  ON inventory_transfers(tenant_id,transfer_number);

ALTER TABLE inventory_transfer_lines
  ADD COLUMN IF NOT EXISTS retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumable_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_consumable_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_consumable_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_consumable_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expired_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_unit_price_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_percent INTEGER NOT NULL DEFAULT 0;

UPDATE inventory_transfer_lines line
SET retail_quantity=CASE WHEN item.product_usage='consumable' THEN 0 ELSE line.quantity END,
    consumable_quantity=CASE WHEN item.product_usage='consumable' THEN line.quantity ELSE 0 END,
    dispatched_retail_quantity=CASE WHEN transfer.status IN ('in_transit','received','cancelled') AND item.product_usage<>'consumable' THEN line.quantity ELSE 0 END,
    dispatched_consumable_quantity=CASE WHEN transfer.status IN ('in_transit','received','cancelled') AND item.product_usage='consumable' THEN line.quantity ELSE 0 END,
    received_retail_quantity=CASE WHEN transfer.status='received' AND item.product_usage<>'consumable' THEN line.quantity ELSE 0 END,
    received_consumable_quantity=CASE WHEN transfer.status='received' AND item.product_usage='consumable' THEN line.quantity ELSE 0 END,
    transfer_unit_price_paise=CASE WHEN line.transfer_unit_price_paise=0 THEN line.unit_cost_paise ELSE line.transfer_unit_price_paise END
FROM inventory_items item,inventory_transfers transfer
WHERE item.id=line.source_inventory_item_id AND item.tenant_id=line.tenant_id
  AND transfer.id=line.transfer_id AND transfer.tenant_id=line.tenant_id
  AND line.retail_quantity=0 AND line.consumable_quantity=0;

ALTER TABLE inventory_transfer_lines DROP CONSTRAINT IF EXISTS inventory_transfer_lines_phase3_progress_check;
ALTER TABLE inventory_transfer_lines ADD CONSTRAINT inventory_transfer_lines_phase3_progress_check CHECK (
  retail_quantity>=0 AND consumable_quantity>=0 AND quantity=retail_quantity+consumable_quantity
  AND reserved_retail_quantity>=0 AND reserved_consumable_quantity>=0
  AND dispatched_retail_quantity>=0 AND dispatched_consumable_quantity>=0
  AND received_retail_quantity>=0 AND received_consumable_quantity>=0
  AND damaged_quantity>=0 AND expired_quantity>=0 AND short_quantity>=0
  AND reserved_retail_quantity+dispatched_retail_quantity<=retail_quantity
  AND reserved_consumable_quantity+dispatched_consumable_quantity<=consumable_quantity
  AND received_retail_quantity+received_consumable_quantity+damaged_quantity+expired_quantity+short_quantity
      <=dispatched_retail_quantity+dispatched_consumable_quantity
  AND transfer_unit_price_paise>=0 AND discount_bps BETWEEN 0 AND 10000 AND gst_percent BETWEEN 0 AND 100
);

CREATE TABLE IF NOT EXISTS inventory_transfer_shipments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
  shipment_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dispatched'
    CHECK (status IN ('dispatched','in_transit','received','cancelled')),
  shipping_paise BIGINT NOT NULL DEFAULT 0 CHECK (shipping_paise>=0),
  handling_paise BIGINT NOT NULL DEFAULT 0 CHECK (handling_paise>=0),
  other_charges_paise BIGINT NOT NULL DEFAULT 0 CHECK (other_charges_paise>=0),
  auto_checkout_applied BOOLEAN NOT NULL DEFAULT FALSE,
  dispatched_by_user_id TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_by_user_id TEXT,
  shipped_at TIMESTAMPTZ,
  received_by_user_id TEXT,
  received_at TIMESTAMPTZ,
  receipt_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,transfer_id,shipment_number)
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_shipments_scope
  ON inventory_transfer_shipments(tenant_id,transfer_id,created_at);

CREATE TABLE IF NOT EXISTS inventory_transfer_shipment_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES inventory_transfer_shipments(id) ON DELETE RESTRICT,
  transfer_line_id TEXT NOT NULL REFERENCES inventory_transfer_lines(id) ON DELETE RESTRICT,
  dispatched_retail_quantity INTEGER NOT NULL DEFAULT 0 CHECK (dispatched_retail_quantity>=0),
  dispatched_consumable_quantity INTEGER NOT NULL DEFAULT 0 CHECK (dispatched_consumable_quantity>=0),
  received_retail_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_retail_quantity>=0),
  received_consumable_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_consumable_quantity>=0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity>=0),
  expired_quantity INTEGER NOT NULL DEFAULT 0 CHECK (expired_quantity>=0),
  short_quantity INTEGER NOT NULL DEFAULT 0 CHECK (short_quantity>=0),
  variance_reason TEXT NOT NULL DEFAULT '',
  source_unit_cost_paise BIGINT NOT NULL CHECK (source_unit_cost_paise>=0),
  transfer_unit_price_paise BIGINT NOT NULL CHECK (transfer_unit_price_paise>=0),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  gst_percent INTEGER NOT NULL CHECK (gst_percent BETWEEN 0 AND 100),
  taxable_paise BIGINT NOT NULL DEFAULT 0 CHECK (taxable_paise>=0),
  cgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (cgst_paise>=0),
  sgst_paise BIGINT NOT NULL DEFAULT 0 CHECK (sgst_paise>=0),
  igst_paise BIGINT NOT NULL DEFAULT 0 CHECK (igst_paise>=0),
  landed_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (landed_cost_paise>=0),
  landed_unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (landed_unit_cost_paise>=0),
  source_stock_ledger_id TEXT,
  destination_stock_ledger_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,shipment_id,transfer_line_id),
  CHECK (dispatched_retail_quantity+dispatched_consumable_quantity>0),
  CHECK (received_retail_quantity+received_consumable_quantity+damaged_quantity+expired_quantity+short_quantity
         <=dispatched_retail_quantity+dispatched_consumable_quantity)
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_shipment_lines_scope
  ON inventory_transfer_shipment_lines(tenant_id,shipment_id,transfer_line_id);

CREATE TABLE IF NOT EXISTS inventory_transfer_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_events_scope
  ON inventory_transfer_events(tenant_id,transfer_id,created_at,id);

ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS inventory_transfer_shipment_id TEXT REFERENCES inventory_transfer_shipments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS inventory_transfer_shipment_line_id TEXT REFERENCES inventory_transfer_shipment_lines(id) ON DELETE RESTRICT;
DROP INDEX IF EXISTS uq_inventory_stock_ledger_transfer_line;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_transfer_line_legacy
  ON inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,inventory_transfer_line_id,movement_type)
  WHERE inventory_transfer_line_id IS NOT NULL AND inventory_transfer_shipment_line_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_transfer_shipment_line
  ON inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,inventory_transfer_shipment_line_id,movement_type)
  WHERE inventory_transfer_shipment_line_id IS NOT NULL;
