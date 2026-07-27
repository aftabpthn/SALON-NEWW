ALTER TABLE pos_coupons
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staff_instructions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_package_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS show_in_staff_app BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_in_customer_app BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pos_coupons_publishing_text_length_check') THEN
    ALTER TABLE pos_coupons ADD CONSTRAINT pos_coupons_publishing_text_length_check CHECK (
      CHAR_LENGTH(title) <= 120
      AND CHAR_LENGTH(customer_description) <= 1000
      AND CHAR_LENGTH(staff_instructions) <= 2000
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS marketing_offer_creatives (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES pos_coupons(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  content_sha256 TEXT NOT NULL,
  content_bytes BYTEA NOT NULL CHECK (OCTET_LENGTH(content_bytes) BETWEEN 1 AND 5242880),
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_coupons_staff_app_live
  ON pos_coupons (tenant_id, branch_id, ends_at)
  WHERE active=TRUE AND approval_status='approved' AND show_in_staff_app=TRUE;

CREATE INDEX IF NOT EXISTS idx_pos_coupons_customer_app_live
  ON pos_coupons (tenant_id, branch_id, ends_at)
  WHERE active=TRUE AND approval_status='approved' AND show_in_customer_app=TRUE;
