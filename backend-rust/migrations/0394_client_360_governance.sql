ALTER TABLE client_merge_history
  ADD COLUMN IF NOT EXISTS reversed_by TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE client_merge_history DROP CONSTRAINT IF EXISTS client_merge_history_reversal_check;
ALTER TABLE client_merge_history ADD CONSTRAINT client_merge_history_reversal_check
  CHECK ((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason='')
      OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason<>''));

CREATE TABLE IF NOT EXISTS client_profile_360 (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  gender TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  marketing_source TEXT NOT NULL DEFAULT '',
  source_detail TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,client_id),
  CHECK (CHAR_LENGTH(gender)<=40),
  CHECK (CHAR_LENGTH(address)<=500),
  CHECK (CHAR_LENGTH(city)<=120),
  CHECK (CHAR_LENGTH(postal_code)<=24),
  CHECK (CHAR_LENGTH(preferred_language)<=40),
  CHECK (CHAR_LENGTH(occupation)<=120),
  CHECK (CHAR_LENGTH(marketing_source)<=120),
  CHECK (CHAR_LENGTH(source_detail)<=500)
);

CREATE INDEX IF NOT EXISTS idx_client_profile_360_source
  ON client_profile_360(tenant_id,branch_id,marketing_source)
  WHERE marketing_source<>'';
