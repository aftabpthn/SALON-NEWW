ALTER TABLE loyalty_redeem_qr_tokens
  DROP CONSTRAINT IF EXISTS loyalty_redeem_qr_tokens_status_check;

ALTER TABLE loyalty_redeem_qr_tokens
  ADD CONSTRAINT loyalty_redeem_qr_tokens_status_check
  CHECK (status IN ('issued','pending_approval','redeemed','expired','cancelled'));
