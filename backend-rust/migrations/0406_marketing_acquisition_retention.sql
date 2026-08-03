ALTER TABLE marketing_leads
  ADD COLUMN IF NOT EXISTS capture_channel TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS external_source_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  ADD COLUMN IF NOT EXISTS first_contacted_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='marketing_leads_capture_channel_check') THEN
    ALTER TABLE marketing_leads ADD CONSTRAINT marketing_leads_capture_channel_check
      CHECK (capture_channel IN ('phone','sms','whatsapp','web_form','social','referral','walk_in','api','other'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_leads_external_source
  ON marketing_leads(tenant_id,branch_id,capture_channel,external_source_id)
  WHERE external_source_id<>'';
CREATE INDEX IF NOT EXISTS idx_marketing_leads_sla
  ON marketing_leads(tenant_id,branch_id,sla_due_at)
  WHERE stage NOT IN ('converted','lost') AND first_contacted_at IS NULL;

ALTER TABLE marketing_governance_settings
  ADD COLUMN IF NOT EXISTS control_group_bps INTEGER NOT NULL DEFAULT 0 CHECK (control_group_bps BETWEEN 0 AND 5000),
  ADD COLUMN IF NOT EXISTS attribution_window_days INTEGER NOT NULL DEFAULT 30 CHECK (attribution_window_days BETWEEN 1 AND 365);

CREATE TABLE IF NOT EXISTS marketing_campaign_control_members (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id,campaign_id,client_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_control_report
  ON marketing_campaign_control_members(tenant_id,branch_id,campaign_id,assigned_at);

ALTER TABLE benefit_notification_outbox
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE benefit_notification_outbox
  DROP CONSTRAINT IF EXISTS benefit_notification_outbox_status_check;
ALTER TABLE benefit_notification_outbox
  ADD CONSTRAINT benefit_notification_outbox_status_check
  CHECK (status IN ('queued','processing','sent','failed','blocked','dead_letter'));

CREATE INDEX IF NOT EXISTS idx_marketing_dead_letter
  ON benefit_notification_outbox(tenant_id,branch_id,updated_at DESC)
  WHERE source_type='marketing_campaign' AND status='dead_letter';
