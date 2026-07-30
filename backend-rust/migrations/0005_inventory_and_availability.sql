CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'pcs',
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  unit_cost_paise BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_branch ON inventory_items(tenant_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_branch_active ON inventory_items(tenant_id, branch_id, active);
CREATE INDEX IF NOT EXISTS idx_inventory_items_search ON inventory_items(tenant_id, branch_id, LOWER(name), LOWER(category));
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_tenant_branch_sku_active
  ON inventory_items(tenant_id, branch_id, LOWER(TRIM(sku)))
  WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS staff_availability (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT staff_availability_time_order CHECK (start_time < end_time),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, branch_id, staff_id, weekday, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_staff_availability_tenant_branch
  ON staff_availability(tenant_id, branch_id, staff_id, weekday);
