ALTER TABLE corporate_billing_accounts
  ADD COLUMN IF NOT EXISTS gstin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS corporate_account_members (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  corporate_account_id TEXT NOT NULL REFERENCES corporate_billing_accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  employee_code TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  spending_limit_paise BIGINT NOT NULL DEFAULT 0 CHECK (spending_limit_paise >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, corporate_account_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_corporate_account_members_account
  ON corporate_account_members (tenant_id, branch_id, corporate_account_id, status);

CREATE TABLE IF NOT EXISTS corporate_credit_invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  corporate_account_id TEXT NOT NULL REFERENCES corporate_billing_accounts(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  due_date DATE NOT NULL,
  original_amount_paise BIGINT NOT NULL CHECK (original_amount_paise > 0),
  paid_paise BIGINT NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  outstanding_paise BIGINT NOT NULL CHECK (outstanding_paise >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','voided')),
  converted_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, sale_id)
);
CREATE INDEX IF NOT EXISTS idx_corporate_credit_invoices_fifo
  ON corporate_credit_invoices (tenant_id, branch_id, corporate_account_id, status, due_date, created_at);

CREATE TABLE IF NOT EXISTS corporate_credit_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  corporate_account_id TEXT NOT NULL REFERENCES corporate_billing_accounts(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank_transfer','upi','card','cheque')),
  payment_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  received_by_user_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key),
  UNIQUE (tenant_id, branch_id, corporate_account_id, payment_reference)
);

CREATE TABLE IF NOT EXISTS corporate_credit_payment_allocations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payment_id TEXT NOT NULL REFERENCES corporate_credit_payments(id) ON DELETE RESTRICT,
  credit_invoice_id TEXT NOT NULL REFERENCES corporate_credit_invoices(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, payment_id, credit_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_corporate_credit_allocations_sale
  ON corporate_credit_payment_allocations (tenant_id, branch_id, sale_id, allocated_at);

ALTER TABLE invoice_notification_profiles
  ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reporting_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reporting_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS client_whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS owner_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_report_time TIME NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS daily_report_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS last_daily_report_date DATE;

CREATE TABLE IF NOT EXISTS invoice_notification_profile_media (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('logo','signature')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  content_sha256 TEXT NOT NULL,
  content_bytes BYTEA NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, media_kind)
);

CREATE TABLE IF NOT EXISTS invoice_notification_contact_verifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  contact_kind TEXT NOT NULL CHECK (contact_kind IN ('sender_email','sender_phone','owner_email','owner_phone','reporting_email')),
  contact_value TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','expired','locked')),
  expires_at TIMESTAMPTZ NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoice_notification_verification_pending
  ON invoice_notification_contact_verifications (tenant_id, branch_id, contact_kind, created_at DESC);

ALTER TABLE pos_financial_risk_cases
  ADD COLUMN IF NOT EXISTS amount_at_risk_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_at_risk_paise >= 0);

ALTER TABLE cash_drawer_movements
  ADD COLUMN IF NOT EXISTS reverses_movement_id TEXT REFERENCES cash_drawer_movements(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_movement_reversal
  ON cash_drawer_movements (tenant_id, branch_id, reverses_movement_id)
  WHERE reverses_movement_id IS NOT NULL;

ALTER TABLE cash_drawer_bank_deposits
  ADD COLUMN IF NOT EXISTS amended_by_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS amendment_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ;
