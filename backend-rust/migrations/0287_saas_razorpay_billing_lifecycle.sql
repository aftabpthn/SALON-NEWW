ALTER TABLE saas_subscriptions DROP CONSTRAINT IF EXISTS saas_subscriptions_status_check;
ALTER TABLE saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_status_check
  CHECK (status IN ('pending','trialing','active','past_due','paused','cancelled'));

DROP INDEX IF EXISTS idx_saas_subscription_one_current;
CREATE UNIQUE INDEX idx_saas_subscription_one_current
  ON saas_subscriptions(tenant_id,branch_id)
  WHERE status IN ('pending','trialing','active','past_due','paused');

ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS provider_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS checkout_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pending_plan_id TEXT REFERENCES saas_plans(id),
  ADD COLUMN IF NOT EXISTS pending_plan_effective TEXT NOT NULL DEFAULT ''
    CHECK (pending_plan_effective IN ('','now','cycle_end')),
  ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_subscription_provider_ref
  ON saas_subscriptions(provider,provider_subscription_ref)
  WHERE provider_subscription_ref<>'';

CREATE TABLE IF NOT EXISTS saas_provider_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  plan_id TEXT NOT NULL REFERENCES saas_plans(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider='razorpay'),
  provider_plan_ref TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise>=0),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly','yearly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id,plan_version,provider),
  UNIQUE(provider,provider_plan_ref)
);

CREATE TABLE IF NOT EXISTS saas_checkout_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  plan_id TEXT NOT NULL REFERENCES saas_plans(id),
  subscription_id TEXT REFERENCES saas_subscriptions(id),
  provider TEXT NOT NULL CHECK (provider='razorpay'),
  provider_subscription_ref TEXT NOT NULL DEFAULT '',
  checkout_url TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','ready','failed')),
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_checkout_one_open
  ON saas_checkout_requests(tenant_id,branch_id)
  WHERE status IN ('creating','ready');

CREATE TABLE IF NOT EXISTS saas_provider_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  provider TEXT NOT NULL CHECK (provider='razorpay'),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subscription_id TEXT REFERENCES saas_subscriptions(id),
  provider_subscription_ref TEXT NOT NULL DEFAULT '',
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error_message TEXT NOT NULL DEFAULT '',
  provider_created_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider,provider_event_id)
);

CREATE TABLE IF NOT EXISTS saas_provider_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
  invoice_id TEXT REFERENCES saas_invoices(id),
  provider TEXT NOT NULL CHECK (provider='razorpay'),
  provider_payment_ref TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise>0),
  currency TEXT NOT NULL DEFAULT 'INR',
  method TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('captured','failed','refunded')),
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('matched','unmatched')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider,provider_payment_ref)
);

CREATE TABLE IF NOT EXISTS saas_refunds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  provider_payment_id TEXT NOT NULL REFERENCES saas_provider_payments(id),
  provider TEXT NOT NULL CHECK (provider='razorpay'),
  provider_refund_ref TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL CHECK (amount_paise>0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','pending','processed','failed')),
  idempotency_key TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(provider,provider_refund_ref)
);

CREATE TABLE IF NOT EXISTS saas_credit_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  invoice_id TEXT REFERENCES saas_invoices(id),
  refund_id TEXT NOT NULL REFERENCES saas_refunds(id),
  credit_note_number TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise>0),
  reason TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,credit_note_number),
  UNIQUE(refund_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_provider_events_subscription
  ON saas_provider_events(provider_subscription_ref,received_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_provider_payments_subscription
  ON saas_provider_payments(tenant_id,subscription_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_refunds_payment
  ON saas_refunds(tenant_id,provider_payment_id,created_at DESC);
