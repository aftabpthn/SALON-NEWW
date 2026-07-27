CREATE TABLE IF NOT EXISTS payment_merchant_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','adyen')),
  provider_account_id TEXT NOT NULL,
  legal_entity_id TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  default_currency TEXT NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
  business_type TEXT NOT NULL CHECK (business_type IN ('company','individual','non_profit')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','requirements_due','active','restricted','disabled')),
  kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','in_progress','verified','requirements_due','rejected')),
  charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  requirements_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  pci_status TEXT NOT NULL DEFAULT 'not_started' CHECK (pci_status IN ('not_started','action_required','submitted','compliant','expired')),
  pci_attestation_due_at TIMESTAMPTZ,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, provider),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_merchant_accounts_status
  ON payment_merchant_accounts (tenant_id, branch_id, status, provider);

CREATE TABLE IF NOT EXISTS payment_provider_operations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  merchant_account_id TEXT NOT NULL REFERENCES payment_merchant_accounts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','adyen')),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('payment','setup','payout','terminal_session')),
  provider_object_id TEXT NOT NULL DEFAULT '',
  sale_id TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  security_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_operations_status
  ON payment_provider_operations (tenant_id, branch_id, provider, operation_type, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_operation_object
  ON payment_provider_operations (provider, provider_object_id)
  WHERE provider_object_id <> '';

CREATE TABLE IF NOT EXISTS payment_provider_settlements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  merchant_account_id TEXT NOT NULL REFERENCES payment_merchant_accounts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','adyen')),
  provider_settlement_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_paise BIGINT NOT NULL DEFAULT 0,
  fee_paise BIGINT NOT NULL DEFAULT 0,
  net_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  available_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, provider, provider_settlement_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_settlements_branch
  ON payment_provider_settlements (tenant_id, branch_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_receipts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('stripe','adyen')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  merchant_account_id TEXT NOT NULL DEFAULT '',
  signature_verified BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  payload_sha256 TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, provider_event_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_receipts_health
  ON payment_webhook_receipts (provider, status, received_at DESC);

ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS provider_terminal_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS tap_to_pay_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminal_provider_id
  ON pos_terminals (tenant_id, payment_provider, provider_terminal_id)
  WHERE payment_provider <> '' AND provider_terminal_id <> '';

ALTER TABLE client_payment_instruments
  ADD COLUMN IF NOT EXISTS provider_mandate_id TEXT NOT NULL DEFAULT '';
