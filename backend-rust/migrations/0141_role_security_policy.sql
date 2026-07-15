ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS denied_permissions_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS masked_fields_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS max_discount_paise BIGINT,
  ADD COLUMN IF NOT EXISTS max_refund_paise BIGINT,
  ADD COLUMN IF NOT EXISTS max_cash_movement_paise BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='roles'::regclass AND conname='ck_roles_security_policy'
  ) THEN
    ALTER TABLE roles
      ADD CONSTRAINT ck_roles_security_policy CHECK (
        JSONB_TYPEOF(denied_permissions_json)='array'
        AND JSONB_TYPEOF(masked_fields_json)='array'
        AND (max_discount_paise IS NULL OR max_discount_paise >= 0)
        AND (max_refund_paise IS NULL OR max_refund_paise >= 0)
        AND (max_cash_movement_paise IS NULL OR max_cash_movement_paise >= 0)
      );
  END IF;
END;
$$;
