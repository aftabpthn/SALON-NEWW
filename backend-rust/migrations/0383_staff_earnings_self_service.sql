ALTER TABLE staff_tip_payout_items
  ADD COLUMN IF NOT EXISTS staff_id TEXT;

UPDATE staff_tip_payout_items item
SET staff_id = payout.staff_id
FROM staff_tip_payouts payout
WHERE item.payout_id = payout.id
  AND item.tenant_id = payout.tenant_id
  AND item.branch_id = payout.branch_id
  AND item.staff_id IS NULL;

ALTER TABLE staff_tip_payout_items
  ALTER COLUMN staff_id SET NOT NULL;

ALTER TABLE staff_tip_payout_items
  DROP CONSTRAINT IF EXISTS staff_tip_payout_items_pkey;

ALTER TABLE staff_tip_payout_items
  ADD CONSTRAINT staff_tip_payout_items_pkey
  PRIMARY KEY (tenant_id, branch_id, sale_id, staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_tip_payout_items_payout
  ON staff_tip_payout_items(tenant_id, branch_id, payout_id);

ALTER TABLE staff_tip_payouts
  ADD COLUMN IF NOT EXISTS payout_method TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS provider_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE staff_tip_payouts
  DROP CONSTRAINT IF EXISTS staff_tip_payouts_method_check,
  DROP CONSTRAINT IF EXISTS staff_tip_payouts_status_check;

ALTER TABLE staff_tip_payouts
  ADD CONSTRAINT staff_tip_payouts_method_check
    CHECK (payout_method IN ('cash','bank','upi','other')),
  ADD CONSTRAINT staff_tip_payouts_status_check
    CHECK (status IN ('pending','processing','paid','failed','reversed'));

CREATE TABLE IF NOT EXISTS staff_tip_disputes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  sale_id TEXT REFERENCES pos_sales(id) ON DELETE RESTRICT,
  payout_id TEXT REFERENCES staff_tip_payouts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','resolved','rejected','cancelled')),
  resolution_note TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (sale_id IS NOT NULL OR payout_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_staff_tip_disputes_self
  ON staff_tip_disputes(tenant_id, branch_id, staff_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tip_disputes_one_pending
  ON staff_tip_disputes(tenant_id, branch_id, staff_id, COALESCE(sale_id,''), COALESCE(payout_id,''))
  WHERE status='pending';
