UPDATE pos_payment_method_settings
   SET reference_required = TRUE,
       updated_at = NOW()
 WHERE code IN ('bank_transfer', 'gift_card', 'store_credit');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_method_contract') THEN
    ALTER TABLE pos_payments
      ADD CONSTRAINT pos_payments_method_contract
      CHECK (method IN ('cash', 'upi', 'card', 'wallet', 'gift_card', 'store_credit', 'bank_transfer', 'other')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_amount_positive') THEN
    ALTER TABLE pos_payments
      ADD CONSTRAINT pos_payments_amount_positive CHECK (amount_paise > 0) NOT VALID;
  END IF;
END $$;
