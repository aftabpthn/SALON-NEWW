ALTER TABLE payment_provider_operations
  ADD COLUMN IF NOT EXISTS capture_method TEXT NOT NULL DEFAULT 'automatic'
    CHECK (capture_method IN ('automatic','manual')),
  ADD COLUMN IF NOT EXISTS uncertain_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS payment_provider_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_id TEXT REFERENCES payment_provider_operations(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL DEFAULT '',
  pos_payment_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL CHECK (provider IN ('razorpay','stripe','adyen')),
  provider_payment_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('capture','void','refund','reconcile')),
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','unknown','succeeded','failed')),
  provider_action_id TEXT NOT NULL DEFAULT '',
  result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_actions_operation
  ON payment_provider_actions (tenant_id, branch_id, operation_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_provider_actions_payment
  ON payment_provider_actions (tenant_id, branch_id, pos_payment_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_provider_actions_attention
  ON payment_provider_actions (tenant_id, branch_id, status, created_at DESC)
  WHERE status IN ('pending','unknown','failed');
