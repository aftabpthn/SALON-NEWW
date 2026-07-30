-- Persist expensive Micro P&L event unions at daily sale-line grain.
CREATE TABLE IF NOT EXISTS micro_profit_daily_rollup (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  sale_id TEXT NOT NULL,
  sale_line_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  item_category TEXT NOT NULL DEFAULT 'Uncategorized',
  staff_id TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  appointment_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'pos',
  unit_count BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0,
  recognized_revenue_paise BIGINT NOT NULL DEFAULT 0,
  product_cost_paise BIGINT NOT NULL DEFAULT 0,
  staff_cost_paise BIGINT NOT NULL DEFAULT 0,
  staff_time_cost_paise BIGINT NOT NULL DEFAULT 0,
  gateway_fee_paise BIGINT NOT NULL DEFAULT 0,
  refund_fee_paise BIGINT NOT NULL DEFAULT 0,
  has_staff_time_cost BOOLEAN NOT NULL DEFAULT FALSE,
  has_gateway_fee BOOLEAN NOT NULL DEFAULT FALSE,
  has_refund_fee BOOLEAN NOT NULL DEFAULT FALSE,
  event_count BIGINT NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,business_date,sale_id,sale_line_id)
);

CREATE INDEX IF NOT EXISTS idx_micro_profit_daily_rollup_scope
  ON micro_profit_daily_rollup(tenant_id,branch_id,business_date);
CREATE INDEX IF NOT EXISTS idx_micro_profit_daily_rollup_dimensions
  ON micro_profit_daily_rollup(tenant_id,business_date,line_type,item_id,staff_id,client_id);

CREATE TABLE IF NOT EXISTS micro_profit_rollup_dirty_days (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  dirtied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,business_date)
);

CREATE TABLE IF NOT EXISTS micro_profit_rollup_day_state (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,business_date)
);

