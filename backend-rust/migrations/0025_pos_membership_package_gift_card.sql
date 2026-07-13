ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS service_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS source_sale_id TEXT NOT NULL DEFAULT '';

ALTER TABLE client_package_credits
  ADD CONSTRAINT client_package_credits_qty_contract
  CHECK (total_qty >= 0 AND remaining_qty >= 0 AND remaining_qty <= total_qty) NOT VALID;

ALTER TABLE client_membership_credits
  ADD CONSTRAINT client_membership_credits_qty_contract
  CHECK (total_qty >= 0 AND remaining_qty >= 0 AND remaining_qty <= total_qty) NOT VALID;

ALTER TABLE gift_cards
  ADD CONSTRAINT gift_cards_source_or_key_required
  CHECK (source_sale_id <> '' OR idempotency_key <> '') NOT VALID;

ALTER TABLE gift_card_transactions
  ADD CONSTRAINT gift_card_transactions_idempotency_required
  CHECK (idempotency_key <> '') NOT VALID;
