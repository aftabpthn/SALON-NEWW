CREATE TABLE IF NOT EXISTS pos_invoice_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  layout TEXT NOT NULL CHECK (layout IN ('a4', 'thermal')),
  sha256 TEXT NOT NULL,
  source_json JSONB NOT NULL,
  pdf_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, sale_id, layout)
);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_documents_sale
  ON pos_invoice_documents (tenant_id, branch_id, sale_id, created_at DESC);