CREATE OR REPLACE FUNCTION refresh_micro_profit_daily_rollup(
  p_tenant_id TEXT,p_branch_ids TEXT[],p_from_date DATE,p_to_date DATE
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_rows BIGINT := 0;
BEGIN
  IF p_from_date>p_to_date OR COALESCE(CARDINALITY(p_branch_ids),0)=0 THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('micro_profit_rollup:'||p_tenant_id,0));
  CREATE TEMP TABLE IF NOT EXISTS micro_profit_refresh_targets(
    tenant_id TEXT,branch_id TEXT,business_date DATE,PRIMARY KEY(tenant_id,branch_id,business_date)
  ) ON COMMIT DROP;
  TRUNCATE micro_profit_refresh_targets;
  INSERT INTO micro_profit_refresh_targets
  SELECT p_tenant_id,branch_id,day::DATE
    FROM UNNEST(p_branch_ids) branch_id
    CROSS JOIN generate_series(p_from_date,p_to_date,'1 day') day
   WHERE EXISTS (SELECT 1 FROM micro_profit_rollup_dirty_days dirty
                  WHERE dirty.tenant_id=p_tenant_id AND dirty.branch_id=branch_id
                    AND dirty.business_date=day::DATE)
      OR NOT EXISTS (SELECT 1 FROM micro_profit_rollup_day_state state
                      WHERE state.tenant_id=p_tenant_id AND state.branch_id=branch_id
                        AND state.business_date=day::DATE);
  IF NOT EXISTS (SELECT 1 FROM micro_profit_refresh_targets) THEN RETURN 0; END IF;

  DELETE FROM micro_profit_daily_rollup rollup USING micro_profit_refresh_targets target
   WHERE rollup.tenant_id=target.tenant_id AND rollup.branch_id=target.branch_id
     AND rollup.business_date=target.business_date;

  WITH event AS (
    SELECT source.tenant_id,source.branch_id,source.business_date,source.sale_id,source.sale_line_id,
           SUM(source.recognized_revenue_paise)::BIGINT recognized_revenue_paise,
           SUM(source.product_cost_paise)::BIGINT product_cost_paise,
           SUM(source.staff_cost_paise)::BIGINT staff_cost_paise,COUNT(*)::BIGINT event_count
      FROM micro_profit_events source JOIN micro_profit_refresh_targets target USING(tenant_id,branch_id,business_date)
     GROUP BY source.tenant_id,source.branch_id,source.business_date,source.sale_id,source.sale_line_id
  ), cost AS (
    SELECT source.tenant_id,source.branch_id,source.business_date,source.sale_id,source.sale_line_id,
           COALESCE(SUM(source.cost_paise) FILTER(WHERE source.cost_type='staff_time'),0)::BIGINT staff_time_cost_paise,
           COALESCE(SUM(source.cost_paise) FILTER(WHERE source.cost_type='gateway_fee'),0)::BIGINT gateway_fee_paise,
           COALESCE(SUM(source.cost_paise) FILTER(WHERE source.cost_type='refund_gateway_fee'),0)::BIGINT refund_fee_paise,
           BOOL_OR(source.cost_type='staff_time') has_staff_time_cost,
           BOOL_OR(source.cost_type='gateway_fee') has_gateway_fee,
           BOOL_OR(source.cost_type='refund_gateway_fee') has_refund_fee
      FROM micro_profit_cost_events source JOIN micro_profit_refresh_targets target USING(tenant_id,branch_id,business_date)
     GROUP BY source.tenant_id,source.branch_id,source.business_date,source.sale_id,source.sale_line_id
  ), combined AS (
    SELECT COALESCE(event.tenant_id,cost.tenant_id) tenant_id,
           COALESCE(event.branch_id,cost.branch_id) branch_id,
           COALESCE(event.business_date,cost.business_date) business_date,
           COALESCE(event.sale_id,cost.sale_id) sale_id,
           COALESCE(event.sale_line_id,cost.sale_line_id) sale_line_id,
           COALESCE(event.recognized_revenue_paise,0)::BIGINT recognized_revenue_paise,
           COALESCE(event.product_cost_paise,0)::BIGINT product_cost_paise,
           COALESCE(event.staff_cost_paise,0)::BIGINT staff_cost_paise,
           COALESCE(cost.staff_time_cost_paise,0)::BIGINT staff_time_cost_paise,
           COALESCE(cost.gateway_fee_paise,0)::BIGINT gateway_fee_paise,
           COALESCE(cost.refund_fee_paise,0)::BIGINT refund_fee_paise,
           COALESCE(cost.has_staff_time_cost,FALSE) has_staff_time_cost,
           COALESCE(cost.has_gateway_fee,FALSE) has_gateway_fee,
           COALESCE(cost.has_refund_fee,FALSE) has_refund_fee,
           COALESCE(event.event_count,0)::BIGINT event_count
      FROM event FULL JOIN cost USING(tenant_id,branch_id,business_date,sale_id,sale_line_id)
  )
  INSERT INTO micro_profit_daily_rollup(
    tenant_id,branch_id,business_date,sale_id,sale_line_id,line_type,item_id,item_name,item_category,
    staff_id,client_id,appointment_id,channel,unit_count,discount_paise,recognized_revenue_paise,
    product_cost_paise,staff_cost_paise,staff_time_cost_paise,gateway_fee_paise,refund_fee_paise,
    has_staff_time_cost,has_gateway_fee,has_refund_fee,event_count,refreshed_at)
  SELECT combined.tenant_id,combined.branch_id,combined.business_date,combined.sale_id,combined.sale_line_id,
         line.line_type,COALESCE(service.id,line.item_id,''),COALESCE(NULLIF(service.name,''),line.item_name,''),
         COALESCE(NULLIF(service.category,''),'Uncategorized'),
         COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),''),COALESCE(sale.client_id,''),
         COALESCE(appointment.id,''),COALESCE(NULLIF(appointment.source_channel,''),NULLIF(sale.source,''),'pos'),
         line.quantity,line.discount_paise,combined.recognized_revenue_paise,combined.product_cost_paise,
         combined.staff_cost_paise,combined.staff_time_cost_paise,combined.gateway_fee_paise,
         combined.refund_fee_paise,combined.has_staff_time_cost,combined.has_gateway_fee,
         combined.has_refund_fee,combined.event_count,NOW()
    FROM combined
    JOIN pos_sale_lines line ON line.tenant_id=combined.tenant_id AND line.branch_id=combined.branch_id
     AND line.sale_id=combined.sale_id AND line.id=combined.sale_line_id
    JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
    LEFT JOIN LATERAL (SELECT redemption.service_id FROM pos_package_redemptions redemption
      WHERE line.line_type='package_redeem' AND redemption.tenant_id=line.tenant_id
        AND redemption.branch_id=line.branch_id AND redemption.sale_id=line.sale_id
        AND redemption.client_package_credit_id=line.item_id
      ORDER BY redemption.created_at,redemption.id LIMIT 1) package_redemption ON TRUE
    LEFT JOIN LATERAL (SELECT redemption.service_id FROM pos_membership_redemptions redemption
      WHERE line.line_type='membership_redeem' AND redemption.tenant_id=line.tenant_id
        AND redemption.branch_id=line.branch_id AND redemption.sale_id=line.sale_id
        AND redemption.client_membership_credit_id=line.item_id
      ORDER BY redemption.created_at,redemption.id LIMIT 1) membership_redemption ON TRUE
    LEFT JOIN services service ON service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
     AND service.id=CASE WHEN line.line_type='package_redeem' THEN COALESCE(package_redemption.service_id,line.item_id)
                         WHEN line.line_type='membership_redeem' THEN COALESCE(membership_redemption.service_id,line.item_id)
                         ELSE line.item_id END
    LEFT JOIN appointments appointment ON appointment.tenant_id=sale.tenant_id
     AND appointment.branch_id=sale.branch_id AND appointment.id=sale.reference_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;

  INSERT INTO micro_profit_rollup_day_state(tenant_id,branch_id,business_date,refreshed_at)
  SELECT tenant_id,branch_id,business_date,NOW() FROM micro_profit_refresh_targets
  ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET refreshed_at=EXCLUDED.refreshed_at;
  DELETE FROM micro_profit_rollup_dirty_days dirty USING micro_profit_refresh_targets target
   WHERE dirty.tenant_id=target.tenant_id AND dirty.branch_id=target.branch_id
     AND dirty.business_date=target.business_date;
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION mark_micro_profit_rollup_dirty_row() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB; old_data JSONB; dirty_date DATE; old_date DATE;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  dirty_date:=CASE WHEN TG_ARGV[1]='timestamp' THEN ((row_data->>TG_ARGV[0])::TIMESTAMPTZ AT TIME ZONE 'Asia/Kolkata')::DATE
                   ELSE (row_data->>TG_ARGV[0])::DATE END;
  IF dirty_date IS NOT NULL THEN
    INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
    VALUES(row_data->>'tenant_id',row_data->>'branch_id',dirty_date,NOW())
    ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  END IF;
  IF TG_OP='UPDATE' THEN
    old_data:=to_jsonb(OLD);
    old_date:=CASE WHEN TG_ARGV[1]='timestamp' THEN ((old_data->>TG_ARGV[0])::TIMESTAMPTZ AT TIME ZONE 'Asia/Kolkata')::DATE
                   ELSE (old_data->>TG_ARGV[0])::DATE END;
    IF old_date IS NOT NULL AND (old_data->>'tenant_id',old_data->>'branch_id',old_date)
       IS DISTINCT FROM (row_data->>'tenant_id',row_data->>'branch_id',dirty_date) THEN
      INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
      VALUES(old_data->>'tenant_id',old_data->>'branch_id',old_date,NOW())
      ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION mark_micro_profit_rollup_dirty_sale() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
  SELECT sale.tenant_id,sale.branch_id,sale.business_date,NOW() FROM pos_sales sale
   WHERE sale.tenant_id=row_data->>'tenant_id' AND sale.branch_id=row_data->>'branch_id'
     AND sale.id=row_data->>'sale_id' AND sale.business_date IS NOT NULL
  ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  IF row_data ? 'refund_id' THEN
    INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
    SELECT refund.tenant_id,refund.branch_id,(refund.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,NOW()
      FROM pos_invoice_refunds refund WHERE refund.id=row_data->>'refund_id'
    ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION mark_micro_profit_rollup_dirty_journal_line() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
  SELECT entry.tenant_id,entry.branch_id,entry.entry_date,NOW() FROM accounting_journal_entries entry
   WHERE entry.id=row_data->>'journal_entry_id' AND entry.entry_date IS NOT NULL
  ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION mark_micro_profit_rollup_dirty_payroll() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='staff_payroll_runs' THEN
    INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
    SELECT row_data->>'tenant_id',row_data->>'branch_id',day::DATE,NOW()
      FROM generate_series((row_data->>'period_start')::DATE,(row_data->>'period_end')::DATE,'1 day') day
    ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  ELSE
    INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
    SELECT run.tenant_id,run.branch_id,day::DATE,NOW() FROM staff_payroll_runs run
    CROSS JOIN LATERAL generate_series(run.period_start,run.period_end,'1 day') day
    WHERE run.id=row_data->>'payroll_run_id'
    ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION mark_micro_profit_rollup_dirty_allocation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_data JSONB;
BEGIN
  row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date,dirtied_at)
  SELECT DISTINCT sale.tenant_id,sale.branch_id,sale.business_date,NOW() FROM pos_sales sale
   WHERE sale.tenant_id=row_data->>'tenant_id' AND sale.branch_id=row_data->>'branch_id'
     AND sale.business_date BETWEEN (row_data->>'effective_from')::DATE
       AND COALESCE((row_data->>'effective_to')::DATE,sale.business_date)
  ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET dirtied_at=EXCLUDED.dirtied_at;
  RETURN COALESCE(NEW,OLD);
