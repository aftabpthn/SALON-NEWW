-- Advanced employee HR profile, documents, and idempotent bulk imports.
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS joining_date DATE,
  ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('','female','male','non_binary','prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT '' CHECK (employment_type IN ('','full_time','part_time','contract','intern')),
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reporting_manager_id TEXT REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS address_line1 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_staff_profiles_reporting_manager
  ON staff_profiles(tenant_id, branch_id, reporting_manager_id);

CREATE TABLE IF NOT EXISTS staff_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  document_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  expiry_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_documents_scope
  ON staff_documents(tenant_id, branch_id, staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_bulk_import_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  total_rows INTEGER NOT NULL CHECK (total_rows > 0),
  created_rows INTEGER NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  updated_rows INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
  staff_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, batch_key)
);

CREATE INDEX IF NOT EXISTS idx_staff_bulk_import_jobs_scope
  ON staff_bulk_import_jobs(tenant_id, branch_id, created_at DESC);
