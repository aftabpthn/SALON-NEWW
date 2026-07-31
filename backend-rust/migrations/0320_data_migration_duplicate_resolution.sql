ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_duplicate_decision_check;

ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_duplicate_decision_check
  CHECK (duplicate_decision IN ('', 'merge', 'keep', 'link', 'reject'));
