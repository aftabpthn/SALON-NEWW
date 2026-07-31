CREATE TABLE IF NOT EXISTS integration_migration_cutovers (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  id TEXT NOT NULL CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  cutover_date DATE NOT NULL,
  contract_version TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id, id)
);

CREATE OR REPLACE FUNCTION reject_integration_migration_cutover_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'migration cutover contracts are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_integration_migration_cutover_immutable
  ON integration_migration_cutovers;
CREATE TRIGGER trg_integration_migration_cutover_immutable
BEFORE UPDATE OR DELETE ON integration_migration_cutovers
FOR EACH ROW EXECUTE FUNCTION reject_integration_migration_cutover_mutation();
