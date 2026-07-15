CREATE TABLE IF NOT EXISTS laundry_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('salon','client')),
  client_id TEXT REFERENCES clients(id),
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','sorting','washing','drying','finishing','outsourced','received_from_vendor','quality_check','rework','ready','returned','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  intake_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  total_items INTEGER NOT NULL CHECK (total_items > 0),
  total_weight_grams INTEGER CHECK (total_weight_grams IS NULL OR total_weight_grams > 0),
  estimated_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_paise >= 0),
  actual_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (actual_cost_paise >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,order_number),
  CHECK ((owner_type='client' AND client_id IS NOT NULL) OR (owner_type='salon' AND client_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_laundry_orders_scope
  ON laundry_orders(tenant_id,branch_id,status,due_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_laundry_orders_client
  ON laundry_orders(tenant_id,branch_id,client_id,created_at DESC)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS laundry_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('towel','cape','sheet','uniform','garment','other')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  barcode TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  condition_in TEXT NOT NULL DEFAULT '',
  condition_out TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','sorting','washing','drying','finishing','outsourced','received_from_vendor','quality_check','rework','ready','returned','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,order_id,item_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_laundry_items_barcode
  ON laundry_items(tenant_id,branch_id,barcode)
  WHERE barcode<>'';
CREATE INDEX IF NOT EXISTS idx_laundry_items_order
  ON laundry_items(tenant_id,branch_id,order_id,status);

CREATE TABLE IF NOT EXISTS laundry_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES laundry_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_laundry_events_order
  ON laundry_events(tenant_id,branch_id,order_id,created_at DESC);

CREATE TABLE IF NOT EXISTS laundry_issues (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES laundry_items(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('stain','damage','lost','shortage','other')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','waived')),
  description TEXT NOT NULL,
  charge_paise BIGINT NOT NULL DEFAULT 0 CHECK (charge_paise >= 0),
  resolution TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_laundry_issues_scope
  ON laundry_issues(tenant_id,branch_id,status,created_at DESC);
