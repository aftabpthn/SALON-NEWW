CREATE TABLE IF NOT EXISTS accounting_cost_centers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,32}$'),
  name TEXT NOT NULL CHECK (LENGTH(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL DEFAULT 'custom'
    CHECK (kind IN ('chair','stylist','category','department','custom')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_cost_centers_scope
  ON accounting_cost_centers (tenant_id, branch_id, active, kind, code);

CREATE TABLE IF NOT EXISTS accounting_journal_line_cost_centers (
  journal_line_id TEXT PRIMARY KEY
    REFERENCES accounting_journal_lines(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL
    REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  cost_center_id TEXT NOT NULL
    REFERENCES accounting_cost_centers(id) ON DELETE RESTRICT,
  tagged_by_user_id TEXT NOT NULL,
  tagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_line_cost_centers_scope
  ON accounting_journal_line_cost_centers
    (tenant_id, branch_id, cost_center_id, journal_entry_id);
