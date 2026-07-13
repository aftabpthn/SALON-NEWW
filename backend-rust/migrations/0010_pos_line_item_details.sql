ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS staff_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS gross_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS taxable_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS gst_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'amount';

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS discount_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS discount_bps BIGINT NOT NULL DEFAULT 0;

UPDATE pos_sale_lines
   SET gross_paise = quantity * unit_price_paise
 WHERE gross_paise = 0
   AND quantity > 0
   AND unit_price_paise > 0;

UPDATE pos_sale_lines
   SET taxable_paise = GREATEST(gross_paise - discount_paise, 0)
 WHERE taxable_paise = 0
   AND gross_paise > 0;

UPDATE pos_sale_lines
   SET gst_paise = GREATEST(line_total_paise - taxable_paise, 0)
 WHERE gst_paise = 0
   AND line_total_paise > 0;

CREATE INDEX IF NOT EXISTS idx_pos_sale_lines_staff
  ON pos_sale_lines (tenant_id, branch_id, staff_id, created_at DESC);
