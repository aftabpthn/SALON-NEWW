-- Global customer identity (cross-tenant).
-- One customer_account = one phone number = one login.
-- Links to many tenant-specific `clients` records via customer_account_id.
-- NO bulk migration — lazy linking on first verified login only.

-- 1. Global customer identity
CREATE TABLE IF NOT EXISTS customer_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone_verified INTEGER DEFAULT 0,
  email_verified INTEGER DEFAULT 0,
  date_of_birth TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  profile_image TEXT DEFAULT '',
  auth_provider TEXT DEFAULT 'phone',
  firebase_uid TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  notification_prefs TEXT DEFAULT '{}',
  privacy_prefs TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_phone ON customer_accounts(phone) WHERE phone != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_email ON customer_accounts(email) WHERE email != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_firebase ON customer_accounts(firebase_uid) WHERE firebase_uid != '';

-- 2. Link audit trail (every linking action logged)
CREATE TABLE IF NOT EXISTS customer_account_link_audit (
  id TEXT PRIMARY KEY,
  customer_account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  match_field TEXT NOT NULL,
  confidence TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cala_account ON customer_account_link_audit(customer_account_id);
CREATE INDEX IF NOT EXISTS idx_cala_client ON customer_account_link_audit(client_id);

-- 3. Ambiguous match flags (pending manual review)
CREATE TABLE IF NOT EXISTS customer_account_link_flags (
  id TEXT PRIMARY KEY,
  customer_account_id TEXT NOT NULL,
  candidate_client_ids TEXT NOT NULL DEFAULT '[]',
  match_field TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  resolved_by TEXT DEFAULT '',
  resolved_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calfl_account ON customer_account_link_flags(customer_account_id);
CREATE INDEX IF NOT EXISTS idx_calfl_status ON customer_account_link_flags(status);
