ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS wallet_balance_paise BIGINT NOT NULL DEFAULT 0;

UPDATE clients
   SET wallet_balance_paise = GREATEST(COALESCE(wallet_balance_paise, 0), 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'clients_wallet_balance_non_negative'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_wallet_balance_non_negative
      CHECK (wallet_balance_paise >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS client_memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_memberships_client
  ON client_memberships (tenant_id, branch_id, client_id, active, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_memberships_membership
  ON client_memberships (tenant_id, branch_id, membership_id, active);
