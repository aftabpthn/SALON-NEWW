ALTER TABLE inventory_automation_policies
  ADD COLUMN IF NOT EXISTS category_budgets_paise JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE inventory_automation_policies DROP CONSTRAINT IF EXISTS ck_inventory_automation_category_budgets;
ALTER TABLE inventory_automation_policies ADD CONSTRAINT ck_inventory_automation_category_budgets
  CHECK (JSONB_TYPEOF(category_budgets_paise)='object');
