ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'english',
  ADD COLUMN IF NOT EXISTS service_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS occasion_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS offer_id TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='message_templates_language_check') THEN
    ALTER TABLE message_templates ADD CONSTRAINT message_templates_language_check
      CHECK (language IN ('english','hindi'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_message_templates_library
  ON message_templates(tenant_id,branch_id,channel,language,service_id,occasion_key,status);
