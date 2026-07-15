CREATE TABLE IF NOT EXISTS cash_drawer_tills (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  till_code TEXT NOT NULL,
  till_name TEXT NOT NULL,
  opening_cash_paise BIGINT NOT NULL DEFAULT 0 CHECK (opening_cash_paise >= 0),
  expected_cash_paise BIGINT NOT NULL DEFAULT 0,
  counted_cash_paise BIGINT,
  variance_paise BIGINT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_approval','closed')),
  opened_by_user_id TEXT NOT NULL,
  close_requested_by_user_id TEXT NOT NULL DEFAULT '',
  approved_by_user_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  close_requested_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, drawer_session_id, till_code)
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_tills_session
  ON cash_drawer_tills (tenant_id, branch_id, drawer_session_id, status, opened_at);

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS cash_drawer_till_id TEXT REFERENCES cash_drawer_tills(id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_cash_drawer_till
  ON pos_sales (tenant_id, branch_id, cash_drawer_till_id, created_at);
