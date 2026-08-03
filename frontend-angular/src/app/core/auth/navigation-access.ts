export interface NavigationAccessRule {
  path: string;
  roles?: readonly string[];
  permissions?: readonly string[];
}

export const NAVIGATION_ACCESS_RULES: readonly NavigationAccessRule[] = [
  { path: '/platform/saas-admin', roles: ['superadmin', 'super-admin', 'super_admin', 'platform-admin', 'platform_admin'] },
  { path: '/pos/enterprise', roles: ['owner', 'admin', 'manager'], permissions: ['management.write'] },
  { path: '/pos/payment-integrations', roles: ['owner', 'admin'], permissions: ['settings.manage'] },
  { path: '/pos/payment-modes', roles: ['owner', 'admin', 'manager'], permissions: ['settings.manage', 'pos.manage'] },
  { path: '/inventory/advanced-controls', roles: ['owner', 'admin'], permissions: ['inventory.approve'] },
  { path: '/inventory/gl-reconciliation', roles: ['owner', 'admin', 'accountant'], permissions: ['inventory.approve', 'finance.read'] },
  { path: '/staff/payroll', roles: ['owner', 'admin', 'manager', 'accountant'], permissions: ['staff.payroll.read', 'staff.payroll.manage'] },
  { path: '/staff/salary-', roles: ['owner', 'admin', 'manager', 'accountant'], permissions: ['staff.payroll.read', 'staff.payroll.manage'] },
  { path: '/staff/fines-deductions', roles: ['owner', 'admin', 'manager', 'accountant'], permissions: ['staff.payroll.read', 'staff.payroll.manage'] },
  { path: '/staff/attendance-summary', roles: ['owner', 'admin', 'manager', 'analyst'], permissions: ['staff.attendance.read', 'staff.attendance.manage'] },
  { path: '/staff/leave-management', roles: ['owner', 'admin', 'manager'], permissions: ['staff.leave.read', 'staff.leave.manage'] },
  { path: '/staff/control-center', roles: ['owner', 'admin', 'manager'], permissions: ['staff.hrms.read', 'staff.hrms.manage'] },
  { path: '/staff', roles: ['owner', 'admin', 'manager', 'analyst'], permissions: ['staff.read', 'staff.manage', 'staff.analytics.read'] },
  { path: '/staff-os', roles: ['owner', 'admin', 'manager', 'analyst'], permissions: ['staff.read', 'staff.manage', 'staff.analytics.read'] },
  { path: '/command-center', roles: ['owner', 'admin', 'manager', 'analyst'], permissions: ['reports.read'] },
  { path: '/clients', roles: ['owner', 'admin', 'manager', 'receptionist', 'front-desk', 'front_desk'], permissions: ['clients.read', 'clients.manage'] },
  { path: '/services', roles: ['owner', 'admin', 'manager', 'receptionist', 'front-desk', 'front_desk'], permissions: ['services.read', 'services.manage'] },
  { path: '/appointment-reports', roles: ['owner', 'admin', 'manager', 'analyst'], permissions: ['appointments.read', 'reports.read'] },
  { path: '/appointments', roles: ['owner', 'admin', 'manager', 'receptionist', 'front-desk', 'front_desk'], permissions: ['appointments.read', 'appointments.manage', 'bookings.read', 'bookings.manage'] },
  { path: '/pos', roles: ['owner', 'admin', 'manager', 'cashier', 'receptionist', 'front-desk', 'front_desk'], permissions: ['pos.read', 'pos.manage'] },
  { path: '/inventory', roles: ['owner', 'admin', 'manager', 'inventory-manager', 'inventory_manager'], permissions: ['inventory.read', 'inventory.manage'] },
  { path: '/suppliers', roles: ['owner', 'admin', 'manager', 'inventory-manager', 'inventory_manager'], permissions: ['purchases.read', 'purchases.manage'] },
  { path: '/purchase-', roles: ['owner', 'admin', 'manager', 'inventory-manager', 'inventory_manager', 'accountant'], permissions: ['purchases.read', 'purchases.manage'] },
  { path: '/memberships', roles: ['owner', 'admin', 'manager', 'receptionist', 'front-desk', 'front_desk'], permissions: ['memberships.read', 'memberships.manage'] },
  { path: '/packages', roles: ['owner', 'admin', 'manager', 'receptionist', 'front-desk', 'front_desk'], permissions: ['packages.read', 'packages.manage'] },
  { path: '/reports', roles: ['owner', 'admin', 'manager', 'analyst', 'accountant'], permissions: ['reports.read'] },
  { path: '/activity-recovery', roles: ['owner', 'admin'], permissions: ['security.read', 'security.manage'] },
  { path: '/marketing', roles: ['owner', 'admin', 'manager', 'marketing', 'marketing-lead', 'marketing_lead'], permissions: ['marketing.read', 'marketing.manage'] },
  { path: '/sms-center', roles: ['owner', 'admin', 'manager', 'marketing', 'marketing-lead', 'marketing_lead'], permissions: ['notifications.read', 'notifications.manage', 'marketing.read'] },
  { path: '/messaging', roles: ['owner', 'admin', 'manager', 'marketing', 'marketing-lead', 'marketing_lead'], permissions: ['notifications.read', 'notifications.manage', 'marketing.read'] },
  { path: '/operations', roles: ['owner', 'admin', 'manager'], permissions: ['management.write'] },
  { path: '/finance', roles: ['owner', 'admin', 'manager', 'analyst', 'accountant'], permissions: ['finance.read', 'reports.read'] },
  { path: '/settings', roles: ['owner', 'admin'], permissions: ['settings.read', 'settings.manage'] },
  { path: '/saas', roles: ['owner', 'admin'] },
  { path: '/security', roles: ['owner', 'admin', 'superadmin', 'super-admin', 'super_admin', 'platform-admin', 'platform_admin'], permissions: ['security.read', 'security.manage'] },
];

export function navigationAccessForUrl(url: string): NavigationAccessRule | undefined {
  const path = (url.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '') || '/';
  return NAVIGATION_ACCESS_RULES.find((rule) =>
    path === rule.path
    || path.startsWith(`${rule.path}/`)
    || (rule.path.endsWith('-') && path.startsWith(rule.path)),
  );
}
