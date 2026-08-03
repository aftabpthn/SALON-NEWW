ALTER TABLE inventory_policies
  ADD COLUMN IF NOT EXISTS stock_action_matrix JSONB NOT NULL DEFAULT '{"receipt":true,"transfer":true,"adjustment":true,"audit":true,"consumption":true,"returns":true,"kit":true}'::JSONB,
  ADD COLUMN IF NOT EXISTS purchase_order_settings JSONB NOT NULL DEFAULT '{"numberPrefix":"PO","approvalRequired":true,"approvalThresholdPaise":0,"bulkRaiseEnabled":true,"supplierElectronicDelivery":false}'::JSONB,
  ADD COLUMN IF NOT EXISTS label_settings JSONB NOT NULL DEFAULT '{"priceCaption":"MRP","showName":true,"showPrice":true,"showSku":true,"showBatch":true,"showExpiry":true,"widthMm":76,"heightMm":32,"columns":5,"terms":{"product":"Product","retail":"Retail","consumable":"Consumable","stock":"Stock"}}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policy_stock_actions_object') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policy_stock_actions_object CHECK (jsonb_typeof(stock_action_matrix)='object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policy_purchase_settings_object') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policy_purchase_settings_object CHECK (jsonb_typeof(purchase_order_settings)='object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_policy_label_settings_object') THEN
    ALTER TABLE inventory_policies ADD CONSTRAINT inventory_policy_label_settings_object CHECK (jsonb_typeof(label_settings)='object');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_product_lifecycle_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('discontinued','reactivated')),
  replacement_inventory_item_id TEXT REFERENCES inventory_items(id),
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(reason)) BETWEEN 3 AND 500),
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (replacement_inventory_item_id IS NULL OR replacement_inventory_item_id <> inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_lifecycle_scope
  ON inventory_product_lifecycle_events(tenant_id,branch_id,inventory_item_id,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_inventory_product_lifecycle_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory product lifecycle history is immutable' USING ERRCODE='P0001';
END $$;

DROP TRIGGER IF EXISTS trg_inventory_product_lifecycle_no_update ON inventory_product_lifecycle_events;
CREATE TRIGGER trg_inventory_product_lifecycle_no_update
BEFORE UPDATE ON inventory_product_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_product_lifecycle_mutation();

DROP TRIGGER IF EXISTS trg_inventory_product_lifecycle_no_delete ON inventory_product_lifecycle_events;
CREATE TRIGGER trg_inventory_product_lifecycle_no_delete
BEFORE DELETE ON inventory_product_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_product_lifecycle_mutation();
