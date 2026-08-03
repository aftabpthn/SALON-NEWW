ALTER TABLE cash_drawer_tills
  ADD COLUMN IF NOT EXISTS terminal_id TEXT REFERENCES pos_terminals(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_active_terminal
  ON cash_drawer_tills (tenant_id, branch_id, drawer_session_id, terminal_id)
  WHERE terminal_id IS NOT NULL AND status IN ('open','pending_approval');

CREATE TABLE IF NOT EXISTS pos_cash_control_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  max_cash_paise BIGINT NOT NULL DEFAULT 0 CHECK (max_cash_paise BETWEEN 0 AND 100000000000),
  variance_alert_paise BIGINT NOT NULL DEFAULT 10000 CHECK (variance_alert_paise BETWEEN 0 AND 100000000000),
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS cash_drawer_close_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE RESTRICT,
  business_date DATE NOT NULL,
  snapshot_json JSONB NOT NULL,
  checksum TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, drawer_session_id)
);

INSERT INTO cash_drawer_close_snapshots
  (tenant_id,branch_id,drawer_session_id,business_date,snapshot_json,checksum,created_by_user_id,created_at)
SELECT session.tenant_id,session.branch_id,session.id,session.business_date,
       jsonb_build_object(
         'drawerSessionId',session.id,'businessDate',session.business_date,
         'openingCashPaise',session.opening_cash_paise,'expectedCashPaise',session.expected_cash_paise,
         'countedCashPaise',session.counted_cash_paise,'variancePaise',session.variance_paise,
         'denominationBreakdown',session.denomination_breakdown_json,
         'closeRequestedAt',session.close_requested_at,'approvedAt',session.approved_at,
         'closedAt',session.closed_at
       ),
       md5(jsonb_build_object(
         'drawerSessionId',session.id,'businessDate',session.business_date,
         'openingCashPaise',session.opening_cash_paise,'expectedCashPaise',session.expected_cash_paise,
         'countedCashPaise',session.counted_cash_paise,'variancePaise',session.variance_paise,
         'denominationBreakdown',session.denomination_breakdown_json,
         'closeRequestedAt',session.close_requested_at,'approvedAt',session.approved_at,
         'closedAt',session.closed_at
       )::TEXT),
       COALESCE(NULLIF(session.approved_by_user_id,''),NULLIF(session.closed_by_user_id,''),session.opened_by_user_id),
       COALESCE(session.closed_at,session.updated_at,session.opened_at)
  FROM cash_drawer_sessions session
 WHERE session.status='closed'
ON CONFLICT (tenant_id,branch_id,drawer_session_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS pos_day_lock_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('locked','reopened')),
  reason TEXT NOT NULL CHECK (BTRIM(reason)<>''),
  actor_user_id TEXT NOT NULL,
  holiday_exception BOOLEAN NOT NULL DEFAULT FALSE,
  holiday_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_day_lock_events_date
  ON pos_day_lock_events (tenant_id, branch_id, business_date, created_at);

INSERT INTO pos_day_lock_events
  (tenant_id,branch_id,business_date,action,reason,actor_user_id,created_at)
SELECT tenant_id,branch_id,business_date,status,reason,actor_user_id,
       CASE WHEN status='reopened' THEN COALESCE(reopened_at,updated_at,locked_at) ELSE locked_at END
  FROM pos_day_locks
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_immutable_pos_close_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'immutable POS close evidence cannot be changed' USING ERRCODE='P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_drawer_close_snapshots_immutable ON cash_drawer_close_snapshots;
CREATE TRIGGER trg_cash_drawer_close_snapshots_immutable
BEFORE UPDATE OR DELETE ON cash_drawer_close_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_pos_close_evidence_mutation();

DROP TRIGGER IF EXISTS trg_pos_day_lock_events_immutable ON pos_day_lock_events;
CREATE TRIGGER trg_pos_day_lock_events_immutable
BEFORE UPDATE OR DELETE ON pos_day_lock_events
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_pos_close_evidence_mutation();
