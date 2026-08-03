-- Observable webhook delivery, dead-letter recovery and audited replay.

ALTER TABLE integration_webhook_deliveries
  DROP CONSTRAINT IF EXISTS integration_webhook_deliveries_status_check;
ALTER TABLE integration_webhook_deliveries
  ADD CONSTRAINT integration_webhook_deliveries_status_check
  CHECK (status IN ('queued','processing','delivered','failed','dead_letter')),
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replayed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_integration_webhook_dead_letter
  ON integration_webhook_deliveries(tenant_id,branch_id,updated_at DESC)
  WHERE status='dead_letter';

CREATE TABLE IF NOT EXISTS integration_webhook_delivery_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES integration_webhook_deliveries(id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('delivered','retry','dead_letter')),
  response_status INTEGER,
  duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(delivery_id,attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_integration_webhook_attempt_scope
  ON integration_webhook_delivery_attempts(tenant_id,branch_id,delivery_id,attempt_no DESC);

CREATE OR REPLACE FUNCTION prevent_integration_webhook_attempt_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'webhook delivery attempts are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_integration_webhook_attempt_immutable
  ON integration_webhook_delivery_attempts;
CREATE TRIGGER trg_integration_webhook_attempt_immutable
BEFORE UPDATE OR DELETE ON integration_webhook_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_integration_webhook_attempt_mutation();
