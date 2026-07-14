CREATE TABLE IF NOT EXISTS pos_staff_commission_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  sale_line_id TEXT NOT NULL REFERENCES pos_sale_lines(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  split_bps INTEGER NOT NULL CHECK (split_bps > 0 AND split_bps <= 10000),
  base_paise BIGINT NOT NULL CHECK (base_paise >= 0),
  rate_percent INTEGER NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  commission_paise BIGINT NOT NULL CHECK (commission_paise >= 0),
  rule_source TEXT NOT NULL DEFAULT '',
  rule_id TEXT NOT NULL DEFAULT '',
  rule_name TEXT NOT NULL DEFAULT '',
  business_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sale_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, sale_line_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_commission_snapshots_sale
  ON pos_staff_commission_snapshots(tenant_id, branch_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_pos_staff_commission_snapshots_staff_date
  ON pos_staff_commission_snapshots(tenant_id, branch_id, staff_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_pos_staff_commission_snapshots_item
  ON pos_staff_commission_snapshots(tenant_id, branch_id, line_type, item_id);
