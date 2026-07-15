ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_entity_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','packages'
  ));

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_entity_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','packages'
  ));
