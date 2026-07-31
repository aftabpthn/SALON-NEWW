CREATE TABLE IF NOT EXISTS integration_opening_inventory_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  import_job_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  cutover_id TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,
  source_checksum TEXT NOT NULL CHECK (source_checksum ~ '^[0-9A-Fa-f]{64}$'),
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, import_job_id),
  UNIQUE (tenant_id, branch_id, cutover_id, source_checksum)
);

CREATE TABLE IF NOT EXISTS integration_opening_inventory_snapshot_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  snapshot_id TEXT NOT NULL REFERENCES integration_opening_inventory_snapshots(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_code TEXT NOT NULL CHECK (BTRIM(location_code) <> ''),
  stock_unit TEXT NOT NULL CHECK (BTRIM(stock_unit) <> ''),
  quantity INTEGER NOT NULL,
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  valuation_paise BIGINT NOT NULL CHECK (valuation_paise >= 0),
  batches_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (JSONB_TYPEOF(batches_json) = 'array'),
  approved_unbatched_quantity INTEGER NOT NULL DEFAULT 0,
  source_sheet TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  source_row_checksum TEXT NOT NULL CHECK (source_row_checksum ~ '^[0-9A-Fa-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_id, inventory_item_id, location_code),
  UNIQUE (snapshot_id, source_sheet, source_row_number)
);

CREATE TABLE IF NOT EXISTS inventory_location_stock (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_code TEXT NOT NULL CHECK (BTRIM(location_code) <> ''),
  stock_unit TEXT NOT NULL CHECK (BTRIM(stock_unit) <> ''),
  quantity INTEGER NOT NULL,
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  snapshot_line_id TEXT NOT NULL REFERENCES integration_opening_inventory_snapshot_lines(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, inventory_item_id, location_code)
);

CREATE TABLE IF NOT EXISTS inventory_location_batches (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_code TEXT NOT NULL,
  batch_number TEXT NOT NULL CHECK (BTRIM(batch_number) <> ''),
  expiry_date DATE,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_cost_paise BIGINT NOT NULL CHECK (unit_cost_paise >= 0),
  snapshot_line_id TEXT NOT NULL REFERENCES integration_opening_inventory_snapshot_lines(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, inventory_item_id, location_code, batch_number),
  FOREIGN KEY (tenant_id, branch_id, inventory_item_id, location_code)
    REFERENCES inventory_location_stock(tenant_id, branch_id, inventory_item_id, location_code)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_opening_inventory_snapshot_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_INVENTORY_SNAPSHOT_EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opening_inventory_snapshots_immutable
  ON integration_opening_inventory_snapshots;
CREATE TRIGGER trg_opening_inventory_snapshots_immutable
BEFORE UPDATE OR DELETE ON integration_opening_inventory_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_opening_inventory_snapshot_evidence_mutation();

DROP TRIGGER IF EXISTS trg_opening_inventory_snapshot_lines_immutable
  ON integration_opening_inventory_snapshot_lines;
CREATE TRIGGER trg_opening_inventory_snapshot_lines_immutable
BEFORE UPDATE OR DELETE ON integration_opening_inventory_snapshot_lines
FOR EACH ROW EXECUTE FUNCTION reject_opening_inventory_snapshot_evidence_mutation();
