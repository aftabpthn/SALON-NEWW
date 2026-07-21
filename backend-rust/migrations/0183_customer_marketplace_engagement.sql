CREATE TABLE IF NOT EXISTS customer_favorites (
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_account_created
  ON customer_favorites (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_booking_reviews (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL DEFAULT '' CHECK (LENGTH(review_text) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (account_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_booking_reviews_branch_created
  ON customer_booking_reviews (tenant_id, branch_id, created_at DESC);

ALTER TABLE appointment_waitlist
  ADD COLUMN IF NOT EXISTS customer_account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_waitlist_source_pending
  ON appointment_waitlist (customer_account_id, source_appointment_id)
  WHERE customer_account_id IS NOT NULL AND source_appointment_id IS NOT NULL AND status = 'pending';
