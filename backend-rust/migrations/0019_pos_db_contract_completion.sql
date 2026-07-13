CREATE TABLE IF NOT EXISTS pos_invoice_number_sequences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_type TEXT NOT NULL DEFAULT 'tax_invoice',
  prefix TEXT NOT NULL DEFAULT '',
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
  reset_period TEXT NOT NULL DEFAULT 'never' CHECK (reset_period IN ('never', 'daily', 'monthly', 'yearly')),
  last_reset_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, invoice_type)
);

CREATE TABLE IF NOT EXISTS pos_invoice_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL DEFAULT '',
  snapshot_type TEXT NOT NULL DEFAULT 'lifecycle',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_snapshots_sale
  ON pos_invoice_snapshots (tenant_id, branch_id, sale_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_payment_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_link_id TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  link_url TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_links_sale_status
  ON pos_payment_links (tenant_id, branch_id, sale_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_links_idempotency
  ON pos_payment_links (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS pos_payment_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  idempotency_key TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_events_sale
  ON pos_payment_events (tenant_id, branch_id, sale_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_events_provider_event
  ON pos_payment_events (tenant_id, provider, provider_event_id)
  WHERE provider_event_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_events_idempotency
  ON pos_payment_events (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS pos_payment_reconciliation_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  from_date DATE,
  to_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_reconciliation_runs
  ON pos_payment_reconciliation_runs (tenant_id, branch_id, provider, created_at DESC);

CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  initial_amount_paise BIGINT NOT NULL CHECK (initial_amount_paise > 0),
  balance_paise BIGINT NOT NULL CHECK (balance_paise >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'voided', 'blocked')),
  expires_at DATE,
  source_sale_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_client_status
  ON gift_cards (tenant_id, branch_id, client_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_cards_idempotency
  ON gift_cards (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  gift_card_id TEXT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL DEFAULT '',
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('issue', 'redeem', 'refund', 'adjustment_credit', 'adjustment_debit')),
  delta_paise BIGINT NOT NULL CHECK (delta_paise <> 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  idempotency_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_card
  ON gift_card_transactions (tenant_id, branch_id, gift_card_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_card_transactions_idempotency
  ON gift_card_transactions (tenant_id, branch_id, gift_card_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS client_membership_credits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  membership_name TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  total_qty INTEGER NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  remaining_qty INTEGER NOT NULL DEFAULT 0 CHECK (remaining_qty >= 0),
  expires_at DATE,
  source_sale_id TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_membership_credits_client
  ON client_membership_credits (tenant_id, branch_id, client_id, active);
CREATE INDEX IF NOT EXISTS idx_client_membership_credits_membership
  ON client_membership_credits (tenant_id, branch_id, membership_id);

CREATE TABLE IF NOT EXISTS pos_membership_redemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  client_membership_credit_id TEXT NOT NULL REFERENCES client_membership_credits(id),
  membership_id TEXT NOT NULL,
  membership_name TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_membership_redemptions_sale
  ON pos_membership_redemptions (tenant_id, branch_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_membership_redemptions_client
  ON pos_membership_redemptions (tenant_id, branch_id, client_id);

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  opened_by_user_id TEXT NOT NULL DEFAULT '',
  closed_by_user_id TEXT NOT NULL DEFAULT '',
  business_date DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_cash_paise BIGINT NOT NULL DEFAULT 0 CHECK (opening_cash_paise >= 0),
  expected_cash_paise BIGINT NOT NULL DEFAULT 0 CHECK (expected_cash_paise >= 0),
  counted_cash_paise BIGINT,
  variance_paise BIGINT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_approval', 'closed', 'voided')),
  notes TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_branch_date
  ON cash_drawer_sessions (tenant_id, branch_id, business_date, status);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'sale_cash', 'cash_in', 'cash_out', 'refund_cash', 'closing_adjustment')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_movements_session
  ON cash_drawer_movements (tenant_id, branch_id, drawer_session_id, created_at DESC);
