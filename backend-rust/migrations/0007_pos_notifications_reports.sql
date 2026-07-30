CREATE TABLE IF NOT EXISTS pos_sales (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  staff_id TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL,
  subtotal_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  tax_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL DEFAULT 0,
  paid_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'manual',
  reference_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pos_sale_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 0,
  unit_price_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  tax_percent INTEGER NOT NULL DEFAULT 0,
  line_total_paise BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT pos_sale_lines_qty_non_negative CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS pos_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount_paise BIGINT NOT NULL DEFAULT 0,
  method_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_tenant_branch
  ON pos_sales (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sale_lines_sale
  ON pos_sale_lines (tenant_id, branch_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_sale
  ON pos_payments (tenant_id, branch_id, sale_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_unique
  ON pos_sales (tenant_id, branch_id, invoice_number);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  notification_type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_branch
  ON notifications (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (tenant_id, branch_id, is_read)
  WHERE is_read = FALSE;

CREATE TABLE IF NOT EXISTS report_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_snapshots_tenant_branch
  ON report_snapshots (tenant_id, branch_id, created_at DESC, report_type);
