CREATE TABLE IF NOT EXISTS pos_terminals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  terminal_code TEXT NOT NULL,
  terminal_name TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL DEFAULT '',
  assigned_counter TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  last_seen_at TIMESTAMPTZ,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, terminal_code)
);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_branch
  ON pos_terminals (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_terminal_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_terminal_sessions_active
  ON pos_terminal_sessions (tenant_id, branch_id, terminal_id, status, opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminal_user_active_session
  ON pos_terminal_sessions (tenant_id, terminal_id, user_id)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS pos_print_devices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('thermal','a4')),
  connection_type TEXT NOT NULL CHECK (connection_type IN ('browser','network','usb')),
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_print_devices_branch
  ON pos_print_devices (tenant_id, branch_id, terminal_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_print_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL REFERENCES pos_terminals(id) ON DELETE RESTRICT,
  device_id TEXT REFERENCES pos_print_devices(id) ON DELETE SET NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  format TEXT NOT NULL CHECK (format IN ('thermal','a4')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','printed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  requested_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pos_print_jobs_queue
  ON pos_print_jobs (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_day_locks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','reopened')),
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, business_date)
);

CREATE TABLE IF NOT EXISTS pos_z_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  report_json JSONB NOT NULL,
  sha256 TEXT NOT NULL,
  generated_by_user_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, business_date, version)
);
CREATE INDEX IF NOT EXISTS idx_pos_z_reports_date
  ON pos_z_reports (tenant_id, branch_id, business_date DESC, version DESC);

CREATE TABLE IF NOT EXISTS pos_eod_accounting_batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  z_report_id TEXT NOT NULL REFERENCES pos_z_reports(id) ON DELETE RESTRICT,
  z_report_version INTEGER NOT NULL,
  journal_entry_count BIGINT NOT NULL DEFAULT 0,
  gross_sales_paise BIGINT NOT NULL DEFAULT 0,
  tax_paise BIGINT NOT NULL DEFAULT 0,
  payment_total_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  posted_by_user_id TEXT NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, business_date, z_report_version)
);

CREATE TABLE IF NOT EXISTS pos_financial_risk_cases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  risk_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by_user_id TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, business_date, risk_code, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_financial_risk_cases_status
  ON pos_financial_risk_cases (tenant_id, branch_id, status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS cash_drawer_approval_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by_user_id TEXT NOT NULL,
  reviewed_by_name TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_approval_tokens_session
  ON cash_drawer_approval_tokens (tenant_id, branch_id, drawer_session_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_notification_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sender_email TEXT NOT NULL DEFAULT '',
  sender_phone TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  signature_url TEXT NOT NULL DEFAULT '',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS corporate_billing_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  billing_email TEXT NOT NULL DEFAULT '',
  credit_limit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0),
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, account_code)
);
CREATE INDEX IF NOT EXISTS idx_corporate_billing_accounts_branch
  ON corporate_billing_accounts (tenant_id, branch_id, status, account_name);

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS terminal_id TEXT REFERENCES pos_terminals(id),
  ADD COLUMN IF NOT EXISTS corporate_account_id TEXT REFERENCES corporate_billing_accounts(id),
  ADD COLUMN IF NOT EXISTS corporate_reference TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION prevent_locked_pos_day_mutation()
RETURNS TRIGGER AS $$
DECLARE
  target_tenant TEXT;
  target_branch TEXT;
  target_date DATE;
  target_sale TEXT;
BEGIN
  IF TG_TABLE_NAME = 'pos_sales' THEN
    target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    target_branch := COALESCE(NEW.branch_id, OLD.branch_id);
    target_date := COALESCE(NEW.business_date, OLD.business_date);
  ELSE
    target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    target_branch := COALESCE(NEW.branch_id, OLD.branch_id);
    target_sale := COALESCE(NEW.sale_id, OLD.sale_id);
    SELECT business_date INTO target_date
      FROM pos_sales
     WHERE tenant_id=target_tenant AND branch_id=target_branch AND id=target_sale;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pos_day_locks
     WHERE tenant_id=target_tenant AND branch_id=target_branch
       AND business_date=target_date AND status='locked'
  ) THEN
    RAISE EXCEPTION 'POS business day is locked' USING ERRCODE='P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_sales_day_lock ON pos_sales;
CREATE TRIGGER trg_pos_sales_day_lock BEFORE INSERT OR UPDATE OR DELETE ON pos_sales
FOR EACH ROW EXECUTE FUNCTION prevent_locked_pos_day_mutation();
DROP TRIGGER IF EXISTS trg_pos_sale_lines_day_lock ON pos_sale_lines;
CREATE TRIGGER trg_pos_sale_lines_day_lock BEFORE INSERT OR UPDATE OR DELETE ON pos_sale_lines
FOR EACH ROW EXECUTE FUNCTION prevent_locked_pos_day_mutation();
DROP TRIGGER IF EXISTS trg_pos_payments_day_lock ON pos_payments;
CREATE TRIGGER trg_pos_payments_day_lock BEFORE INSERT OR UPDATE OR DELETE ON pos_payments
FOR EACH ROW EXECUTE FUNCTION prevent_locked_pos_day_mutation();
