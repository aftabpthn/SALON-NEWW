import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSessionService } from './auth-session.service';
import { AppStateService } from './state/app-state.service';

export const GRANTS: Record<string, string[]> = {
  superAdmin: ['*'],
  owner: ['*'],
  admin: ['*'],
  manager: [
    'read:*',
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
    'read:*',
    'write:clients',
    'write:appointments',
    'write:sales',
    'write:invoices',
    'write:payments',
    'write:appointment_deposits'
  ],
  frontDesk: [
    'read:*',
    'write:clients',
    'write:appointments',
    'write:sales',
    'write:invoices',
    'write:payments',
    'write:appointment_deposits'
  ],
  cashier: ['read:*', 'write:clients', 'write:sales', 'write:invoices', 'write:payments', 'read:appointment_deposits', 'read:finance', 'write:finance'],
  accountant: ['read:*', 'write:finance', 'write:invoices', 'write:payments', 'read:appointment_deposits'],
  inventoryManager: ['read:*', 'write:products', 'write:inventory', 'write:suppliers'],
  staff: ['read:staff', 'read:appointments', 'read:clients', 'read:services', 'write:appointments'],
  analyst: ['read:*', 'write:analytics']
};

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
  return GRANTS[role] || [];
}

function grantsForSession(role: string, session: AuthSessionService): string[] {
  const dynamicGrants = session.currentUser()?.permissions || [];
  return dynamicGrants.length ? dynamicGrants : staticGrantsForRole(role);
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

