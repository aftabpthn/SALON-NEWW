ALTER TABLE pos_coupons
  ADD COLUMN IF NOT EXISTS marketing_benefit_type TEXT NOT NULL DEFAULT 'percentage_discount',
  ADD COLUMN IF NOT EXISTS benefit_value BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_client_id TEXT,
  ADD COLUMN IF NOT EXISTS complimentary_service_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS allow_membership_stacking BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allow_package_stacking BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_marketing_benefit_type_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_marketing_benefit_type_check CHECK (
      marketing_benefit_type IN ('percentage_discount','fixed_discount','complimentary_add_on','loyalty_points','wallet_credit','gift_card','package_upgrade','priority_appointment','off_peak_deal','last_minute_slot')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_approval_status_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_approval_status_check CHECK (approval_status IN ('draft','pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_benefit_value_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_benefit_value_check CHECK (benefit_value >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_coupons_marketing_scope
  ON pos_coupons(tenant_id,branch_id,approval_status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_coupons_personal_code
  ON pos_coupons(tenant_id,branch_id,code,target_client_id)
  WHERE target_client_id IS NOT NULL;
