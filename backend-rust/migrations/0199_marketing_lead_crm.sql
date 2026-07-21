CREATE TABLE IF NOT EXISTS marketing_leads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL CHECK (BTRIM(first_name) <> '' AND LENGTH(first_name) <= 120),
  last_name TEXT NOT NULL DEFAULT '' CHECK (LENGTH(last_name) <= 120),
  phone TEXT NOT NULL DEFAULT '' CHECK (LENGTH(phone) <= 40),
  email TEXT NOT NULL DEFAULT '' CHECK (LENGTH(email) <= 254),
  source TEXT NOT NULL DEFAULT 'other' CHECK (LENGTH(source) <= 80),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','converted','lost')),
  qualification_status TEXT NOT NULL DEFAULT 'unqualified'
    CHECK (qualification_status IN ('unqualified','qualified','disqualified')),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  owner_user_id TEXT NOT NULL DEFAULT '',
  next_follow_up_date DATE,
  converted_appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '' CHECK (LENGTH(notes) <= 4000),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_scope_stage
  ON marketing_leads (tenant_id, branch_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_scope_owner
  ON marketing_leads (tenant_id, branch_id, owner_user_id, next_follow_up_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_leads_active_phone
  ON marketing_leads (tenant_id, branch_id, phone)
  WHERE phone <> '' AND stage NOT IN ('converted','lost');

CREATE TABLE IF NOT EXISTS marketing_lead_activities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('note','call','message','follow_up','qualification','conversion')),
  body TEXT NOT NULL CHECK (BTRIM(body) <> '' AND LENGTH(body) <= 4000),
  next_follow_up_date DATE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_lead_activities_scope
  ON marketing_lead_activities (tenant_id, branch_id, lead_id, created_at DESC);
