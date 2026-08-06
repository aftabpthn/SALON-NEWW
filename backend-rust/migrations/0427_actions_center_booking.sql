CREATE TABLE IF NOT EXISTS actions_center_merchants (
  merchant_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS actions_center_bookings (
  merchant_id TEXT NOT NULL REFERENCES actions_center_merchants(merchant_id) ON UPDATE CASCADE,
  idempotency_token TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  appointment_id TEXT,
  client_id TEXT NOT NULL,
  slot_json JSONB NOT NULL,
  user_json JSONB NOT NULL,
  response_json JSONB,
  last_update_hash TEXT,
  last_update_response_json JSONB,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, idempotency_token),
  UNIQUE (appointment_id),
  CONSTRAINT actions_center_booking_status CHECK (status IN ('processing','confirmed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_actions_center_bookings_merchant_status
  ON actions_center_bookings(merchant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS actions_center_marketing_preferences (
  user_id TEXT PRIMARY KEY,
  user_json JSONB NOT NULL,
  receive_marketing BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
