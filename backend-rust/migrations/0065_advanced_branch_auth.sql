ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_version BIGINT NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_login_id
  ON users(tenant_id, LOWER(login_id))
  WHERE login_id IS NOT NULL AND BTRIM(login_id) <> '';

CREATE TABLE IF NOT EXISTS user_branch_roles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  role_id TEXT REFERENCES roles(id),
  role_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  UNIQUE(tenant_id, user_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_access
  ON user_branch_roles(tenant_id, user_id, branch_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_branch_roles_default
  ON user_branch_roles(tenant_id, user_id)
  WHERE is_default = TRUE AND active = TRUE;

INSERT INTO user_branch_roles (tenant_id, user_id, branch_id, role_id, role_name, is_default)
SELECT tenant_id, id, branch_id, role_id, role_name, TRUE
FROM users
WHERE branch_id IS NOT NULL AND BTRIM(branch_id) <> ''
ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING;

ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS role_name TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS permission_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

UPDATE auth_refresh_tokens SET session_id = id WHERE session_id IS NULL OR BTRIM(session_id) = '';
ALTER TABLE auth_refresh_tokens ALTER COLUMN session_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session
  ON auth_refresh_tokens(tenant_id, user_id, session_id, revoked_at);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  branch_id TEXT,
  identity TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_tenant_created
  ON auth_audit_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_user_created
  ON auth_audit_logs(tenant_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION bump_branch_role_permission_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE users SET permission_version = permission_version + 1, updated_at = NOW()
    WHERE tenant_id = OLD.tenant_id AND id = OLD.user_id;
    RETURN OLD;
  END IF;
  UPDATE users SET permission_version = permission_version + 1, updated_at = NOW()
  WHERE tenant_id = NEW.tenant_id AND id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_branch_roles_permission_version ON user_branch_roles;
CREATE TRIGGER trg_user_branch_roles_permission_version
AFTER INSERT OR UPDATE OR DELETE ON user_branch_roles
FOR EACH ROW EXECUTE FUNCTION bump_branch_role_permission_version();

CREATE OR REPLACE FUNCTION bump_role_permission_version()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.permissions_json IS DISTINCT FROM NEW.permissions_json THEN
    UPDATE users u
    SET permission_version = permission_version + 1, updated_at = NOW()
    WHERE u.tenant_id = NEW.tenant_id
      AND (
        u.role_id = NEW.id
        OR EXISTS (
          SELECT 1 FROM user_branch_roles ubr
          WHERE ubr.tenant_id = u.tenant_id
            AND ubr.user_id = u.id
            AND ubr.role_id = NEW.id
            AND ubr.active = TRUE
        )
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roles_permission_version ON roles;
CREATE TRIGGER trg_roles_permission_version
AFTER UPDATE OF permissions_json ON roles
FOR EACH ROW EXECUTE FUNCTION bump_role_permission_version();
