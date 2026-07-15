CREATE TABLE IF NOT EXISTS security_privacy_requests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    subject_type TEXT NOT NULL DEFAULT 'client',
    subject_id TEXT NOT NULL DEFAULT '',
    request_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolution_note TEXT NOT NULL DEFAULT '',
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_privacy_requests_scope
    ON security_privacy_requests (tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS security_disclosure_reports (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    reporter_name TEXT NOT NULL DEFAULT '',
    reporter_contact TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
    resolution_note TEXT NOT NULL DEFAULT '',
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_disclosure_reports_scope
    ON security_disclosure_reports (tenant_id, branch_id, status, created_at DESC);
