-- Tenant operators use branch-scoped roles. Customer accounts keep their
-- separate customer-portal identity and must never enter tenant RBAC.
WITH permission_catalog(code) AS (
  VALUES
    ('appointments.read'), ('appointments.manage'), ('appointments.settings.manage'),
    ('bookings.read'), ('bookings.manage'),
    ('clients.read'), ('clients.manage'), ('clients.consent.manage'),
    ('clients.forms.manage'), ('clients.merge'), ('clients.audit.read'),
    ('clients.reviews.link'),
    ('pos.read'), ('pos.manage'), ('pos.void'), ('pos.refund'),
    ('services.read'), ('services.manage'),
    ('inventory.read'), ('inventory.manage'), ('inventory.approve'),
    ('purchases.read'), ('purchases.manage'), ('purchases.approve'),
    ('memberships.read'), ('memberships.manage'),
    ('packages.read'), ('packages.manage'),
    ('staff.read'), ('staff.manage'),
    ('staff.attendance.read'), ('staff.attendance.manage'),
    ('staff.leave.read'), ('staff.leave.manage'),
    ('staff.schedule.read'), ('staff.schedule.manage'),
    ('staff.payroll.read'), ('staff.payroll.manage'),
    ('staff.analytics.read'), ('staff.self_manage'),
    ('reports.read'), ('reports.export'),
    ('finance.read'), ('finance.write'),
    ('notifications.read'), ('notifications.manage'),
    ('marketing.read'), ('marketing.manage'),
    ('settings.read'), ('settings.manage'),
    ('security.read'), ('security.manage'),
    ('tenant.read'), ('front_desk.write'), ('management.write'),
    ('inventory.write'), ('staff_self.write')
),
tenant_scopes(tenant_id) AS (
  SELECT COALESCE(NULLIF(scope_id, ''), id::TEXT)
  FROM tenants
  WHERE status = 'active'
  UNION
  SELECT DISTINCT tenant_id FROM users WHERE BTRIM(tenant_id) <> ''
  UNION
  SELECT DISTINCT tenant_id FROM roles WHERE BTRIM(tenant_id) <> ''
),
role_templates(role_key, name, permissions) AS (
  VALUES
    ('owner', 'Owner', NULL::TEXT[]),
    ('admin', 'Admin', NULL::TEXT[]),
    ('manager', 'Manager', ARRAY[
      'appointments.read','appointments.manage','appointments.settings.manage',
      'bookings.read','bookings.manage','clients.read','clients.manage',
      'clients.consent.manage','clients.forms.manage','clients.merge','clients.audit.read',
      'pos.read','pos.manage','pos.void','pos.refund','services.read','services.manage',
      'inventory.read','inventory.manage','inventory.approve','purchases.read',
      'purchases.manage','purchases.approve','memberships.read','memberships.manage',
      'packages.read','packages.manage','staff.read','staff.manage',
      'staff.attendance.read','staff.attendance.manage','staff.leave.read',
      'staff.leave.manage','staff.schedule.read','staff.schedule.manage',
      'staff.payroll.read','staff.analytics.read','reports.read','reports.export',
      'finance.read','notifications.read','notifications.manage','marketing.read',
      'marketing.manage','settings.read','security.read','tenant.read','management.write'
    ]::TEXT[]),
    ('receptionist', 'Receptionist', ARRAY[
      'appointments.read','appointments.manage','bookings.read','bookings.manage',
      'clients.read','clients.manage','clients.consent.manage','clients.forms.manage',
      'pos.read','pos.manage','services.read','memberships.read','packages.read',
      'notifications.read','notifications.manage','front_desk.write'
    ]::TEXT[]),
    ('frontdesk', 'Front Desk', ARRAY[
      'appointments.read','appointments.manage','bookings.read','bookings.manage',
      'clients.read','clients.manage','clients.consent.manage','clients.forms.manage',
      'pos.read','pos.manage','services.read','memberships.read','packages.read',
      'notifications.read','notifications.manage','front_desk.write'
    ]::TEXT[]),
    ('cashier', 'Cashier', ARRAY[
      'clients.read','clients.manage','pos.read','pos.manage','services.read',
      'memberships.read','packages.read','notifications.read'
    ]::TEXT[]),
    ('accountant', 'Accountant', ARRAY[
      'pos.read','inventory.read','purchases.read','staff.payroll.read',
      'staff.payroll.manage','reports.read','reports.export','finance.read','finance.write'
    ]::TEXT[]),
    ('inventorymanager', 'Inventory Manager', ARRAY[
      'services.read','inventory.read','inventory.manage','inventory.approve',
      'purchases.read','purchases.manage','purchases.approve','reports.read','inventory.write'
    ]::TEXT[]),
    ('marketinglead', 'Marketing Lead', ARRAY[
      'clients.read','clients.reviews.link','memberships.read','packages.read',
      'reports.read','notifications.read','notifications.manage','marketing.read','marketing.manage'
    ]::TEXT[]),
    ('analyst', 'Analyst', ARRAY[
      'appointments.read','bookings.read','clients.read','clients.audit.read','pos.read',
      'services.read','inventory.read','purchases.read','memberships.read','packages.read',
      'staff.read','staff.attendance.read','staff.leave.read','staff.schedule.read',
      'staff.payroll.read','staff.analytics.read','reports.read','reports.export',
      'finance.read','notifications.read','marketing.read','settings.read','security.read'
    ]::TEXT[]),
    ('staff', 'Staff', ARRAY[
      'appointments.read','clients.read','services.read','staff.attendance.read',
      'staff.leave.read','staff.schedule.read','staff.self_manage','notifications.read',
      'staff_self.write'
    ]::TEXT[])
),
resolved_templates AS (
  SELECT
    role_key,
    name,
    CASE
      WHEN permissions IS NULL THEN (SELECT JSONB_AGG(code ORDER BY code) FROM permission_catalog)
      ELSE TO_JSONB(permissions)
    END AS permissions_json
  FROM role_templates
)
INSERT INTO roles (
  tenant_id, name, permissions_json, denied_permissions_json, masked_fields_json,
  max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system
)
SELECT
  tenant.tenant_id, template.name, template.permissions_json, '[]'::JSONB, '[]'::JSONB,
  NULL, NULL, NULL, TRUE
FROM tenant_scopes tenant
CROSS JOIN resolved_templates template
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
