ALTER TABLE inventory_stock_ledger
  ADD COLUMN IF NOT EXISTS reversal_of_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reversed_by_user_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stock_ledger_reversal
  ON inventory_stock_ledger (tenant_id, branch_id, reversal_of_ledger_id)
  WHERE reversal_of_ledger_id IS NOT NULL;

ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rolled_back_by TEXT NOT NULL DEFAULT '';

ALTER TABLE purchase_receipts
  DROP CONSTRAINT IF EXISTS purchase_receipts_tenant_id_branch_id_supplier_gstin_suppli_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_receipts_active_supplier_invoice
  ON purchase_receipts (tenant_id, branch_id, supplier_gstin, supplier_invoice_number)
  WHERE rolled_back_at IS NULL;

DROP INDEX IF EXISTS idx_pos_invoice_unique;
CREATE UNIQUE INDEX idx_pos_invoice_unique
  ON pos_sales (tenant_id, branch_id, invoice_number)
  WHERE is_deleted = FALSE;

CREATE OR REPLACE FUNCTION reverse_inventory_stock_ledger(
  p_tenant_id TEXT,
  p_branch_id TEXT,
  p_ledger_id TEXT,
  p_actor_user_id TEXT,
  p_reason TEXT
) RETURNS TEXT AS $$
DECLARE
  source inventory_stock_ledger%ROWTYPE;
  existing_reversal_id TEXT;
  reversal_id TEXT;
  stock_after INTEGER;
BEGIN
  SELECT * INTO source
  FROM inventory_stock_ledger
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND id = p_ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory ledger movement was not found' USING ERRCODE = 'P0002';
  END IF;
  IF source.reversal_of_ledger_id IS NOT NULL THEN
    RAISE EXCEPTION 'a reversal movement cannot be reversed' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO existing_reversal_id
  FROM inventory_stock_ledger
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND reversal_of_ledger_id = p_ledger_id;
  IF existing_reversal_id IS NOT NULL THEN
    RETURN existing_reversal_id;
  END IF;

  UPDATE inventory_items
  SET stock_quantity = stock_quantity - source.quantity_delta,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND id = source.inventory_item_id
  RETURNING stock_quantity INTO stock_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item for ledger movement was not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO inventory_stock_ledger (
    tenant_id, branch_id, inventory_item_id, movement_type,
    quantity_delta, unit_cost_paise, stock_after_quantity,
    adjustment_reason, reversal_of_ledger_id, reversal_reason, reversed_by_user_id
  ) VALUES (
    p_tenant_id, p_branch_id, source.inventory_item_id, 'adjustment',
    -source.quantity_delta, source.unit_cost_paise, stock_after,
    CONCAT(p_reason, ' [reversal of ', source.id, ']'),
    source.id, p_reason, p_actor_user_id
  ) RETURNING id INTO reversal_id;

  RETURN reversal_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_inventory_stock_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory stock ledger is append-only; post a reversal instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_stock_ledger_append_only ON inventory_stock_ledger;
CREATE TRIGGER inventory_stock_ledger_append_only
BEFORE UPDATE OR DELETE ON inventory_stock_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_stock_ledger_mutation();
