CREATE TABLE IF NOT EXISTS stock_count_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','review','recount_required','pending_approval','approved','rejected','posted','cancelled')),
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  blind_counting BOOLEAN NOT NULL DEFAULT TRUE,
  required_counters INTEGER NOT NULL DEFAULT 1 CHECK (required_counters BETWEEN 1 AND 5),
  recount_threshold INTEGER NOT NULL DEFAULT 0 CHECK (recount_threshold >= 0),
  cutoff_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cutoff_ledger_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stock_count_sessions_scope ON stock_count_sessions(tenant_id,branch_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS stock_count_session_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES stock_count_sessions(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
  approved_quantity INTEGER,
  variance_quantity INTEGER,
  variance_reason TEXT NOT NULL DEFAULT '',
  adjustment_ledger_id TEXT REFERENCES inventory_stock_ledger(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  UNIQUE(session_id,inventory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_session_items_scope ON stock_count_session_items(tenant_id,branch_id,session_id,inventory_item_id);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_item_id TEXT NOT NULL REFERENCES stock_count_session_items(id) ON DELETE RESTRICT,
  counter_user_id TEXT NOT NULL,
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number BETWEEN 1 AND 10),
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  device_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,idempotency_key),
  UNIQUE(session_item_id,counter_user_id,round_number)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_scope ON stock_count_lines(tenant_id,branch_id,session_item_id,round_number);

CREATE TABLE IF NOT EXISTS stock_count_findings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_item_id TEXT NOT NULL REFERENCES stock_count_session_items(id) ON DELETE RESTRICT,
  finding_type TEXT NOT NULL CHECK (finding_type IN ('variance','leakage','theft')),
  notes TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_count_findings_scope ON stock_count_findings(tenant_id,branch_id,session_item_id,created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_scanner_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  workflow TEXT NOT NULL CHECK (workflow IN ('lookup','receive','count','waste','transfer')),
  code TEXT NOT NULL CHECK (BTRIM(code) <> ''),
  result TEXT NOT NULL CHECK (result IN ('matched','unmatched','queued','replayed','rejected')),
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  client_event_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE(tenant_id,branch_id,client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_scanner_events_scope ON inventory_scanner_events(tenant_id,branch_id,received_at DESC);

CREATE TABLE IF NOT EXISTS inventory_barcode_aliases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (BTRIM(code) <> ''),
  alias_type TEXT NOT NULL CHECK (alias_type IN ('product','batch','package','location')),
  target_id TEXT NOT NULL,
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inventory_barcode_aliases_scope ON inventory_barcode_aliases(tenant_id,branch_id,alias_type,active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_barcode_aliases_normalized_code
  ON inventory_barcode_aliases(tenant_id,branch_id,LOWER(BTRIM(code)));

CREATE OR REPLACE FUNCTION prevent_stock_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stock-audit count and scanner events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_count_lines_immutable ON stock_count_lines;
CREATE TRIGGER stock_count_lines_immutable
BEFORE UPDATE OR DELETE ON stock_count_lines
FOR EACH ROW EXECUTE FUNCTION prevent_stock_audit_event_mutation();

DROP TRIGGER IF EXISTS inventory_scanner_events_immutable ON inventory_scanner_events;
CREATE TRIGGER inventory_scanner_events_immutable
BEFORE UPDATE OR DELETE ON inventory_scanner_events
FOR EACH ROW EXECUTE FUNCTION prevent_stock_audit_event_mutation();
