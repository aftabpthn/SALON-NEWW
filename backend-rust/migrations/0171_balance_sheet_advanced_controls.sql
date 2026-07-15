CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  asset_code TEXT NOT NULL CHECK (asset_code ~ '^[A-Z0-9_]{1,32}$'),
  name TEXT NOT NULL CHECK (LENGTH(name) BETWEEN 1 AND 120),
  acquisition_date DATE NOT NULL,
  depreciation_start_date DATE NOT NULL,
  cost_paise BIGINT NOT NULL CHECK (cost_paise > 0),
  salvage_paise BIGINT NOT NULL DEFAULT 0 CHECK (salvage_paise >= 0),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months BETWEEN 1 AND 1200),
  accumulated_depreciation_paise BIGINT NOT NULL DEFAULT 0
    CHECK (accumulated_depreciation_paise >= 0),
  last_depreciation_date DATE,
  purchase_offset_account TEXT NOT NULL
    CHECK (purchase_offset_account IN ('ACCOUNTS_PAYABLE','CASH_ON_HAND','BANK_CLEARING')),
  purchase_journal_entry_id TEXT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  purchase_idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (salvage_paise < cost_paise),
  CHECK (accumulated_depreciation_paise <= cost_paise - salvage_paise),
  UNIQUE (tenant_id, branch_id, asset_code),
  UNIQUE (tenant_id, branch_id, purchase_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_scope
  ON accounting_fixed_assets (tenant_id, branch_id, status, acquisition_date, asset_code);

CREATE TABLE IF NOT EXISTS accounting_deferred_revenue_schedules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  sale_line_id TEXT NOT NULL REFERENCES pos_sale_lines(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('membership','package')),
  source_item_id TEXT NOT NULL,
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  recognized_paise BIGINT NOT NULL DEFAULT 0 CHECK (recognized_paise >= 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  last_recognition_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (recognized_paise <= total_paise),
  UNIQUE (tenant_id, branch_id, sale_line_id)
);

CREATE INDEX IF NOT EXISTS idx_deferred_revenue_schedules_scope
  ON accounting_deferred_revenue_schedules
    (tenant_id, branch_id, status, start_date, end_date);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_month DATE NOT NULL CHECK (period_month = DATE_TRUNC('month', period_month)::DATE),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  close_reason TEXT NOT NULL DEFAULT '',
  closed_by_user_id TEXT,
  closed_at TIMESTAMPTZ,
  reopen_reason TEXT NOT NULL DEFAULT '',
  reopened_by_user_id TEXT,
  reopened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_scope
  ON accounting_periods (tenant_id, branch_id, period_month DESC, status);

CREATE OR REPLACE FUNCTION enforce_accounting_period_open()
RETURNS TRIGGER AS $$
DECLARE
  period_key INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM accounting_journal_entries
    WHERE tenant_id=NEW.tenant_id
      AND branch_id=NEW.branch_id
      AND source_type=NEW.source_type
      AND source_id=NEW.source_id
  ) THEN
    RETURN NULL;
  END IF;

  period_key := EXTRACT(YEAR FROM NEW.entry_date)::INTEGER * 100
    + EXTRACT(MONTH FROM NEW.entry_date)::INTEGER;
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.tenant_id || ':' || NEW.branch_id),
    period_key
  );

  IF EXISTS (
    SELECT 1
    FROM accounting_periods
    WHERE tenant_id=NEW.tenant_id
      AND branch_id=NEW.branch_id
      AND period_month=DATE_TRUNC('month', NEW.entry_date)::DATE
      AND status='closed'
  ) THEN
    RAISE EXCEPTION 'accounting period is closed for %', NEW.entry_date
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounting_journal_period_guard ON accounting_journal_entries;
CREATE TRIGGER accounting_journal_period_guard
BEFORE INSERT ON accounting_journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_accounting_period_open();

INSERT INTO accounting_deferred_revenue_schedules (
  tenant_id, branch_id, sale_id, sale_line_id, source_type, source_item_id,
  total_paise, start_date, end_date, status
)
SELECT line.tenant_id,
       line.branch_id,
       line.sale_id,
       line.id,
       line.line_type,
       line.item_id,
       line.taxable_paise,
       sale.business_date,
       sale.business_date + (
         GREATEST(
           CASE
             WHEN line.line_type='membership' THEN COALESCE(membership.validity_days, 1)
             ELSE COALESCE(package.validity_days, 1)
           END,
           1
         ) - 1
       ),
       'open'
FROM pos_sale_lines line
JOIN pos_sales sale
  ON sale.id=line.sale_id
 AND sale.tenant_id=line.tenant_id
 AND sale.branch_id=line.branch_id
JOIN accounting_journal_entries journal
  ON journal.tenant_id=line.tenant_id
 AND journal.branch_id=line.branch_id
 AND journal.source_type='invoice'
 AND journal.source_id=line.sale_id
LEFT JOIN memberships membership
  ON membership.id=line.item_id
 AND membership.tenant_id=line.tenant_id
 AND membership.branch_id=line.branch_id
 AND line.line_type='membership'
LEFT JOIN packages package
  ON package.id=line.item_id
 AND package.tenant_id=line.tenant_id
 AND package.branch_id=line.branch_id
 AND line.line_type='package'
WHERE line.line_type IN ('membership','package')
  AND line.taxable_paise > 0
ON CONFLICT (tenant_id, branch_id, sale_line_id) DO NOTHING;
