CREATE TABLE IF NOT EXISTS client_form_definitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  form_key TEXT NOT NULL,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  form_type TEXT NOT NULL CHECK (form_type IN ('consent','intake','treatment')),
  version INTEGER NOT NULL CHECK (version > 0),
  body TEXT NOT NULL DEFAULT '',
  fields_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(fields_json) = 'array'),
  requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, form_key, version)
);

CREATE INDEX IF NOT EXISTS idx_client_form_definitions_scope
  ON client_form_definitions (tenant_id, branch_id, active, form_key, version DESC);

CREATE TABLE IF NOT EXISTS client_clinical_profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  allergies TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, client_id)
);

CREATE TABLE IF NOT EXISTS client_form_submissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES client_form_definitions(id) ON DELETE RESTRICT,
  form_key TEXT NOT NULL,
  form_name TEXT NOT NULL,
  form_type TEXT NOT NULL,
  form_version INTEGER NOT NULL CHECK (form_version > 0),
  responses_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(responses_json) = 'object'),
  signature_name TEXT NOT NULL DEFAULT '',
  signature_sha256 TEXT NOT NULL DEFAULT '',
  signed_at TIMESTAMPTZ,
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((signature_name = '' AND signature_sha256 = '' AND signed_at IS NULL)
      OR (signature_name <> '' AND signature_sha256 <> '' AND signed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_client_form_submissions_client
  ON client_form_submissions (tenant_id, branch_id, client_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS client_treatment_photos (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id TEXT,
  caption TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (OCTET_LENGTH(content) = byte_size)
);

CREATE INDEX IF NOT EXISTS idx_client_treatment_photos_client
  ON client_treatment_photos (tenant_id, branch_id, client_id, created_at DESC);
