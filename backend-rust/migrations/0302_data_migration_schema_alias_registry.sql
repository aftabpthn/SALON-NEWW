CREATE TABLE IF NOT EXISTS integration_import_aliases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN (
    'clients','staff','services','products','suppliers','inventory','memberships',
    'client-memberships','packages','appointments','sales','invoices','payments',
    'expenses','purchase-bills','refunds','gift-cards','loyalty','payroll',
    'commissions','client-notes','files','stock-movements'
  )),
  source_provider TEXT NOT NULL DEFAULT 'auto' CHECK(source_provider IN (
    'auto','zenoti','dingg','salonist','fresha','tally','busy','marg','excel','csv','manual'
  )),
  alias TEXT NOT NULL CHECK(LENGTH(BTRIM(alias)) BETWEEN 1 AND 200),
  target_field TEXT NOT NULL CHECK(LENGTH(BTRIM(target_field)) BETWEEN 1 AND 120),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_import_alias_scope
  ON integration_import_aliases(tenant_id, branch_id, entity, source_provider, LOWER(alias));

CREATE INDEX IF NOT EXISTS idx_integration_import_alias_lookup
  ON integration_import_aliases(tenant_id, branch_id, entity, source_provider, updated_at DESC);
