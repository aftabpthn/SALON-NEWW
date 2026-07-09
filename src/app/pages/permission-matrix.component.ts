import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type RightsMode = 'definition' | 'rights' | 'activity';
type PermissionViewKey = 'overview' | 'users' | 'definition' | 'rights' | 'activity' | 'controls';
type PermissionAction = 'access' | 'add' | 'edit' | 'delete' | 'back' | 'print' | 'export' | 'all';
type TenantUser = ApiRecord & {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  branchIds: string[];
  isLocked?: boolean;
};
type StaffPermissionCatalogItem = {
  groupKey: string;
  groupLabel: string;
  resource: string;
  action: string;
  label: string;
  category?: string;
  uiTargets?: string[];
  apiTargets?: string[];
};

type StaffPermissionGroup = {
  key: string;
  label: string;
  items: StaffPermissionCatalogItem[];
};

const OWNER_ROLES = new Set(['owner', 'admin', 'superAdmin']);
const LOCKED_SYSTEM_ROLES = new Set(['manager', 'frontDesk', 'receptionist', 'cashier', 'accountant', 'inventoryManager', 'staff']);
const BUILTIN_ROLE_OPTIONS: ApiRecord[] = [
  { role: 'owner', name: 'Owner', isSystem: 1 },
  { role: 'superAdmin', name: 'Super Admin', isSystem: 1 },
  { role: 'admin', name: 'Admin', isSystem: 1 },
  { role: 'manager', name: 'Manager', isSystem: 1 },
  { role: 'frontDesk', name: 'Front Desk', isSystem: 1 },
  { role: 'staff', name: 'Staff', isSystem: 1 },
  { role: 'accountant', name: 'Accountant', isSystem: 1 },
  { role: 'inventoryManager', name: 'Inventory Manager', isSystem: 1 },
  { role: 'marketingLead', name: 'Marketing Lead', isSystem: 1 },
  { role: 'customMarketingLead', name: 'Custom Marketing Lead', isSystem: 0 }
];
const ROLE_ORDER = new Map(BUILTIN_ROLE_OPTIONS.map((item, index) => [item.role, index]));
const ACTION_COLUMNS: { key: PermissionAction; label: string; backend: string[] }[] = [
  { key: 'access', label: 'Access', backend: ['read'] },
  { key: 'add', label: 'Add', backend: ['write', 'create'] },
  { key: 'edit', label: 'Edit', backend: ['write', 'update'] },
  { key: 'delete', label: 'Delete', backend: ['write', 'delete'] },
  { key: 'back', label: 'Back', backend: ['write', 'back'] },
  { key: 'print', label: 'Print', backend: ['write', 'print'] },
  { key: 'export', label: 'Export', backend: ['write', 'export'] },
  { key: 'all', label: 'All', backend: ['admin'] }
];
const RESOURCE_GROUPS = [
  {
    key: 'core',
    label: 'System',
    resources: [
      ['dashboard', 'Home dashboard'],
      ['settings', 'Business settings'],
      ['security', 'Security and permissions'],
      ['branches', 'Branches and franchise'],
      ['localization', 'Localization']
    ]
  },
  {
    key: 'front-desk',
    label: 'Front Desk',
    resources: [
      ['appointments', 'Appointments'],
      ['booking-portal', 'Online booking'],
      ['smart-booking', 'Smart booking'],
      ['clients', 'Clients CRM'],
      ['customer-360', 'Customer 360'],
      ['notifications', 'Notifications']
    ]
  },
  {
    key: 'catalog',
    label: 'Masters',
    resources: [
      ['services', 'Services'],
      ['packages', 'Packages'],
      ['memberships', 'Memberships'],
      ['gift-cards', 'Gift cards'],
      ['coupons', 'Coupons'],
      ['loyalty', 'Loyalty']
    ]
  },
  {
    key: 'pos',
    label: 'Transactions',
    resources: [
      ['pos', 'POS billing'],
      ['sales', 'Sales register'],
      ['invoices', 'Invoices'],
      ['payments', 'Payments'],
      ['refunds', 'Refunds'],
      ['cash-drawer', 'Cash drawer'],
      ['appointment_deposits', 'Appointment deposits']
    ]
  },
  {
    key: 'inventory',
    label: 'Products and Inventory',
    resources: [
      ['products', 'Product list'],
      ['inventory', 'Inventory'],
      ['inventory-intelligence', 'Inventory intelligence'],
      ['suppliers', 'Suppliers'],
      ['outgoing-funds', 'Outgoing funds']
    ]
  },
  {
    key: 'staff',
    label: 'Staff and Payroll',
    resources: [
      ['staff', 'Staff OS'],
      ['payroll', 'Payroll'],
      ['reports', 'Reports'],
      ['analytics', 'Analytics'],
      ['finance', 'Finance']
    ]
  },
  {
    key: 'growth',
    label: 'Growth and AI',
    resources: [
      ['marketing', 'Marketing'],
      ['whatsapp', 'WhatsApp campaigns'],
      ['reviews', 'Reviews'],
      ['ai', 'AI tools'],
      ['workflows', 'Workflow engine']
    ]
  },
  {
    key: 'platform',
    label: 'Enterprise Platform',
    resources: [
      ['quality', 'Quality center'],
      ['deployment', 'Deployment'],
      ['migration', 'Data migration'],
      ['marketplace-integrations', 'Integrations'],
      ['plugins', 'Plugins'],
      ['developer-api', 'Developer API'],
      ['webhooks', 'Webhooks'],
      ['franchise', 'Franchise OS']
    ]
  }
];

