ALTER TABLE purchase_bill_drafts
  ADD COLUMN IF NOT EXISTS supplier_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_contract JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE purchase_bill_draft_lines
  ADD COLUMN IF NOT EXISTS product_contract JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS free_quantity INTEGER NOT NULL DEFAULT 0 CHECK (free_quantity >= 0);

ALTER TABLE purchase_bill_drafts
  ADD CONSTRAINT purchase_bill_drafts_bill_contract_object CHECK (jsonb_typeof(bill_contract)='object');

ALTER TABLE purchase_bill_draft_lines
  ADD CONSTRAINT purchase_bill_draft_lines_product_contract_object CHECK (jsonb_typeof(product_contract)='object');
