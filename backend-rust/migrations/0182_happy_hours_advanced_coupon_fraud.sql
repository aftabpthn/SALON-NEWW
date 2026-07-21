ALTER TABLE pos_coupons
  ADD COLUMN IF NOT EXISTS offer_type TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS per_client_limit BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_service_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS target_service_categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS target_client_segments TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS first_visit_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_required BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_offer_type_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_offer_type_check
      CHECK (offer_type IN ('generic','first_visit','referral','branch_specific','service_specific','segment'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_per_client_limit_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_per_client_limit_check
      CHECK (per_client_limit >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_sales_coupon_client
  ON pos_sales(tenant_id,branch_id,coupon_code,client_id,finalized_at DESC)
  WHERE coupon_code<>'' AND client_id<>'';

ALTER TABLE pos_happy_hour_rules
  ADD COLUMN IF NOT EXISTS last_changed_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_changed_by_role TEXT NOT NULL DEFAULT '';

UPDATE pos_happy_hour_rules
   SET last_changed_by='migration',last_changed_by_role='admin'
 WHERE last_changed_by_role='';

ALTER TABLE pos_happy_hour_approval_requests
  ADD COLUMN IF NOT EXISTS approval_limit_bps INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS rule_snapshot_json JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='happy_hour_approval_limit_check') THEN
    ALTER TABLE pos_happy_hour_approval_requests ADD CONSTRAINT happy_hour_approval_limit_check
      CHECK (approval_limit_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_happy_hour_fraud_cases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  fraud_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  decision TEXT NOT NULL CHECK (decision IN ('allow','manager_review','block_until_review')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,signature)
);

CREATE INDEX IF NOT EXISTS idx_happy_hour_fraud_cases_scope
  ON pos_happy_hour_fraud_cases(tenant_id,branch_id,status,decision,risk_score DESC,detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_happy_hour_fraud_cases_subject
  ON pos_happy_hour_fraud_cases(tenant_id,branch_id,subject_type,subject_id,status);

INSERT INTO roles(
  tenant_id,name,permissions_json,denied_permissions_json,masked_fields_json,
  max_discount_paise,max_refund_paise,max_cash_movement_paise,is_system
)
SELECT tenant_id,'Regional Head',permissions_json,denied_permissions_json,masked_fields_json,
       max_discount_paise,max_refund_paise,max_cash_movement_paise,TRUE
  FROM roles manager_role
 WHERE LOWER(manager_role.name)='manager'
ON CONFLICT (tenant_id,(LOWER(name))) DO UPDATE
SET permissions_json=EXCLUDED.permissions_json,is_system=TRUE;
