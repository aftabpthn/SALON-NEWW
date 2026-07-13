CREATE TABLE IF NOT EXISTS invoice_compliance_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  annual_turnover_paise BIGINT NOT NULL DEFAULT 0 CHECK (annual_turnover_paise >= 0),
  e_invoice_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  e_invoice_threshold_paise BIGINT NOT NULL DEFAULT 5000000000 CHECK (e_invoice_threshold_paise > 0),
  e_way_bill_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  e_way_bill_threshold_paise BIGINT NOT NULL DEFAULT 5000000 CHECK (e_way_bill_threshold_paise > 0),
  auto_queue_e_invoice BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS pos_invoice_compliance (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  e_invoice_status TEXT NOT NULL DEFAULT 'not_required' CHECK (e_invoice_status IN ('not_required', 'review_required', 'queued', 'submitted', 'failed')),
  e_way_bill_status TEXT NOT NULL DEFAULT 'not_required' CHECK (e_way_bill_status IN ('not_required', 'review_required', 'queued', 'submitted', 'failed')),
  eligibility_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, sale_id)
);

CREATE TABLE IF NOT EXISTS pos_compliance_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('e_invoice', 'e_way_bill')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitted', 'failed', 'cancelled')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, sale_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_pos_compliance_jobs_due
  ON pos_compliance_jobs (tenant_id, branch_id, status, created_at);
