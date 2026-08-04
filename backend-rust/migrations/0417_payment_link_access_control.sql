-- Access control and telemetry for invoice payment links.
--
-- A payment link is handed to a guest over WhatsApp, and the provider URL that
-- comes back is a bearer credential: whoever opens it sees the invoice and can
-- pay it. Forwarded once, it is out of the salon's hands. Nothing recorded that
-- a link had been opened, by whom or how often, and nothing stopped several
-- live links existing for the same invoice at the same time.
--
-- The fix is to stop handing out the provider URL. A link now carries a token
-- of ours; opening it lands on our side, where the guest confirms the last four
-- digits of the phone the invoice belongs to before being forwarded on. That is
-- also where the telemetry comes from — every open, challenge and redirect is
-- a row here, which feeds straight into the dispute evidence pack.

ALTER TABLE pos_payment_links
  -- Only the hash is stored. The token itself lives in the URL the guest was
  -- sent and nowhere else, so a database dump does not hand over live links.
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT NOT NULL DEFAULT '',
  -- Off leaves the old behaviour: the provider URL is returned directly. On,
  -- the guest confirms the phone before the redirect.
  ADD COLUMN IF NOT EXISTS require_phone_verification BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opened_count INTEGER NOT NULL DEFAULT 0 CHECK (opened_count >= 0),
  ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ,
  -- Failed phone confirmations. Four digits is a small space, so the count is
  -- on the row and the link stops answering once it is spent.
  ADD COLUMN IF NOT EXISTS failed_verifications INTEGER NOT NULL DEFAULT 0
    CHECK (failed_verifications >= 0),
  -- Set when a newer link replaced this one, so an old URL still in a chat
  -- thread says so instead of quietly working.
  ADD COLUMN IF NOT EXISTS superseded_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_links_access_token
  ON pos_payment_links (access_token_hash)
  WHERE access_token_hash <> '';

-- One live link per invoice: the supersede pass looks up the others.
CREATE INDEX IF NOT EXISTS idx_pos_payment_links_pending_sale
  ON pos_payment_links (tenant_id, branch_id, sale_id)
  WHERE status = 'pending';

-- Every interaction with a link, including the ones that failed.
--
-- A dispute turns on whether the guest themselves authorised the charge, and
-- "the link was opened twice from one address and the phone was confirmed" is
-- the closest thing to evidence a hosted checkout can give.
CREATE TABLE IF NOT EXISTS pos_payment_link_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES pos_payment_links(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('opened', 'verification_failed', 'verified', 'redirected', 'blocked')),
  source_ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (JSONB_TYPEOF(details_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_pos_payment_link_events_link
  ON pos_payment_link_events (tenant_id, branch_id, link_id, created_at DESC);
