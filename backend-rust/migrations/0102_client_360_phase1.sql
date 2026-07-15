CREATE TABLE IF NOT EXISTS client_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'general',
  note TEXT NOT NULL CHECK (BTRIM(note) <> ''),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_notes_client
  ON client_notes (tenant_id, branch_id, client_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_client_last_visit_from_appointment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('completed', 'billed', 'paid') AND NEW.start_at <= NOW() THEN
    UPDATE clients
       SET last_visit_at = GREATEST(COALESCE(last_visit_at, NEW.start_at), NEW.start_at),
           updated_at = NOW()
     WHERE id = NEW.client_id
       AND tenant_id = NEW.tenant_id
       AND branch_id = NEW.branch_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_client_last_visit ON appointments;
CREATE TRIGGER trg_appointments_client_last_visit
AFTER INSERT OR UPDATE OF status, start_at, client_id ON appointments
FOR EACH ROW EXECUTE FUNCTION update_client_last_visit_from_appointment();

UPDATE clients client
   SET last_visit_at = history.last_visit_at,
       updated_at = NOW()
  FROM (
    SELECT tenant_id, branch_id, client_id, MAX(start_at) AS last_visit_at
      FROM appointments
     WHERE status IN ('completed', 'billed', 'paid') AND start_at <= NOW()
     GROUP BY tenant_id, branch_id, client_id
  ) history
 WHERE client.id = history.client_id
   AND client.tenant_id = history.tenant_id
   AND client.branch_id = history.branch_id
   AND (client.last_visit_at IS NULL OR client.last_visit_at < history.last_visit_at);
