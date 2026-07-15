CREATE TABLE IF NOT EXISTS auth_sso_policies (
    tenant_id TEXT PRIMARY KEY,
    google_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    microsoft_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enforced_roles TEXT[] NOT NULL DEFAULT '{}',
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
