ALTER TABLE pos_invoice_number_sequences
  ADD COLUMN IF NOT EXISTS fiscal_year TEXT NOT NULL DEFAULT '';

UPDATE pos_invoice_number_sequences
   SET fiscal_year = 'legacy'
 WHERE fiscal_year = '';

ALTER TABLE pos_invoice_number_sequences
  DROP CONSTRAINT IF EXISTS pos_invoice_number_sequences_tenant_id_branch_id_invoice_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_invoice_number_sequences_fiscal_year
  ON pos_invoice_number_sequences (tenant_id, branch_id, invoice_type, fiscal_year);

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS fiscal_year TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS invoice_number_sequence_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_credit_notes
  ADD COLUMN IF NOT EXISTS fiscal_year TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS invoice_number_sequence_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pos_sales_fiscal_invoice_number
  ON pos_sales (tenant_id, branch_id, fiscal_year, invoice_number);
