ALTER TABLE supplier_communication_queue
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_supplier_communication_due
  ON supplier_communication_queue(next_attempt_at, created_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_supplier_communication_failed_scope
  ON supplier_communication_queue(tenant_id, branch_id, attempts, updated_at DESC)
  WHERE status = 'failed';
