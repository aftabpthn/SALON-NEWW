-- Phase 17: one communication identity/timeline across provider channels.
ALTER TABLE client_communications DROP CONSTRAINT IF EXISTS client_communications_source_type_check;
ALTER TABLE client_communications ADD CONSTRAINT client_communications_source_type_check
  CHECK (source_type IN ('invoice','benefit','marketing','provider','voice'));
ALTER TABLE client_communications DROP CONSTRAINT IF EXISTS client_communications_channel_check;
ALTER TABLE client_communications ADD CONSTRAINT client_communications_channel_check
  CHECK (channel IN ('whatsapp','sms','email','voice','web_chat'));
ALTER TABLE client_communications ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE client_communications ADD COLUMN IF NOT EXISTS lead_id TEXT REFERENCES marketing_leads(id) ON DELETE SET NULL;
ALTER TABLE client_communications DROP CONSTRAINT IF EXISTS client_communications_identity_check;
ALTER TABLE client_communications ADD CONSTRAINT client_communications_identity_check
  CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_client_communications_lead
  ON client_communications(tenant_id,branch_id,lead_id,occurred_at DESC) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS communication_thread_states (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES marketing_leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to TEXT NOT NULL DEFAULT '',
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_responded_at TIMESTAMPTZ,
  sla_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '30 minutes'),
  resolved_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((client_id IS NOT NULL)::INTEGER + (lead_id IS NOT NULL)::INTEGER = 1),
  UNIQUE(tenant_id,branch_id,thread_key)
);
CREATE INDEX IF NOT EXISTS idx_communication_thread_work_queue
  ON communication_thread_states(tenant_id,branch_id,status,priority,sla_due_at,last_activity_at DESC);

