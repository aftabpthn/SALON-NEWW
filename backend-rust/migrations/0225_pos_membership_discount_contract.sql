ALTER TABLE pos_sale_lines
  DROP CONSTRAINT IF EXISTS pos_sale_lines_discount_type_contract;

ALTER TABLE pos_sale_lines
  ADD CONSTRAINT pos_sale_lines_discount_type_contract
  CHECK (discount_type IN ('amount', 'percent', 'membership', 'membership_stacked')) NOT VALID;
