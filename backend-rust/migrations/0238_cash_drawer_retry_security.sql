ALTER TABLE cash_drawer_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_movement_idempotency
  ON cash_drawer_movements (tenant_id, branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE cash_drawer_movements
  DROP CONSTRAINT IF EXISTS cash_drawer_movement_idempotency_key_check;
ALTER TABLE cash_drawer_movements
  ADD CONSTRAINT cash_drawer_movement_idempotency_key_check
  CHECK (idempotency_key IS NULL OR CHAR_LENGTH(idempotency_key) BETWEEN 10 AND 120);

ALTER TABLE pos_provider_reconciliation_runs
  DROP CONSTRAINT IF EXISTS provider_reconciliation_independent_review_check;
ALTER TABLE pos_provider_reconciliation_runs
  ADD CONSTRAINT provider_reconciliation_independent_review_check
  CHECK (reviewed_by_user_id = '' OR reviewed_by_user_id <> created_by_user_id) NOT VALID;
