-- Phase 8 dependency-aware execution graph.
ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_status_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_status_check
  CHECK(status IN ('staging','dependency_pending','validated','queued','processing','paused','completed','failed','cancelled','rolled_back'));

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_status_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_status_check
  CHECK(status IN ('validated','dependency_pending','warning','duplicate','error','imported','created','merged','linked','kept','rolled_back'));

CREATE OR REPLACE FUNCTION migration_import_dependency_rank(value TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE value
    WHEN 'clients' THEN 0
    WHEN 'staff' THEN 1 WHEN 'services' THEN 1 WHEN 'products' THEN 1 WHEN 'suppliers' THEN 1
    WHEN 'memberships' THEN 2 WHEN 'packages' THEN 2 WHEN 'inventory' THEN 2
    WHEN 'purchase-bills' THEN 2 WHEN 'payroll' THEN 2
    WHEN 'client-memberships' THEN 3 WHEN 'appointments' THEN 3 WHEN 'client-notes' THEN 3
    WHEN 'sales' THEN 4 WHEN 'invoices' THEN 4 WHEN 'expenses' THEN 4
    WHEN 'payments' THEN 5 WHEN 'refunds' THEN 5 WHEN 'gift-cards' THEN 5
    WHEN 'loyalty' THEN 6 WHEN 'commissions' THEN 6 WHEN 'stock-movements' THEN 6 WHEN 'files' THEN 6
    ELSE 100
  END
$$;

CREATE OR REPLACE FUNCTION enforce_migration_import_dependency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  dependent_entity TEXT;
  prerequisite_entity TEXT;
BEGIN
  SELECT entity INTO dependent_entity
  FROM integration_import_jobs
  WHERE id=NEW.job_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id;
  SELECT entity INTO prerequisite_entity
  FROM integration_import_jobs
  WHERE id=NEW.depends_on_job_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id;
  IF dependent_entity IS NULL OR prerequisite_entity IS NULL
     OR migration_import_dependency_rank(dependent_entity)
        <= migration_import_dependency_rank(prerequisite_entity) THEN
    RAISE EXCEPTION 'invalid migration dependency scope or order' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_migration_import_dependency
  ON integration_import_job_dependencies;
CREATE TRIGGER trg_enforce_migration_import_dependency
BEFORE INSERT OR UPDATE ON integration_import_job_dependencies
FOR EACH ROW EXECUTE FUNCTION enforce_migration_import_dependency();

INSERT INTO integration_import_job_dependencies(
  tenant_id,branch_id,job_id,depends_on_job_id
)
SELECT dependent.tenant_id,dependent.branch_id,dependent.id,prerequisite.id
FROM integration_import_jobs dependent
JOIN integration_import_jobs prerequisite
  ON prerequisite.tenant_id=dependent.tenant_id
 AND prerequisite.branch_id=dependent.branch_id
 AND prerequisite.source_hash=dependent.source_hash
 AND prerequisite.mode='commit'
 AND prerequisite.id<>dependent.id
WHERE dependent.mode='commit'
  AND dependent.source_hash IS NOT NULL AND dependent.source_hash<>''
  AND dependent.status NOT IN ('cancelled','rolled_back')
  AND prerequisite.status NOT IN ('cancelled','rolled_back')
  AND migration_import_dependency_rank(dependent.entity)
      > migration_import_dependency_rank(prerequisite.entity)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_integration_import_jobs_dependency_pending
  ON integration_import_jobs(updated_at, id)
  WHERE status='dependency_pending';
