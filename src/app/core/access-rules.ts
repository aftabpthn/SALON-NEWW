import { grantsAllow } from './permission.guard';

const ACCESS_PERMISSION_RULES: Array<{ pattern: RegExp; permission: string | string[] }> = [
  { pattern: /^\/(enterprise-security-shield|security-alerts|permissions|compliance|audit-compliance|two-factor|mfa-security|passkeys|audit-logs|site-logs)/, permission: ['read:security', 'write:security', 'admin:security'] },
  { pattern: /^\/(business-details|settings|setting|branches|white-label|localization|locations|super-admin|saas)/, permission: ['read:settings', 'write:settings', 'read:branches', 'write:branches'] },
  { pattern: /^\/dashboard\//, permission: 'read:dashboard' },
  { pattern: /^\/(appointments|appointment-activity|appointment-reports|booking-inbox|scheduler|staff\/my-work|queue-system)/, permission: 'read:appointments' },
  { pattern: /^\/appointment-deposits/, permission: 'read:appointment_deposits' },
  { pattern: /^\/(clients|client-masters|customer-360)/, permission: ['read:clients', 'read:customer-360'] },
  { pattern: /^\/(pos|checkout)/, permission: 'use:pos' },
  { pattern: /^\/(cash-drawer|sales)/, permission: ['read:sales', 'read:invoices'] },
  { pattern: /^\/(billing|invoices|payments)/, permission: ['read:invoices', 'read:payments', 'read:finance'] },
  { pattern: /^\/(inventory|products)/, permission: ['read:inventory', 'read:products'] },
  { pattern: /^\/suppliers/, permission: 'read:suppliers' },
  { pattern: /^\/(services|packages)/, permission: 'read:services' },
  { pattern: /^\/(memberships|gift-cards|loyalty)/, permission: ['read:memberships', 'read:services'] },
  { pattern: /^\/(staff|staff-os|staff-enterprise|payroll|commissions)/, permission: 'read:staff' },
  { pattern: /^\/(finance|profit-intelligence|account-master|balance-sheet|transactions)/, permission: 'read:finance' },
  { pattern: /^\/(reports|analytics|kpi-details)/, permission: ['read:reports', 'read:analytics'] },
  { pattern: /^\/(marketing|growth-rank-bot|discount-rules|coupons|sales-tools|leads|engagement|message-templates|message-history)/, permission: 'read:marketing' },
  { pattern: /^\/reputation/, permission: ['read:reputation', 'read:reviews'] },
  { pattern: /^\/message-logs/, permission: 'read:whatsapp' },
  { pattern: /^\/customer-care-ai/, permission: ['read:clients', 'read:customer-360'] },
  { pattern: /^\/(command-center|pricing|future-features)/, permission: 'read:ai' },
  { pattern: /^\/smart-booking/, permission: 'read:smart-booking' },
  { pattern: /^\/(book|online-booking)/, permission: 'read:booking-portal' },
  { pattern: /^\/offline/, permission: 'read:offline' },


  { pattern: /^\/deployment/, permission: 'read:deployment' },
  { pattern: /^\/data-migration/, permission: 'read:migration' },
  { pattern: /^\/(marketplace-integrations|design-system)/, permission: ['read:marketplace-integrations'] },
  { pattern: /^\/(franchise|training-academy)/, permission: 'read:franchise' }
];

function isPublicRoutePath(path: string): boolean {
  return path === '/salon' || path === '/salon-3d' || path.startsWith('/book') || path.startsWith('/memberships/self-service/') || path.startsWith('/cash-drawer-approval/');
}

export function routePermissionForPath(path: string): string | string[] {
  const cleanPath = (path || '/').split(/[?#]/)[0] || '/';
  if (!cleanPath || cleanPath === '/' || cleanPath === '/home' || cleanPath === '/dashboard' || isPublicRoutePath(cleanPath)) return '';
  return ACCESS_PERMISSION_RULES.find((rule) => rule.pattern.test(cleanPath))?.permission || 'admin:system';
}

export function grantsCanAccessPath(grants: string[], path: string): boolean {
  const permission = routePermissionForPath(path);
  if (!permission || (Array.isArray(permission) && !permission.length)) return true;
  const permissions = Array.isArray(permission) ? permission : [permission];
  return permissions.some((item) => grantsAllow(grants, item));
}
