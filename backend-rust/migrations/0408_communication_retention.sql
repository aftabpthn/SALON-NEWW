ALTER TABLE client_communications
  ADD COLUMN IF NOT EXISTS retained_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_communication_retention()
RETURNS TRIGGER AS $$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT LEAST(3650,GREATEST(1,COALESCE(
           NULLIF(settings_json->>'retentionDays','')::INTEGER,
           NULLIF(settings_json->>'historyDays','')::INTEGER,
           365)))
    INTO v_days FROM message_history_settings
   WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id;
  NEW.retained_until := COALESCE(NEW.retained_until,NEW.occurred_at+MAKE_INTERVAL(days=>COALESCE(v_days,365)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_communication_retention ON client_communications;
CREATE TRIGGER trg_client_communication_retention
BEFORE INSERT OR UPDATE OF occurred_at ON client_communications
FOR EACH ROW EXECUTE FUNCTION set_communication_retention();

UPDATE client_communications communication
   SET retained_until=communication.occurred_at+MAKE_INTERVAL(days=>COALESCE((
         SELECT LEAST(3650,GREATEST(1,COALESCE(
           NULLIF(settings.settings_json->>'retentionDays','')::INTEGER,
           NULLIF(settings.settings_json->>'historyDays','')::INTEGER,
           365)))
           FROM message_history_settings settings
          WHERE settings.tenant_id=communication.tenant_id AND settings.branch_id=communication.branch_id
       ),365))
 WHERE retained_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_communications_retention
  ON client_communications(retained_until) WHERE redacted_at IS NULL;
