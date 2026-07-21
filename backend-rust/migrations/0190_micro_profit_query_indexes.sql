CREATE INDEX IF NOT EXISTS idx_pos_staff_commission_snapshots_profit_period
  ON pos_staff_commission_snapshots
  (tenant_id, branch_id, business_date, sale_line_id);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_ledger_profit_period
  ON inventory_stock_ledger
  (tenant_id, branch_id, ((created_at AT TIME ZONE 'Asia/Kolkata')::DATE), sale_line_id)
  WHERE movement_type IN ('sale','return');

CREATE INDEX IF NOT EXISTS idx_pos_invoice_refunds_profit_period
  ON pos_invoice_refunds
  (tenant_id, branch_id, ((created_at AT TIME ZONE 'Asia/Kolkata')::DATE), sale_id);
