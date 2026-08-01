CREATE TABLE IF NOT EXISTS inventory_color_bowls (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_color_bowls_client
  ON inventory_color_bowls (tenant_id, branch_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_color_bowls_appointment
  ON inventory_color_bowls (tenant_id, branch_id, appointment_id, created_at DESC);

ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS bowl_id TEXT REFERENCES inventory_color_bowls(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS bowl_line_no INTEGER NOT NULL DEFAULT 0 CHECK (bowl_line_no >= 0),
  ADD COLUMN IF NOT EXISTS component_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS container_id TEXT REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS unit_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0);

UPDATE inventory_backbar_usage usage
SET unit_cost_paise = item.unit_cost_paise
FROM inventory_items item
WHERE usage.inventory_item_id = item.id
  AND usage.tenant_id = item.tenant_id
  AND usage.branch_id = item.branch_id
  AND usage.unit_cost_paise = 0;

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_component_type_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_component_type_check
  CHECK (component_type IN ('base','fashion','developer','other')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_bowl
  ON inventory_backbar_usage (tenant_id, branch_id, bowl_id, bowl_line_no)
  WHERE bowl_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_dual_use_stock_reservation()
RETURNS TRIGGER AS $$
DECLARE
  sealed_quantity INTEGER;
BEGIN
  IF NEW.dual_use_stock THEN
    SELECT COALESCE(SUM(capacity_quantity), 0)::INTEGER INTO sealed_quantity
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
      SELECT COALESCE(SUM(capacity_quantity), 0)::INTEGER INTO sealed_quantity
      FROM inventory_backbar_containers
      WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
        AND inventory_item_id=NEW.inventory_item_id AND status='sealed'
        AND id<>NEW.id;
      IF sealed_quantity + NEW.capacity_quantity > total_unopened THEN
        RAISE EXCEPTION 'no retail stock is available to reserve for sealed backbar'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
