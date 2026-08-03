ALTER TABLE security_privacy_requests
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS execution_summary_json JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE security_privacy_requests DROP CONSTRAINT IF EXISTS security_privacy_requests_approval_status_check;
ALTER TABLE security_privacy_requests ADD CONSTRAINT security_privacy_requests_approval_status_check
  CHECK (approval_status IN ('not_required','pending','approved','rejected'));
ALTER TABLE security_privacy_requests DROP CONSTRAINT IF EXISTS security_privacy_requests_execution_status_check;
ALTER TABLE security_privacy_requests ADD CONSTRAINT security_privacy_requests_execution_status_check
  CHECK (execution_status IN ('not_started','pending','completed','blocked'));
ALTER TABLE security_privacy_requests DROP CONSTRAINT IF EXISTS security_privacy_requests_execution_summary_check;
ALTER TABLE security_privacy_requests ADD CONSTRAINT security_privacy_requests_execution_summary_check
  CHECK (JSONB_TYPEOF(execution_summary_json)='object');

UPDATE security_privacy_requests
SET approval_status='pending', execution_status='pending'
WHERE request_type='deletion' AND status='open' AND approval_status='not_required';

CREATE TABLE IF NOT EXISTS security_data_retention_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  record_class TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  disposition TEXT NOT NULL CHECK (disposition IN ('delete','anonymize','review')),
  legal_basis TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_id, record_class)
);

CREATE TABLE IF NOT EXISTS security_legal_holds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('client','staff','user','tenant')),
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','expired')),
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  released_by TEXT,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_security_legal_holds_scope
  ON security_legal_holds(tenant_id,branch_id,subject_type,subject_id,status,expires_at);

CREATE TABLE IF NOT EXISTS security_pii_export_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('client')),
  subject_id TEXT NOT NULL DEFAULT '',
  row_limit INTEGER NOT NULL CHECK (row_limit BETWEEN 1 AND 10000),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','downloaded','expired')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  download_token_hash TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status IN ('approved','downloaded') AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL AND download_token_hash<>'')
      OR status IN ('pending','rejected','expired'))
);
CREATE INDEX IF NOT EXISTS idx_security_pii_exports_scope
  ON security_pii_export_requests(tenant_id,branch_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS security_compliance_evidence_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  framework TEXT NOT NULL CHECK (framework IN ('soc1','soc2','iso27001','gdpr','hipaa','pci')),
  control_key TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','ready','verified','not_applicable')),
  evidence_reference TEXT NOT NULL DEFAULT '',
  independent_assessor TEXT NOT NULL DEFAULT '',
  valid_until DATE,
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,framework,control_key)
);

CREATE TABLE IF NOT EXISTS security_pen_test_findings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  status TEXT NOT NULL CHECK (status IN ('open','resolved','risk_accepted')),
  owner_user_id TEXT NOT NULL,
  remediation_note TEXT NOT NULL DEFAULT '',
  risk_acceptance_reason TEXT NOT NULL DEFAULT '',
  risk_accepted_by TEXT,
  risk_acceptance_expires_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status<>'risk_accepted' OR (risk_acceptance_reason<>'' AND risk_accepted_by IS NOT NULL AND risk_acceptance_expires_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_security_pen_test_findings_scope
  ON security_pen_test_findings(tenant_id,branch_id,status,severity,updated_at DESC);
