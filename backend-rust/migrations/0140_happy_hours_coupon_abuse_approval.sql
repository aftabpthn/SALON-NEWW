CREATE TABLE IF NOT EXISTS pos_discount_approval_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES pos_sales(id),
  requested_by TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL CHECK (discount_type IN ('bill','coupon','line','combined')),
  discount_amount_paise BIGINT NOT NULL CHECK (discount_amount_paise > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','superseded')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_discount_approvals_scope
  ON pos_discount_approval_requests(tenant_id,branch_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discount_approvals_sale
  ON pos_discount_approval_requests(tenant_id,branch_id,sale_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_approvals_pending_sale
  ON pos_discount_approval_requests(tenant_id,branch_id,sale_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS pos_coupon_abuse_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  client_id TEXT NOT NULL,
  coupon_code TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'coupon_reuse',
  severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('low','medium','high','critical')),
  evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT NOT NULL DEFAULT '',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,branch_id,signature)
);
CREATE INDEX IF NOT EXISTS idx_coupon_abuse_alerts_scope
  ON pos_coupon_abuse_alerts(tenant_id,branch_id,status,severity,detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_abuse_alerts_client
  ON pos_coupon_abuse_alerts(tenant_id,branch_id,client_id,coupon_code);
