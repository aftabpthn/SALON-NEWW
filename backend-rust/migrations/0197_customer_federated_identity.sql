CREATE TABLE IF NOT EXISTS customer_federated_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google','apple','facebook','phone','password','firebase')),
  provider_subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider,provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_customer_federated_identity_account
  ON customer_federated_identities (account_id,provider);
