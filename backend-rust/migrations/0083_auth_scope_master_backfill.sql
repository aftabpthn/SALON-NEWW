-- Keep UUID master keys while mapping them to the existing text tenant/branch scope.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS scope_id TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS scope_id TEXT;

UPDATE tenants
SET scope_id = id::TEXT
WHERE scope_id IS NULL OR BTRIM(scope_id) = '';

UPDATE branches
SET scope_id = id::TEXT
WHERE scope_id IS NULL OR BTRIM(scope_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_scope_id
  ON tenants(LOWER(scope_id))
  WHERE scope_id IS NOT NULL AND BTRIM(scope_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_tenant_scope_id
  ON branches(tenant_id, LOWER(scope_id))
  WHERE scope_id IS NOT NULL AND BTRIM(scope_id) <> '';

WITH operational_tenants AS (
  SELECT tenant_id FROM staff
  UNION SELECT tenant_id FROM clients
  UNION SELECT tenant_id FROM services
  UNION SELECT tenant_id FROM appointments
)
INSERT INTO tenants (name, slug, status, scope_id)
SELECT scope.tenant_id, scope.tenant_id, 'active', scope.tenant_id
FROM operational_tenants scope
WHERE BTRIM(scope.tenant_id) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM tenants tenant
    WHERE tenant.id::TEXT = scope.tenant_id
       OR LOWER(tenant.scope_id) = LOWER(scope.tenant_id)
       OR LOWER(tenant.slug) = LOWER(scope.tenant_id)
  )
ON CONFLICT DO NOTHING;

WITH operational_branches AS (
  SELECT tenant_id, branch_id FROM staff
  UNION SELECT tenant_id, branch_id FROM clients
  UNION SELECT tenant_id, branch_id FROM services
  UNION SELECT tenant_id, branch_id FROM appointments
)
INSERT INTO branches (tenant_id, name, code, active, scope_id)
SELECT tenant.id, scope.branch_id, scope.branch_id, TRUE, scope.branch_id
FROM operational_branches scope
JOIN tenants tenant
  ON tenant.id::TEXT = scope.tenant_id
  OR LOWER(tenant.scope_id) = LOWER(scope.tenant_id)
  OR LOWER(tenant.slug) = LOWER(scope.tenant_id)
WHERE BTRIM(scope.tenant_id) <> ''
  AND BTRIM(scope.branch_id) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM branches branch
    WHERE branch.tenant_id = tenant.id
      AND (
        branch.id::TEXT = scope.branch_id
        OR LOWER(branch.scope_id) = LOWER(scope.branch_id)
        OR LOWER(branch.code) = LOWER(scope.branch_id)
      )
  )
ON CONFLICT DO NOTHING;

INSERT INTO roles (tenant_id, name, permissions_json, is_system)
SELECT tenant.scope_id, 'Owner', '[]'::JSONB, TRUE
FROM tenants tenant
WHERE tenant.status = 'active'
  AND tenant.scope_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM branches branch WHERE branch.tenant_id = tenant.id AND branch.active)
  AND NOT EXISTS (
    SELECT 1 FROM roles role
    WHERE role.tenant_id = tenant.scope_id AND LOWER(role.name) = 'owner'
  );

-- Re-run the legacy Owner backfill now that text scope mappings exist.
INSERT INTO user_branch_roles (
  tenant_id, user_id, branch_id, role_id, role_name, is_default
)
SELECT
  users.tenant_id,
  users.id,
  branch.scope_id,
  role.id,
  role.name,
  branch.scope_id = users.branch_id
FROM users
JOIN roles role
  ON role.tenant_id = users.tenant_id
 AND LOWER(role.name) = LOWER(users.role_name)
JOIN tenants tenant
  ON LOWER(tenant.scope_id) = LOWER(users.tenant_id)
JOIN branches branch
  ON branch.tenant_id = tenant.id
 AND branch.active = TRUE
WHERE users.active = TRUE
  AND branch.scope_id IS NOT NULL
  AND REGEXP_REPLACE(LOWER(role.name), '[-_ ]', '', 'g') IN ('owner', 'admin', 'superadmin')
ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING;
