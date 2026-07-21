CREATE TABLE IF NOT EXISTS marketing_campaign_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  event_type TEXT NOT NULL CHECK (event_type IN ('opened','clicked','opted_out')),
  provider_event_id TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,campaign_id,client_id,channel,event_type,provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaign_events_attribution
  ON marketing_campaign_events(tenant_id,branch_id,campaign_id,event_type,occurred_at DESC);
