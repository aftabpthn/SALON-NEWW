CREATE TABLE IF NOT EXISTS outgoing_fund_categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  label TEXT NOT NULL,
  account_code TEXT,
  manual_entry BOOLEAN NOT NULL DEFAULT TRUE,
  workflow_path TEXT,
  workflow_label TEXT,
  requires_party BOOLEAN NOT NULL DEFAULT FALSE,
  requires_bill_reference BOOLEAN NOT NULL DEFAULT FALSE,
  requires_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  approval_threshold_paise BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_categories_scope
  ON outgoing_fund_categories (tenant_id, branch_id, active, label);

ALTER TABLE outgoing_fund_vouchers
  ADD COLUMN IF NOT EXISTS fund_source TEXT NOT NULL DEFAULT 'business_cash'
    CHECK (fund_source IN ('business_cash','petty_cash_balance','bank','other')),
  ADD COLUMN IF NOT EXISTS cash_drawer_session_id TEXT,
  ADD COLUMN IF NOT EXISTS cash_drawer_till_id TEXT,
  ADD COLUMN IF NOT EXISTS opening_balance_paise BIGINT,
  ADD COLUMN IF NOT EXISTS closing_balance_paise BIGINT,
  ADD COLUMN IF NOT EXISTS approval_policy_reason TEXT;

ALTER TABLE outgoing_fund_lines
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS cost_center_id TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS line_party_type TEXT NOT NULL DEFAULT 'voucher'
    CHECK (line_party_type IN ('voucher','none','vendor','staff','client','owner','other')),
  ADD COLUMN IF NOT EXISTS line_party_id TEXT,
  ADD COLUMN IF NOT EXISTS line_party_name TEXT,
  ADD COLUMN IF NOT EXISTS source_reference_type TEXT,
  ADD COLUMN IF NOT EXISTS source_reference_id TEXT,
  ADD COLUMN IF NOT EXISTS receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS tax_invoice BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reimbursement BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_lines_micro
  ON outgoing_fund_lines (tenant_id, branch_id, department, cost_center_id, source_reference_type, source_reference_id);

CREATE TABLE IF NOT EXISTS outgoing_fund_attachments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  line_number INTEGER,
  file_url TEXT NOT NULL,
  file_type TEXT,
  uploaded_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, branch_id, voucher_id)
    REFERENCES outgoing_fund_vouchers(tenant_id, branch_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_attachments_voucher
  ON outgoing_fund_attachments (tenant_id, branch_id, voucher_id, line_number, created_at DESC);
