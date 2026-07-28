-- AI copilot proposals.
--
-- The copilot never changes business data. It records a proposal for the user
-- to act on, and anything that would change state stays 'pending' until a
-- person explicitly approves it in the CRM screen that owns that change.
--
-- Widens the allowed action types beyond the original two so every proposal
-- kind the copilot can raise has an audit row.

ALTER TABLE ai_concierge_actions
  DROP CONSTRAINT IF EXISTS ai_concierge_actions_action_type_check;

ALTER TABLE ai_concierge_actions
  ADD CONSTRAINT ai_concierge_actions_action_type_check
  CHECK (action_type IN (
    -- Pre-existing concierge actions.
    'booking_draft','human_handoff',
    -- Read-only navigation proposals; recorded for traceability only.
    'open_staff_report','view_client','open_membership',
    -- Proposals that prepare a change a person must still approve.
    'create_offer_draft','prepare_whatsapp_draft','continue_billing',
    'prepare_booking_draft'
  ));

-- Reviewers need to find what is still awaiting a decision.
CREATE INDEX IF NOT EXISTS idx_ai_concierge_actions_pending
  ON ai_concierge_actions (tenant_id, branch_id, status, created_at DESC);
