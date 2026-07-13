ALTER TABLE services
  ADD COLUMN IF NOT EXISTS sac_code TEXT NOT NULL DEFAULT '';

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS hsn_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gst_percent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS seller_gstin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seller_state_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_gstin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS place_of_supply_state_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'intra_state',
  ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cgst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_paise BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS hsn_sac_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cgst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_paise BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve existing aggregate-GST invoices while all new invoices use a jurisdictional split.
UPDATE pos_sales
   SET igst_paise = tax_paise
 WHERE cgst_paise = 0 AND sgst_paise = 0 AND igst_paise = 0 AND tax_paise > 0;

UPDATE pos_sale_lines
   SET igst_paise = gst_paise
 WHERE cgst_paise = 0 AND sgst_paise = 0 AND igst_paise = 0 AND gst_paise > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_gst_split_total') THEN
    ALTER TABLE pos_sales ADD CONSTRAINT pos_sales_gst_split_total
      CHECK (cgst_paise >= 0 AND sgst_paise >= 0 AND igst_paise >= 0 AND cgst_paise + sgst_paise + igst_paise = tax_paise) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_gst_split_total') THEN
    ALTER TABLE pos_sale_lines ADD CONSTRAINT pos_sale_lines_gst_split_total
      CHECK (cgst_paise >= 0 AND sgst_paise >= 0 AND igst_paise >= 0 AND cgst_paise + sgst_paise + igst_paise = gst_paise) NOT VALID;
  END IF;
END $$;
