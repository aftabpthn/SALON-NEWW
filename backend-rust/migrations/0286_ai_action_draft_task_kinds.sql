-- Draft kinds the copilot may prepare for the CRM's own task and purchasing screens.
--
-- Coaching and membership follow-ups are task-shaped: approving one creates a
-- staff task through the service that owns tasks. A reorder proposal is still a
-- hand-off, because completing a purchase order is the purchasing screen's job.

ALTER TABLE ai_action_drafts DROP CONSTRAINT IF EXISTS ai_action_drafts_action_type_check;
ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ai_action_drafts_action_type_check
  CHECK (action_type IN (
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
    'continue_billing',
    'create_coaching_task',
    'create_reorder_proposal',
    'create_membership_follow_up'
  )) NOT VALID;

-- The audit trail must accept every event the service actually writes.
--
-- `approved` and `failed` were being written but not permitted, so those rows
-- were silently dropped: an approval left no audit record, which is the one
-- thing an approval trail exists to keep.
ALTER TABLE ai_action_audit DROP CONSTRAINT IF EXISTS ai_action_audit_event_check;
ALTER TABLE ai_action_audit
  ADD CONSTRAINT ai_action_audit_event_check
  CHECK (event IN (
    'drafted','confirmed','approved','cancelled','refused','replayed','failed'
  )) NOT VALID;
