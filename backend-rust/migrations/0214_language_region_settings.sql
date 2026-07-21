CREATE TABLE IF NOT EXISTS tenant_language_settings (
  tenant_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT '*',
  primary_language TEXT NOT NULL DEFAULT 'en-IN',
  secondary_language TEXT,
  display_mode TEXT NOT NULL DEFAULT 'single' CHECK (display_mode IN ('single', 'bilingual')),
  region TEXT NOT NULL DEFAULT 'IN',
  currency TEXT NOT NULL DEFAULT 'INR',
  time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
  number_locale TEXT NOT NULL DEFAULT 'en-IN',
  allow_user_override BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_language_settings_scope
  ON tenant_language_settings (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS user_language_preferences (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT '*',
  user_id TEXT NOT NULL,
  primary_language TEXT NOT NULL,
  secondary_language TEXT,
  display_mode TEXT NOT NULL CHECK (display_mode IN ('single', 'bilingual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_language_preferences_scope
  ON user_language_preferences (tenant_id, branch_id, user_id);
