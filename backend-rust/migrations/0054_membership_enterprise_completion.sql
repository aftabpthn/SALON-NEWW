ALTER TABLE membership_lifecycle_ledger
  DROP CONSTRAINT IF EXISTS membership_lifecycle_ledger_event_type_check;

ALTER TABLE membership_lifecycle_ledger
  ADD CONSTRAINT membership_lifecycle_ledger_event_type_check
  CHECK (event_type IN (
    'assigned', 'renewed', 'cancelled', 'upgraded', 'downgraded',
    'plan_change_scheduled', 'family_member_added', 'family_member_removed',
    'self_service_requested', 'auto_renew_failed', 'auto_renew_paused', 'auto_renew_resumed'
  ));

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS pending_membership_id TEXT REFERENCES memberships(id),
  ADD COLUMN IF NOT EXISTS auto_renew_status TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS auto_renew_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_renewal_at TIMESTAMPTZ;

ALTER TABLE client_memberships
  DROP CONSTRAINT IF EXISTS client_memberships_auto_renew_status_check;

ALTER TABLE client_memberships
  ADD CONSTRAINT client_memberships_auto_renew_status_check
  CHECK (auto_renew_status IN ('disabled', 'active', 'paused', 'payment_required', 'failed'));

CREATE TABLE IF NOT EXISTS membership_plan_changes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  from_membership_id TEXT NOT NULL REFERENCES memberships(id),
  target_membership_id TEXT NOT NULL REFERENCES memberships(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('upgrade', 'downgrade')),
  effective_at TEXT NOT NULL CHECK (effective_at IN ('now', 'renewal')),
  remaining_days INTEGER NOT NULL DEFAULT 0,
  charge_paise BIGINT NOT NULL DEFAULT 0,
  credit_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_checkout' CHECK (status IN ('pending_checkout', 'scheduled', 'completed', 'cancelled')),
  source_sale_id TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_membership_plan_changes_membership
  ON membership_plan_changes (tenant_id, branch_id, client_membership_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_plan_changes_pending
  ON membership_plan_changes (tenant_id, branch_id, client_membership_id)
  WHERE status IN ('pending_checkout', 'scheduled');

CREATE TABLE IF NOT EXISTS membership_family_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  owner_client_id TEXT NOT NULL REFERENCES clients(id),
  member_client_id TEXT NOT NULL REFERENCES clients(id),
  relationship TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_family_active_member
  ON membership_family_members (tenant_id, branch_id, client_membership_id, member_client_id)
  WHERE active=TRUE;

CREATE INDEX IF NOT EXISTS idx_membership_family_member
  ON membership_family_members (tenant_id, branch_id, member_client_id, active);

CREATE TABLE IF NOT EXISTS membership_self_service_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('renew', 'cancel', 'upgrade', 'downgrade')),
  target_membership_id TEXT REFERENCES memberships(id),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_membership_self_service_status
  ON membership_self_service_requests (tenant_id, branch_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_self_service_pending
  ON membership_self_service_requests (tenant_id, branch_id, client_membership_id, request_type)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS membership_auto_renew_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'payment_required', 'checkout_ready', 'completed', 'failed')),
  source_sale_id TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_auto_renew_attempt_number
  ON membership_auto_renew_attempts (tenant_id, branch_id, client_membership_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_membership_auto_renew_status
  ON membership_auto_renew_attempts (tenant_id, branch_id, status, next_retry_at);
