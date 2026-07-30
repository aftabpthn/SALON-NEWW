-- Keep the public TEXT auth contract while enforcing canonical UUID masters.
-- Migration 0243 rewrites every legacy scope value to the matching UUID text.

DO $$
DECLARE
  users_without_tenant BIGINT;
  users_without_branch BIGINT;
  assignments_without_user BIGINT;
  assignments_without_branch BIGINT;
  users_without_role BIGINT;
  assignments_without_role BIGINT;
BEGIN
  SELECT COUNT(*) INTO users_without_tenant
  FROM users user_row
  WHERE user_row.tenant_id <> 'platform'
    AND NOT EXISTS (
      SELECT 1 FROM tenants tenant
      WHERE tenant.id::TEXT = user_row.tenant_id
    );

  SELECT COUNT(*) INTO users_without_branch
  FROM users user_row
  WHERE NULLIF(BTRIM(user_row.branch_id), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM branches branch
      WHERE branch.tenant_id::TEXT = user_row.tenant_id
        AND branch.id::TEXT = user_row.branch_id
    );

  SELECT COUNT(*) INTO assignments_without_user
  FROM user_branch_roles assignment
  WHERE NOT EXISTS (
    SELECT 1 FROM users user_row
    WHERE user_row.tenant_id = assignment.tenant_id
      AND user_row.id = assignment.user_id
  );

  SELECT COUNT(*) INTO assignments_without_branch
  FROM user_branch_roles assignment
  WHERE NOT EXISTS (
    SELECT 1 FROM branches branch
    WHERE branch.tenant_id::TEXT = assignment.tenant_id
      AND branch.id::TEXT = assignment.branch_id
  );

  SELECT COUNT(*) INTO users_without_role
  FROM users user_row
  WHERE user_row.role_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM roles role
      WHERE role.tenant_id = user_row.tenant_id
        AND role.id = user_row.role_id
    );

  SELECT COUNT(*) INTO assignments_without_role
  FROM user_branch_roles assignment
  WHERE assignment.role_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM roles role
      WHERE role.tenant_id = assignment.tenant_id
        AND role.id = assignment.role_id
    );

  IF users_without_tenant > 0
     OR users_without_branch > 0
     OR assignments_without_user > 0
     OR assignments_without_branch > 0
     OR users_without_role > 0
     OR assignments_without_role > 0 THEN
    RAISE EXCEPTION
      'tenant/branch integrity audit failed: users_without_tenant=%, users_without_branch=%, assignments_without_user=%, assignments_without_branch=%, users_without_role=%, assignments_without_role=%',
      users_without_tenant,
      users_without_branch,
      assignments_without_user,
      assignments_without_branch,
      users_without_role,
      assignments_without_role;
  END IF;
END;
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_uuid UUID
    GENERATED ALWAYS AS (
      CASE WHEN tenant_id = 'platform' THEN NULL ELSE tenant_id::UUID END
    ) STORED,
  ADD COLUMN IF NOT EXISTS branch_uuid UUID
    GENERATED ALWAYS AS (NULLIF(BTRIM(branch_id), '')::UUID) STORED;

ALTER TABLE user_branch_roles
  ADD COLUMN IF NOT EXISTS tenant_uuid UUID
    GENERATED ALWAYS AS (tenant_id::UUID) STORED,
  ADD COLUMN IF NOT EXISTS branch_uuid UUID
    GENERATED ALWAYS AS (branch_id::UUID) STORED;

ALTER TABLE user_branch_roles
  ALTER COLUMN tenant_uuid SET NOT NULL,
  ALTER COLUMN branch_uuid SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_uuid_id
  ON users(tenant_uuid, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_id_id
  ON roles(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_uuid_branch_uuid
  ON users(tenant_uuid, branch_uuid);
CREATE INDEX IF NOT EXISTS idx_user_branch_roles_tenant_uuid_user
  ON user_branch_roles(tenant_uuid, user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_roles_tenant_uuid_branch
  ON user_branch_roles(tenant_uuid, branch_uuid);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::REGCLASS
      AND conname = 'ck_users_platform_scope'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT ck_users_platform_scope
      CHECK (
        (tenant_id = 'platform' AND tenant_uuid IS NULL AND branch_uuid IS NULL)
        OR (tenant_id <> 'platform' AND tenant_uuid IS NOT NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::REGCLASS
      AND conname = 'fk_users_tenant_uuid'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_tenant_uuid
      FOREIGN KEY (tenant_uuid) REFERENCES tenants(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::REGCLASS
      AND conname = 'fk_users_tenant_branch_uuid'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_tenant_branch_uuid
      FOREIGN KEY (tenant_uuid, branch_uuid)
      REFERENCES branches(tenant_id, id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::REGCLASS
      AND conname = 'fk_users_tenant_role'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_tenant_role
      FOREIGN KEY (tenant_id, role_id)
      REFERENCES roles(tenant_id, id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_roles'::REGCLASS
      AND conname = 'fk_user_branch_roles_tenant_uuid'
  ) THEN
    ALTER TABLE user_branch_roles ADD CONSTRAINT fk_user_branch_roles_tenant_uuid
      FOREIGN KEY (tenant_uuid) REFERENCES tenants(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_roles'::REGCLASS
      AND conname = 'fk_user_branch_roles_tenant_user'
  ) THEN
    ALTER TABLE user_branch_roles ADD CONSTRAINT fk_user_branch_roles_tenant_user
      FOREIGN KEY (tenant_uuid, user_id)
      REFERENCES users(tenant_uuid, id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_roles'::REGCLASS
      AND conname = 'fk_user_branch_roles_tenant_branch'
  ) THEN
    ALTER TABLE user_branch_roles ADD CONSTRAINT fk_user_branch_roles_tenant_branch
      FOREIGN KEY (tenant_uuid, branch_uuid)
      REFERENCES branches(tenant_id, id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'user_branch_roles'::REGCLASS
      AND conname = 'fk_user_branch_roles_tenant_role'
  ) THEN
    ALTER TABLE user_branch_roles ADD CONSTRAINT fk_user_branch_roles_tenant_role
      FOREIGN KEY (tenant_id, role_id)
      REFERENCES roles(tenant_id, id) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE users VALIDATE CONSTRAINT ck_users_platform_scope;
ALTER TABLE users VALIDATE CONSTRAINT fk_users_tenant_uuid;
ALTER TABLE users VALIDATE CONSTRAINT fk_users_tenant_branch_uuid;
ALTER TABLE users VALIDATE CONSTRAINT fk_users_tenant_role;
ALTER TABLE user_branch_roles VALIDATE CONSTRAINT fk_user_branch_roles_tenant_uuid;
ALTER TABLE user_branch_roles VALIDATE CONSTRAINT fk_user_branch_roles_tenant_user;
ALTER TABLE user_branch_roles VALIDATE CONSTRAINT fk_user_branch_roles_tenant_branch;
ALTER TABLE user_branch_roles VALIDATE CONSTRAINT fk_user_branch_roles_tenant_role;
