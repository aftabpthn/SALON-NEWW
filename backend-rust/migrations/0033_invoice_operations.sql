CREATE TABLE IF NOT EXISTS pos_invoice_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  action_history_id TEXT REFERENCES pos_invoice_action_history(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  recipient TEXT NOT NULL,
  template_version TEXT NOT NULL DEFAULT 'invoice-v1',
  payload_json JSONB NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  external_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_outbox_idempotency
  ON pos_invoice_outbox (tenant_id, branch_id, sale_id, idempotency_key)
  WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_pos_invoice_outbox_due
  ON pos_invoice_outbox (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS pos_invoice_event_chain (
  sequence BIGSERIAL NOT NULL,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL UNIQUE REFERENCES pos_invoice_events(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL DEFAULT '',
  payload_text TEXT NOT NULL,
  previous_hash TEXT NOT NULL DEFAULT '',
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_event_chain_sale
  ON pos_invoice_event_chain (tenant_id, branch_id, sale_id, sequence);

CREATE TABLE IF NOT EXISTS pos_happy_hour_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  weekdays SMALLINT[] NOT NULL,
  discount_bps INTEGER NOT NULL CHECK (discount_bps > 0 AND discount_bps <= 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_happy_hour_rules_active
  ON pos_happy_hour_rules (tenant_id, branch_id, active);

CREATE TABLE IF NOT EXISTS pos_happy_hour_locks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL UNIQUE REFERENCES pos_sales(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES pos_happy_hour_rules(id),
  rule_snapshot JSONB NOT NULL,
  eligible_paise BIGINT NOT NULL,
  discount_paise BIGINT NOT NULL,
  reversed_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
