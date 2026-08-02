ALTER TABLE inventory_backbar_containers
  ADD COLUMN IF NOT EXISTS unit_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS opening_stock_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT;

ALTER TABLE inventory_backbar_containers
  DROP CONSTRAINT IF EXISTS inventory_backbar_containers_unit_cost_check;
ALTER TABLE inventory_backbar_containers
  ADD CONSTRAINT inventory_backbar_containers_unit_cost_check
  CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0) NOT VALID;

UPDATE inventory_backbar_containers container
SET opening_stock_ledger_id = (
      SELECT ledger.id FROM inventory_stock_ledger ledger
      WHERE ledger.tenant_id=container.tenant_id AND ledger.branch_id=container.branch_id
        AND ledger.backbar_container_id=container.id AND ledger.quantity_delta<0
      ORDER BY ledger.created_at,ledger.id LIMIT 1
    ),
    unit_cost_paise = (
      SELECT ledger.unit_cost_paise FROM inventory_stock_ledger ledger
      WHERE ledger.tenant_id=container.tenant_id AND ledger.branch_id=container.branch_id
        AND ledger.backbar_container_id=container.id AND ledger.quantity_delta<0
      ORDER BY ledger.created_at,ledger.id LIMIT 1
    )
WHERE container.status IN ('open','empty','discarded')
  AND container.opening_stock_ledger_id IS NULL
  AND EXISTS (SELECT 1 FROM inventory_stock_ledger ledger WHERE ledger.tenant_id=container.tenant_id AND ledger.branch_id=container.branch_id AND ledger.backbar_container_id=container.id AND ledger.quantity_delta<0);

UPDATE inventory_backbar_containers container
SET unit_cost_paise = COALESCE(
      (SELECT batch.unit_cost_paise FROM inventory_batches batch WHERE batch.id=container.batch_id),
      (SELECT item.unit_cost_paise FROM inventory_items item WHERE item.id=container.inventory_item_id AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id)
    )
WHERE EXISTS (SELECT 1 FROM inventory_items item WHERE item.id=container.inventory_item_id AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id)
  AND container.status IN ('open','empty','discarded')
  AND container.unit_cost_paise IS NULL;
