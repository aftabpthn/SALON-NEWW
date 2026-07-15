CREATE TABLE IF NOT EXISTS appointment_package_reservations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  client_package_credit_id TEXT NOT NULL REFERENCES client_package_credits(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','redeemed','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, appointment_id, client_package_credit_id)
);

CREATE INDEX IF NOT EXISTS idx_package_reservations_credit_status
  ON appointment_package_reservations (tenant_id, branch_id, client_package_credit_id, status);
