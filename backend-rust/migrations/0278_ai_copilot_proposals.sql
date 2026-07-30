-- AI copilot proposal governance.
--
-- The copilot records proposals only. Any business-data change remains pending
-- until a signed-in user approves or rejects the proposal explicitly.

ALTER TABLE ai_concierge_actions
  DROP CONSTRAINT IF EXISTS ai_concierge_actions_action_type_check;

ALTER TABLE ai_concierge_actions
  ADD CONSTRAINT ai_concierge_actions_action_type_check
  CHECK (action_type IN (
    'booking_draft','human_handoff',
    'open_staff_report','view_client','open_membership',
    'create_offer_draft','prepare_whatsapp_draft','continue_billing',
    'prepare_booking_draft'
  ));

CREATE INDEX IF NOT EXISTS idx_ai_concierge_actions_pending
  ON ai_concierge_actions (tenant_id, branch_id, status, created_at DESC);
