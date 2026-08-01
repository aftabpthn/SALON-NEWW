ALTER TABLE purchase_receipts
    DROP CONSTRAINT IF EXISTS purchase_receipts_check;

ALTER TABLE purchase_receipts
    ADD CONSTRAINT purchase_receipts_check CHECK (
        taxable_paise
        + cgst_paise
        + sgst_paise
        + igst_paise
        + shipping_paise
        + handling_paise
        + round_off_paise
        = total_paise
    );
