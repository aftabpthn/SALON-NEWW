ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS reorder_history_days INTEGER NOT NULL DEFAULT 60
    CHECK (reorder_history_days BETWEEN 14 AND 365),
  ADD COLUMN IF NOT EXISTS reorder_coverage_days INTEGER NOT NULL DEFAULT 30
    CHECK (reorder_coverage_days BETWEEN 7 AND 180);

CREATE TABLE IF NOT EXISTS purchase_bill_item_aliases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_sku_normalized TEXT NOT NULL DEFAULT '',
  raw_name_normalized TEXT NOT NULL DEFAULT '',
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  match_count INTEGER NOT NULL DEFAULT 1 CHECK (match_count > 0),
  last_matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (supplier_sku_normalized <> '' OR raw_name_normalized <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_bill_item_alias
  ON purchase_bill_item_aliases (
    tenant_id,
    branch_id,
    COALESCE(supplier_id, ''),
    supplier_sku_normalized,
    raw_name_normalized
  );
CREATE INDEX IF NOT EXISTS idx_purchase_bill_item_alias_lookup
  ON purchase_bill_item_aliases (
    tenant_id,
    branch_id,
    COALESCE(supplier_id, ''),
    supplier_sku_normalized,
    raw_name_normalized,
    last_matched_at DESC
  );

ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_client
  ON inventory_backbar_usage (tenant_id, branch_id, client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_recipe_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  recipe_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  changed_by TEXT,
  change_source TEXT NOT NULL DEFAULT 'service_update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, service_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_service_recipe_versions_scope
  ON service_recipe_versions (tenant_id, branch_id, service_id, version_number DESC);

INSERT INTO service_recipe_versions (
  tenant_id, branch_id, service_id, version_number, recipe_json, change_source
)
SELECT tenant_id, branch_id, id, 1, COALESCE(product_consumption_json, '[]'::JSONB), 'migration_baseline'
FROM services
WHERE jsonb_typeof(COALESCE(product_consumption_json, '[]'::JSONB)) = 'array'
  AND jsonb_array_length(COALESCE(product_consumption_json, '[]'::JSONB)) > 0
ON CONFLICT (tenant_id, branch_id, service_id, version_number) DO NOTHING;

CREATE OR REPLACE FUNCTION capture_service_recipe_version()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.product_consumption_json, '[]'::JSONB)
       IS DISTINCT FROM COALESCE(OLD.product_consumption_json, '[]'::JSONB) THEN
    INSERT INTO service_recipe_versions (
      tenant_id, branch_id, service_id, version_number, recipe_json, change_source
    ) VALUES (
      NEW.tenant_id,
      NEW.branch_id,
      NEW.id,
      COALESCE((
        SELECT MAX(version_number) + 1
        FROM service_recipe_versions
        WHERE tenant_id = NEW.tenant_id
          AND branch_id = NEW.branch_id
          AND service_id = NEW.id
      ), 1),
      COALESCE(NEW.product_consumption_json, '[]'::JSONB),
      'service_update'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capture_service_recipe_version ON services;
CREATE TRIGGER trg_capture_service_recipe_version
AFTER UPDATE OF product_consumption_json ON services
FOR EACH ROW EXECUTE FUNCTION capture_service_recipe_version();
