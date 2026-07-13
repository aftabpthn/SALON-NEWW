DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_type_contract') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_type_contract
      CHECK (line_type IN ('service', 'product', 'custom', 'membership', 'package', 'gift_card', 'package_redeem', 'membership_redeem')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_qty_positive') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_qty_positive CHECK (quantity > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_money_non_negative') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_money_non_negative
      CHECK (
        unit_price_paise >= 0
        AND gross_paise >= 0
        AND taxable_paise >= 0
        AND discount_paise >= 0
        AND gst_paise >= 0
        AND line_total_paise >= 0
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_gst_percent_range') THEN
    ALTER TABLE pos_sale_lines
      ADD CONSTRAINT pos_sale_lines_gst_percent_range CHECK (tax_percent BETWEEN 0 AND 100) NOT VALID;
  END IF;
END $$;
