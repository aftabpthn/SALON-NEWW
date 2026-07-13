ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_idempotency_required
  CHECK (idempotency_key <> '') NOT VALID;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_use_ref_required
  CHECK (transaction_type NOT IN ('use', 'refund') OR (reference_type <> '' AND reference_id <> '')) NOT VALID;

ALTER TABLE store_credits
  ADD CONSTRAINT store_credits_idempotency_required
  CHECK (idempotency_key <> '') NOT VALID;

ALTER TABLE store_credits
  ADD CONSTRAINT store_credits_source_required
  CHECK (source_type <> '' AND source_id <> '') NOT VALID;

ALTER TABLE store_credit_transactions
  ADD CONSTRAINT store_credit_transactions_idempotency_required
  CHECK (idempotency_key <> '') NOT VALID;

ALTER TABLE store_credit_transactions
  ADD CONSTRAINT store_credit_transactions_ref_required
  CHECK (transaction_type = 'issue' OR (reference_type <> '' AND reference_id <> '')) NOT VALID;
