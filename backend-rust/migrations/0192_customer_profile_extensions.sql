CREATE TABLE IF NOT EXISTS customer_support_tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  subject TEXT NOT NULL CHECK (BTRIM(subject) <> '' AND LENGTH(subject) <= 160),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('booking','payment','service','account','other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_support_account
  ON customer_support_tickets (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_support_branch
  ON customer_support_tickets (tenant_id, branch_id, status, priority, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_support_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ticket_id TEXT NOT NULL REFERENCES customer_support_tickets(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('customer','support')),
  body TEXT NOT NULL CHECK (BTRIM(body) <> '' AND LENGTH(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_support_messages_ticket
  ON customer_support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS customer_beauty_goals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (BTRIM(title) <> '' AND LENGTH(title) <= 160),
  goal_type TEXT NOT NULL DEFAULT 'other'
    CHECK (goal_type IN ('hair','skin','wellness','event','other')),
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  notes TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_beauty_goals_account
  ON customer_beauty_goals (account_id, status, created_at DESC);
