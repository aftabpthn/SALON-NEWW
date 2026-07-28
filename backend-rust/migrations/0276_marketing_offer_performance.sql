CREATE TABLE IF NOT EXISTS marketing_offer_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES pos_coupons(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('view','click')),
  channel TEXT NOT NULL CHECK (channel IN ('staff_app','customer_app','instagram','whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_offer_events_report
  ON marketing_offer_events (tenant_id, branch_id, offer_id, created_at DESC);
