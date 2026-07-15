CREATE TABLE IF NOT EXISTS integration_api_keys (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  rotated_from_id TEXT REFERENCES integration_api_keys(id),
  created_by TEXT NOT NULL,
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_prefix)
);
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_scope
  ON integration_api_keys(tenant_id,branch_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS integration_webhook_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  events_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  secret_ciphertext TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_webhooks_scope
  ON integration_webhook_subscriptions(tenant_id,branch_id,active,created_at DESC);

CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES integration_webhook_subscriptions(id),
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_status INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscription_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_integration_webhook_delivery_due
  ON integration_webhook_deliveries(status,next_attempt_at,created_at)
  WHERE status IN ('queued','failed');

CREATE OR REPLACE FUNCTION enqueue_integration_webhook_event()
RETURNS TRIGGER AS $$
DECLARE
  event_name TEXT := TG_ARGV[0];
  entity_id TEXT := NEW.id::TEXT;
  event_key TEXT;
  payload JSONB;
BEGIN
  IF TG_OP='UPDATE' AND TG_ARGV[1]='status'
     AND (to_jsonb(OLD)->>'status') IS NOT DISTINCT FROM (to_jsonb(NEW)->>'status') THEN
    RETURN NEW;
  END IF;
  event_key := TG_TABLE_NAME || ':' || entity_id || ':' || event_name || ':' || gen_random_uuid()::TEXT;
  payload := jsonb_build_object(
    'id',event_key,'type',event_name,'createdAt',NOW(),
    'data',jsonb_build_object('entityId',entity_id,'status',CASE WHEN TG_ARGV[1]='status' THEN to_jsonb(NEW)->>'status' ELSE NULL END)
  );
  INSERT INTO integration_webhook_deliveries(
    tenant_id,branch_id,subscription_id,event_type,event_id,payload_json
  )
  SELECT NEW.tenant_id,NEW.branch_id,s.id,event_name,event_key,payload
    FROM integration_webhook_subscriptions s
   WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
     AND s.active=TRUE AND s.events_json ? event_name
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_integration_client_created ON clients;
CREATE TRIGGER trg_integration_client_created AFTER INSERT ON clients
FOR EACH ROW EXECUTE FUNCTION enqueue_integration_webhook_event('client.created','');

DROP TRIGGER IF EXISTS trg_integration_appointment_created ON appointments;
CREATE TRIGGER trg_integration_appointment_created AFTER INSERT ON appointments
FOR EACH ROW EXECUTE FUNCTION enqueue_integration_webhook_event('appointment.created','');

DROP TRIGGER IF EXISTS trg_integration_appointment_status ON appointments;
CREATE TRIGGER trg_integration_appointment_status AFTER UPDATE OF status ON appointments
FOR EACH ROW EXECUTE FUNCTION enqueue_integration_webhook_event('appointment.status_changed','status');

DROP TRIGGER IF EXISTS trg_integration_sale_status ON pos_sales;
CREATE TRIGGER trg_integration_sale_status AFTER UPDATE OF status ON pos_sales
FOR EACH ROW EXECUTE FUNCTION enqueue_integration_webhook_event('sale.status_changed','status');
