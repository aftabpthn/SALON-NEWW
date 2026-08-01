ALTER TABLE inventory_policies
  DROP CONSTRAINT IF EXISTS inventory_policies_negative_stock_rule_check;
ALTER TABLE inventory_policies
  ADD CONSTRAINT inventory_policies_negative_stock_rule_check
  CHECK (negative_stock_rule IN ('block','approval_required','allow_with_warning'));
ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS auto_checkout_retail_sales BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_checkout_service_consumption BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS inventory_operational_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'manual_checkout','auto_retail_sale','auto_service_checkout','auto_transfer_checkout',
    'container_registered','container_opened','manual_consumption','conversion','reversal'
  )),
  source_bucket TEXT NOT NULL CHECK (source_bucket IN (
    'external','store_unopened','retail_available','consumable_available',
    'sealed_backbar_reserve','open_floor_balance','damaged_quarantine','in_transit','sold','consumed'
  )),
  destination_bucket TEXT NOT NULL CHECK (destination_bucket IN (
    'external','store_unopened','retail_available','consumable_available',
    'sealed_backbar_reserve','open_floor_balance','damaged_quarantine','in_transit','sold','consumed'
  )),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  stock_value_paise BIGINT NOT NULL CHECK (stock_value_paise >= 0),
  employee_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL CHECK (BTRIM(actor_user_id) <> ''),
  comment TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL CHECK (BTRIM(idempotency_key) <> ''),
  reversal_of_id TEXT REFERENCES inventory_operational_movements(id) ON DELETE RESTRICT,
  warning BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_bucket <> destination_bucket),
  CHECK (stock_value_paise = quantity::BIGINT * unit_cost_paise),
  UNIQUE (tenant_id,branch_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_operational_movements_item
  ON inventory_operational_movements(tenant_id,branch_id,inventory_item_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_operational_movements_history
  ON inventory_operational_movements(tenant_id,branch_id,action,created_at DESC,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_operational_movement_reversal
  ON inventory_operational_movements(tenant_id,branch_id,reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_inventory_operational_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'inventory operational movements are append-only; post a reversal'
    USING ERRCODE='55000';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inventory_operational_movements_append_only ON inventory_operational_movements;
CREATE TRIGGER inventory_operational_movements_append_only
BEFORE UPDATE OR DELETE ON inventory_operational_movements
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_operational_movement_mutation();

CREATE OR REPLACE FUNCTION enforce_dual_use_stock_reservation()
RETURNS TRIGGER AS $$
DECLARE
  sealed_quantity INTEGER;
  negative_rule TEXT;
BEGIN
  IF NEW.dual_use_stock THEN
    SELECT COALESCE(SUM(capacity_quantity),0)::INTEGER INTO sealed_quantity
    FROM inventory_backbar_containers
    WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
      AND inventory_item_id=NEW.id AND status='sealed';
    SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies
      WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id),'block') INTO negative_rule;
    IF NEW.stock_quantity < sealed_quantity AND negative_rule <> 'allow_with_warning' THEN
      RAISE EXCEPTION 'available stock cannot be lower than sealed backbar reserve'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_dual_use_container_reservation()
RETURNS TRIGGER AS $$
DECLARE
  is_dual_use BOOLEAN;
  total_unopened INTEGER;
  sealed_quantity INTEGER;
  negative_rule TEXT;
BEGIN
  IF NEW.status='sealed' THEN
    SELECT dual_use_stock,stock_quantity INTO is_dual_use,total_unopened
    FROM inventory_items
    WHERE id=NEW.inventory_item_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
    FOR UPDATE;
    IF is_dual_use THEN
      SELECT COALESCE(SUM(capacity_quantity),0)::INTEGER INTO sealed_quantity
      FROM inventory_backbar_containers
      WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
        AND inventory_item_id=NEW.inventory_item_id AND status='sealed' AND id<>NEW.id;
      SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies
        WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id),'block') INTO negative_rule;
      IF sealed_quantity + NEW.capacity_quantity > total_unopened AND negative_rule <> 'allow_with_warning' THEN
        RAISE EXCEPTION 'no available stock can be reserved for sealed backbar'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,created_by)
SELECT scope.tenant_id,scope.branch_id,'action_label',action.code,action.label,'migration'
FROM (SELECT DISTINCT tenant_id,branch_id FROM inventory_items) scope
CROSS JOIN (VALUES
  ('manual_checkout','Manual Checkout'),('auto_retail_sale','Automatic Retail Checkout'),
  ('auto_service_checkout','Automatic Service Checkout'),('auto_transfer_checkout','Automatic Transfer Checkout'),
  ('conversion','Retail Consumable Conversion'),('reversal','Operational Reversal')
) action(code,label)
ON CONFLICT DO NOTHING;
