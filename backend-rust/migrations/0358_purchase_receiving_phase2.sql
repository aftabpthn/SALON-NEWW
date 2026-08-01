ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS excess_receiving_policy TEXT NOT NULL DEFAULT 'permission_required',
  ADD COLUMN IF NOT EXISTS price_difference_prompt BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS price_difference_threshold_bps INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policies_excess_receiving_valid') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policies_excess_receiving_valid
      CHECK (excess_receiving_policy IN ('block','permission_required'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policies_price_difference_valid') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policies_price_difference_valid
      CHECK (price_difference_threshold_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumable_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retail_received_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumable_received_quantity INTEGER NOT NULL DEFAULT 0;

UPDATE purchase_order_lines line
SET retail_quantity = CASE WHEN item.product_usage='consumable' THEN 0 ELSE line.quantity END,
    consumable_quantity = CASE WHEN item.product_usage='consumable' THEN line.quantity ELSE 0 END,
    retail_received_quantity = CASE WHEN item.product_usage='consumable' THEN 0 ELSE line.received_quantity END,
    consumable_received_quantity = CASE WHEN item.product_usage='consumable' THEN line.received_quantity ELSE 0 END
FROM inventory_items item
WHERE item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id
  AND line.retail_quantity=0 AND line.consumable_quantity=0;

ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_phase2_quantity_check;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_phase2_quantity_check CHECK (
  retail_quantity>=0 AND consumable_quantity>=0
  AND quantity=retail_quantity+consumable_quantity
  AND retail_received_quantity>=0 AND consumable_received_quantity>=0
  AND received_quantity=retail_received_quantity+consumable_received_quantity
  AND retail_received_quantity<=retail_quantity
  AND consumable_received_quantity<=consumable_quantity
);

ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS retail_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumable_quantity INTEGER NOT NULL DEFAULT 0;

UPDATE purchase_receipt_lines line
SET retail_quantity = CASE WHEN item.product_usage='consumable' THEN 0 ELSE line.quantity END,
    consumable_quantity = CASE WHEN item.product_usage='consumable' THEN line.quantity ELSE 0 END
FROM inventory_items item
WHERE item.id=line.inventory_item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id
  AND line.retail_quantity=0 AND line.consumable_quantity=0;

ALTER TABLE purchase_receipt_lines DROP CONSTRAINT IF EXISTS purchase_receipt_lines_phase2_quantity_check;
ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_phase2_quantity_check CHECK (
  retail_quantity>=0 AND consumable_quantity>=0 AND quantity=retail_quantity+consumable_quantity
);

ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS excess_approved_by TEXT;

CREATE TABLE IF NOT EXISTS purchase_price_update_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  purchase_receipt_line_id TEXT NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  current_unit_cost_paise BIGINT,
  requested_unit_cost_paise BIGINT NOT NULL CHECK (requested_unit_cost_paise>=0),
  requested_discount_bps INTEGER NOT NULL CHECK (requested_discount_bps BETWEEN 0 AND 10000),
  requested_gst_percent INTEGER NOT NULL CHECK (requested_gst_percent BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  UNIQUE(tenant_id,branch_id,purchase_receipt_line_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_price_update_requests_scope
  ON purchase_price_update_requests(tenant_id,branch_id,status,requested_at DESC);
