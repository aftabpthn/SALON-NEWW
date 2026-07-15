CREATE TABLE IF NOT EXISTS client_communications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('invoice', 'benefit')),
  source_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_client_communications_client
  ON client_communications (tenant_id, branch_id, client_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION record_client_communication_audit(
  p_tenant_id TEXT,
  p_branch_id TEXT,
  p_client_id TEXT,
  p_source_type TEXT,
  p_source_id TEXT,
  p_channel TEXT,
  p_status TEXT,
  p_provider_message_id TEXT,
  p_last_error TEXT
)
RETURNS VOID AS $$
  INSERT INTO client_audit_events (
    tenant_id, branch_id, client_id, event_type, actor_user_id, details_json
  ) VALUES (
    p_tenant_id, p_branch_id, p_client_id, 'client.communication.' || p_status,
    'system:communication-delivery', JSONB_BUILD_OBJECT(
      'sourceType', p_source_type,
      'sourceId', p_source_id,
      'channel', p_channel,
      'providerMessageId', p_provider_message_id,
      'lastError', p_last_error
    )
  );
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION sync_benefit_client_communication()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO client_communications (
    tenant_id, branch_id, client_id, source_type, source_id, channel, status,
    recipient, subject, body, provider_message_id, last_error, occurred_at, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, NEW.client_id, 'benefit', NEW.id, NEW.channel, NEW.status,
    NEW.recipient,
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
      NEW.tenant_id, NEW.branch_id, NEW.client_id, 'benefit', NEW.id, NEW.channel,
      NEW.status, NEW.provider_message_id, NEW.last_error
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

CREATE OR REPLACE FUNCTION sync_invoice_client_communication()
RETURNS TRIGGER AS $$
DECLARE
  linked_client_id TEXT;
  linked_invoice_number TEXT;
BEGIN
  SELECT sale.client_id, sale.invoice_number
    INTO linked_client_id, linked_invoice_number
    FROM pos_sales sale
   WHERE sale.tenant_id = NEW.tenant_id
     AND sale.branch_id = NEW.branch_id
     AND sale.id = NEW.sale_id;

  IF linked_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO client_communications (
    tenant_id, branch_id, client_id, source_type, source_id, channel, status,
    recipient, subject, body, provider_message_id, last_error, occurred_at, updated_at
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, linked_client_id, 'invoice', NEW.id, NEW.channel, NEW.status,
    NEW.recipient, COALESCE(NULLIF(NEW.payload_json->>'subject', ''), 'Invoice ' || linked_invoice_number),
    COALESCE(NEW.payload_json->>'message', ''), NEW.external_message_id, NEW.last_error,
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
      NEW.tenant_id, NEW.branch_id, linked_client_id, 'invoice', NEW.id, NEW.channel,
      NEW.status, NEW.external_message_id, NEW.last_error
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_client_communication ON pos_invoice_outbox;
CREATE TRIGGER trg_invoice_client_communication
AFTER INSERT OR UPDATE OF status, external_message_id, last_error, payload_json, recipient
ON pos_invoice_outbox
FOR EACH ROW EXECUTE FUNCTION sync_invoice_client_communication();

INSERT INTO client_communications (
  tenant_id, branch_id, client_id, source_type, source_id, channel, status,
  recipient, subject, body, provider_message_id, last_error, occurred_at, updated_at
)
SELECT outbox.tenant_id, outbox.branch_id, outbox.client_id, 'benefit', outbox.id,
       outbox.channel, outbox.status, outbox.recipient,
       COALESCE(NULLIF(outbox.payload_json->>'subject', ''), INITCAP(REPLACE(outbox.source_type, '_', ' '))),
       COALESCE(outbox.payload_json->>'message', ''), outbox.provider_message_id, outbox.last_error,
       outbox.created_at, COALESCE(outbox.updated_at, outbox.created_at)
  FROM benefit_notification_outbox outbox
 WHERE outbox.client_id IS NOT NULL
ON CONFLICT (tenant_id, branch_id, source_type, source_id) DO UPDATE SET
  status = EXCLUDED.status,
  provider_message_id = EXCLUDED.provider_message_id,
  last_error = EXCLUDED.last_error,
  updated_at = EXCLUDED.updated_at;

INSERT INTO client_communications (
  tenant_id, branch_id, client_id, source_type, source_id, channel, status,
  recipient, subject, body, provider_message_id, last_error, occurred_at, updated_at
)
SELECT outbox.tenant_id, outbox.branch_id, sale.client_id, 'invoice', outbox.id,
       outbox.channel, outbox.status, outbox.recipient,
       COALESCE(NULLIF(outbox.payload_json->>'subject', ''), 'Invoice ' || sale.invoice_number),
       COALESCE(outbox.payload_json->>'message', ''), outbox.external_message_id, outbox.last_error,
       outbox.created_at, COALESCE(outbox.updated_at, outbox.created_at)
  FROM pos_invoice_outbox outbox
  JOIN pos_sales sale
    ON sale.tenant_id = outbox.tenant_id
   AND sale.branch_id = outbox.branch_id
   AND sale.id = outbox.sale_id
 WHERE sale.client_id IS NOT NULL
ON CONFLICT (tenant_id, branch_id, source_type, source_id) DO UPDATE SET
  status = EXCLUDED.status,
  provider_message_id = EXCLUDED.provider_message_id,
  last_error = EXCLUDED.last_error,
  updated_at = EXCLUDED.updated_at;
