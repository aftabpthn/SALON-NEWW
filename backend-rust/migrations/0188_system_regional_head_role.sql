-- Regional Head is a tenant authentication role with explicit branch grants.
-- This migration is additive and safe for tenants that already ran 0179.
WITH tenant_scopes(tenant_id) AS (
  SELECT COALESCE(NULLIF(scope_id, ''), id::TEXT)
  FROM tenants
  WHERE status = 'active'
  UNION
  SELECT DISTINCT tenant_id FROM users WHERE BTRIM(tenant_id) <> ''
  UNION
  SELECT DISTINCT tenant_id FROM roles WHERE BTRIM(tenant_id) <> ''
),
regional_head_permissions(permissions_json) AS (
  SELECT TO_JSONB(ARRAY[
    'appointments.read','appointments.manage','bookings.read','bookings.manage',
    'clients.read','clients.manage','clients.consent.manage','clients.forms.manage',
    'clients.audit.read','pos.read','pos.manage','pos.void','pos.refund',
    'services.read','services.manage','inventory.read','inventory.manage',
    'inventory.approve','purchases.read','purchases.manage','purchases.approve',
    'memberships.read','memberships.manage','packages.read','packages.manage',
    'staff.read','staff.manage','staff.attendance.read','staff.attendance.manage',
    'staff.leave.read','staff.leave.manage','staff.schedule.read',
    'staff.schedule.manage','staff.payroll.read','staff.analytics.read',
    'reports.read','reports.export','finance.read','notifications.read',
    'notifications.manage','marketing.read','marketing.manage','tenant.read',
    'management.write'
  ]::TEXT[])
)
INSERT INTO roles (
  tenant_id, name, permissions_json, denied_permissions_json, masked_fields_json,
  max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system
)
SELECT tenant.tenant_id, 'Regional Head', permissions.permissions_json,
       '[]'::JSONB, '[]'::JSONB, NULL, NULL, NULL, TRUE
FROM tenant_scopes tenant
CROSS JOIN regional_head_permissions permissions
WHERE LOWER(tenant.tenant_id) <> 'platform'
ON CONFLICT (tenant_id, (LOWER(name))) DO UPDATE
SET permissions_json = CASE
      WHEN roles.is_system THEN EXCLUDED.permissions_json
      ELSE (
        SELECT COALESCE(JSONB_AGG(permission ORDER BY permission), '[]'::JSONB)
        FROM (
          SELECT DISTINCT JSONB_ARRAY_ELEMENTS_TEXT(
            roles.permissions_json || EXCLUDED.permissions_json
          ) AS permission
        ) merged_permissions
      )
    END,
    denied_permissions_json = CASE
      WHEN roles.is_system THEN EXCLUDED.denied_permissions_json
      ELSE roles.denied_permissions_json
    END,
    masked_fields_json = CASE
      WHEN roles.is_system THEN EXCLUDED.masked_fields_json
      ELSE roles.masked_fields_json
    END,
    is_system = roles.is_system,
    updated_at = NOW();
