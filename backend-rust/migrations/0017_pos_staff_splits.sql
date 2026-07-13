ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS staff_splits JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pos_sale_lines_staff_splits_gin
  ON pos_sale_lines USING GIN (staff_splits);
