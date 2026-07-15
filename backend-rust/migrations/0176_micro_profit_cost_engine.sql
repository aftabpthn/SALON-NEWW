-- Phase 2 Micro P&L cost engine. Operational and accounting ledgers remain the
-- monetary truth; these additions preserve exact redemption values and version
-- the rules used to allocate recorded overhead.

ALTER TABLE client_membership_credits
  ADD COLUMN IF NOT EXISTS unit_value_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issued_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE client_membership_credits
  DROP CONSTRAINT IF EXISTS client_membership_credits_value_check;
ALTER TABLE client_membership_credits
  ADD CONSTRAINT client_membership_credits_value_check CHECK (
    unit_value_paise >= 0 AND issued_value_paise >= 0
  );

ALTER TABLE pos_membership_redemptions
  ADD COLUMN IF NOT EXISTS unit_value_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS redeemed_value_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_membership_redemptions
  DROP CONSTRAINT IF EXISTS pos_membership_redemptions_value_check;
ALTER TABLE pos_membership_redemptions
  ADD CONSTRAINT pos_membership_redemptions_value_check CHECK (
    unit_value_paise >= 0 AND redeemed_value_paise >= 0
  );

WITH weighted AS (
  SELECT credit.id,
         line.taxable_paise,
         GREATEST(COALESCE(service.price_paise,0),1)::NUMERIC
           * GREATEST(credit.total_qty,1) AS weight,
         SUM(GREATEST(COALESCE(service.price_paise,0),1)::NUMERIC
           * GREATEST(credit.total_qty,1)) OVER (
             PARTITION BY credit.tenant_id,credit.branch_id,credit.source_sale_id,credit.membership_id
           ) AS total_weight,
         SUM(GREATEST(COALESCE(service.price_paise,0),1)::NUMERIC
           * GREATEST(credit.total_qty,1)) OVER (
             PARTITION BY credit.tenant_id,credit.branch_id,credit.source_sale_id,credit.membership_id
             ORDER BY credit.created_at,credit.id
           ) AS cumulative_weight,
         credit.total_qty
    FROM client_membership_credits credit
    JOIN pos_sale_lines line
      ON line.tenant_id=credit.tenant_id AND line.branch_id=credit.branch_id
     AND line.sale_id=credit.source_sale_id AND line.line_type='membership'
     AND line.item_id=credit.membership_id
    LEFT JOIN services service
      ON service.tenant_id=credit.tenant_id AND service.branch_id=credit.branch_id
     AND service.id=credit.service_id
), allocated AS (
  SELECT id,total_qty,
         ROUND(taxable_paise::NUMERIC*cumulative_weight/NULLIF(total_weight,0))::BIGINT
         - ROUND(taxable_paise::NUMERIC*(cumulative_weight-weight)/NULLIF(total_weight,0))::BIGINT
           AS issued_value_paise
    FROM weighted
)
UPDATE client_membership_credits credit
   SET issued_value_paise=GREATEST(allocated.issued_value_paise,0),
       unit_value_paise=CASE WHEN allocated.total_qty>0
         THEN GREATEST(allocated.issued_value_paise,0)/allocated.total_qty ELSE 0 END
  FROM allocated
 WHERE credit.id=allocated.id AND credit.issued_value_paise=0;

