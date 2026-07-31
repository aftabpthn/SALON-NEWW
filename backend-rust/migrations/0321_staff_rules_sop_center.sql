CREATE TABLE IF NOT EXISTS staff_rule_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  document_key TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('rule','sop')),
  category TEXT NOT NULL CHECK (category IN ('service','hygiene','attendance','behavior','safety')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  document_version INTEGER NOT NULL CHECK (document_version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unpublished')),
  effective_date DATE NOT NULL,
  expires_on DATE,
  mandatory_acknowledgement BOOLEAN NOT NULL DEFAULT TRUE,
  training_attachment_url TEXT NOT NULL DEFAULT '',
  quiz_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(quiz_json)='array'),
  quiz_pass_score INTEGER NOT NULL DEFAULT 0 CHECK (quiz_pass_score BETWEEN 0 AND 100),
  created_by TEXT NOT NULL,
  published_by TEXT,
  published_at TIMESTAMPTZ,
  unpublished_by TEXT,
  unpublished_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, document_key, document_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_rule_documents_published
  ON staff_rule_documents(tenant_id, branch_id, document_key)
  WHERE status='published';

CREATE INDEX IF NOT EXISTS idx_staff_rule_documents_scope
  ON staff_rule_documents(tenant_id, branch_id, status, effective_date, expires_on);

CREATE TABLE IF NOT EXISTS staff_rule_staff_status (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES staff_rule_documents(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  first_read_at TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  quiz_answers_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(quiz_answers_json)='array'),
  quiz_score INTEGER,
  quiz_passed BOOLEAN,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, document_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_rule_status_scope
  ON staff_rule_staff_status(tenant_id, branch_id, staff_id, acknowledged_at);

CREATE TABLE IF NOT EXISTS staff_rule_violations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES staff_rule_documents(id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  details TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  recorded_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_rule_violations_scope
  ON staff_rule_violations(tenant_id, branch_id, status, occurred_at DESC);
