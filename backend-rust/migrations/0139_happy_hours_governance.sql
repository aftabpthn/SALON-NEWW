CREATE TABLE IF NOT EXISTS pos_happy_hour_approval_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_id TEXT NOT NULL REFERENCES pos_happy_hour_rules(id),
  requested_by TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT '',
  requested_discount_bps INTEGER NOT NULL CHECK (requested_discount_bps BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  note TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_happy_hour_approvals_scope
  ON pos_happy_hour_approval_requests(tenant_id,branch_id,status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_happy_hour_approvals_pending_rule
  ON pos_happy_hour_approval_requests(tenant_id,branch_id,rule_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS pos_happy_hour_anomalies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,signature)
);
CREATE INDEX IF NOT EXISTS idx_happy_hour_anomalies_scope
  ON pos_happy_hour_anomalies(tenant_id,branch_id,status,severity,detected_at DESC);

CREATE TABLE IF NOT EXISTS pos_happy_hour_budgets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_paise BIGINT NOT NULL CHECK (budget_paise >= 0),
  alert_threshold_bps INTEGER NOT NULL DEFAULT 8000 CHECK (alert_threshold_bps BETWEEN 1 AND 10000),
  approval_above_bps INTEGER NOT NULL DEFAULT 1500 CHECK (approval_above_bps BETWEEN 1 AND 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE(tenant_id,branch_id,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS idx_happy_hour_budgets_scope
  ON pos_happy_hour_budgets(tenant_id,branch_id,active,period_start,period_end);

CREATE OR REPLACE FUNCTION enqueue_happy_hour_webhook_event()
RETURNS TRIGGER AS $$
DECLARE
  event_key TEXT := 'happy-hours:' || NEW.id;
  payload JSONB;
BEGIN
  payload := jsonb_build_object(
    'id',event_key,
    'type',NEW.event_type,
    'createdAt',NEW.created_at,
    'data',COALESCE(NEW.details_json,'{}'::JSONB)
  );
  INSERT INTO integration_webhook_deliveries(
    tenant_id,branch_id,subscription_id,event_type,event_id,payload_json
  )
  SELECT NEW.tenant_id,NEW.branch_id,subscription.id,NEW.event_type,event_key,payload
    FROM integration_webhook_subscriptions subscription
   WHERE subscription.tenant_id=NEW.tenant_id
     AND subscription.branch_id=NEW.branch_id
     AND subscription.active=TRUE
     AND subscription.events_json ? NEW.event_type
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_happy_hour_webhook_event ON auth_audit_logs;
CREATE TRIGGER trg_happy_hour_webhook_event
AFTER INSERT ON auth_audit_logs
FOR EACH ROW
WHEN (NEW.event_type LIKE 'happy_hours.%')
EXECUTE FUNCTION enqueue_happy_hour_webhook_event();
