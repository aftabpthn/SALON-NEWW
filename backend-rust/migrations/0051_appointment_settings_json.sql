ALTER TABLE appointment_branch_settings
    ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb;
