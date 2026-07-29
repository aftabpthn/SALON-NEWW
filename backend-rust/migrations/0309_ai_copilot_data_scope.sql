-- AI copilot data scope, governance and proactive intelligence storage.
-- Every copilot answer resolves a login-derived scope, records what it was allowed to
-- read, and routes risky actions through explicit approval instead of auto-execution.

CREATE TABLE IF NOT EXISTS ai_copilot_scope_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_name TEXT NOT NULL DEFAULT '',
  scope_level TEXT NOT NULL CHECK (scope_level IN ('tenant','region','zone','cluster','branch','self')),
  scope_label TEXT NOT NULL DEFAULT '',
  requested_scope_level TEXT NOT NULL DEFAULT '',
  requested_scope_label TEXT NOT NULL DEFAULT '',
  narrowed BOOLEAN NOT NULL DEFAULT FALSE,
  authorized_branch_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  denied_branch_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  tool_name TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  period_start DATE,
  period_end DATE,
  outcome TEXT NOT NULL DEFAULT 'answered'
    CHECK (outcome IN ('answered','narrowed','denied','insufficient_data','error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_copilot_scope_audit_scope
  ON ai_copilot_scope_audit (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_scope_audit_outcome
  ON ai_copilot_scope_audit (tenant_id, outcome, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_copilot_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  scope_level TEXT NOT NULL DEFAULT 'branch'
    CHECK (scope_level IN ('tenant','region','zone','cluster','branch','self')),
  scope_label TEXT NOT NULL DEFAULT '',
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'staff_performance_decline','branch_revenue_decline','unusual_product_consumption',
    'product_wastage','service_demand_decline','high_no_show_risk','client_churn_opportunity',
    'membership_expiry','stock_shortage','margin_loss','target_miss'
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  subject_type TEXT NOT NULL DEFAULT '',
  subject_id TEXT NOT NULL DEFAULT '',
  subject_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  metrics_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  required_permission TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed')),
  acknowledged_by TEXT NOT NULL DEFAULT '',
  acknowledged_at TIMESTAMPTZ,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Repeated detections of the same condition update one open row instead of stacking.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_copilot_alerts_open_fingerprint
  ON ai_copilot_alerts (tenant_id, branch_id, fingerprint)
  WHERE status IN ('open','acknowledged');
CREATE INDEX IF NOT EXISTS idx_ai_copilot_alerts_feed
  ON ai_copilot_alerts (tenant_id, branch_id, status, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ai_copilot_approvals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'payment','refund','offer_publish','marketing_send','booking_confirmation','payroll_change',
    'coaching_task_draft','stock_audit_draft','purchase_draft','report_draft','recommendation'
  )),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('auto','explicit_approval')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  scope_level TEXT NOT NULL DEFAULT 'branch'
    CHECK (scope_level IN ('tenant','region','zone','cluster','branch','self')),
  scope_label TEXT NOT NULL DEFAULT '',
  required_permission TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  requested_by TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT ck_ai_copilot_approvals_auto_status CHECK (
    approval_mode = 'explicit_approval' OR status <> 'pending'
  ),
  CONSTRAINT ck_ai_copilot_approvals_decision CHECK (
    status = 'pending' OR decided_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_copilot_approvals_queue
  ON ai_copilot_approvals (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_copilot_approvals_requester
  ON ai_copilot_approvals (tenant_id, requested_by, created_at DESC);
