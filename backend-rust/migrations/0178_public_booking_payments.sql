ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS booked_total_paise BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS appointment_payment_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_link_id TEXT NOT NULL DEFAULT '',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','creating','issued','paid','expired','cancelled','failed','refunded')),
  link_url TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, appointment_id),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_payment_links_provider
  ON appointment_payment_links(provider, provider_link_id)
  WHERE provider_link_id <> '';

CREATE INDEX IF NOT EXISTS idx_appointment_payment_links_status
  ON appointment_payment_links(tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS appointment_payment_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  payment_link_id TEXT NOT NULL REFERENCES appointment_payment_links(id),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_event_id)
);

CREATE TABLE IF NOT EXISTS appointment_payment_refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  payment_link_id TEXT NOT NULL REFERENCES appointment_payment_links(id),
  provider_refund_id TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, appointment_id, idempotency_key)
);
