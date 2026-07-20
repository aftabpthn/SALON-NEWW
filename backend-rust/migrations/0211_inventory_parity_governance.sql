CREATE TABLE IF NOT EXISTS inventory_policies (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  negative_stock_rule TEXT NOT NULL DEFAULT 'block' CHECK (negative_stock_rule IN ('block','approval_required')),
  valuation_method TEXT NOT NULL DEFAULT 'weighted_average' CHECK (valuation_method IN ('weighted_average','fifo')),
  expiry_window_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_window_days BETWEEN 1 AND 3650),
  count_variance_threshold_bps INTEGER NOT NULL DEFAULT 500 CHECK (count_variance_threshold_bps BETWEEN 0 AND 10000),
  approval_matrix JSONB NOT NULL DEFAULT '{"negativeStock":"owner","stockCount":"inventory_manager","backbarOverride":"owner"}'::JSONB,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS supplier_price_lists (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (tenant_id, branch_id, supplier_id, inventory_item_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_supplier_price_lists_scope ON supplier_price_lists(tenant_id,branch_id,supplier_id,effective_from DESC);

CREATE TABLE IF NOT EXISTS supplier_communication_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id TEXT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  destination TEXT NOT NULL CHECK (BTRIM(destination) <> ''),
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL CHECK (BTRIM(message) <> ''),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_supplier_communication_queue_scope ON supplier_communication_queue(tenant_id,branch_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_backbar_containers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  barcode TEXT NOT NULL,
  batch_id TEXT REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  capacity_quantity INTEGER NOT NULL CHECK (capacity_quantity > 0),
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= capacity_quantity),
  unit TEXT NOT NULL CHECK (BTRIM(unit) <> ''),
  status TEXT NOT NULL DEFAULT 'sealed' CHECK (status IN ('sealed','open','empty','discarded')),
  opened_by TEXT,
  opened_at TIMESTAMPTZ,
  closed_by TEXT,
  closed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, barcode)
);
CREATE INDEX IF NOT EXISTS idx_backbar_containers_scope ON inventory_backbar_containers(tenant_id,branch_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS inventory_backbar_container_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  container_id TEXT NOT NULL REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','opened','consumed','closed','override_requested','override_approved','override_rejected')),
  quantity_delta INTEGER NOT NULL DEFAULT 0,
  remaining_after INTEGER NOT NULL CHECK (remaining_after >= 0),
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_backbar_container_events_scope ON inventory_backbar_container_events(tenant_id,branch_id,container_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_backbar_overrides (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  container_id TEXT NOT NULL REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT,
  requested_remaining INTEGER NOT NULL CHECK (requested_remaining >= 0),
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_backbar_pending_override ON inventory_backbar_overrides(tenant_id,branch_id,container_id) WHERE status='pending';

ALTER TABLE inventory_stock_ledger ADD COLUMN IF NOT EXISTS backbar_container_id TEXT REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_container_open ON inventory_stock_ledger(tenant_id,branch_id,backbar_container_id,movement_type) WHERE backbar_container_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_negative_stock_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  requested_stock_quantity INTEGER NOT NULL CHECK (requested_stock_quantity < 0),
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_negative_stock_pending ON inventory_negative_stock_requests(tenant_id,branch_id,inventory_item_id) WHERE status='pending';
ALTER TABLE inventory_stock_ledger ADD COLUMN IF NOT EXISTS negative_stock_request_id TEXT REFERENCES inventory_negative_stock_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_negative_stock_ledger ON inventory_stock_ledger(tenant_id,branch_id,negative_stock_request_id) WHERE negative_stock_request_id IS NOT NULL;