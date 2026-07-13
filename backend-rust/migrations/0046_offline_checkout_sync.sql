CREATE TABLE IF NOT EXISTS offline_checkout_operations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  sale_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'conflict', 'failed')),
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, operation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_offline_operation
  ON pos_sales (tenant_id, branch_id, source, reference_id)
  WHERE source = 'offline_sync' AND reference_id <> '';
