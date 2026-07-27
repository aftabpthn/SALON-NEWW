-- Loyalty Phase 1B: stamp card ledger.
--
-- Stamps are a second loyalty currency and cannot share
-- membership_reward_ledger: that table's unique index allows exactly one
-- 'earned' row per (tenant, branch, sale), so a stamp written there would
-- collide with the sale's reward points. Program definitions live in
-- membership_settings.stampCards; per-client stamp events live here.
CREATE TABLE IF NOT EXISTS stamp_card_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  program_code TEXT NOT NULL,
  source_sale_id TEXT NOT NULL DEFAULT '',
  source_refund_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK (event_type IN ('earned','redeemed','reversed','adjusted')),
  stamps INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  staff_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One stamp event of each type per invoice per program. This is the
-- authoritative duplicate guard: a paid invoice can reach the reward hook
-- more than once (sale persist, payment applied, invoice finalize, deferred
-- gateway settlement), so application logic alone would double-stamp.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_card_events_sale
  ON stamp_card_events (tenant_id, branch_id, program_code, source_sale_id, event_type)
  WHERE source_sale_id <> '';

-- Replay guard for completion and manual adjustment events, which are not
-- keyed by a sale.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_card_events_idempotency
  ON stamp_card_events (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key <> '';

-- Running balance lookup and customer card summary.
CREATE INDEX IF NOT EXISTS idx_stamp_card_events_client
  ON stamp_card_events (tenant_id, branch_id, client_id, program_code, created_at DESC);

-- Reversal lookup when a refund is processed.
CREATE INDEX IF NOT EXISTS idx_stamp_card_events_refund
  ON stamp_card_events (tenant_id, branch_id, source_refund_id)
  WHERE source_refund_id <> '';
