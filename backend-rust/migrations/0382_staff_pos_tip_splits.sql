ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS tip_splits JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE pos_sales
  DROP CONSTRAINT IF EXISTS pos_sales_tip_splits_array;

ALTER TABLE pos_sales
  ADD CONSTRAINT pos_sales_tip_splits_array
  CHECK (jsonb_typeof(tip_splits) = 'array');
