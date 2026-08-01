ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS sale_id TEXT REFERENCES pos_sales(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sale_line_id TEXT REFERENCES pos_sale_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reconciliation_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_reconciliation_source_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_reconciliation_source_check
  CHECK (reconciliation_source IN ('manual','bowl_slip','pos_recipe')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_sale
  ON inventory_backbar_usage (tenant_id, branch_id, sale_id, sale_line_id)
  WHERE sale_id IS NOT NULL;

ALTER TABLE inventory_backbar_containers
  ADD COLUMN IF NOT EXISTS location_code TEXT NOT NULL DEFAULT 'BACKBAR',
  ADD COLUMN IF NOT EXISTS custodian_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT;

ALTER TABLE inventory_backbar_containers
  DROP CONSTRAINT IF EXISTS inventory_backbar_containers_location_code_check;
ALTER TABLE inventory_backbar_containers
  ADD CONSTRAINT inventory_backbar_containers_location_code_check
  CHECK (BTRIM(location_code) <> '') NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_one_open_container
  ON inventory_backbar_containers (tenant_id, branch_id, inventory_item_id)
  WHERE status='open';

ALTER TABLE inventory_backbar_container_events
  DROP CONSTRAINT IF EXISTS inventory_backbar_container_events_event_type_check;
ALTER TABLE inventory_backbar_container_events
  ADD CONSTRAINT inventory_backbar_container_events_event_type_check
  CHECK (event_type IN (
    'created','opened','consumed','closed','premature_open_blocked',
    'override_requested','override_approved','override_rejected',
    'custody_transferred','floor_count_adjusted'
  )) NOT VALID;

CREATE TABLE IF NOT EXISTS inventory_floor_locations (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (BTRIM(code) <> ''),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  location_type TEXT NOT NULL CHECK (location_type IN ('store','backbar','station','trolley')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, code)
);

INSERT INTO inventory_floor_locations(tenant_id,branch_id,code,name,location_type,created_by)
SELECT DISTINCT tenant_id,branch_id,'BACKBAR','Backbar','backbar','system:migration'
FROM inventory_backbar_containers
ON CONFLICT (tenant_id,branch_id,code) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_floor_custody_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  container_id TEXT NOT NULL REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT,
  from_location_code TEXT NOT NULL,
  to_location_code TEXT NOT NULL,
  from_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  to_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_floor_custody_container
  ON inventory_floor_custody_events(tenant_id,branch_id,container_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_floor_closings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  shift_label TEXT NOT NULL CHECK (BTRIM(shift_label) <> ''),
  status TEXT NOT NULL CHECK (status IN ('recorded','pending_approval','approved','rejected')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  review_idempotency_key TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_floor_closings_scope
  ON inventory_floor_closings(tenant_id,branch_id,business_date DESC,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_floor_closing_review_key
  ON inventory_floor_closings(tenant_id,branch_id,review_idempotency_key)
  WHERE review_idempotency_key<>'';

CREATE TABLE IF NOT EXISTS inventory_floor_closing_lines (
  closing_id TEXT NOT NULL REFERENCES inventory_floor_closings(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  container_id TEXT NOT NULL REFERENCES inventory_backbar_containers(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  expected_remaining INTEGER NOT NULL CHECK (expected_remaining >= 0),
  counted_remaining INTEGER NOT NULL CHECK (counted_remaining >= 0),
  variance_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  PRIMARY KEY (closing_id, container_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_floor_closing_lines_scope
  ON inventory_floor_closing_lines(tenant_id,branch_id,inventory_item_id);
