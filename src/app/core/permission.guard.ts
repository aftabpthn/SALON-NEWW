import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSessionService } from './auth-session.service';
import { AppStateService } from './state/app-state.service';

export const GRANTS: Record<string, string[]> = {
  superAdmin: ['*'],
  owner: ['*'],
  admin: ['*'],
  manager: [
    'read:dashboard',
    'read:appointments',
    'read:clients',
    'read:services',
    'read:products',
    'read:inventory',
    'read:sales',
    'use:pos',
    'read:invoices',
    'read:payments',
    'read:notifications',
    'write:notifications',
    'read:staff',
    'read:reports',
    'write:clients',
    'write:appointments',
    'write:services',
    'write:products',
    'write:inventory',
    'write:sales',
    'write:invoices',
    'write:payments',
    'write:appointment_deposits',
    'write:staff'
  ],
  receptionist: [
    'read:dashboard',
    'read:appointments',
    'read:clients',
    'read:services',
    'read:products',
    'read:sales',
    'use:pos',
    'read:invoices',
    'read:payments',
    'read:notifications',
    'write:notifications',
    'write:clients',
    'write:appointments',
    'write:sales',
    'write:invoices',
    'write:payments',
    'write:appointment_deposits',
    'read:smart-booking',
    'write:smart-booking',
    'read:booking-portal',
    'write:booking-portal'
  ],
  frontDesk: [
    'read:dashboard',
    'read:appointments',
    'read:clients',
    'read:services',
    'read:products',
    'read:sales',
    'use:pos',
    'read:invoices',
    'read:payments',
    'read:notifications',
    'write:notifications',
    'write:clients',
    'write:appointments',
    'write:sales',
    'write:invoices',
    'write:payments',
    'write:appointment_deposits',
    'read:smart-booking',
    'write:smart-booking',
    'read:booking-portal',
    'write:booking-portal'
  ],
  cashier: ['read:dashboard', 'read:clients', 'read:services', 'read:products', 'read:sales', 'use:pos', 'read:invoices', 'read:payments', 'read:notifications', 'write:notifications', 'write:clients', 'write:sales', 'write:invoices', 'write:payments', 'read:appointment_deposits', 'write:appointment_deposits'],
  accountant: ['read:dashboard', 'read:finance', 'read:invoices', 'read:payments', 'write:finance', 'write:invoices', 'write:payments', 'read:appointment_deposits', 'read:reports', 'read:analytics'],
  inventoryManager: ['read:dashboard', 'read:products', 'read:inventory', 'read:suppliers', 'read:inventory-intelligence', 'write:products', 'write:inventory', 'write:suppliers', 'write:inventory-intelligence'],
  marketingLead: ['read:dashboard', 'read:marketing', 'write:marketing', 'read:campaigns', 'write:campaigns', 'read:clients', 'read:leads', 'write:leads', 'read:coupons', 'write:coupons', 'read:whatsapp', 'write:whatsapp', 'read:notifications', 'write:notifications', 'read:reviews', 'read:reputation', 'write:reputation'],
  customMarketingLead: ['read:dashboard', 'read:marketing', 'write:marketing', 'read:campaigns', 'write:campaigns', 'read:clients', 'read:leads', 'write:leads', 'read:coupons', 'write:coupons', 'read:whatsapp', 'write:whatsapp', 'read:notifications', 'write:notifications', 'read:reviews', 'read:reputation', 'write:reputation'],
  staff: ['read:appointments', 'read:clients', 'read:services', 'read:products', 'write:appointments'],
  analyst: ['read:*', 'write:analytics']
};

function normalizeRole(role: string): string {
  const compact = String(role || '').trim().replace(/[\s_-]+/g, '').toLowerCase();
  if (compact === 'superadmin') return 'superAdmin';
  if (compact === 'frontdesk') return 'frontDesk';
  if (compact === 'inventorymanager') return 'inventoryManager';
  if (compact === 'custommarketinglead') return 'customMarketingLead';
  if (compact === 'marketinglead') return 'marketingLead';
  return role;
}

export function grantsAllow(grants: string[], perm: string): boolean {
  if (grants.includes('*')) return true;
  if (grants.includes(perm)) return true;
  const [action, resource] = perm.split(':');
  const writeAliases = new Set(['create', 'update', 'delete', 'back', 'print', 'export']);
  return grants.includes(`${action}:*`) ||
    grants.includes('admin:*') ||
    (resource ? grants.includes(`admin:${resource}`) : false) ||
    (resource && writeAliases.has(action) ? grants.includes(`write:${resource}`) || grants.includes('write:*') : false);
}
export function staticGrantsForRole(role: string): string[] {
  return GRANTS[normalizeRole(role)] || [];
}

function grantsForSession(role: string, session: AuthSessionService): string[] {
  const dynamicGrants = session.currentUser()?.permissions || [];
  return Array.from(new Set([...staticGrantsForRole(role), ...dynamicGrants]));
}

export const permissionGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const state = inject(AppStateService);
  const session = inject(AuthSessionService);
  const required = route.data?.['permission'];
  const role = state.userRole();
  const grants = grantsForSession(role, session);
  const perms = Array.isArray(required) ? required : required ? [required] : [];
  if (perms.length === 0) return true;
  const ok = perms.every((permission: string) => grantsAllow(grants, permission));
  return ok ? true : router.createUrlTree(['/dashboard']);
};

