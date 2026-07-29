ALTER TABLE pos_client_due_receipts
  ADD COLUMN IF NOT EXISTS received_by_user_id TEXT NOT NULL DEFAULT '';
