-- Canonical Micro P&L projection. Durable truth remains in the operational and
-- accounting ledgers; this view only aligns those immutable events by sale line.
CREATE OR REPLACE VIEW micro_profit_events AS
SELECT sale.tenant_id,
       sale.branch_id,
       sale.business_date,
       sale.id AS sale_id,
       line.id AS sale_line_id,
       'sale_origin'::TEXT AS event_type,
       CASE WHEN line.line_type IN ('membership','package')
         THEN 0 ELSE line.taxable_paise END::BIGINT AS recognized_revenue_paise,
       0::BIGINT AS product_cost_paise,
       0::BIGINT AS staff_cost_paise,
       'pos_sale_line'::TEXT AS source_type,
       line.id AS source_id
  FROM pos_sale_lines line
  JOIN pos_sales sale
    ON sale.id=line.sale_id
   AND sale.tenant_id=line.tenant_id
   AND sale.branch_id=line.branch_id
 WHERE sale.status NOT IN ('draft','open','voided','cancelled')

UNION ALL

SELECT refund.tenant_id,
       refund.branch_id,
       (refund.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
       refund.sale_id,
       refund_line.sale_line_id,
       'refund'::TEXT,
       -CASE WHEN sale_line.line_total_paise>0
         THEN ROUND(
           refund_line.amount_paise::NUMERIC*sale_line.taxable_paise
           / sale_line.line_total_paise
         )::BIGINT
         ELSE 0 END,
       0::BIGINT,
       0::BIGINT,
       'pos_invoice_refund_line'::TEXT,
       refund_line.id
  FROM pos_invoice_refund_lines refund_line
  JOIN pos_invoice_refunds refund
    ON refund.id=refund_line.refund_id
   AND refund.tenant_id=refund_line.tenant_id
   AND refund.branch_id=refund_line.branch_id
  JOIN pos_sale_lines sale_line
    ON sale_line.id=refund_line.sale_line_id
   AND sale_line.tenant_id=refund_line.tenant_id
   AND sale_line.branch_id=refund_line.branch_id

UNION ALL

SELECT schedule.tenant_id,
       schedule.branch_id,
       entry.entry_date,
       schedule.sale_id,
       schedule.sale_line_id,
       'deferred_revenue_recognition'::TEXT,
       (journal_line.credit_paise-journal_line.debit_paise)::BIGINT,
       0::BIGINT,
       0::BIGINT,
       'accounting_journal_entry'::TEXT,
       entry.id
  FROM accounting_deferred_revenue_schedules schedule
  JOIN accounting_journal_entries entry
    ON entry.tenant_id=schedule.tenant_id
   AND entry.branch_id=schedule.branch_id
   AND entry.source_type='deferred_revenue_recognition'
   AND entry.source_id=schedule.id
  JOIN accounting_journal_lines journal_line
    ON journal_line.journal_entry_id=entry.id
   AND journal_line.account_code='SALES_REVENUE'

UNION ALL

SELECT stock.tenant_id,
       stock.branch_id,
       (stock.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
       stock.sale_id,
       stock.sale_line_id,
       CASE WHEN stock.movement_type='return'
         THEN 'product_cost_reversal' ELSE 'product_cost' END::TEXT,
       0::BIGINT,
       CASE WHEN stock.movement_type='return'
         THEN -(ABS(stock.quantity_delta)::BIGINT*stock.unit_cost_paise)
         ELSE ABS(stock.quantity_delta)::BIGINT*stock.unit_cost_paise END,
       0::BIGINT,
       'inventory_stock_ledger'::TEXT,
       stock.id
  FROM inventory_stock_ledger stock
 WHERE stock.movement_type IN ('sale','return')

UNION ALL

SELECT commission.tenant_id,
       commission.branch_id,
       commission.business_date,
       commission.sale_id,
       commission.sale_line_id,
       'staff_commission'::TEXT,
       0::BIGINT,
       0::BIGINT,
       commission.commission_paise::BIGINT,
       'pos_staff_commission_snapshot'::TEXT,
       commission.id
  FROM pos_staff_commission_snapshots commission;
