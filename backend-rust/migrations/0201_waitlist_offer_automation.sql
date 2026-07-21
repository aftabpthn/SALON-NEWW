ALTER TABLE appointment_waitlist
  ADD COLUMN IF NOT EXISTS preferred_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS idx_customer_waitlist_source_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_waitlist_source_active
  ON appointment_waitlist (customer_account_id, source_appointment_id)
  WHERE customer_account_id IS NOT NULL
    AND source_appointment_id IS NOT NULL
    AND status IN ('pending', 'offered');

CREATE TABLE IF NOT EXISTS appointment_waitlist_offers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  waitlist_id TEXT NOT NULL REFERENCES appointment_waitlist(id) ON DELETE CASCADE,
  source_appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  offered_appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (waitlist_id, source_appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_offers_due
  ON appointment_waitlist_offers (status, expires_at)
  WHERE status='offered';
