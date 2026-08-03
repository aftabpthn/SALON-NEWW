ALTER TABLE inventory_kit_assemblies
  ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'bundle',
  ADD COLUMN IF NOT EXISTS comments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_receipt_id TEXT,
  ADD COLUMN IF NOT EXISTS source_receipt_line_id TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_after_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory_kit_assemblies
  DROP CONSTRAINT IF EXISTS inventory_kit_assemblies_operation_type_check;
ALTER TABLE inventory_kit_assemblies
  ADD CONSTRAINT inventory_kit_assemblies_operation_type_check
  CHECK (operation_type IN ('bundle', 'unbundle', 'receipt_unbundle'));

UPDATE inventory_kit_assemblies operation
SET unit_cost_paise=ledger.unit_cost_paise,
    stock_after_quantity=ledger.stock_after_quantity
FROM inventory_stock_ledger ledger
WHERE ledger.kit_assembly_id=operation.id
  AND ledger.inventory_item_id=operation.kit_inventory_item_id
  AND ledger.movement_type='kit_assembly_in'
  AND operation.operation_type='bundle';

CREATE INDEX IF NOT EXISTS idx_inventory_kit_history
  ON inventory_kit_assemblies(tenant_id, branch_id, kit_inventory_item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_kit_receipt_unbundle
  ON inventory_kit_assemblies(tenant_id, branch_id, source_receipt_line_id)
  WHERE operation_type='receipt_unbundle' AND source_receipt_line_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_kit_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  kit_inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  auto_unbundle_on_receive BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, kit_inventory_item_id)
);

CREATE OR REPLACE FUNCTION validate_inventory_kit_component_type()
RETURNS TRIGGER AS $$
DECLARE
  v_kit_usage TEXT;
  v_component_usage TEXT;
BEGIN
  SELECT product_usage INTO v_kit_usage FROM inventory_items
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND id=NEW.kit_inventory_item_id;
  SELECT product_usage INTO v_component_usage FROM inventory_items
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND id=NEW.component_inventory_item_id;
  IF v_kit_usage NOT IN ('retail','consumable')
     OR v_component_usage NOT IN (v_kit_usage,'dual_use') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='KIT_PRODUCT_TYPE_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM inventory_kit_components
    WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
      AND kit_inventory_item_id=NEW.component_inventory_item_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='NESTED_PRODUCT_KIT_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM inventory_kit_components
    WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
      AND component_inventory_item_id=NEW.kit_inventory_item_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='NESTED_PRODUCT_KIT_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_kit_component_type ON inventory_kit_components;
CREATE TRIGGER trg_inventory_kit_component_type
BEFORE INSERT OR UPDATE ON inventory_kit_components
FOR EACH ROW EXECUTE FUNCTION validate_inventory_kit_component_type();

CREATE OR REPLACE FUNCTION protect_inventory_kit_product_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_usage IS DISTINCT FROM OLD.product_usage AND EXISTS (
    SELECT 1 FROM inventory_kit_components component
    JOIN inventory_items kit ON kit.tenant_id=component.tenant_id
      AND kit.branch_id=component.branch_id AND kit.id=component.kit_inventory_item_id
    JOIN inventory_items product ON product.tenant_id=component.tenant_id
      AND product.branch_id=component.branch_id AND product.id=component.component_inventory_item_id
    WHERE component.tenant_id=NEW.tenant_id AND component.branch_id=NEW.branch_id
      AND (component.kit_inventory_item_id=NEW.id OR component.component_inventory_item_id=NEW.id)
      AND (kit.product_usage NOT IN ('retail','consumable')
        OR product.product_usage NOT IN (kit.product_usage,'dual_use'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='KIT_PRODUCT_TYPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_kit_product_type ON inventory_items;
CREATE CONSTRAINT TRIGGER trg_inventory_kit_product_type
AFTER UPDATE OF product_usage ON inventory_items
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION protect_inventory_kit_product_type();

ALTER TABLE inventory_stock_ledger
  DROP CONSTRAINT IF EXISTS inventory_stock_ledger_movement_type_check;
ALTER TABLE inventory_stock_ledger
  ADD CONSTRAINT inventory_stock_ledger_movement_type_check
  CHECK (movement_type IN (
    'sale', 'return', 'purchase', 'purchase_return',
    'transfer_out', 'transfer_in', 'transfer_reversal',
    'adjustment', 'consumption', 'kit_component_out', 'kit_assembly_in',
    'kit_unbundle_out', 'kit_component_in', 'opening_snapshot'
  )) NOT VALID;
