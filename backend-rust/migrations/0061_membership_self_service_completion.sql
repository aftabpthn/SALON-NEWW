ALTER TABLE membership_self_service_requests
  ADD COLUMN IF NOT EXISTS service_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_reference TEXT NOT NULL DEFAULT '';

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS auto_renew_payment_reference TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS membership_credit_adjustments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES membership_self_service_requests(id),
  client_membership_id TEXT NOT NULL REFERENCES client_memberships(id),
  client_membership_credit_id TEXT NOT NULL REFERENCES client_membership_credits(id),
  service_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  before_total INTEGER NOT NULL,
  after_total INTEGER NOT NULL,
  before_remaining INTEGER NOT NULL,
  after_remaining INTEGER NOT NULL CHECK (after_remaining >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, request_id)
);
