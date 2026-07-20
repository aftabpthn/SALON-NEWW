CREATE TABLE IF NOT EXISTS supplier_inventory_terms (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days BETWEEN 0 AND 365),
  minimum_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  pack_size INTEGER NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  safety_stock_days INTEGER NOT NULL DEFAULT 7 CHECK (safety_stock_days BETWEEN 0 AND 90),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(tenant_id,branch_id,supplier_id,inventory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_inventory_terms_item ON supplier_inventory_terms(tenant_id,branch_id,inventory_item_id,active);

CREATE TABLE IF NOT EXISTS inventory_reorder_forecast_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  history_start DATE NOT NULL,
  history_end DATE NOT NULL,
  created_by TEXT NOT NULL,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_reorder_forecast_runs_scope ON inventory_reorder_forecast_runs(tenant_id,branch_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_reorder_recommendations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  forecast_run_id TEXT NOT NULL REFERENCES inventory_reorder_forecast_runs(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','converting','converted','rejected')),
  suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity > 0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  explanation JSONB NOT NULL DEFAULT '{}'::JSONB,
  purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(forecast_run_id,inventory_item_id),
  UNIQUE(purchase_order_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reorder_recommendations_scope ON inventory_reorder_recommendations(tenant_id,branch_id,status,created_at DESC);
