ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN;

ALTER TABLE pos_sale_lines
  ALTER COLUMN tax_inclusive SET DEFAULT FALSE;

COMMENT ON COLUMN pos_sale_lines.tax_inclusive IS
  'Invoice-time pricing mode snapshot. NULL means historical mode was not recorded.';
