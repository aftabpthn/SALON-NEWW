-- Approval-gated action drafts raised by the copilot.
--
-- A draft is a proposal the user has not yet agreed to. Creating one changes no
-- business data; confirming one executes only what the draft says, and only
-- after Rust has re-checked the caller's permission and the current state.
--
-- ai_concierge_actions already records what a message proposed, but it is tied
-- to a session and a message by non-null foreign keys and has no idempotency
-- key, so it cannot carry a confirm/execute lifecycle. This table owns that
-- lifecycle; the two are complementary rather than duplicates.

CREATE TABLE IF NOT EXISTS ai_action_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  -- The allow-list. Widening it is a schema change on purpose: nothing that
  -- moves money, publishes an offer, sends a campaign, confirms a booking,
  -- cancels a membership or touches payroll belongs here.
  action_type TEXT NOT NULL CHECK (action_type IN (
    'create_offer_draft',
    'create_campaign_draft',
    'create_whatsapp_draft',
    'create_follow_up_task',
    'prepare_booking_draft',
    'prepare_membership_renewal',
    'open_staff_report',
    'open_client_profile',
    'open_service_report',
    'open_membership',
    'continue_billing'
  )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','executed','cancelled')),
  -- Exactly what the user is being asked to agree to, in their own words.
  summary TEXT NOT NULL,
  -- True when executing would create or change a record rather than navigate.
  requires_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Which screens should reload once this has run.
  refresh_targets JSONB NOT NULL DEFAULT '[]'::JSONB,
  -- Supplied by the client at confirm time. Unique per tenant, so a repeated
  -- confirmation returns the first result instead of acting twice.
  idempotency_key TEXT,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  CONSTRAINT ai_action_drafts_decided CHECK (
    (status = 'draft' AND decided_at IS NULL)
    OR (status <> 'draft' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_action_drafts_scope
  ON ai_action_drafts (tenant_id, branch_id, status, created_at DESC);

-- Partial so that many unconfirmed drafts can coexist with a null key, while a
-- supplied key can only ever be used once per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_action_drafts_idempotency
  ON ai_action_drafts (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Append-only record of every attempt, including the ones that were refused.
-- A refused attempt is the entry most worth having.
CREATE TABLE IF NOT EXISTS ai_action_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  draft_id TEXT,
  action_type TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('drafted','confirmed','cancelled','refused','replayed')),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_action_audit_scope
  ON ai_action_audit (tenant_id, branch_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_action_audit_refused
  ON ai_action_audit (tenant_id, branch_id, created_at DESC)
  WHERE event = 'refused';
