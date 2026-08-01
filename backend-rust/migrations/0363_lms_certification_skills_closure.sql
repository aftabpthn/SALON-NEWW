CREATE TABLE IF NOT EXISTS staff_course_profiles (
  document_id TEXT PRIMARY KEY REFERENCES staff_rule_documents(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  skill_name TEXT NOT NULL DEFAULT '',
  skill_level SMALLINT NOT NULL DEFAULT 1 CHECK (skill_level BETWEEN 1 AND 5),
  expected_minutes INTEGER NOT NULL DEFAULT 0 CHECK (expected_minutes BETWEEN 0 AND 10080),
  certification_valid_days INTEGER NOT NULL DEFAULT 0 CHECK (certification_valid_days BETWEEN 0 AND 3650),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_course_profiles_skill
  ON staff_course_profiles(tenant_id, branch_id, LOWER(skill_name))
  WHERE skill_name<>'';

ALTER TABLE staff_tasks
  ADD COLUMN IF NOT EXISTS course_document_id TEXT REFERENCES staff_rule_documents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_active_course_assignment
  ON staff_tasks(tenant_id, branch_id, staff_id, course_document_id)
  WHERE course_document_id IS NOT NULL AND status IN ('open','in_progress','blocked');

CREATE INDEX IF NOT EXISTS idx_staff_course_assignments
  ON staff_tasks(tenant_id, branch_id, course_document_id, status, staff_id)
  WHERE course_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_skill_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('role','service')),
  scope_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  required_level SMALLINT NOT NULL DEFAULT 1 CHECK (required_level BETWEEN 1 AND 5),
  certification_required BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_skill_requirement
  ON staff_skill_requirements(tenant_id, branch_id, scope_type, scope_id, LOWER(skill_name));

CREATE INDEX IF NOT EXISTS idx_staff_skill_requirements_scope
  ON staff_skill_requirements(tenant_id, branch_id, active, scope_type, scope_id);

ALTER TABLE staff_skill_licenses
  ADD COLUMN IF NOT EXISTS skill_level SMALLINT NOT NULL DEFAULT 1 CHECK (skill_level BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS source_course_document_id TEXT REFERENCES staff_rule_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewed_from_license_id TEXT REFERENCES staff_skill_licenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

UPDATE staff_skill_licenses
SET verified_at=COALESCE(verified_at,updated_at,created_at), verified_by=COALESCE(verified_by,created_by)
WHERE verification_status='verified' AND verified_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_course_certificate
  ON staff_skill_licenses(tenant_id, branch_id, staff_id, source_course_document_id)
  WHERE source_course_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_course_completion_evidence()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.course_document_id IS NOT NULL AND NEW.status='completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM staff_rule_staff_status evidence
       WHERE evidence.tenant_id=NEW.tenant_id AND evidence.branch_id=NEW.branch_id
         AND evidence.document_id=NEW.course_document_id AND evidence.staff_id=NEW.staff_id
         AND evidence.acknowledged_at IS NOT NULL AND evidence.quiz_passed=TRUE
     ) THEN
    RAISE EXCEPTION 'course acknowledgement and passing quiz evidence are required';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_course_completion_evidence ON staff_tasks;
CREATE TRIGGER trg_staff_course_completion_evidence
  BEFORE INSERT OR UPDATE OF status ON staff_tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_course_completion_evidence();
