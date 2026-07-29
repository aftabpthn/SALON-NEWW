ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS count_value_variance_threshold_paise BIGINT NOT NULL DEFAULT 10000
  CHECK (count_value_variance_threshold_paise BETWEEN 0 AND 1000000000000);

ALTER TABLE stock_count_sessions
  ADD COLUMN IF NOT EXISTS count_variance_threshold_bps INTEGER NOT NULL DEFAULT 500
  CHECK (count_variance_threshold_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS count_value_variance_threshold_paise BIGINT NOT NULL DEFAULT 10000
  CHECK (count_value_variance_threshold_paise BETWEEN 0 AND 1000000000000);

ALTER TABLE stock_count_session_items
  ADD COLUMN IF NOT EXISTS expected_unit_cost_paise BIGINT NOT NULL DEFAULT 0
  CHECK (expected_unit_cost_paise >= 0);

UPDATE stock_count_session_items AS audit_item
SET expected_unit_cost_paise = GREATEST(inventory_item.unit_cost_paise, 0)
FROM inventory_items AS inventory_item
WHERE audit_item.tenant_id = inventory_item.tenant_id
  AND audit_item.branch_id = inventory_item.branch_id
  AND audit_item.inventory_item_id = inventory_item.id
  AND audit_item.expected_unit_cost_paise = 0;
