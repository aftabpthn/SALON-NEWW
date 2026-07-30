-- A confirmed AI proposal only authorizes opening its owning CRM screen. The
-- screen still performs the real business write with its existing validation,
-- permission and audit rules, so the draft must not claim it was executed.

ALTER TABLE ai_action_drafts
  DROP CONSTRAINT IF EXISTS ai_action_drafts_status_check;

UPDATE ai_action_drafts
SET status = 'approved'
WHERE status = 'executed';

ALTER TABLE ai_action_drafts
  ADD CONSTRAINT ai_action_drafts_status_check
  CHECK (status IN ('draft','approved','cancelled'));

ALTER TABLE ai_action_audit
  DROP CONSTRAINT IF EXISTS ai_action_audit_event_check;

UPDATE ai_action_audit
SET event = 'approved'
WHERE event = 'confirmed';

ALTER TABLE ai_action_audit
  ADD CONSTRAINT ai_action_audit_event_check
  CHECK (event IN ('drafted','approved','cancelled','refused','replayed'));

DROP INDEX IF EXISTS uq_ai_action_drafts_idempotency;

CREATE UNIQUE INDEX uq_ai_action_drafts_idempotency
  ON ai_action_drafts (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
