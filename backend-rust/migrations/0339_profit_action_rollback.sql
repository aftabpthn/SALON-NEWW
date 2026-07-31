ALTER TABLE profit_governance_audit_events
  DROP CONSTRAINT IF EXISTS profit_governance_audit_events_event_type_check;

ALTER TABLE profit_governance_audit_events
  ADD CONSTRAINT profit_governance_audit_events_event_type_check CHECK (
    event_type IN (
      'rule_saved','evaluated','approval_requested','approved','rejected',
      'action_created','action_approved','action_completed','action_dismissed',
      'action_rolled_back'
    )
  );
