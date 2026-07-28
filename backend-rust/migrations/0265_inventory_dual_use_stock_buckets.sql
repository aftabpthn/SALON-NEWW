ALTER TABLE inventory_items
  ADD COLUMN dual_use_stock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION enforce_dual_use_stock_reservation()
RETURNS TRIGGER AS $$
DECLARE
  sealed_quantity INTEGER;
BEGIN
  IF NEW.dual_use_stock THEN
    SELECT COUNT(*)::INTEGER INTO sealed_quantity
    FROM inventory_backbar_containers
    WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
      AND inventory_item_id=NEW.id AND status='sealed';
    IF NEW.stock_quantity < sealed_quantity THEN
      RAISE EXCEPTION 'retail stock cannot be lower than sealed backbar stock'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_dual_use_stock_guard ON inventory_items;
CREATE TRIGGER inventory_dual_use_stock_guard
BEFORE UPDATE OF stock_quantity, dual_use_stock ON inventory_items
FOR EACH ROW EXECUTE FUNCTION enforce_dual_use_stock_reservation();

CREATE OR REPLACE FUNCTION enforce_dual_use_container_reservation()
RETURNS TRIGGER AS $$
DECLARE
  is_dual_use BOOLEAN;
  total_unopened INTEGER;
  sealed_quantity INTEGER;
BEGIN
  IF NEW.status='sealed' THEN
    SELECT dual_use_stock,stock_quantity INTO is_dual_use,total_unopened
    FROM inventory_items
    WHERE id=NEW.inventory_item_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
    FOR UPDATE;
    IF is_dual_use THEN
      SELECT COUNT(*)::INTEGER INTO sealed_quantity
      FROM inventory_backbar_containers
      WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
        AND inventory_item_id=NEW.inventory_item_id AND status='sealed'
        AND id<>NEW.id;
      IF sealed_quantity >= total_unopened THEN
        RAISE EXCEPTION 'no retail stock is available to reserve for sealed backbar'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_dual_use_container_guard ON inventory_backbar_containers;
CREATE TRIGGER inventory_dual_use_container_guard
BEFORE INSERT OR UPDATE OF status, inventory_item_id ON inventory_backbar_containers
FOR EACH ROW EXECUTE FUNCTION enforce_dual_use_container_reservation();
