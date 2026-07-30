CREATE TABLE IF NOT EXISTS branch_bulk_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  requested_from_branch_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_branch_count INTEGER NOT NULL,
  result_json JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, requested_from_branch_id)
    REFERENCES branches(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (BTRIM(idempotency_key) <> ''),
  CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (row_count BETWEEN 1 AND 1000),
  CHECK (created_branch_count BETWEEN 1 AND row_count)
);

CREATE INDEX IF NOT EXISTS idx_branch_bulk_imports_tenant_created
  ON branch_bulk_imports(tenant_id, created_at DESC);
