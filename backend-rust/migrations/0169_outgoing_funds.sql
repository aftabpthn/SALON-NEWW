CREATE TABLE IF NOT EXISTS outgoing_fund_vouchers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  voucher_number TEXT NOT NULL,
  business_date DATE NOT NULL,
  payment_account_code TEXT NOT NULL
    CHECK (payment_account_code IN ('CASH_ON_HAND', 'BANK_CLEARING')),
  payment_mode TEXT NOT NULL,
  reference_number TEXT,
  cheque_number TEXT,
  cheque_date DATE,
  linked_party_type TEXT NOT NULL DEFAULT 'none'
    CHECK (linked_party_type IN ('none','vendor','staff','client','owner','other')),
  linked_party_id TEXT,
  linked_party_name TEXT,
  bill_reference TEXT,
  attachment_url TEXT,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','rejected','reversed','cancelled')),
  journal_entry_id TEXT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id TEXT REFERENCES accounting_journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id TEXT NOT NULL,
  submitted_by_user_id TEXT,
  approved_by_user_id TEXT,
  rejected_by_user_id TEXT,
  reversed_by_user_id TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, id),
  UNIQUE (tenant_id, branch_id, voucher_number),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_vouchers_register
  ON outgoing_fund_vouchers (tenant_id, branch_id, business_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_vouchers_status
  ON outgoing_fund_vouchers (tenant_id, branch_id, status, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_vouchers_party
  ON outgoing_fund_vouchers (tenant_id, branch_id, linked_party_type, linked_party_id)
  WHERE linked_party_type <> 'none';

CREATE TABLE IF NOT EXISTS outgoing_fund_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  category_key TEXT NOT NULL,
  account_code TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  gst_treatment TEXT NOT NULL DEFAULT 'none'
    CHECK (gst_treatment IN ('none','cgst_sgst','igst')),
  gst_paise BIGINT NOT NULL DEFAULT 0
    CHECK (gst_paise >= 0 AND gst_paise <= amount_paise),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (voucher_id, line_number),
  FOREIGN KEY (tenant_id, branch_id, voucher_id)
    REFERENCES outgoing_fund_vouchers(tenant_id, branch_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_lines_scope
  ON outgoing_fund_lines (tenant_id, branch_id, voucher_id, line_number);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_lines_category
  ON outgoing_fund_lines (tenant_id, branch_id, category_key, voucher_id);

CREATE TABLE IF NOT EXISTS outgoing_fund_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, branch_id, voucher_id)
    REFERENCES outgoing_fund_vouchers(tenant_id, branch_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outgoing_fund_audit_events_voucher
  ON outgoing_fund_audit_events (tenant_id, branch_id, voucher_id, created_at DESC);
