ALTER TABLE branch_bulk_imports
  ADD COLUMN IF NOT EXISTS import_mode TEXT NOT NULL DEFAULT 'full';

ALTER TABLE branch_bulk_imports
  ADD CONSTRAINT branch_bulk_imports_import_mode_check
  CHECK (import_mode IN ('full', 'partial'));

ALTER TABLE branch_bulk_imports
  DROP CONSTRAINT branch_bulk_imports_check,
  ADD CONSTRAINT branch_bulk_imports_check
  CHECK (created_branch_count BETWEEN 0 AND row_count);

CREATE INDEX IF NOT EXISTS idx_branch_bulk_imports_tenant_mode_created
  ON branch_bulk_imports(tenant_id, import_mode, created_at DESC);
