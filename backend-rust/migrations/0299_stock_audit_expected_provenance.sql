ALTER TABLE stock_count_session_items
  ADD COLUMN IF NOT EXISTS expected_source_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS expected_ledger_movement_count BIGINT NOT NULL DEFAULT 0
    CHECK (expected_ledger_movement_count >= 0),
  ADD COLUMN IF NOT EXISTS expected_provenance_status TEXT NOT NULL DEFAULT 'opening_baseline'
    CHECK (expected_provenance_status IN ('verified_ledger','opening_baseline','legacy_snapshot')),
  ADD COLUMN IF NOT EXISTS expected_movement_summary JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(expected_movement_summary) = 'object');

WITH evidence AS (
  SELECT
    audit_item.id,
    latest.id AS source_ledger_id,
    COALESCE(movement.movement_count, 0) AS movement_count,
    CASE
      WHEN latest.id IS NULL THEN 'opening_baseline'
      WHEN latest.stock_after_quantity = audit_item.expected_quantity THEN 'verified_ledger'
      ELSE 'legacy_snapshot'
    END AS provenance_status,
    jsonb_build_object(
      'openingQuantity', audit_item.expected_quantity - COALESCE(movement.total_quantity, 0),
      'purchaseQuantity', COALESCE(movement.purchase_quantity, 0),
      'purchaseReturnQuantity', COALESCE(movement.purchase_return_quantity, 0),
      'transferInQuantity', COALESCE(movement.transfer_in_quantity, 0),
      'transferOutQuantity', COALESCE(movement.transfer_out_quantity, 0),
      'transferReversalQuantity', COALESCE(movement.transfer_reversal_quantity, 0),
      'saleQuantity', COALESCE(movement.sale_quantity, 0),
      'returnQuantity', COALESCE(movement.return_quantity, 0),
      'consumptionQuantity', COALESCE(movement.consumption_quantity, 0),
      'kitComponentOutQuantity', COALESCE(movement.kit_component_out_quantity, 0),
      'kitAssemblyInQuantity', COALESCE(movement.kit_assembly_in_quantity, 0),
      'adjustmentQuantity', COALESCE(movement.adjustment_quantity, 0)
    ) AS movement_summary
  FROM stock_count_session_items audit_item
  JOIN stock_count_sessions session
    ON session.id = audit_item.session_id
   AND session.tenant_id = audit_item.tenant_id
   AND session.branch_id = audit_item.branch_id
  LEFT JOIN LATERAL (
    SELECT ledger.id, ledger.stock_after_quantity
    FROM inventory_stock_ledger ledger
    WHERE ledger.tenant_id = audit_item.tenant_id
      AND ledger.branch_id = audit_item.branch_id
      AND ledger.inventory_item_id = audit_item.inventory_item_id
      AND ledger.created_at <= session.cutoff_at
    ORDER BY ledger.created_at DESC, ledger.id DESC
    LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::BIGINT AS movement_count,
      COALESCE(SUM(ledger.quantity_delta), 0)::INTEGER AS total_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'purchase'), 0)::INTEGER AS purchase_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'purchase_return'), 0)::INTEGER AS purchase_return_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'transfer_in'), 0)::INTEGER AS transfer_in_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'transfer_out'), 0)::INTEGER AS transfer_out_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'transfer_reversal'), 0)::INTEGER AS transfer_reversal_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'sale'), 0)::INTEGER AS sale_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'return'), 0)::INTEGER AS return_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'consumption'), 0)::INTEGER AS consumption_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'kit_component_out'), 0)::INTEGER AS kit_component_out_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'kit_assembly_in'), 0)::INTEGER AS kit_assembly_in_quantity,
      COALESCE(SUM(ledger.quantity_delta) FILTER (WHERE ledger.movement_type = 'adjustment'), 0)::INTEGER AS adjustment_quantity
    FROM inventory_stock_ledger ledger
    WHERE ledger.tenant_id = audit_item.tenant_id
      AND ledger.branch_id = audit_item.branch_id
      AND ledger.inventory_item_id = audit_item.inventory_item_id
      AND ledger.created_at <= session.cutoff_at
  ) movement ON TRUE
)
UPDATE stock_count_session_items audit_item
SET expected_source_ledger_id = evidence.source_ledger_id,
    expected_ledger_movement_count = evidence.movement_count,
    expected_provenance_status = evidence.provenance_status,
    expected_movement_summary = evidence.movement_summary
FROM evidence
WHERE audit_item.id = evidence.id
  AND audit_item.expected_movement_summary = '{}'::JSONB;