END $$;

DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('pos_sales','business_date','date'),('pos_invoice_refunds','created_at','timestamp'),
    ('accounting_journal_entries','entry_date','date'),('inventory_stock_ledger','created_at','timestamp'),
    ('pos_staff_commission_snapshots','business_date','date'),
    ('pos_provider_reconciliation_runs','settlement_date','date'),('pos_gateway_refunds','created_at','timestamp')
  ) value(table_name,date_column,date_kind) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_profit_rollup_dirty ON %I',item.table_name,item.table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_profit_rollup_dirty AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_row(%L,%L)',item.table_name,item.table_name,item.date_column,item.date_kind);
  END LOOP;
  FOR item IN SELECT table_name FROM (VALUES ('pos_sale_lines'),('pos_invoice_refund_lines'),
    ('pos_package_redemptions'),('pos_membership_redemptions'),('pos_payments')) value(table_name) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_profit_rollup_dirty ON %I',item.table_name,item.table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_profit_rollup_dirty AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_sale()',item.table_name,item.table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_accounting_journal_lines_profit_rollup_dirty ON accounting_journal_lines;
CREATE TRIGGER trg_accounting_journal_lines_profit_rollup_dirty AFTER INSERT OR UPDATE OR DELETE
  ON accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_journal_line();

