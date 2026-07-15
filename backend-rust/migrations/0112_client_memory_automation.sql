CREATE TABLE IF NOT EXISTS client_recommendation_feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL CHECK (BTRIM(recommendation) <> ''),
  reason TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  comment TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_recommendation_feedback_client
  ON client_recommendation_feedback (tenant_id, branch_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_segment_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  previous_segment TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL,
  rfm_score SMALLINT NOT NULL CHECK (rfm_score BETWEEN 3 AND 15),
  churn_risk_score SMALLINT NOT NULL CHECK (churn_risk_score BETWEEN 0 AND 100),
  source_snapshot_date DATE NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, client_id, source_snapshot_date, segment)
);
CREATE INDEX IF NOT EXISTS idx_client_segment_history_client
  ON client_segment_history (tenant_id, branch_id, client_id, changed_at DESC);

CREATE OR REPLACE FUNCTION record_client_segment_change()
RETURNS TRIGGER AS $$
DECLARE previous_value TEXT;
BEGIN
  SELECT segment INTO previous_value
    FROM client_intelligence_snapshots
   WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND client_id=NEW.client_id AND id<>NEW.id
   ORDER BY snapshot_date DESC,calculated_at DESC LIMIT 1;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO client_segment_history(tenant_id,branch_id,client_id,previous_segment,segment,rfm_score,churn_risk_score,source_snapshot_date,changed_at)
    VALUES(NEW.tenant_id,NEW.branch_id,NEW.client_id,COALESCE(previous_value,''),NEW.segment,NEW.rfm_score,NEW.churn_risk_score,NEW.snapshot_date,NEW.calculated_at)
    ON CONFLICT DO NOTHING;
  ELSIF OLD.segment IS DISTINCT FROM NEW.segment THEN
    INSERT INTO client_segment_history(tenant_id,branch_id,client_id,previous_segment,segment,rfm_score,churn_risk_score,source_snapshot_date,changed_at)
    VALUES(NEW.tenant_id,NEW.branch_id,NEW.client_id,OLD.segment,NEW.segment,NEW.rfm_score,NEW.churn_risk_score,NEW.snapshot_date,NEW.calculated_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO client_segment_history (
  tenant_id, branch_id, client_id, previous_segment, segment,
  rfm_score, churn_risk_score, source_snapshot_date, changed_at
)
SELECT DISTINCT ON (tenant_id, branch_id, client_id)
  tenant_id, branch_id, client_id, '', segment,
  rfm_score, churn_risk_score, snapshot_date, calculated_at
FROM client_intelligence_snapshots
ORDER BY tenant_id, branch_id, client_id, snapshot_date DESC, calculated_at DESC
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS trg_client_segment_history ON client_intelligence_snapshots;
CREATE TRIGGER trg_client_segment_history
AFTER INSERT OR UPDATE OF segment,rfm_score,churn_risk_score ON client_intelligence_snapshots
FOR EACH ROW EXECUTE FUNCTION record_client_segment_change();

ALTER TABLE benefit_notification_outbox DROP CONSTRAINT IF EXISTS benefit_notification_outbox_source_type_check;
ALTER TABLE benefit_notification_outbox ADD CONSTRAINT benefit_notification_outbox_source_type_check
  CHECK (source_type IN ('membership_reminder','package_alert','win_back','occasion_campaign','membership_renewal','wallet_reminder','review_recovery'));

CREATE INDEX IF NOT EXISTS idx_appointments_client_timeline
  ON appointments (tenant_id, branch_id, client_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sales_client_timeline
  ON pos_sales (tenant_id, branch_id, client_id, created_at DESC);
