CREATE TABLE IF NOT EXISTS inventory_api_idempotency (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  response_status INTEGER,
  response_content_type TEXT NOT NULL DEFAULT 'application/json',
  response_body BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, actor_user_id, idempotency_key),
  CHECK (CHAR_LENGTH(idempotency_key) BETWEEN 8 AND 160),
  CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  CHECK (status IN ('processing','completed')),
  CHECK (CHAR_LENGTH(request_hash) = 64),
  CHECK (
    (status='processing' AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR
    (status='completed' AND response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_inventory_api_idempotency_scope_time
  ON inventory_api_idempotency(tenant_id,branch_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_inventory_mutations
  ON auth_audit_logs(tenant_id,branch_id,created_at DESC)
  WHERE event_type='inventory.api.mutation';
