ALTER TABLE due_recovery_followups
  ADD COLUMN IF NOT EXISTS assigned_manager_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_due_recovery_followups_manager
  ON due_recovery_followups (tenant_id, branch_id, assigned_manager_id, created_at DESC)
  WHERE assigned_manager_id <> '';
