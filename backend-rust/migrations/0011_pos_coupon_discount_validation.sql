ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS coupon_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS coupon_discount_paise BIGINT NOT NULL DEFAULT 0;

UPDATE pos_sales
   SET coupon_code = COALESCE(coupon_code, ''),
       coupon_discount_paise = GREATEST(COALESCE(coupon_discount_paise, 0), 0),
       bill_discount_paise = GREATEST(COALESCE(bill_discount_paise, 0), 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'pos_sales_coupon_discount_non_negative'
  ) THEN
    ALTER TABLE pos_sales
      ADD CONSTRAINT pos_sales_coupon_discount_non_negative
      CHECK (coupon_discount_paise >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'pos_sales_bill_discount_non_negative'
  ) THEN
    ALTER TABLE pos_sales
      ADD CONSTRAINT pos_sales_bill_discount_non_negative
      CHECK (bill_discount_paise >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_sales_coupon
  ON pos_sales (tenant_id, branch_id, coupon_code)
  WHERE coupon_code <> '';

CREATE TABLE IF NOT EXISTS pos_coupons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'amount',
  discount_value_paise BIGINT NOT NULL DEFAULT 0,
  discount_bps BIGINT NOT NULL DEFAULT 0,
  min_subtotal_paise BIGINT NOT NULL DEFAULT 0,
  max_discount_paise BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  usage_limit BIGINT,
  used_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pos_coupons_discount_type_check CHECK (discount_type IN ('amount', 'percent')),
  CONSTRAINT pos_coupons_discount_non_negative CHECK (
    discount_value_paise >= 0
    AND discount_bps >= 0
    AND min_subtotal_paise >= 0
    AND max_discount_paise >= 0
    AND used_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_coupons_code
  ON pos_coupons (tenant_id, branch_id, code);

CREATE INDEX IF NOT EXISTS idx_pos_coupons_active_window
  ON pos_coupons (tenant_id, branch_id, active, starts_at, ends_at);
