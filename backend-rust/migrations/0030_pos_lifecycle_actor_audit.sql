ALTER TABLE pos_invoice_voids
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_invoice_refunds
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_credit_notes
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pos_invoice_voids_actor
  ON pos_invoice_voids (tenant_id, branch_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_invoice_refunds_actor
  ON pos_invoice_refunds (tenant_id, branch_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_credit_notes_actor
  ON pos_credit_notes (tenant_id, branch_id, actor_user_id, created_at DESC);
