CREATE TABLE IF NOT EXISTS hr_job_openings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time','part_time','contract','intern')),
  openings_count INTEGER NOT NULL DEFAULT 1 CHECK (openings_count > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paused','closed')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_job_openings_scope
  ON hr_job_openings(tenant_id, branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS hr_job_applications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  job_opening_id TEXT NOT NULL REFERENCES hr_job_openings(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  resume_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','screening','interview','offer','hired','rejected','withdrawn')),
  linked_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (email <> '' OR phone <> ''),
  CHECK (stage <> 'hired' OR linked_staff_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hr_job_applications_scope
  ON hr_job_applications(tenant_id, branch_id, job_opening_id, stage, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_job_application_email
  ON hr_job_applications(tenant_id, branch_id, job_opening_id, LOWER(email))
  WHERE email <> '' AND stage NOT IN ('rejected','withdrawn');

CREATE TABLE IF NOT EXISTS staff_lifecycle_cases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  application_id TEXT REFERENCES hr_job_applications(id) ON DELETE RESTRICT,
  case_type TEXT NOT NULL CHECK (case_type IN ('onboarding','offboarding')),
  effective_date DATE NOT NULL,
  owner_user_id TEXT NOT NULL,
  tasks_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(tasks_json)='array'),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (staff_id IS NOT NULL OR application_id IS NOT NULL),
  CHECK (case_type <> 'offboarding' OR staff_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_staff_lifecycle_cases_scope
  ON staff_lifecycle_cases(tenant_id, branch_id, case_type, status, effective_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_lifecycle_active_case
  ON staff_lifecycle_cases(tenant_id, branch_id, case_type, COALESCE(staff_id,''), COALESCE(application_id,''))
  WHERE status IN ('planned','in_progress');

CREATE TABLE IF NOT EXISTS staff_appraisal_cycles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','review','calibration','closed')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (period_end >= period_start),
  UNIQUE (tenant_id, branch_id, name, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_staff_appraisal_cycles_scope
  ON staff_appraisal_cycles(tenant_id, branch_id, status, period_end DESC);

CREATE TABLE IF NOT EXISTS staff_succession_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  role_title TEXT NOT NULL,
  incumbent_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
  target_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_succession_plans_scope
  ON staff_succession_plans(tenant_id, branch_id, status, target_date);

CREATE TABLE IF NOT EXISTS staff_succession_candidates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES staff_succession_plans(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  readiness TEXT NOT NULL CHECK (readiness IN ('ready_now','short_term','long_term','not_ready')),
  readiness_score INTEGER NOT NULL CHECK (readiness_score BETWEEN 0 AND 100),
  evidence_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(evidence_json)='array'),
  development_actions_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(development_actions_json)='array'),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','removed')),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, branch_id, plan_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_succession_candidates_scope
  ON staff_succession_candidates(tenant_id, branch_id, plan_id, status, readiness_score DESC);
