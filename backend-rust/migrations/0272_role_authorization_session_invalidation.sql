CREATE OR REPLACE FUNCTION bump_role_permission_version()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.permissions_json IS DISTINCT FROM NEW.permissions_json
     OR OLD.denied_permissions_json IS DISTINCT FROM NEW.denied_permissions_json
     OR OLD.masked_fields_json IS DISTINCT FROM NEW.masked_fields_json
     OR OLD.max_discount_paise IS DISTINCT FROM NEW.max_discount_paise
     OR OLD.max_refund_paise IS DISTINCT FROM NEW.max_refund_paise
     OR OLD.max_cash_movement_paise IS DISTINCT FROM NEW.max_cash_movement_paise THEN
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

    UPDATE auth_refresh_tokens token
    SET revoked_at = NOW(), revoke_reason = 'role_authorization_changed'
    WHERE token.tenant_id = NEW.tenant_id
      AND token.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.tenant_id = token.tenant_id
          AND u.id = token.user_id
          AND (
            u.role_id = NEW.id
            OR EXISTS (
              SELECT 1 FROM user_branch_roles ubr
              WHERE ubr.tenant_id = u.tenant_id
                AND ubr.user_id = u.id
                AND ubr.role_id = NEW.id
                AND ubr.active = TRUE
            )
          )
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roles_permission_version ON roles;
CREATE TRIGGER trg_roles_permission_version
AFTER UPDATE OF name, permissions_json, denied_permissions_json, masked_fields_json,
                max_discount_paise, max_refund_paise, max_cash_movement_paise
ON roles
FOR EACH ROW EXECUTE FUNCTION bump_role_permission_version();
