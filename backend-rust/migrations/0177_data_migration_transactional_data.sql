ALTER TABLE integration_import_jobs
  DROP CONSTRAINT IF EXISTS integration_import_jobs_entity_check;
ALTER TABLE integration_import_jobs
  ADD CONSTRAINT integration_import_jobs_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','packages',
    'appointments','sales','invoices','payments','expenses','purchase-bills'
  ));

ALTER TABLE integration_import_row_results
  DROP CONSTRAINT IF EXISTS integration_import_row_results_entity_check;
ALTER TABLE integration_import_row_results
  ADD CONSTRAINT integration_import_row_results_entity_check
  CHECK (entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships','packages',
    'appointments','sales','invoices','payments','expenses','purchase-bills'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sales_migration_reference
  ON pos_sales (tenant_id, branch_id, reference_id)
  WHERE source='migration' AND BTRIM(reference_id)<>'';

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_migration_reference
  ON appointments (tenant_id, branch_id, booking_group_id)
  WHERE source='migration' AND BTRIM(booking_group_id)<>'';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_payments_migration_reference
  ON pos_payments (tenant_id, branch_id, method_reference)
  WHERE method_reference LIKE 'migration:%';
