ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS transfer_base_transport_cost_paise BIGINT,
  ADD COLUMN IF NOT EXISTS transfer_cost_per_km_paise BIGINT,
  ADD COLUMN IF NOT EXISTS transfer_handling_cost_per_unit_paise BIGINT,
  ADD COLUMN IF NOT EXISTS transfer_delay_cost_per_unit_day_paise BIGINT,
  ADD COLUMN IF NOT EXISTS transfer_expected_days INTEGER;

ALTER TABLE inventory_policies DROP CONSTRAINT IF EXISTS ck_inventory_policy_transfer_base_cost;
ALTER TABLE inventory_policies ADD CONSTRAINT ck_inventory_policy_transfer_base_cost
  CHECK (transfer_base_transport_cost_paise IS NULL OR transfer_base_transport_cost_paise BETWEEN 0 AND 1000000000);
ALTER TABLE inventory_policies DROP CONSTRAINT IF EXISTS ck_inventory_policy_transfer_km_cost;
ALTER TABLE inventory_policies ADD CONSTRAINT ck_inventory_policy_transfer_km_cost
  CHECK (transfer_cost_per_km_paise IS NULL OR transfer_cost_per_km_paise BETWEEN 0 AND 1000000000);
ALTER TABLE inventory_policies DROP CONSTRAINT IF EXISTS ck_inventory_policy_transfer_handling_cost;
ALTER TABLE inventory_policies ADD CONSTRAINT ck_inventory_policy_transfer_handling_cost
  CHECK (transfer_handling_cost_per_unit_paise IS NULL OR transfer_handling_cost_per_unit_paise BETWEEN 0 AND 10000000);
ALTER TABLE inventory_policies DROP CONSTRAINT IF EXISTS ck_inventory_policy_transfer_delay_cost;
ALTER TABLE inventory_policies ADD CONSTRAINT ck_inventory_policy_transfer_delay_cost
  CHECK (transfer_delay_cost_per_unit_day_paise IS NULL OR transfer_delay_cost_per_unit_day_paise BETWEEN 0 AND 10000000);
ALTER TABLE inventory_policies DROP CONSTRAINT IF EXISTS ck_inventory_policy_transfer_expected_days;
ALTER TABLE inventory_policies ADD CONSTRAINT ck_inventory_policy_transfer_expected_days
  CHECK (transfer_expected_days IS NULL OR transfer_expected_days BETWEEN 0 AND 365);
