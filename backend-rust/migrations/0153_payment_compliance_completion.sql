CREATE TABLE IF NOT EXISTS client_payment_instruments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  provider TEXT NOT NULL,
  provider_customer_id TEXT NOT NULL DEFAULT '',
  provider_instrument_id TEXT NOT NULL,
  method_type TEXT NOT NULL DEFAULT 'card',
  brand TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT '',
  expiry_month SMALLINT,
  expiry_year SMALLINT,
  recurring_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'saved'
    CHECK (status IN ('saved', 'active', 'revoked', 'expired')),
  consent_source TEXT NOT NULL DEFAULT 'provider_webhook',
  consented_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT client_payment_instruments_last4_masked
    CHECK (last4 = '' OR last4 ~ '^[0-9]{4}$'),
  UNIQUE (tenant_id, provider, provider_instrument_id)
);

CREATE INDEX IF NOT EXISTS idx_client_payment_instruments_client
  ON client_payment_instruments (tenant_id, branch_id, client_id, status, last_used_at DESC);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id),
  payment_id TEXT NOT NULL REFERENCES pos_payments(id),
  client_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  provider_dispute_id TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'won', 'lost', 'closed')),
  evidence_due_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, provider, provider_dispute_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_sale
  ON payment_disputes (tenant_id, branch_id, sale_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_provider_payment
  ON payment_disputes (tenant_id, provider, provider_payment_id);
