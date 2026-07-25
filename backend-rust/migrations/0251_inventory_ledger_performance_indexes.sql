CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_tenant_branch_created_at_id
  ON inventory_stock_ledger (tenant_id, branch_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_tenant_branch_movement_created_at_id
  ON inventory_stock_ledger (tenant_id, branch_id, movement_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_adjustment_reason_trgm
  ON inventory_stock_ledger USING gin (LOWER(COALESCE(adjustment_reason, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_reversal_reason_trgm
  ON inventory_stock_ledger USING gin (LOWER(COALESCE(reversal_reason, '')) gin_trgm_ops);
