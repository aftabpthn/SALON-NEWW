CREATE TABLE IF NOT EXISTS profit_governance_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (
    rule_type IN ('margin_safe_discount','negative_margin_block','profit_action_governance')
  ),
  title TEXT NOT NULL CHECK (LENGTH(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (LENGTH(description) <= 500),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_margin_bps INTEGER NOT NULL CHECK (min_margin_bps BETWEEN 0 AND 10000),
  max_discount_bps INTEGER NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 10000),
  max_impact_paise BIGINT NOT NULL CHECK (max_impact_paise >= 0),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  auto_execute_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  audit_required BOOLEAN NOT NULL DEFAULT TRUE,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_profit_governance_rules_scope
  ON profit_governance_rules (tenant_id, branch_id, enabled, rule_type);

CREATE TABLE IF NOT EXISTS profit_governance_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  rule_id TEXT REFERENCES profit_governance_rules(id) ON DELETE SET NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('discount','action')),
  source_type TEXT NOT NULL CHECK (LENGTH(source_type) BETWEEN 1 AND 64),
  source_id TEXT NOT NULL CHECK (LENGTH(source_id) BETWEEN 1 AND 128),
  action_type TEXT NOT NULL DEFAULT '' CHECK (LENGTH(action_type) <= 64),
  decision TEXT NOT NULL CHECK (
    decision IN ('allowed','approval_required','blocked','auto_execute_allowed')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('allowed','pending_approval','blocked','approved','rejected')
  ),
  gross_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (gross_amount_paise >= 0),
  discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  product_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (product_cost_paise >= 0),
  staff_cost_paise BIGINT NOT NULL DEFAULT 0 CHECK (staff_cost_paise >= 0),
  membership_redemption_paise BIGINT NOT NULL DEFAULT 0
    CHECK (membership_redemption_paise >= 0),
  estimated_profit_paise BIGINT NOT NULL DEFAULT 0,
  margin_bps BIGINT NOT NULL DEFAULT 0,
  discount_bps BIGINT NOT NULL DEFAULT 0,
  impact_paise BIGINT NOT NULL DEFAULT 0 CHECK (impact_paise >= 0),
  reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(reason_codes) = 'array'),
  message TEXT NOT NULL DEFAULT '' CHECK (LENGTH(message) <= 500),
  requested_by_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (LENGTH(idempotency_key) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_profit_governance_decisions_scope
  ON profit_governance_decisions (tenant_id, branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profit_governance_decisions_source
  ON profit_governance_decisions (tenant_id, branch_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS profit_governance_approvals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  decision_id TEXT NOT NULL UNIQUE
    REFERENCES profit_governance_decisions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  requested_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  review_note TEXT NOT NULL DEFAULT '' CHECK (LENGTH(review_note) <= 500),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_profit_governance_approvals_scope
  ON profit_governance_approvals (tenant_id, branch_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS profit_governance_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  decision_id TEXT REFERENCES profit_governance_decisions(id) ON DELETE RESTRICT,
  rule_id TEXT REFERENCES profit_governance_rules(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('rule_saved','evaluated','approval_requested','approved','rejected')
  ),
  actor_user_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(details_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_governance_audit_scope
  ON profit_governance_audit_events
    (tenant_id, branch_id, created_at DESC, event_type);

CREATE OR REPLACE FUNCTION reject_profit_governance_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'profit governance audit events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profit_governance_audit_immutable
  ON profit_governance_audit_events;

CREATE TRIGGER trg_profit_governance_audit_immutable
BEFORE UPDATE OR DELETE ON profit_governance_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_profit_governance_audit_mutation();
