ALTER TABLE purchase_receipts
    ADD COLUMN IF NOT EXISTS round_off_paise BIGINT NOT NULL DEFAULT 0;
