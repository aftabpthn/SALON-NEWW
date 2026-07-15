-- Phase 8: branch hierarchy and time-bound staff deputation.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS region_name TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS zone_name TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS cluster_name TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='branches'::regclass AND conname='ck_branches_hierarchy'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT ck_branches_hierarchy CHECK (
      CHAR_LENGTH(region_name) <= 100
      AND CHAR_LENGTH(zone_name) <= 100
      AND CHAR_LENGTH(cluster_name) <= 100
      AND (zone_name='' OR region_name<>'')
      AND (cluster_name='' OR zone_name<>'')
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_branches_tenant_hierarchy
  ON branches(tenant_id, region_name, zone_name, cluster_name, active);

ALTER TABLE user_branch_roles
  ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'permanent';
ALTER TABLE user_branch_roles ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE user_branch_roles ADD COLUMN IF NOT EXISTS valid_until DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='user_branch_roles'::regclass
      AND conname='ck_user_branch_roles_access_window'
  ) THEN
    ALTER TABLE user_branch_roles
      ADD CONSTRAINT ck_user_branch_roles_access_window CHECK (
        (access_type='permanent' AND valid_from IS NULL AND valid_until IS NULL)
        OR
        (access_type='deputation' AND valid_from IS NOT NULL AND valid_until >= valid_from)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='user_branch_roles'::regclass
      AND conname='ck_user_branch_roles_default_permanent'
  ) THEN
    ALTER TABLE user_branch_roles
      ADD CONSTRAINT ck_user_branch_roles_default_permanent CHECK (
        is_default=FALSE OR access_type='permanent'
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_effective
  ON user_branch_roles(tenant_id, user_id, active, access_type, valid_from, valid_until);
