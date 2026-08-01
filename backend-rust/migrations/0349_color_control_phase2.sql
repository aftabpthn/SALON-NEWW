ALTER TABLE inventory_backbar_usage
  ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_profile TEXT NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS waste_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_range_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_range_check
  CHECK (min_quantity >= 0 AND min_quantity <= expected_quantity
    AND (max_quantity = 0 OR expected_quantity <= max_quantity)) NOT VALID;

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_profile_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_profile_check
  CHECK (usage_profile IN ('root_touch_up','full_colour','custom')) NOT VALID;

ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_waste_reason_check;
ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_waste_reason_check
  CHECK (waste_reason IN ('','long_hair','thick_hair','colour_correction','spillage','overmix','client_change','tube_residue','other')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_inventory_backbar_usage_staff_date
  ON inventory_backbar_usage (tenant_id, branch_id, staff_id, created_at DESC)
  WHERE bowl_id IS NOT NULL;
