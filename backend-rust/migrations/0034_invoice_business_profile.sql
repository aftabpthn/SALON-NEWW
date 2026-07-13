CREATE TABLE IF NOT EXISTS invoice_business_profiles (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  trade_name TEXT NOT NULL DEFAULT '',
  is_gst_registered BOOLEAN NOT NULL DEFAULT FALSE,
  gstin TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  upi_id TEXT NOT NULL DEFAULT '',
  upi_payee_name TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);
