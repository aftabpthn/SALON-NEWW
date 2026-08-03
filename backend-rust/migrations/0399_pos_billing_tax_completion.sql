ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS other_fee_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines DROP CONSTRAINT IF EXISTS ck_pos_sale_lines_other_fee;
ALTER TABLE pos_sale_lines ADD CONSTRAINT ck_pos_sale_lines_other_fee
  CHECK (other_fee_paise BETWEEN 0 AND 100000000);

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS discount_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cart_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cart_owner_terminal_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS separate_group_invoice BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pos_sales DROP CONSTRAINT IF EXISTS ck_pos_sales_cart_version;
ALTER TABLE pos_sales ADD CONSTRAINT ck_pos_sales_cart_version CHECK (cart_version > 0);

ALTER TABLE pos_invoice_refunds
  ADD COLUMN IF NOT EXISTS settlement_method TEXT NOT NULL DEFAULT 'original_tender',
  ADD COLUMN IF NOT EXISTS exchange_store_credit_id TEXT REFERENCES store_credits(id) ON DELETE SET NULL;

ALTER TABLE pos_invoice_refunds DROP CONSTRAINT IF EXISTS ck_pos_invoice_refunds_settlement;
ALTER TABLE pos_invoice_refunds ADD CONSTRAINT ck_pos_invoice_refunds_settlement
  CHECK (settlement_method IN ('original_tender','exchange_credit'));

CREATE INDEX IF NOT EXISTS idx_pos_invoice_refunds_exchange_credit
  ON pos_invoice_refunds(tenant_id,branch_id,exchange_store_credit_id)
  WHERE exchange_store_credit_id IS NOT NULL;
