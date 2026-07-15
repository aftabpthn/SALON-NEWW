ALTER TABLE client_communications
  DROP CONSTRAINT IF EXISTS client_communications_source_type_check;
ALTER TABLE client_communications
  ADD CONSTRAINT client_communications_source_type_check
  CHECK (source_type IN ('invoice', 'benefit', 'marketing', 'provider'));

ALTER TABLE client_communications
  DROP CONSTRAINT IF EXISTS client_communications_channel_check;
ALTER TABLE client_communications
  ADD CONSTRAINT client_communications_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'email'));

UPDATE client_communications communication
   SET source_type = 'marketing'
  FROM benefit_notification_outbox outbox
 WHERE communication.tenant_id = outbox.tenant_id
   AND communication.branch_id = outbox.branch_id
   AND communication.source_type = 'benefit'
   AND communication.source_id = outbox.id
   AND outbox.source_type = 'marketing_campaign';

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_communications_provider_message
  ON client_communications (tenant_id, branch_id, channel, provider_message_id)
  WHERE provider_message_id <> '';

CREATE OR REPLACE FUNCTION sync_benefit_client_communication()
RETURNS TRIGGER AS $$
DECLARE
  communication_source_type TEXT;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  communication_source_type := CASE
    WHEN NEW.source_type = 'marketing_campaign' THEN 'marketing'
    ELSE 'benefit'
  END;

  INSERT INTO client_communications (
    tenant_id, branch_id, client_id, source_type, source_id, channel, status,
    recipient, subject, body, provider_message_id, last_error, occurred_at, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, NEW.client_id, communication_source_type, NEW.id,
    NEW.channel, NEW.status, NEW.recipient,
    COALESCE(NULLIF(NEW.payload_json->>'subject', ''), INITCAP(REPLACE(NEW.source_type, '_', ' '))),
    COALESCE(NEW.payload_json->>'message', ''), NEW.provider_message_id, NEW.last_error,
    NEW.created_at, COALESCE(NEW.updated_at, NEW.created_at)
  )
  ON CONFLICT (tenant_id, branch_id, source_type, source_id) DO UPDATE SET
    client_id = EXCLUDED.client_id,
    channel = EXCLUDED.channel,
    status = EXCLUDED.status,
    recipient = EXCLUDED.recipient,
    subject = EXCLUDED.subject,
    body = EXCLUDED.body,
    provider_message_id = EXCLUDED.provider_message_id,
    last_error = EXCLUDED.last_error,
    updated_at = EXCLUDED.updated_at;

  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM record_client_communication_audit(
      NEW.tenant_id, NEW.branch_id, NEW.client_id, communication_source_type, NEW.id,
      NEW.channel, NEW.status, NEW.provider_message_id, NEW.last_error
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_benefit_client_communication ON benefit_notification_outbox;
CREATE TRIGGER trg_benefit_client_communication
AFTER INSERT OR UPDATE OF status, provider_message_id, last_error, payload_json, recipient
ON benefit_notification_outbox
FOR EACH ROW EXECUTE FUNCTION sync_benefit_client_communication();
