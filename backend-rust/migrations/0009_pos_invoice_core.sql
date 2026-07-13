ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'tax_invoice';

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS business_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch_business_date
  ON pos_sales (tenant_id, branch_id, business_date, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_invoice_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_events_sale
  ON pos_invoice_events (tenant_id, branch_id, sale_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_events_type
  ON pos_invoice_events (tenant_id, branch_id, event_type, created_at DESC);
