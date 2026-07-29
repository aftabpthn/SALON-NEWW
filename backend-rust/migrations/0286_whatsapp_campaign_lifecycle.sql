ALTER TABLE whatsapp_campaign_plans
  DROP CONSTRAINT IF EXISTS whatsapp_campaign_plans_status_check;

ALTER TABLE whatsapp_campaign_plans
  ADD CONSTRAINT whatsapp_campaign_plans_status_check
  CHECK (status IN ('draft','pending','approved','rejected','scheduled','sent','stopped','cancelled','archived'));

ALTER TABLE whatsapp_campaign_plans
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
