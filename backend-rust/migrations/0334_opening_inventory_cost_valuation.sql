ALTER TABLE integration_opening_inventory_snapshot_lines
  ADD COLUMN IF NOT EXISTS source_unit_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS source_valuation_paise BIGINT,
  ADD COLUMN IF NOT EXISTS suggested_source_system_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS suggested_latest_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS suggested_weighted_average_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS cost_method TEXT,
  ADD COLUMN IF NOT EXISTS cost_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS cost_approved_at TIMESTAMPTZ;

ALTER TABLE integration_opening_inventory_snapshot_lines
  DROP CONSTRAINT IF EXISTS integration_opening_inventory_snapshot_li_valuation_paise_check,
  ADD CONSTRAINT opening_inventory_cost_method_check
    CHECK (cost_method IN (
      'latest_historical_purchase_cost',
      'weighted_average_historical_cost',
      'current_source_system_valuation',
      'manual_approved_cost'
    )) NOT VALID,
  ADD CONSTRAINT opening_inventory_valuation_formula_check
    CHECK (
      cost_approved_by IS NOT NULL
      AND cost_approved_at IS NOT NULL
      AND valuation_paise::NUMERIC = quantity::NUMERIC * unit_cost_paise::NUMERIC
      AND CASE cost_method
        WHEN 'latest_historical_purchase_cost' THEN
          suggested_latest_cost_paise IS NOT NULL
          AND unit_cost_paise = suggested_latest_cost_paise
        WHEN 'weighted_average_historical_cost' THEN
          suggested_weighted_average_cost_paise IS NOT NULL
          AND unit_cost_paise = suggested_weighted_average_cost_paise
        WHEN 'current_source_system_valuation' THEN
          suggested_source_system_cost_paise IS NOT NULL
          AND unit_cost_paise = suggested_source_system_cost_paise
        WHEN 'manual_approved_cost' THEN TRUE
        ELSE FALSE
      END
    ) NOT VALID,
  ADD CONSTRAINT opening_inventory_cost_approver_fk
    FOREIGN KEY (cost_approved_by) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;

CREATE INDEX IF NOT EXISTS idx_historical_purchase_cost_evidence
  ON historical_purchase_bill_lines(
    tenant_id, branch_id, mapped_inventory_item_id, stock_unit, historical_bill_id
  ) WHERE mapped_inventory_item_id IS NOT NULL AND purchased_quantity > 0;