WITH redemption_value AS (
  SELECT redemption.id,credit.unit_value_paise,
         ROUND(credit.issued_value_paise::NUMERIC
           * SUM(redemption.quantity) OVER (
               PARTITION BY redemption.client_membership_credit_id
               ORDER BY redemption.created_at,redemption.id
             ) / NULLIF(credit.total_qty,0))::BIGINT
         - ROUND(credit.issued_value_paise::NUMERIC
           * (SUM(redemption.quantity) OVER (
                PARTITION BY redemption.client_membership_credit_id
                ORDER BY redemption.created_at,redemption.id
              )-redemption.quantity) / NULLIF(credit.total_qty,0))::BIGINT
           AS redeemed_value_paise
    FROM pos_membership_redemptions redemption
    JOIN client_membership_credits credit
      ON credit.id=redemption.client_membership_credit_id
     AND credit.tenant_id=redemption.tenant_id
)
UPDATE pos_membership_redemptions redemption
   SET unit_value_paise=redemption_value.unit_value_paise,
       redeemed_value_paise=GREATEST(redemption_value.redeemed_value_paise,0)
  FROM redemption_value
 WHERE redemption.id=redemption_value.id AND redemption.redeemed_value_paise=0;

CREATE INDEX IF NOT EXISTS idx_pos_membership_redemptions_credit_value
  ON pos_membership_redemptions
    (tenant_id, branch_id, client_membership_credit_id, created_at);