CREATE TABLE IF NOT EXISTS communication_thread_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES communication_thread_states(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  before_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  after_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_communication_thread_audit_scope
  ON communication_thread_audit(tenant_id,branch_id,thread_id,created_at DESC);

CREATE OR REPLACE FUNCTION sync_communication_thread_state()
RETURNS TRIGGER AS $$
DECLARE
  v_thread_key TEXT;
  v_sla_minutes INTEGER;
BEGIN
  v_thread_key := CASE WHEN NEW.client_id IS NOT NULL THEN 'client:'||NEW.client_id ELSE 'lead:'||NEW.lead_id END;
  SELECT LEAST(1440,GREATEST(5,COALESCE(NULLIF(settings_json->>'slaMinutes','')::INTEGER,30)))
    INTO v_sla_minutes FROM message_history_settings
   WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id;
  v_sla_minutes := COALESCE(v_sla_minutes,30);

  INSERT INTO communication_thread_states(
    tenant_id,branch_id,thread_key,client_id,lead_id,status,first_received_at,
    first_responded_at,sla_due_at,last_activity_at
  ) VALUES (
    NEW.tenant_id,NEW.branch_id,v_thread_key,NEW.client_id,NEW.lead_id,
    CASE WHEN NEW.direction='inbound' THEN 'open' ELSE 'assigned' END,
    NEW.occurred_at,CASE WHEN NEW.direction='outbound' THEN NEW.occurred_at END,
    NEW.occurred_at+MAKE_INTERVAL(mins=>v_sla_minutes),NEW.occurred_at
  )
  ON CONFLICT(tenant_id,branch_id,thread_key) DO UPDATE SET
    client_id=COALESCE(EXCLUDED.client_id,communication_thread_states.client_id),
    lead_id=COALESCE(EXCLUDED.lead_id,communication_thread_states.lead_id),
    status=CASE WHEN NEW.direction='inbound' AND communication_thread_states.status='resolved' THEN 'open' ELSE communication_thread_states.status END,
    first_responded_at=CASE WHEN NEW.direction='outbound' THEN COALESCE(communication_thread_states.first_responded_at,NEW.occurred_at) ELSE communication_thread_states.first_responded_at END,
    sla_due_at=CASE WHEN NEW.direction='inbound' AND communication_thread_states.status='resolved' THEN NEW.occurred_at+MAKE_INTERVAL(mins=>v_sla_minutes) ELSE communication_thread_states.sla_due_at END,
    resolved_at=CASE WHEN NEW.direction='inbound' AND communication_thread_states.status='resolved' THEN NULL ELSE communication_thread_states.resolved_at END,
    last_activity_at=GREATEST(communication_thread_states.last_activity_at,NEW.occurred_at),
    updated_at=NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_communication_thread_state ON client_communications;
CREATE TRIGGER trg_client_communication_thread_state
AFTER INSERT OR UPDATE OF status,occurred_at ON client_communications
FOR EACH ROW EXECUTE FUNCTION sync_communication_thread_state();

INSERT INTO communication_thread_states(
  tenant_id,branch_id,thread_key,client_id,lead_id,status,first_received_at,
  first_responded_at,sla_due_at,last_activity_at
)
SELECT communication.tenant_id,communication.branch_id,
       CASE WHEN communication.client_id IS NOT NULL THEN 'client:'||communication.client_id ELSE 'lead:'||communication.lead_id END,
       communication.client_id,communication.lead_id,'open',
       MIN(communication.occurred_at) FILTER(WHERE communication.direction='inbound'),
       MIN(communication.occurred_at) FILTER(WHERE communication.direction='outbound'),
       MIN(communication.occurred_at) FILTER(WHERE communication.direction='inbound')+INTERVAL '30 minutes',
       MAX(communication.occurred_at)
  FROM client_communications communication
 GROUP BY communication.tenant_id,communication.branch_id,communication.client_id,communication.lead_id
HAVING COUNT(*) FILTER(WHERE communication.direction='inbound')>0
ON CONFLICT(tenant_id,branch_id,thread_key) DO NOTHING;

ALTER TABLE ai_voice_call_records
  ADD COLUMN IF NOT EXISTS recording_consent_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS recording_retention_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_queue TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extension TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voicemail BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_voice_call_records DROP CONSTRAINT IF EXISTS ai_voice_recording_consent_check;
ALTER TABLE ai_voice_call_records ADD CONSTRAINT ai_voice_recording_consent_check
  CHECK (recording_consent_status IN ('unknown','granted','declined','legal_notice'));
CREATE INDEX IF NOT EXISTS idx_ai_voice_voicemail_queue
  ON ai_voice_call_records(tenant_id,branch_id,voicemail,status,created_at DESC);

CREATE OR REPLACE FUNCTION sync_voice_communication()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.client_id IS NULL AND NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO client_communications(
    id,tenant_id,branch_id,client_id,lead_id,source_type,source_id,channel,direction,status,
    recipient,subject,body,provider_message_id,occurred_at,updated_at
  ) VALUES (
    'voice:'||NEW.id,NEW.tenant_id,NEW.branch_id,NEW.client_id,NEW.lead_id,'voice',NEW.id,'voice',NEW.direction,NEW.status,
    NEW.caller_phone,CASE WHEN NEW.voicemail THEN 'Voicemail' ELSE 'Voice call' END,
    COALESCE(NULLIF(NEW.ai_summary,''),NULLIF(NEW.lost_reason,''),NEW.status),NEW.provider_call_id,
    COALESCE(NEW.started_at,NEW.created_at),NOW()
  ) ON CONFLICT(tenant_id,branch_id,source_type,source_id) DO UPDATE SET
    client_id=EXCLUDED.client_id,lead_id=EXCLUDED.lead_id,status=EXCLUDED.status,
    subject=EXCLUDED.subject,body=EXCLUDED.body,occurred_at=EXCLUDED.occurred_at,updated_at=NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voice_communication ON ai_voice_call_records;
CREATE TRIGGER trg_voice_communication
AFTER INSERT OR UPDATE ON ai_voice_call_records
FOR EACH ROW EXECUTE FUNCTION sync_voice_communication();

INSERT INTO client_communications(
  id,tenant_id,branch_id,client_id,lead_id,source_type,source_id,channel,direction,status,
  recipient,subject,body,provider_message_id,occurred_at,updated_at
)
SELECT 'voice:'||call.id,call.tenant_id,call.branch_id,call.client_id,call.lead_id,'voice',call.id,'voice',call.direction,call.status,
       call.caller_phone,CASE WHEN call.voicemail THEN 'Voicemail' ELSE 'Voice call' END,
       COALESCE(NULLIF(call.ai_summary,''),NULLIF(call.lost_reason,''),call.status),call.provider_call_id,
       COALESCE(call.started_at,call.created_at),NOW()
  FROM ai_voice_call_records call
 WHERE call.client_id IS NOT NULL OR call.lead_id IS NOT NULL
ON CONFLICT(tenant_id,branch_id,source_type,source_id) DO NOTHING;
