-- Preserve legacy tenant-wide Owner/Admin access as explicit branch grants.
-- Managers remain deny-by-default unless they already have branch assignments.
INSERT INTO user_branch_roles (
  tenant_id, user_id, branch_id, role_id, role_name, is_default
)
SELECT u.tenant_id, u.id, b.id::TEXT, r.id, r.name, FALSE
FROM users u
JOIN roles r
  ON r.tenant_id = u.tenant_id
 AND (
   (u.role_id IS NOT NULL AND r.id = u.role_id)
   OR (u.role_id IS NULL AND LOWER(r.name) = LOWER(u.role_name))
 )
JOIN branches b
  ON b.tenant_id::TEXT = u.tenant_id
 AND b.active = TRUE
WHERE u.active = TRUE
  AND REGEXP_REPLACE(LOWER(r.name), '[-_ ]', '', 'g') IN ('owner', 'admin', 'superadmin')
ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING;
