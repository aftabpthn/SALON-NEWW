import { Injectable, computed, signal } from '@angular/core';

export type UserRole =
  | 'superAdmin'
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'receptionist'
  | 'frontDesk'
  | 'staff'
  | 'accountant'
  | 'inventoryManager'
  | 'marketingLead'
  | 'analyst'
  | 'customMarketingLead'
  | (string & {});

const DEFAULT_TENANT_ID = 'tenant_aura';
const TENANT_KEY = 'aura.selectedTenantId';
const BRANCH_KEY = 'aura.selectedBranchId';

@Injectable({ providedIn: 'root' })
export class AppStateService {
  readonly selectedTenantId = signal(this.normalizeTenantId(localStorage.getItem(TENANT_KEY)));
  readonly selectedBranchId = signal(this.readBranch(this.selectedTenantId()));
  readonly userRole = signal<UserRole>(this.normalizeRole(localStorage.getItem('aura.userRole')));
  readonly globalSearch = signal('');

  readonly tenantScopeLabel = computed(() => this.selectedTenantId());
  readonly branchScopeLabel = computed(() => this.selectedBranchId() || 'All branches');
  readonly canManageSettings = computed(() => ['superAdmin', 'owner', 'admin'].includes(this.userRole()));

  setTenant(tenantId: string): void {
    const normalizedTenantId = this.normalizeTenantId(tenantId);
    this.selectedTenantId.set(normalizedTenantId);
    localStorage.setItem(TENANT_KEY, normalizedTenantId);
    this.selectedBranchId.set(this.readBranch(normalizedTenantId));
  }

  setBranch(branchId: string, persist = true): void {
    this.selectedBranchId.set(branchId);
    const tenantBranchKey = `${BRANCH_KEY}.${this.selectedTenantId()}`;
    if (persist) {
      localStorage.setItem(BRANCH_KEY, branchId);
      localStorage.setItem(tenantBranchKey, branchId);
    } else {
      localStorage.removeItem(BRANCH_KEY);
      localStorage.removeItem(tenantBranchKey);
    }
  }

  setRole(role: UserRole): void {
    const normalizedRole = this.normalizeRole(role);
    this.userRole.set(normalizedRole);
    localStorage.setItem('aura.userRole', normalizedRole);
  }

  private normalizeTenantId(tenantId: string | null): string {
    const value = tenantId || DEFAULT_TENANT_ID;
    if (/^tenant_(ai|import)_/i.test(value)) return DEFAULT_TENANT_ID;
    return value;
  }

  private readBranch(tenantId: string): string {
    return localStorage.getItem(`${BRANCH_KEY}.${tenantId}`) || localStorage.getItem(BRANCH_KEY) || '';
  }

  private normalizeRole(role: string | null): UserRole {
    const compact = String(role || 'owner').trim().replace(/[\s_-]+/g, '').toLowerCase();
    if (compact === 'superadmin') return 'superAdmin';
    if (compact === 'frontdesk') return 'frontDesk';
    if (compact === 'inventorymanager') return 'inventoryManager';
    if (compact === 'marketinglead') return 'marketingLead';
    if (compact === 'custommarketinglead') return 'customMarketingLead';
    return (role as UserRole) || 'owner';
  }
}
