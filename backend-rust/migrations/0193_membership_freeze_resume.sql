ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS frozen_until DATE,
  ADD COLUMN IF NOT EXISTS freeze_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE membership_lifecycle_ledger
  DROP CONSTRAINT IF EXISTS membership_lifecycle_ledger_event_type_check;

ALTER TABLE membership_lifecycle_ledger
  ADD CONSTRAINT membership_lifecycle_ledger_event_type_check
  CHECK (event_type IN (
    'assigned', 'renewed', 'cancelled', 'upgraded', 'downgraded',
    'plan_change_scheduled', 'family_member_added', 'family_member_removed',
    'self_service_requested', 'auto_renew_failed', 'auto_renew_paused',
    'auto_renew_resumed', 'frozen', 'resumed'
  ));

CREATE INDEX IF NOT EXISTS idx_client_memberships_frozen
  ON client_memberships (tenant_id, branch_id, frozen_at)
  WHERE frozen_at IS NOT NULL;