CREATE TABLE IF NOT EXISTS micro_profit_allocation_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 120),
  version INTEGER NOT NULL CHECK (version > 0),
  driver TEXT NOT NULL CHECK (driver IN (
    'service_minutes','chair_resource_minutes','revenue_share','headcount','transaction_count'
  )),
  account_codes TEXT[] NOT NULL CHECK (CARDINALITY(account_codes) BETWEEN 1 AND 50),
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (tenant_id, branch_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_micro_profit_allocation_rules_scope
  ON micro_profit_allocation_rules
    (tenant_id, branch_id, effective_from, effective_to, name, version DESC);

CREATE OR REPLACE VIEW micro_profit_events AS
SELECT sale.tenant_id,sale.branch_id,sale.business_date,sale.id AS sale_id,
       line.id AS sale_line_id,'sale_origin'::TEXT AS event_type,
       CASE WHEN line.line_type IN ('membership','package') THEN 0
         ELSE line.taxable_paise END::BIGINT AS recognized_revenue_paise,
       0::BIGINT AS product_cost_paise,0::BIGINT AS staff_cost_paise,
       'pos_sale_line'::TEXT AS source_type,line.id AS source_id
  FROM pos_sale_lines line
  JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id
   AND sale.branch_id=line.branch_id
 WHERE sale.status NOT IN ('draft','open','voided','cancelled')

UNION ALL
SELECT refund.tenant_id,refund.branch_id,
       (refund.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,refund.sale_id,
       refund_line.sale_line_id,'refund'::TEXT,
       -CASE WHEN sale_line.line_total_paise>0 THEN ROUND(
         refund_line.amount_paise::NUMERIC*sale_line.taxable_paise/sale_line.line_total_paise
       )::BIGINT ELSE 0 END,0::BIGINT,0::BIGINT,
       'pos_invoice_refund_line'::TEXT,refund_line.id
  FROM pos_invoice_refund_lines refund_line
  JOIN pos_invoice_refunds refund ON refund.id=refund_line.refund_id
   AND refund.tenant_id=refund_line.tenant_id AND refund.branch_id=refund_line.branch_id
  JOIN pos_sale_lines sale_line ON sale_line.id=refund_line.sale_line_id
   AND sale_line.tenant_id=refund_line.tenant_id AND sale_line.branch_id=refund_line.branch_id

UNION ALL
SELECT schedule.tenant_id,schedule.branch_id,entry.entry_date,schedule.sale_id,
       schedule.sale_line_id,'deferred_revenue_recognition'::TEXT,
       (journal_line.credit_paise-journal_line.debit_paise)::BIGINT,0::BIGINT,0::BIGINT,
       'accounting_journal_entry'::TEXT,entry.id
  FROM accounting_deferred_revenue_schedules schedule
  JOIN accounting_journal_entries entry ON entry.tenant_id=schedule.tenant_id
   AND entry.branch_id=schedule.branch_id AND entry.source_type='deferred_revenue_recognition'
   AND entry.source_id=schedule.id
  JOIN accounting_journal_lines journal_line ON journal_line.journal_entry_id=entry.id
   AND journal_line.account_code='SALES_REVENUE'
 WHERE NOT EXISTS (
   SELECT 1 FROM client_package_credits credit
   JOIN pos_package_redemptions redemption
     ON redemption.client_package_credit_id=credit.id AND redemption.tenant_id=credit.tenant_id
    WHERE credit.tenant_id=schedule.tenant_id AND credit.branch_id=schedule.branch_id
      AND credit.source_sale_id=schedule.sale_id AND schedule.source_type='package'
 ) AND NOT EXISTS (
   SELECT 1 FROM client_membership_credits credit
   JOIN pos_membership_redemptions redemption
     ON redemption.client_membership_credit_id=credit.id AND redemption.tenant_id=credit.tenant_id
    WHERE credit.tenant_id=schedule.tenant_id AND credit.branch_id=schedule.branch_id
      AND credit.source_sale_id=schedule.sale_id AND schedule.source_type='membership'
 )

UNION ALL
SELECT redemption.tenant_id,redemption.branch_id,sale.business_date,redemption.sale_id,
       line.id,'package_redemption_revenue'::TEXT,redemption.redeemed_value_paise,
       0::BIGINT,0::BIGINT,'pos_package_redemption'::TEXT,redemption.id
  FROM pos_package_redemptions redemption
  JOIN pos_sales sale ON sale.id=redemption.sale_id AND sale.tenant_id=redemption.tenant_id
   AND sale.branch_id=redemption.branch_id
  JOIN LATERAL (
    SELECT sale_line.id FROM pos_sale_lines sale_line
     WHERE sale_line.tenant_id=redemption.tenant_id
       AND sale_line.branch_id=redemption.branch_id AND sale_line.sale_id=redemption.sale_id
       AND sale_line.line_type='package_redeem'
       AND sale_line.item_id=redemption.client_package_credit_id
     ORDER BY sale_line.created_at,sale_line.id LIMIT 1
  ) line ON TRUE

UNION ALL
SELECT redemption.tenant_id,redemption.branch_id,sale.business_date,redemption.sale_id,
       line.id,'membership_redemption_revenue'::TEXT,redemption.redeemed_value_paise,
       0::BIGINT,0::BIGINT,'pos_membership_redemption'::TEXT,redemption.id
  FROM pos_membership_redemptions redemption
  JOIN pos_sales sale ON sale.id=redemption.sale_id AND sale.tenant_id=redemption.tenant_id
   AND sale.branch_id=redemption.branch_id
  JOIN LATERAL (
    SELECT sale_line.id FROM pos_sale_lines sale_line
     WHERE sale_line.tenant_id=redemption.tenant_id
       AND sale_line.branch_id=redemption.branch_id AND sale_line.sale_id=redemption.sale_id
       AND sale_line.line_type='membership_redeem'
       AND sale_line.item_id=redemption.client_membership_credit_id
     ORDER BY sale_line.created_at,sale_line.id LIMIT 1
  ) line ON TRUE

UNION ALL
SELECT stock.tenant_id,stock.branch_id,
       (stock.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,stock.sale_id,stock.sale_line_id,
       CASE WHEN stock.movement_type='return' THEN 'product_cost_reversal'
         ELSE 'product_cost' END::TEXT,0::BIGINT,
       CASE WHEN stock.movement_type='return'
         THEN -(ABS(stock.quantity_delta)::BIGINT*stock.unit_cost_paise)
         ELSE ABS(stock.quantity_delta)::BIGINT*stock.unit_cost_paise END,
       0::BIGINT,'inventory_stock_ledger'::TEXT,stock.id
  FROM inventory_stock_ledger stock WHERE stock.movement_type IN ('sale','return')

UNION ALL
SELECT commission.tenant_id,commission.branch_id,commission.business_date,
       commission.sale_id,commission.sale_line_id,'staff_commission'::TEXT,
       0::BIGINT,0::BIGINT,commission.commission_paise::BIGINT,
       'pos_staff_commission_snapshot'::TEXT,commission.id
  FROM pos_staff_commission_snapshots commission;

CREATE OR REPLACE VIEW micro_profit_cost_events AS
WITH attributed_staff AS (
  SELECT line.tenant_id,line.branch_id,line.sale_id,line.id AS sale_line_id,
         sale.business_date,
         COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),
                  NULLIF(package_redemption.staff_id,''),NULLIF(membership_redemption.staff_id,''),'') AS staff_id,
         10000::BIGINT AS split_bps,
         COALESCE(service.duration_minutes,0)::BIGINT*GREATEST(line.quantity,1) AS service_minutes
    FROM pos_sale_lines line
    JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id
     AND sale.branch_id=line.branch_id
    LEFT JOIN pos_package_redemptions package_redemption
      ON package_redemption.tenant_id=line.tenant_id AND package_redemption.branch_id=line.branch_id
     AND package_redemption.sale_id=line.sale_id
     AND package_redemption.client_package_credit_id=line.item_id
    LEFT JOIN pos_membership_redemptions membership_redemption
      ON membership_redemption.tenant_id=line.tenant_id AND membership_redemption.branch_id=line.branch_id
     AND membership_redemption.sale_id=line.sale_id
     AND membership_redemption.client_membership_credit_id=line.item_id
    LEFT JOIN services service ON service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
     AND service.id=CASE
       WHEN line.line_type='package_redeem' THEN package_redemption.service_id
       WHEN line.line_type='membership_redeem' THEN membership_redemption.service_id
       ELSE line.item_id END
   WHERE sale.status NOT IN ('draft','open','voided','cancelled')
     AND line.line_type IN ('service','package_redeem','membership_redeem')
     AND (jsonb_typeof(COALESCE(line.staff_splits,'[]'::JSONB))<>'array'
       OR jsonb_array_length(COALESCE(line.staff_splits,'[]'::JSONB))=0)
  UNION ALL
  SELECT line.tenant_id,line.branch_id,line.sale_id,line.id,sale.business_date,
         split.value->>'staffId',
         ROUND((split.value->>'percent')::NUMERIC*100)::BIGINT,
         COALESCE(service.duration_minutes,0)::BIGINT*GREATEST(line.quantity,1)
    FROM pos_sale_lines line
    JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id
     AND sale.branch_id=line.branch_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
    LEFT JOIN pos_package_redemptions package_redemption
      ON package_redemption.tenant_id=line.tenant_id AND package_redemption.branch_id=line.branch_id
     AND package_redemption.sale_id=line.sale_id
     AND package_redemption.client_package_credit_id=line.item_id
    LEFT JOIN pos_membership_redemptions membership_redemption
      ON membership_redemption.tenant_id=line.tenant_id AND membership_redemption.branch_id=line.branch_id
     AND membership_redemption.sale_id=line.sale_id
     AND membership_redemption.client_membership_credit_id=line.item_id
    LEFT JOIN services service ON service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
     AND service.id=CASE
       WHEN line.line_type='package_redeem' THEN package_redemption.service_id
       WHEN line.line_type='membership_redeem' THEN membership_redemption.service_id
       ELSE line.item_id END
   WHERE sale.status NOT IN ('draft','open','voided','cancelled')
     AND line.line_type IN ('service','package_redeem','membership_redeem')
     AND COALESCE(split.value->>'staffId','')<>''
     AND COALESCE(split.value->>'percent','') ~ '^[0-9]+([.][0-9]+)?$'
), staff_time AS (
  SELECT attribution.tenant_id,attribution.branch_id,attribution.business_date,
         attribution.sale_id,attribution.sale_line_id,'staff_time'::TEXT AS cost_type,
         ROUND((payroll.earned_salary_paise+payroll.overtime_paise)::NUMERIC
           * attribution.service_minutes*attribution.split_bps
           / NULLIF(payroll.worked_minutes::NUMERIC*10000,0))::BIGINT AS cost_paise,
         'staff_payroll_item'::TEXT AS source_type,payroll.id AS source_id
    FROM attributed_staff attribution
    JOIN staff_payroll_runs run ON run.tenant_id=attribution.tenant_id
     AND run.branch_id=attribution.branch_id
     AND attribution.business_date BETWEEN run.period_start AND run.period_end
     AND run.status IN ('finalized','paid')
    JOIN staff_payroll_items payroll ON payroll.payroll_run_id=run.id
     AND payroll.tenant_id=run.tenant_id AND payroll.branch_id=run.branch_id
     AND payroll.staff_id=attribution.staff_id AND payroll.worked_minutes>0
   WHERE attribution.service_minutes>0
), gateway_fee AS (
  SELECT payment.tenant_id,payment.branch_id,reconciliation.settlement_date,
         payment.sale_id,line.id AS sale_line_id,'gateway_fee'::TEXT AS cost_type,
         ROUND(reconciliation.fee_paise::NUMERIC*payment.amount_paise
           / NULLIF(reconciliation.system_gross_paise,0)
           * GREATEST(line.taxable_paise,0)
           / NULLIF(SUM(GREATEST(line.taxable_paise,0)) OVER (PARTITION BY reconciliation.id,payment.id),0)
         )::BIGINT AS cost_paise,
         'pos_provider_reconciliation'::TEXT AS source_type,reconciliation.id AS source_id
    FROM pos_provider_reconciliation_runs reconciliation
    JOIN pos_payments payment ON payment.tenant_id=reconciliation.tenant_id
     AND payment.branch_id=reconciliation.branch_id
     AND (LOWER(payment.method)=LOWER(reconciliation.provider)
       OR payment.idempotency_key ILIKE reconciliation.provider||':%')
    JOIN pos_sales sale ON sale.id=payment.sale_id AND sale.tenant_id=payment.tenant_id
     AND sale.branch_id=payment.branch_id AND sale.business_date=reconciliation.settlement_date
    JOIN pos_sale_lines line ON line.sale_id=sale.id AND line.tenant_id=sale.tenant_id
     AND line.branch_id=sale.branch_id
   WHERE reconciliation.status IN ('matched','reviewed') AND reconciliation.fee_paise>0
     AND reconciliation.system_gross_paise>0
), refund_fee AS (
  SELECT gateway.tenant_id,gateway.branch_id,
         (gateway.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,gateway.sale_id,
         refund_line.sale_line_id,'refund_gateway_fee'::TEXT AS cost_type,
         ROUND((CASE WHEN COALESCE(gateway.payload_json->>'feePaise',
                   gateway.payload_json->>'fee_paise',gateway.payload_json->>'fee','') ~ '^[0-9]+$'
               THEN COALESCE(gateway.payload_json->>'feePaise',
                   gateway.payload_json->>'fee_paise',gateway.payload_json->>'fee')::NUMERIC ELSE 0 END)
           * refund_line.amount_paise
           / NULLIF(SUM(refund_line.amount_paise) OVER (PARTITION BY gateway.id),0))::BIGINT
             AS cost_paise,
         'pos_gateway_refund'::TEXT,gateway.id
    FROM pos_gateway_refunds gateway
    JOIN pos_invoice_refund_lines refund_line ON refund_line.refund_id=gateway.refund_id
     AND refund_line.tenant_id=gateway.tenant_id AND refund_line.branch_id=gateway.branch_id
   WHERE gateway.status IN ('pending','processed')
)
SELECT * FROM staff_time WHERE cost_paise<>0
UNION ALL SELECT * FROM gateway_fee WHERE cost_paise<>0
UNION ALL SELECT * FROM refund_fee WHERE cost_paise<>0;
