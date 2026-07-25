\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  item_id TEXT := gen_random_uuid()::TEXT;
  source_id TEXT;
  reversal_id TEXT;
  replay_id TEXT;
  stock INTEGER;
  movement_count BIGINT;
BEGIN
  INSERT INTO inventory_items (
    id, tenant_id, branch_id, sku, name, stock_quantity, unit_cost_paise
  ) VALUES (
    item_id, 'ledger-trust-check', 'branch-check', item_id, 'Ledger trust check', 5, 100
  );

  INSERT INTO inventory_stock_ledger (
    tenant_id, branch_id, inventory_item_id, movement_type,
    quantity_delta, unit_cost_paise, stock_after_quantity, adjustment_reason
  ) VALUES (
    'ledger-trust-check', 'branch-check', item_id, 'adjustment', 5, 100, 5, 'Trust check source'
  ) RETURNING id INTO source_id;

  reversal_id := reverse_inventory_stock_ledger(
    'ledger-trust-check', 'branch-check', source_id, 'trust-check', 'Trust check reversal'
  );
  replay_id := reverse_inventory_stock_ledger(
    'ledger-trust-check', 'branch-check', source_id, 'trust-check', 'Trust check replay'
  );

  SELECT stock_quantity INTO stock FROM inventory_items WHERE id = item_id;
  SELECT COUNT(*) INTO movement_count
  FROM inventory_stock_ledger
  WHERE tenant_id = 'ledger-trust-check' AND branch_id = 'branch-check';

  IF reversal_id <> replay_id OR stock <> 0 OR movement_count <> 2 THEN
    RAISE EXCEPTION 'ledger reversal check failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM inventory_stock_ledger
    WHERE id = reversal_id
      AND reversal_of_ledger_id = source_id
      AND reversed_by_user_id = 'trust-check'
      AND quantity_delta = -5
      AND stock_after_quantity = 0
  ) THEN
    RAISE EXCEPTION 'reversal evidence check failed';
  END IF;

  BEGIN
    DELETE FROM inventory_stock_ledger WHERE id = source_id;
    RAISE EXCEPTION 'append-only delete unexpectedly succeeded' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'inventory stock ledger is append-only%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