@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, StateComponent],
  styles: [`
    .user-management-os { gap: 16px; }
    .user-hero { grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
    .um-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .um-kpis article { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); }
    .um-kpis span, .um-muted { color: var(--muted); font-size: 12px; font-weight: 800; }
    .um-kpis strong { display: block; margin-top: 6px; font-size: 1.45rem; color: var(--ink); }
    .permission-section-workspace { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
    .permission-side-nav { position: sticky; top: 92px; display: grid; gap: 10px; }
    .permission-nav-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 11px; align-items: center; width: 100%; min-height: 92px; padding: 13px; border: 1px solid var(--line); border-left: 4px solid #4B1238; border-radius: 8px; background: var(--surface); color: var(--ink); text-align: left; box-shadow: var(--shadow); cursor: pointer; }
    .permission-nav-card:hover, .permission-nav-card.active { background: linear-gradient(135deg, #4B1238, #6B1E4B); border-color: color-mix(in srgb, #4B1238 38%, var(--line)); transform: translateY(-1px); }
    .permission-nav-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: #f5f2ef; color: #3D0F2C; font-weight: 950; font-size: 12px; }
    .permission-nav-card strong, .permission-nav-card small { display: block; }
    .permission-nav-card small { margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1.3; }
    .permission-nav-card em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #f5f2ef; color: #3D0F2C; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .permission-detail { display: grid; gap: 14px; min-width: 0; }
    .um-shell { display: grid; grid-template-columns: 286px minmax(0, 1fr) 292px; gap: 14px; align-items: start; }
    .um-shell[data-active-view]:not([data-active-view="overview"]) { grid-template-columns: minmax(0, 1fr); }
    .um-shell[data-active-view]:not([data-active-view="overview"]) > * { display: none; }
    .um-shell[data-active-view="users"] > .um-sidebar,
    .um-shell[data-active-view="controls"] > .um-control-panel { display: grid; position: static; grid-column: 1 / -1; }
    .um-shell[data-active-view="definition"] > .um-workbench,
    .um-shell[data-active-view="rights"] > .um-workbench,
    .um-shell[data-active-view="activity"] > .um-workbench { display: block; grid-column: 1 / -1; }
    .um-sidebar, .um-workbench, .um-control-panel, .um-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); }
    .um-sidebar, .um-control-panel { display: grid; gap: 12px; padding: 12px; position: sticky; top: 74px; }
    .um-workbench { min-width: 0; overflow: hidden; }
    .um-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid var(--line); }
    .um-panel-head h3, .um-panel-head h2 { margin: 0; }
    .um-filters { display: grid; gap: 8px; }
    .um-filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .um-list { display: grid; gap: 8px; max-height: 54vh; overflow: auto; padding-right: 2px; }
    .um-user-card { display: grid; gap: 8px; width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfdfc; text-align: left; cursor: pointer; }
    .um-user-card.active { border-color: #4B1238; background: #F8EEF4; box-shadow: inset 3px 0 0 #4B1238; }
    .um-user-card header { display: flex; justify-content: space-between; gap: 8px; }
    .um-user-card strong { color: var(--ink); }
    .um-user-card small { display: block; color: var(--muted); font-size: 12px; }
    .um-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .um-tabs { display: flex; gap: 8px; padding: 10px 12px 0; border-bottom: 1px solid var(--line); background: var(--surface-2); }
    .um-tabs button { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-bottom: 0; border-radius: 8px 8px 0 0; background: #f8faf9; font-weight: 900; }
    .um-tabs button.active { color: #4B1238; background: var(--surface); }
    .um-body { display: grid; gap: 14px; padding: 12px; }
    .um-definition-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 0.86fr); gap: 14px; }
    .um-card { display: grid; gap: 12px; padding: 12px; box-shadow: none; }
    .um-card h3 { margin: 0; }
    .um-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .um-form-grid .full { grid-column: 1 / -1; }
    .um-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 160px 180px auto; gap: 10px; align-items: end; }
    .um-toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .um-rights-frame { overflow: auto; max-height: 62vh; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .salonist-permission-surface { border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
    .salonist-summary { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 800; }
    .salonist-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-height: 46vh; overflow: auto; padding: 12px; }
    .salonist-group { display: grid; gap: 8px; min-width: 0; padding: 0 0 10px; border-bottom: 1px solid #edf2f1; }
    .salonist-group header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; }
    .salonist-group h4 { margin: 0; color: var(--ink); font-size: 14px; }
    .salonist-group-select { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 900; }
    .salonist-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; }
    .salonist-permission { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; min-width: 0; }
    .salonist-permission span { display: block; color: var(--ink); font-weight: 800; line-height: 1.25; }
    .salonist-permission small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .um-rights-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 12px; }
    .um-rights-table th, .um-rights-table td { border-bottom: 1px solid #edf2f1; padding: 6px 7px; text-align: center; white-space: nowrap; }
    .um-rights-table th:first-child, .um-rights-table td:first-child { position: sticky; left: 0; z-index: 2; min-width: 270px; text-align: left; background: inherit; }
    .um-rights-table thead th { position: sticky; top: 0; z-index: 3; background: #f4faf8; color: #344256; font-weight: 950; }
    .um-rights-table thead th:first-child { z-index: 4; }
    .um-group-row td { background: #edf7f5; color: #143c37; font-weight: 950; }
    .um-resource-name { display: grid; gap: 2px; }
    .um-resource-name small { color: var(--muted); font-size: 11px; }
    .um-check { width: 16px; min-height: 16px; accent-color: #4B1238; }
    .um-check:disabled { cursor: not-allowed; opacity: 0.7; }
    .um-owner-note { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: 999px; color: #075a51; background: #d8fbef; font-size: 12px; font-weight: 900; }
    .um-selected-card { display: grid; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
    .um-avatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #d5cec7, #a0928a); font-weight: 1000; }
    .um-selected-head { display: flex; gap: 10px; align-items: center; }
    .um-lock-list { display: grid; gap: 8px; }
    .um-lock-item { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fbfdfc; }
    .um-lock-item strong, .um-lock-item small { display: block; }
    .um-activity-list { display: grid; gap: 8px; }
    .um-activity-list article { display: grid; gap: 3px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fbfdfc; }
    .um-inline-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .um-danger { color: var(--red); border-color: color-mix(in srgb, var(--red) 32%, var(--line)); }
    .um-success-text { color: var(--green); font-weight: 900; }
    @media (max-width: 1180px) { .permission-section-workspace { grid-template-columns: 1fr; } .permission-side-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); } .um-shell { grid-template-columns: 260px minmax(0, 1fr); } .um-control-panel { position: static; grid-column: 1 / -1; } .um-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 780px) { .user-hero, .permission-side-nav, .um-shell, .um-definition-grid, .um-toolbar, .um-form-grid, .um-filter-row, .salonist-groups, .salonist-grid { grid-template-columns: 1fr; } .um-sidebar { position: static; } .um-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hero-actions, .um-toolbar-actions { justify-content: stretch; } .hero-actions button, .um-toolbar-actions button { flex: 1; } }
  `],
  template: `
    <section class="page-stack user-management-os">
      <div class="module-hero user-hero">
        <div>
          <h2>Advanced users, roles and rights control</h2>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" (click)="newUser()">New user</button>
          <button class="ghost-button" type="button" (click)="exportUsers()">Export users</button>
          <button class="primary-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="um-kpis">
        <article><span>Total users</span><strong>{{ metrics().users || 0 }}</strong></article>
        <article><span>Active</span><strong>{{ metrics().activeUsers || 0 }}</strong></article>
        <article><span>Owners/Admins</span><strong>{{ metrics().ownerUsers || 0 }}</strong></article>
        <article><span>Locked</span><strong>{{ metrics().lockedUsers || 0 }}</strong></article>
        <article><span>Roles</span><strong>{{ roles().length }}</strong></article>
        <article><span>Modules</span><strong>{{ resourceCount() }}</strong></article>
      </div>

      <div class="permission-section-workspace">
        <aside class="permission-side-nav" aria-label="Permission sections">
          <button
            class="permission-nav-card"
            type="button"
            *ngFor="let view of permissionViews"
            [class.active]="activePermissionView() === view.key"
            (click)="setPermissionView(view.key)"
          >
            <span class="permission-nav-icon">{{ view.icon }}</span>
            <span><strong>{{ view.label }}</strong><small>{{ view.description }}</small></span>
            <em>{{ view.badge }}</em>
          </button>
        </aside>

        <main class="permission-detail">
      <section class="um-shell" id="permission-users" [attr.data-active-view]="activePermissionView()">
        <aside class="um-sidebar" aria-label="User search and list">
          <div class="um-panel-head">
            <h3>Users</h3>
            <span class="badge">{{ filteredUsers().length }} shown</span>
          </div>
          <div class="um-filters">
            <label class="field">
              <span>Search users</span>
              <input [ngModel]="userQuery()" (ngModelChange)="userQuery.set($event)" placeholder="Name, email, role, branch" />
            </label>
            <div class="um-filter-row">
              <label class="field">
                <span>Role</span>
                <select [ngModel]="roleFilter()" (ngModelChange)="roleFilter.set($event)">
                  <option value="">All roles</option>
                  <option *ngFor="let role of roles()" [value]="role.role">{{ role.name || role.role }}</option>
                </select>
              </label>
              <label class="field">
                <span>Status</span>
                <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="hidden">Hidden</option>
                  <option value="disabled">Disabled</option>
                  <option value="suspended">Suspended</option>
                  <option value="locked">Locked</option>
                </select>
              </label>
            </div>
            <div class="um-filter-row">
              <label class="field">
                <span>Branch</span>
                <select [ngModel]="branchFilter()" (ngModelChange)="branchFilter.set($event)">
                  <option value="">All branches</option>
                  <option *ngFor="let branch of branchOptions()" [value]="branch">{{ branch }}</option>
                </select>
              </label>
              <label class="field">
                <span>Sort</span>
                <select [ngModel]="sortMode()" (ngModelChange)="sortMode.set($event)">
                  <option value="name">Name</option>
                  <option value="role">Role</option>
                  <option value="status">Status</option>
                  <option value="lastLogin">Last login</option>
                </select>
              </label>
            </div>
          </div>

          <div class="um-list">
            <button
              class="um-user-card"
              type="button"
              *ngFor="let user of filteredUsers()"
              [class.active]="selectedUserId() === user.id"
              (click)="selectUser(user)"
            >
              <header>
                <strong>{{ user.name }}</strong>
                <span class="badge" [class.success]="user.status === 'active'">{{ user.status }}</span>
              </header>
              <small>{{ user.email }}</small>
              <div class="um-badges">
                <span class="badge">{{ roleName(user.role) }}</span>
                <span class="badge" *ngIf="user.branchIds?.length">{{ user.branchIds.join(', ') }}</span>
                <span class="badge warning" *ngIf="user.isLocked">Locked</span>
              </div>
            </button>
          </div>
        </aside>

        <main class="um-workbench">
          <div class="um-tabs" role="tablist" aria-label="User management sections">
            <button type="button" [class.active]="mode() === 'definition'" (click)="mode.set('definition')">User Definition</button>
            <button type="button" [class.active]="mode() === 'rights'" (click)="mode.set('rights')">User Rights</button>
            <button type="button" [class.active]="mode() === 'activity'" (click)="mode.set('activity')">Audit</button>
          </div>

          <div class="um-body" id="permission-definition" *ngIf="mode() === 'definition'">
            <section class="um-definition-grid">
              <form class="um-card" [formGroup]="userForm" (ngSubmit)="saveUser()">
                <div class="um-panel-head">
                  <div>
                    <h3>{{ userForm.value.id ? 'Edit user' : 'Create user' }}</h3>
                  </div>
                  <span class="badge">{{ selectedUser()?.id || 'new' }}</span>
                </div>
                <div class="um-form-grid">
                  <label class="field"><span>Name</span><input formControlName="name" /></label>
                  <label class="field"><span>Email</span><input formControlName="email" /></label>
                  <label class="field"><span>Login ID</span><input formControlName="loginId" /></label>
                  <label class="field"><span>Staff ID</span><input formControlName="staffId" /></label>
                  <label class="field">
                    <span>Role</span>
                    <select formControlName="role" (change)="selectRole(userForm.value.role || 'staff')">
                      <option *ngFor="let role of roles()" [value]="role.role">{{ role.name || role.role }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Status</span>
                    <select formControlName="status">
                      <option value="active">Active</option>
                      <option value="hidden">Hidden</option>
                      <option value="disabled">Disabled</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                  <label class="field full"><span>Branch IDs</span><input formControlName="branchIdsText" placeholder="branch_hyd, branch_blr" /></label>
                  <label class="field full"><span>Temporary password</span><input formControlName="tempPassword" type="password" autocomplete="new-password" placeholder="Required for new user, optional for reset" /></label>
                </div>
                <div class="um-inline-actions">
                  <button class="primary-button" type="submit" [disabled]="saving() || userForm.invalid">{{ userForm.value.id ? 'Save user' : 'Create user' }}</button>
                  <button class="ghost-button" type="button" (click)="lockSelectedUser(15)" [disabled]="!selectedUser()">Lock 15 min</button>
                  <button class="ghost-button" type="button" (click)="unlockSelectedUser()" [disabled]="!selectedUser()">Unlock</button>
                  <button class="ghost-button um-danger" type="button" (click)="disableSelectedUser()" [disabled]="!selectedUser()">Disable</button>
                </div>
              </form>

              <form class="um-card" [formGroup]="roleForm" (ngSubmit)="saveRoleDefinition()">
                <div class="um-panel-head">
                  <div>
                    <h3>Role definition</h3>
                  </div>
                  <span class="badge">{{ selectedRole() }}</span>
                </div>
                <div class="um-form-grid">
                  <label class="field"><span>Role key</span><input formControlName="role" /></label>
                  <label class="field"><span>Name</span><input formControlName="name" /></label>
                  <label class="field full"><span>Description</span><input formControlName="description" /></label>
                  <label class="field"><span>Initial resource</span><input formControlName="resource" /></label>
                  <label class="field"><span>Initial actions CSV</span><input formControlName="actions" /></label>
                </div>
                <div class="um-inline-actions">
                  <button class="primary-button" type="submit" [disabled]="roleForm.invalid || saving()">Save role</button>
                  <button class="ghost-button" type="button" (click)="applyPreset('manager')">Manager preset</button>
                  <button class="ghost-button" type="button" (click)="applyPreset('frontDesk')">Front desk preset</button>
                  <button class="ghost-button" type="button" (click)="applyPreset('staff')">Staff preset</button>
                </div>
              </form>
            </section>
          </div>

          <div class="um-body" id="permission-rights" *ngIf="mode() === 'rights'">
            <div class="um-toolbar">
              <label class="field">
                <span>Search menu rights</span>
                <input [ngModel]="permissionQuery()" (ngModelChange)="permissionQuery.set($event)" placeholder="appointments, invoice, inventory, AI" />
              </label>
              <label class="field">
                <span>Module group</span>
                <select [ngModel]="groupFilter()" (ngModelChange)="groupFilter.set($event)">
                  <option value="">All groups</option>
                  <option *ngFor="let group of resourceGroups" [value]="group.key">{{ group.label }}</option>
                </select>
              </label>
              <label class="field">
                <span>Copy from</span>
                <select [ngModel]="copyFromRole()" (ngModelChange)="copyFromRole.set($event)">
                  <option value="">Select role</option>
                  <option *ngFor="let role of roles()" [value]="role.role">{{ role.name || role.role }}</option>
                </select>
              </label>
              <div class="um-toolbar-actions">
                <button class="ghost-button" type="button" (click)="copyRightsFromRole()" [disabled]="!copyFromRole()">Copy</button>
                <button class="ghost-button" type="button" (click)="exportMatrix()">Export matrix</button>
                <button class="primary-button" type="button" (click)="saveRoleMatrix()" [disabled]="saving() || isRoleReadOnly(selectedRole())">Save rights</button>
              </div>
            </div>

            <div class="um-panel-head">
              <div>
                <h2>{{ roleName(selectedRole()) }} rights</h2>
                <span class="um-muted" *ngIf="isOwnerRole(selectedRole())">Owner/admin roles always keep full control across the app.</span>
                <span class="um-muted" *ngIf="isLockedSystemRole(selectedRole())">This built-in role is fixed. Create a custom role to change rights.</span>
                <span class="um-muted" *ngIf="!isRoleReadOnly(selectedRole())">Changes save into role definitions and security permissions.</span>
              </div>
              <span class="um-owner-note" *ngIf="isOwnerRole(selectedRole())">Full owner control</span>
            </div>
            <section class="salonist-permission-surface" *ngIf="staffPermissionGroups().length">
              <div class="um-panel-head">
                <div>
                  <h3>Staff permissions</h3>
                </div>
                <span class="salonist-summary">{{ salonistPermissionCount() }} controls · {{ permissionCatalog().length }} cataloged</span>
              </div>
              <div class="salonist-groups">
                <section class="salonist-group" *ngFor="let group of staffPermissionGroups()">
                  <header>
                    <h4>{{ group.label }}</h4>
                    <label class="salonist-group-select">
                      <input class="um-check" type="checkbox" [checked]="isFeatureGroupChecked(group)" [disabled]="isRoleReadOnly(selectedRole())" (change)="toggleFeatureGroup(group, $any($event.target).checked)" />
                      <span>All</span>
                    </label>
                  </header>
                  <div class="salonist-grid">
                    <label class="salonist-permission" *ngFor="let item of group.items">
                      <input class="um-check" type="checkbox" [checked]="isFeaturePermissionChecked(item)" [disabled]="isRoleReadOnly(selectedRole())" (change)="toggleFeaturePermission(item, $any($event.target).checked)" />
                      <span>
                        <span>{{ item.label }}</span>
                        <small>{{ item.action }}:{{ item.resource }}</small>
                      </span>
                    </label>
                  </div>
                </section>
              </div>
            </section>

            <div class="um-rights-frame">
              <table class="um-rights-table">
                <thead>
                  <tr>
                    <th>Menu item</th>
                    <th *ngFor="let action of actionColumns">
                      <label>
                        <span>{{ action.label }}</span><br />
                        <input class="um-check" type="checkbox" [checked]="isColumnChecked(action.key)" [disabled]="isRoleReadOnly(selectedRole())" (change)="setColumn(action.key, $any($event.target).checked)" />
                      </label>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <ng-container *ngFor="let group of visibleResourceGroups()">
                    <tr class="um-group-row">
                      <td>{{ group.label }}</td>
                      <td *ngFor="let action of actionColumns">
                        <input class="um-check" type="checkbox" [checked]="isGroupChecked(group.key, action.key)" [disabled]="isRoleReadOnly(selectedRole())" (change)="setGroupColumn(group.key, action.key, $any($event.target).checked)" />
                      </td>
                    </tr>
                    <tr *ngFor="let resource of group.resources">
                      <td>
                        <div class="um-resource-name">
                          <strong>{{ resource[1] }}</strong>
                          <small>{{ resource[0] }}</small>
                        </div>
                      </td>
                      <td *ngFor="let action of actionColumns">
                        <input class="um-check" type="checkbox" [checked]="isPermissionChecked(resource[0], action.key)" [disabled]="isRoleReadOnly(selectedRole())" (change)="togglePermission(resource[0], action.key, $any($event.target).checked)" />
                      </td>
                    </tr>
                  </ng-container>
                </tbody>
              </table>
            </div>
          </div>

          <div class="um-body" id="permission-activity" *ngIf="mode() === 'activity'">
            <div class="um-panel-head">
              <div>
                <h2>User audit and sessions</h2>
              </div>
              <button class="ghost-button" type="button" (click)="load()">Reload audit</button>
            </div>
            <div class="um-activity-list">
              <article *ngFor="let item of activityRows()">
                <strong>{{ item.method || item.action || 'activity' }} · {{ item.path || item.targetType || '' }}</strong>
                <span>{{ item.userId || item.actorUserId || 'system' }} · {{ item.role || item.actorRole || '-' }} · {{ item.createdAt }}</span>
                <small class="um-muted">Status {{ item.statusCode || item.severity || 'info' }} · {{ item.durationMs || 0 }} ms</small>
              </article>
            </div>
          </div>
        </main>

        <aside class="um-control-panel" id="permission-controls" aria-label="Selected user and lock controls">
          <div class="um-selected-card">
            <div class="um-selected-head">
              <span class="um-avatar">{{ initials(selectedUser()?.name || selectedRole()) }}</span>
              <div>
                <strong>{{ selectedUser()?.name || 'No user selected' }}</strong>
                <small class="um-muted">{{ selectedUser()?.email || 'Create or choose a user' }}</small>
              </div>
            </div>
            <div class="um-badges">
              <span class="badge">{{ roleName(selectedRole()) }}</span>
              <span class="badge success" *ngIf="isOwnerRole(selectedRole())">Full control</span>
              <span class="badge warning" *ngIf="selectedUser()?.isLocked">Locked</span>
            </div>
          </div>

          <div class="um-card">
            <h3>Lock sensitive actions</h3>
            <div class="um-lock-list">
              <label class="um-lock-item" *ngFor="let item of lockControls">
                <input class="um-check" type="checkbox" [checked]="isPermissionChecked(item.resource, 'all')" [disabled]="isRoleReadOnly(selectedRole())" (change)="togglePermission(item.resource, 'all', $any($event.target).checked)" />
                <span><strong>{{ item.label }}</strong><small class="um-muted">{{ item.detail }}</small></span>
              </label>
            </div>
          </div>

          <div class="um-card">
            <h3>Owner safety</h3>
            <div class="um-inline-actions">
              <button class="ghost-button" type="button" (click)="selectRole('owner')">View owner</button>
              <button class="ghost-button" type="button" (click)="selectRole('manager')">View manager</button>
            </div>
            <span class="um-success-text" *ngIf="notice()">{{ notice() }}</span>
          </div>
        </aside>
      </section>
        </main>
      </div>
    </section>
  `
})
export class PermissionMatrixComponent implements OnInit {
  readonly matrix = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly mode = signal<RightsMode>('rights');
  readonly activePermissionView = signal<PermissionViewKey>('overview');
  readonly permissionViews: Array<{ key: PermissionViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'All permission sections', icon: 'OV', badge: 'All' },
    { key: 'users', label: 'Users', description: 'User list and assignment', icon: 'US', badge: 'CRM' },
    { key: 'definition', label: 'Definitions', description: 'Role and module rules', icon: 'DF', badge: 'RBAC' },
    { key: 'rights', label: 'Rights', description: 'Action permission matrix', icon: 'RT', badge: 'Live' },
    { key: 'activity', label: 'Activity', description: 'Audit and recent changes', icon: 'AC', badge: 'Log' },
    { key: 'controls', label: 'Controls', description: 'Bulk, export and sync tools', icon: 'CT', badge: 'Ops' }
  ];  readonly userQuery = signal('');
  readonly roleFilter = signal('');
  readonly statusFilter = signal('');
  readonly branchFilter = signal('');
  readonly sortMode = signal('name');
  readonly permissionQuery = signal('');
  readonly groupFilter = signal('');
  readonly selectedUserId = signal('');
  readonly selectedRole = signal('owner');
  readonly copyFromRole = signal('');
  readonly draftPermissions = signal<Record<string, PermissionAction[]>>({});
  readonly featureDraft = signal<Record<string, boolean>>({});
  readonly actionColumns = ACTION_COLUMNS;
  readonly resourceGroups = RESOURCE_GROUPS;
  readonly lockControls = [
    { resource: 'outgoing-funds', label: 'Outgoing payments', detail: 'Daily expense, bank deposit, purchase and miscellaneous payment locks.' },
    { resource: 'payroll', label: 'Payroll payouts', detail: 'Salary, advance and loan controls.' },
    { resource: 'refunds', label: 'Refunds and reversals', detail: 'Refund, void, credit note and invoice cancellation controls.' },
    { resource: 'cash-drawer', label: 'Cash drawer close', detail: 'Cash in/out and end-of-day close control.' },
    { resource: 'reports', label: 'Report exports', detail: 'PDF, CSV and sensitive business export control.' }
  ];

  readonly userForm = this.fb.group({
    id: [''],
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    loginId: [''],
    staffId: [''],
    role: ['staff', Validators.required],
    status: ['active', Validators.required],
    branchIdsText: [''],
    tempPassword: ['']
  });
  readonly roleForm = this.fb.group({
    role: ['customManager', [Validators.required, Validators.pattern(/^[a-zA-Z][a-zA-Z0-9_-]{2,40}$/)]],
    name: ['Custom manager', Validators.required],
    description: ['Custom branch role managed from User Management.'],
    resource: ['appointments', Validators.required],
    actions: ['read,write', Validators.required]
  });

  readonly roles = computed<ApiRecord[]>(() => {
    const data = this.matrix() || {};
    const rows = new Map<string, ApiRecord>();
    const addRole = (item: ApiRecord | string) => {
      const row = typeof item === 'string' ? { role: item } : item;
      const role = String(row?.role || '').trim();
      if (!role || rows.has(role)) return;
      rows.set(role, { ...row, role, name: row.name || this.roleNameFallback(role) });
    };
    BUILTIN_ROLE_OPTIONS.forEach(addRole);
    if (Array.isArray(data.roles)) data.roles.forEach(addRole);
    if (Array.isArray(data.customRoles)) data.customRoles.forEach(addRole);
    if (Array.isArray(data.users)) data.users.forEach((user) => addRole(String(user.role || '')));
    return Array.from(rows.values()).sort((left, right) => {
      const leftOrder = ROLE_ORDER.get(left.role) ?? 1000;
      const rightOrder = ROLE_ORDER.get(right.role) ?? 1000;
      return leftOrder === rightOrder
        ? String(left.name || left.role).localeCompare(String(right.name || right.role))
        : leftOrder - rightOrder;
    });
  });
  readonly users = computed<TenantUser[]>(() => this.matrix()?.users || []);
  readonly metrics = computed(() => this.matrix()?.metrics || {});
  readonly permissionCatalog = computed<StaffPermissionCatalogItem[]>(() => Array.isArray(this.matrix()?.permissionCatalog) ? this.matrix()?.permissionCatalog as StaffPermissionCatalogItem[] : []);
  readonly salonistPermissionCount = computed(() => this.permissionCatalog().length);
  readonly resourceCount = computed(() => Array.isArray(this.matrix()?.resources) ? (this.matrix()?.resources as unknown[]).length : this.resourceGroups.reduce((total, group) => total + group.resources.length, 0));
  readonly branchOptions = computed(() => [...new Set(this.users().flatMap((user) => user.branchIds || []))].sort());
  readonly selectedUser = computed(() => this.users().find((user) => user.id === this.selectedUserId()) || null);
  readonly filteredUsers = computed(() => {
    const query = this.userQuery().trim().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();
    const branch = this.branchFilter();
    const rows = this.users().filter((user) => {
      const text = [user.name, user.email, user.loginId, user.role, user.status, ...(user.branchIds || [])].join(' ').toLowerCase();
      if (query && !text.includes(query)) return false;
      if (role && user.role !== role) return false;
      if (branch && !(user.branchIds || []).includes(branch)) return false;
      if (status === 'locked') return Boolean(user.isLocked);
      if (status && user.status !== status) return false;
      return true;
    });
    return rows.sort((left, right) => {
      const mode = this.sortMode();
      if (mode === 'lastLogin') return String(right.lastLoginAt || '').localeCompare(String(left.lastLoginAt || ''));
      return String(left[mode] || left.name || '').localeCompare(String(right[mode] || right.name || ''));
    });
  });
  readonly visibleResourceGroups = computed(() => {
    const query = this.permissionQuery().trim().toLowerCase();
    const group = this.groupFilter();
    return this.resourceGroups
      .filter((item) => !group || item.key === group)
      .map((item) => ({
        ...item,
        resources: item.resources.filter((resource) => {
          const text = `${resource[0]} ${resource[1]} ${item.label}`.toLowerCase();
          return !query || text.includes(query);
        })
      }))
      .filter((item) => item.resources.length);
  });
  readonly staffPermissionGroups = computed<StaffPermissionGroup[]>(() => {
    const query = this.permissionQuery().trim().toLowerCase();
    const groups = new Map<string, StaffPermissionGroup>();
    this.permissionCatalog().forEach((item) => {
      const text = `${item.groupLabel} ${item.label} ${item.resource} ${item.action}`.toLowerCase();
      if (query && !text.includes(query)) return;
      const current = groups.get(item.groupKey) || { key: item.groupKey, label: item.groupLabel, items: [] };
      current.items.push(item);
      groups.set(item.groupKey, current);
    });
    return Array.from(groups.values());
  });
  readonly activityRows = computed(() => [
    ...(this.matrix()?.activity || []),
    ...(this.matrix()?.sessions || [])
  ].slice(0, 60));

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder, private readonly route: ActivatedRoute) {}

  setPermissionView(view: PermissionViewKey): void {
    this.activePermissionView.set(view);
    if (view === 'definition' || view === 'rights' || view === 'activity') this.mode.set(view);
    setTimeout(() => {
      const target = view === 'overview'
        ? document.querySelector('.um-kpis')
        : document.getElementById(`permission-${view === 'users' ? 'users' : view}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('security/user-management', { includeAllBranches: true }).subscribe({
      next: (matrix) => {
        this.matrix.set(matrix);
        this.refreshPermissionMatrixSnapshot();
        if (!this.applyLaunchContext()) {
          const current = this.selectedUserId();
          const user = this.users().find((item) => item.id === current) || this.users()[0];
          if (user) this.selectUser(user);
          if (!user) this.hydrateDraftForRole(this.selectedRole());
        }
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load user management'));
        this.loading.set(false);
      }
    });
  }
  private refreshPermissionMatrixSnapshot(): void {
    this.api.list<ApiRecord>('security/permission-matrix', { includeAllBranches: true }).subscribe({
      next: (snapshot) => {
        const current = this.matrix() || {};
        this.matrix.set({
          ...current,
          ...snapshot,
          users: current.users || [],
          metrics: current.metrics || {},
          activity: current.activity || [],
          sessions: current.sessions || []
        });
        this.hydrateDraftForRole(this.selectedRole());
      },
      error: () => undefined
    });
  }

  selectUser(user: TenantUser): void {
    this.selectedUserId.set(user.id);
    this.selectedRole.set(user.role || 'staff');
    this.userForm.patchValue({
      id: user.id,
      name: user.name || '',
      email: user.email || '',
      loginId: user.loginId || '',
      staffId: user.staffId || '',
      role: user.role || 'staff',
      status: user.status || 'active',
      branchIdsText: (user.branchIds || []).join(', '),
      tempPassword: ''
    });
    this.patchRoleForm(user.role || 'staff');
    this.hydrateDraftForRole(user.role || 'staff');
  }

  newUser(): void {
    this.selectedUserId.set('');
    this.selectedRole.set(this.roleFilter() || 'staff');
    this.mode.set('definition');
    this.userForm.reset({
      id: '',
      name: '',
      email: '',
      loginId: '',
      staffId: '',
      role: this.selectedRole(),
      status: 'active',
      branchIdsText: this.branchFilter() || '',
      tempPassword: ''
    });
    this.patchRoleForm(this.selectedRole());
    this.hydrateDraftForRole(this.selectedRole());
  }

  selectRole(role: string): void {
    this.selectedRole.set(role || 'staff');
    this.userForm.patchValue({ role: this.selectedRole() });
    this.patchRoleForm(this.selectedRole());
    this.hydrateDraftForRole(this.selectedRole());
  }

  saveUser(): void {
    if (this.userForm.invalid) return;
    const value = this.userForm.getRawValue();
    if (!value.id && !String(value.tempPassword || '').trim()) {
      this.error.set('Temporary password is required for new users');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const payload = {
      name: value.name,
      email: value.email,
      loginId: value.loginId,
      staffId: value.staffId,
      role: value.role,
      status: value.status,
      branchIdsText: value.branchIdsText,
      tempPassword: value.tempPassword || undefined
    };
    const request = value.id
      ? this.api.patch<ApiRecord>(`security/users/${value.id}`, payload)
      : this.api.post<ApiRecord>('security/users', payload);
    request.subscribe({
      next: (response) => this.afterUserMutation(response, value.id ? 'User updated' : 'User created'),
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save user'));
        this.saving.set(false);
      }
    });
  }

  lockSelectedUser(minutes: number): void {
    const user = this.selectedUser();
    if (!user) return;
    this.saving.set(true);
    this.api.patch<ApiRecord>(`security/users/${user.id}`, { lockMinutes: minutes }).subscribe({
      next: (response) => this.afterUserMutation(response, 'User locked'),
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to lock user'));
        this.saving.set(false);
      }
    });
  }

  unlockSelectedUser(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.saving.set(true);
    this.api.patch<ApiRecord>(`security/users/${user.id}`, { unlock: true, resetFailedLoginCount: true }).subscribe({
      next: (response) => this.afterUserMutation(response, 'User unlocked'),
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to unlock user'));
        this.saving.set(false);
      }
    });
  }

  disableSelectedUser(): void {
    const user = this.selectedUser();
    if (!user) return;
    this.saving.set(true);
    this.api.delete<ApiRecord>('security/users', user.id).subscribe({
      next: (response) => this.afterUserMutation(response, 'User disabled'),
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to disable user'));
        this.saving.set(false);
      }
    });
  }

  saveRoleDefinition(): void {
    if (this.roleForm.invalid) return;
    const value = this.roleForm.getRawValue();
    this.saving.set(true);
    this.api.post<ApiRecord>('security/roles', {
      role: value.role,
      name: value.name,
      description: value.description,
      permissions: [
        {
          resource: value.resource,
          actions: this.csv(value.actions)
        }
      ]
    }).subscribe({
      next: (response) => {
        this.matrix.set(response.matrix || this.matrix());
        this.selectedRole.set(value.role);
        this.hydrateDraftForRole(value.role);
        this.notice.set('Role saved');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save role'));
        this.saving.set(false);
      }
    });
  }

  saveRoleMatrix(): void {
    const role = this.selectedRole();
    if (this.isRoleReadOnly(role)) return;
    const definition = this.roles().find((item) => item.role === role) || { role, name: this.roleName(role), description: '' };
    const permissionMap = new Map<string, Set<string>>();
    const matrixResources = this.resourceGroups.flatMap((group) => group.resources.map((resource) => resource[0]));
    const catalogResources = new Set(this.permissionCatalog().map((item) => item.resource));
    const authoritativeResources = new Set([...matrixResources, ...catalogResources]);

    const addAction = (resource: string, action: string): void => {
      if (!resource || !action) return;
      const set = permissionMap.get(resource) || new Set<string>();
      set.add(action);
      permissionMap.set(resource, set);
    };

    Object.entries(this.draftPermissions()).forEach(([resource, actions]) => {
      const backend = catalogResources.has(resource) ? this.granularBackendActions(actions) : this.backendActions(resource, actions);
      backend.forEach((action) => addAction(resource, action));
    });
    this.permissionCatalog().forEach((item) => {
      if (this.featureDraft()[this.featureKey(item)]) addAction(item.resource, item.action);
    });

    const permissions = Array.from(authoritativeResources).sort().map((resource) => {
      const actions = Array.from(permissionMap.get(resource) || []).sort();
      return {
        resource,
        actions,
        effect: actions.length ? 'allow' : 'deny',
        conditions: { source: 'owner-user-management', catalog: catalogResources.has(resource) }
      };
    });

    this.saving.set(true);
    this.api.post<ApiRecord>('security/roles', {
      role,
      name: definition.name || role,
      description: definition.description || 'Managed through advanced user management',
      isSystem: definition.isSystem ? 1 : 0,
      permissions
    }).subscribe({
      next: (response) => {
        this.matrix.set(response.matrix || this.matrix());
        this.hydrateDraftForRole(role);
        this.notice.set('Rights saved');
        this.saving.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save rights'));
        this.saving.set(false);
      }
    });
  }
  copyRightsFromRole(): void {
    const source = this.copyFromRole();
    if (!source || source === this.selectedRole()) return;
    const draft = this.draftForRole(source);
    this.draftPermissions.set(draft);
    this.featureDraft.set(this.featureDraftForRole(source));
    this.notice.set(`Copied rights from ${this.roleName(source)}`);
  }

  applyPreset(role: 'manager' | 'frontDesk' | 'staff'): void {
    this.selectedRole.set(this.roleForm.value.role || role);
    const presets: Record<string, string[]> = {
      manager: ['dashboard', 'appointments', 'clients', 'services', 'products', 'inventory', 'staff', 'reports', 'analytics', 'marketing', 'finance'],
      frontDesk: ['dashboard', 'appointments', 'clients', 'pos', 'sales', 'invoices', 'payments', 'booking-portal', 'notifications'],
      staff: ['appointments', 'clients', 'services', 'products', 'staff', 'booking-portal']
    };
    const fullActions: PermissionAction[] = role === 'staff' ? ['access'] : ['access', 'add', 'edit', 'print', 'export'];
    this.draftPermissions.set(Object.fromEntries(presets[role].map((resource) => [resource, fullActions])));
    this.featureDraft.set(this.featureDraftForRole(this.selectedRole()));
    this.notice.set(`${this.roleName(role)} preset applied`);
    this.mode.set('rights');
  }

  togglePermission(resource: string, action: PermissionAction, checked: boolean): void {
    if (this.isRoleReadOnly(this.selectedRole())) return;
    const next = { ...this.draftPermissions() };
    const set = new Set(next[resource] || []);
    if (action === 'all') {
      ACTION_COLUMNS.forEach((item) => checked ? set.add(item.key) : set.delete(item.key));
    } else if (checked) {
      set.add(action);
      if (ACTION_COLUMNS.filter((item) => item.key !== 'all').every((item) => set.has(item.key))) set.add('all');
    } else {
      set.delete(action);
      set.delete('all');
    }
    next[resource] = Array.from(set);
    this.draftPermissions.set(next);
  }

  setColumn(action: PermissionAction, checked: boolean): void {
    this.visibleResourceGroups().forEach((group) => group.resources.forEach((resource) => this.togglePermission(resource[0], action, checked)));
  }

  setGroupColumn(groupKey: string, action: PermissionAction, checked: boolean): void {
    const group = this.resourceGroups.find((item) => item.key === groupKey);
    group?.resources.forEach((resource) => this.togglePermission(resource[0], action, checked));
  }

  isPermissionChecked(resource: string, action: PermissionAction): boolean {
    if (this.isOwnerRole(this.selectedRole())) return true;
    const actions = this.draftPermissions()[resource] || [];
    return actions.includes(action) || actions.includes('all');
  }

  isColumnChecked(action: PermissionAction): boolean {
    const resources = this.visibleResourceGroups().flatMap((group) => group.resources.map((resource) => resource[0]));
    return resources.length > 0 && resources.every((resource) => this.isPermissionChecked(resource, action));
  }

  isGroupChecked(groupKey: string, action: PermissionAction): boolean {
    const group = this.visibleResourceGroups().find((item) => item.key === groupKey);
    return Boolean(group?.resources.length) && group!.resources.every((resource) => this.isPermissionChecked(resource[0], action));
  }
  isFeaturePermissionChecked(item: StaffPermissionCatalogItem): boolean {
    if (this.isOwnerRole(this.selectedRole())) return true;
    return Boolean(this.featureDraft()[this.featureKey(item)]);
  }

  toggleFeaturePermission(item: StaffPermissionCatalogItem, checked: boolean): void {
    if (this.isRoleReadOnly(this.selectedRole())) return;
    this.featureDraft.set({ ...this.featureDraft(), [this.featureKey(item)]: checked });
  }

  isFeatureGroupChecked(group: StaffPermissionGroup): boolean {
    return group.items.length > 0 && group.items.every((item) => this.isFeaturePermissionChecked(item));
  }

  toggleFeatureGroup(group: StaffPermissionGroup, checked: boolean): void {
    if (this.isRoleReadOnly(this.selectedRole())) return;
    const next = { ...this.featureDraft() };
    group.items.forEach((item) => next[this.featureKey(item)] = checked);
    this.featureDraft.set(next);
  }

  exportUsers(): void {
    this.downloadCsv('aura-users.csv', [
      ['Name', 'Email', 'Login ID', 'Role', 'Status', 'Branches', 'Last login'],
      ...this.filteredUsers().map((user) => [user.name, user.email, user.loginId || '', user.role, user.status, (user.branchIds || []).join('|'), user.lastLoginAt || ''])
    ]);
  }

  exportMatrix(): void {
    const rows = [['Role', 'Resource', ...ACTION_COLUMNS.map((item) => item.label)]];
    this.resourceGroups.flatMap((group) => group.resources).forEach((resource) => {
      rows.push([this.selectedRole(), resource[0], ...ACTION_COLUMNS.map((action) => this.isPermissionChecked(resource[0], action.key) ? 'yes' : 'no')]);
    });
    this.downloadCsv(`aura-${this.selectedRole()}-rights.csv`, rows);
  }

  roleName(role: string): string {
    return this.roles().find((item) => item.role === role)?.name || this.roleNameFallback(role);
  }

  private roleNameFallback(role: string): string {
    return role?.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()) || 'Role';
  }

  initials(value: string): string {
    return String(value || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  isOwnerRole(role: string): boolean {
    return OWNER_ROLES.has(role);
  }

  isLockedSystemRole(role: string): boolean {
    return LOCKED_SYSTEM_ROLES.has(role);
  }

  isRoleReadOnly(role: string): boolean {
    return this.isOwnerRole(role) || this.isLockedSystemRole(role);
  }

  private afterUserMutation(response: ApiRecord, message: string): void {
    this.matrix.set(response.management || this.matrix());
    const user = response.user || null;
    if (user) this.selectUser(user as TenantUser);
    this.notice.set(message);
    this.saving.set(false);
  }

  private applyLaunchContext(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const mode = params.get('mode');
    if (mode === 'definition' || mode === 'rights' || mode === 'activity') this.mode.set(mode);
    const user = this.findLaunchUser(params.get('userId') || '', params.get('staffId') || '', params.get('loginId') || '');
    if (user) {
      this.selectUser(user);
      this.mode.set('rights');
      if (params.get('source') === 'staff-created') this.notice.set('Employee saved. Set permissions for this staff login.');
      return true;
    }
    const role = params.get('role') || '';
    if (role) {
      this.selectedRole.set(role);
      this.roleFilter.set(role);
      this.patchRoleForm(role);
      this.hydrateDraftForRole(role);
      this.mode.set('rights');
      if (params.get('source') === 'staff-created') this.notice.set('Employee saved. No login user found yet, so role permissions are open.');
      return true;
    }
    return Boolean(mode);
  }

  private findLaunchUser(userId: string, staffId: string, loginId: string): TenantUser | null {
    const normalizedLogin = loginId.trim().toLowerCase();
    return this.users().find((user) =>
      (userId && user.id === userId) ||
      (staffId && String(user.staffId || '') === staffId) ||
      (normalizedLogin && [user.loginId, user.email].some((value) => String(value || '').toLowerCase() === normalizedLogin))
    ) || null;
  }

  private patchRoleForm(role: string): void {
    const definition = this.roles().find((item) => item.role === role);
    this.roleForm.patchValue({
      role,
      name: definition?.name || this.roleName(role),
      description: definition?.description || '',
      resource: 'appointments',
      actions: 'read,write'
    });
  }

  private hydrateDraftForRole(role: string): void {
    this.draftPermissions.set(this.draftForRole(role));
    this.featureDraft.set(this.featureDraftForRole(role));
  }

  private draftForRole(role: string): Record<string, PermissionAction[]> {
    const row = (this.matrix()?.matrix || []).find((item: ApiRecord) => item.role === role);
    const explicit = (this.matrix()?.permissionRows || []).filter((item: ApiRecord) => item.role === role);
    const draft: Record<string, PermissionAction[]> = {};
    if (this.isOwnerRole(role)) {
      this.resourceGroups.flatMap((group) => group.resources).forEach((resource) => draft[resource[0]] = ACTION_COLUMNS.map((item) => item.key));
      return draft;
    }
    this.resourceGroups.flatMap((group) => group.resources).forEach((resource) => {
      const state = row?.resources?.[resource[0]] || {};
      const set = new Set<PermissionAction>();
      if (state.read) set.add('access');
      if (state.write) ['add', 'edit', 'delete', 'back', 'print', 'export'].forEach((item) => set.add(item as PermissionAction));
      if (state.admin) ACTION_COLUMNS.forEach((item) => set.add(item.key));
      draft[resource[0]] = Array.from(set);
    });
    explicit.forEach((permission: ApiRecord) => {
      const set = new Set(draft[permission.resource] || []);
      this.asArray(permission.actions).forEach((action) => this.mapBackendAction(action).forEach((mapped) => set.add(mapped)));
      if (ACTION_COLUMNS.filter((item) => item.key !== 'all').every((item) => set.has(item.key))) set.add('all');
      draft[permission.resource] = Array.from(set);
    });
    return draft;
  }

  private featureDraftForRole(role: string): Record<string, boolean> {
    const draft: Record<string, boolean> = {};
    this.permissionCatalog().forEach((item) => draft[this.featureKey(item)] = this.roleHasCatalogPermission(role, item));
    return draft;
  }

  private roleHasCatalogPermission(role: string, item: StaffPermissionCatalogItem): boolean {
    if (this.isOwnerRole(role)) return true;
    const explicit = (this.matrix()?.permissionRows || []).filter((permission: ApiRecord) => permission.role === role && permission.resource === item.resource);
    if (explicit.length) {
      if (explicit.some((permission: ApiRecord) => permission.effect === 'deny' && (!this.asArray(permission.actions).length || this.backendActionMatches(this.asArray(permission.actions), item.action)))) return false;
      if (explicit.some((permission: ApiRecord) => permission.effect !== 'deny' && this.backendActionMatches(this.asArray(permission.actions), item.action))) return true;
      return false;
    }
    const row = (this.matrix()?.matrix || []).find((entry: ApiRecord) => entry.role === role);
    const state = row?.resources?.[item.resource] || {};
    if (item.action === 'read') return Boolean(state.read || state.admin);
    if (item.action === 'write') return Boolean(state.write || state.admin);
    if (['create', 'update', 'delete', 'back', 'print', 'export'].includes(item.action)) return Boolean(state.write || state.admin);
    return Boolean(state.admin);
  }

  private backendActionMatches(actions: string[], action: string): boolean {
    const normalized = actions.map((item) => String(item || '').toLowerCase());
    return normalized.includes(action) || normalized.includes('*') || normalized.includes('admin') || (['create', 'update', 'delete', 'back', 'print', 'export'].includes(action) && normalized.includes('write'));
  }

  private featureKey(item: StaffPermissionCatalogItem): string {
    return `${item.action}:${item.resource}`;
  }

  private granularBackendActions(actions: PermissionAction[]): string[] {
    const selected = new Set(actions);
    const backend = new Set<string>();
    if (selected.has('access')) backend.add('read');
    if (selected.has('add')) backend.add('create');
    if (selected.has('edit')) backend.add('update');
    if (selected.has('delete')) backend.add('delete');
    if (selected.has('back')) backend.add('back');
    if (selected.has('print')) backend.add('print');
    if (selected.has('export')) backend.add('export');
    if (selected.has('all')) backend.add('admin');
    return Array.from(backend);
  }

  private mapBackendAction(action: string): PermissionAction[] {
    const normalized = String(action || '').toLowerCase();
    if (normalized === '*' || normalized === 'admin' || normalized === 'all') return ACTION_COLUMNS.map((item) => item.key);
    if (normalized === 'use') return ['access'];
    if (normalized === 'read' || normalized === 'access' || normalized === 'view') return ['access'];
    if (normalized === 'create' || normalized === 'add') return ['add'];
    if (normalized === 'update' || normalized === 'edit') return ['edit'];
    if (normalized === 'delete' || normalized === 'remove') return ['delete'];
    if (normalized === 'print') return ['print'];
    if (normalized === 'export') return ['export'];
    if (normalized === 'back') return ['back'];
    if (normalized === 'write') return ['add', 'edit', 'delete', 'back', 'print', 'export'];
    return [];
  }

  private backendActions(resource: string, actions: PermissionAction[]): string[] {
    const selected = new Set(actions);
    const backend = new Set<string>();
    ACTION_COLUMNS.forEach((column) => {
      if (!selected.has(column.key)) return;
      column.backend.forEach((action) => backend.add(resource === 'pos' && action === 'read' ? 'use' : action));
    });
    return Array.from(backend);
  }

  private csv(value: unknown): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  private asArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private downloadCsv(filename: string, rows: unknown[][]): void {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}



