ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_sensitive_excluded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS marketing_governance_settings (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  frequency_cap_days INTEGER NOT NULL DEFAULT 7 CHECK (frequency_cap_days BETWEEN 0 AND 365),
  quiet_start TIME NOT NULL DEFAULT TIME '20:00',
  quiet_end TIME NOT NULL DEFAULT TIME '09:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  offer_approval_threshold_bps INTEGER NOT NULL DEFAULT 1000 CHECK (offer_approval_threshold_bps BETWEEN 0 AND 10000),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,branch_id)
);

WITH grants(role_name,permissions) AS (
  VALUES
    ('Owner', '["marketing.read","marketing.manage","marketing.approve","marketing.send","offers.approve","templates.manage","analytics.read"]'::JSONB),
    ('Admin', '["marketing.read","marketing.manage","marketing.approve","marketing.send","offers.approve","templates.manage","analytics.read"]'::JSONB),
    ('Manager', '["marketing.read","marketing.manage","marketing.approve","marketing.send","offers.approve","templates.manage","analytics.read"]'::JSONB),
    ('Marketing Lead', '["marketing.read","marketing.manage","marketing.approve","marketing.send","offers.approve","templates.manage","analytics.read"]'::JSONB),
    ('Analyst', '["marketing.read","analytics.read"]'::JSONB)
)
UPDATE roles role
   SET permissions_json=(SELECT JSONB_AGG(DISTINCT permission) FROM JSONB_ARRAY_ELEMENTS(role.permissions_json||grants.permissions) permission),updated_at=NOW()
  FROM grants WHERE role.is_system=TRUE AND LOWER(role.name)=LOWER(grants.role_name);
