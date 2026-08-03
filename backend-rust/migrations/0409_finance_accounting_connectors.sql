CREATE TABLE IF NOT EXISTS accounting_connector_account_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks','xero','netsuite')),
  local_account_code TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_account_name TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,provider,local_account_code)
);
CREATE INDEX IF NOT EXISTS idx_accounting_connector_mapping_scope
  ON accounting_connector_account_mappings(tenant_id,branch_id,provider,local_account_code);

CREATE TABLE IF NOT EXISTS accounting_connector_mapping_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  local_account_code TEXT NOT NULL,
  old_value JSONB NOT NULL DEFAULT '{}'::JSONB,
  new_value JSONB NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounting_connector_mapping_audit_scope
  ON accounting_connector_mapping_audit(tenant_id,branch_id,provider,created_at DESC);

CREATE TABLE IF NOT EXISTS accounting_connector_journal_syncs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES integration_connector_connections(id),
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks','xero','netsuite')),
  journal_entry_id TEXT NOT NULL REFERENCES accounting_journal_entries(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','synced','failed','uncertain')),
  debit_paise BIGINT NOT NULL CHECK (debit_paise >= 0),
  credit_paise BIGINT NOT NULL CHECK (credit_paise >= 0),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  external_transaction_id TEXT NOT NULL DEFAULT '',
  response_sha256 TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,provider,journal_entry_id),
  UNIQUE (tenant_id,branch_id,provider,idempotency_key),
  CHECK (debit_paise = credit_paise)
);
CREATE INDEX IF NOT EXISTS idx_accounting_connector_journal_sync_scope
  ON accounting_connector_journal_syncs(tenant_id,branch_id,provider,status,updated_at DESC);

CREATE OR REPLACE FUNCTION prevent_accounting_connector_sync_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'accounting connector sync evidence is immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_connector_sync_no_delete
  ON accounting_connector_journal_syncs;
CREATE TRIGGER trg_accounting_connector_sync_no_delete
BEFORE DELETE ON accounting_connector_journal_syncs
FOR EACH ROW EXECUTE FUNCTION prevent_accounting_connector_sync_delete();
