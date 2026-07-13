ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS membership_lifecycle_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  event_type TEXT NOT NULL CHECK (event_type = 'cancelled'),
  source_sale_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_lifecycle_ledger_membership
  ON membership_lifecycle_ledger (tenant_id, branch_id, client_membership_id, created_at DESC);

ALTER TABLE membership_lifecycle_ledger
  DROP CONSTRAINT IF EXISTS membership_lifecycle_ledger_event_type_check;

ALTER TABLE membership_lifecycle_ledger
  ADD CONSTRAINT membership_lifecycle_ledger_event_type_check
  CHECK (event_type IN ('assigned', 'renewed', 'cancelled'));

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS auto_renew_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_lifecycle_ledger_sale_event
  ON membership_lifecycle_ledger (tenant_id, branch_id, source_sale_id, event_type)
  WHERE source_sale_id <> '';