DROP TRIGGER IF EXISTS trg_staff_payroll_runs_profit_rollup_dirty ON staff_payroll_runs;
CREATE TRIGGER trg_staff_payroll_runs_profit_rollup_dirty AFTER INSERT OR UPDATE OR DELETE
  ON staff_payroll_runs FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_payroll();
DROP TRIGGER IF EXISTS trg_staff_payroll_items_profit_rollup_dirty ON staff_payroll_items;
CREATE TRIGGER trg_staff_payroll_items_profit_rollup_dirty AFTER INSERT OR UPDATE OR DELETE
  ON staff_payroll_items FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_payroll();
DROP TRIGGER IF EXISTS trg_micro_profit_allocation_rules_rollup_dirty ON micro_profit_allocation_rules;
CREATE TRIGGER trg_micro_profit_allocation_rules_rollup_dirty AFTER INSERT OR UPDATE OR DELETE
  ON micro_profit_allocation_rules FOR EACH ROW EXECUTE FUNCTION mark_micro_profit_rollup_dirty_allocation();

INSERT INTO micro_profit_rollup_dirty_days(tenant_id,branch_id,business_date)
SELECT DISTINCT tenant_id,branch_id,business_date FROM pos_sales WHERE business_date IS NOT NULL
ON CONFLICT DO NOTHING;
