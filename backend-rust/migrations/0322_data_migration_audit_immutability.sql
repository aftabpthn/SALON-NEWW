CREATE OR REPLACE FUNCTION reject_integration_import_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'migration audit events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_integration_import_audit_immutable
  ON integration_import_audit_events;
CREATE TRIGGER trg_integration_import_audit_immutable
BEFORE UPDATE OR DELETE ON integration_import_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_integration_import_audit_mutation();
