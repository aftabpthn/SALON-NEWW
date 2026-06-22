import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiRecord, ApiService } from './core/api.service';
import { AuthSessionService } from './core/auth-session.service';
import { I18nService, LocalePreference } from './core/i18n.service';
import { AppStateService, UserRole } from './core/state/app-state.service';
import { AutoNameCaseDirective } from './shared/directives/auto-name-case.directive';

type NavItem = {
  path: string;
  label: string;
  icon: string;
  keywords?: string;
  children?: NavItem[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  primaryPath: string;
  items: NavItem[];
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  hostDirectives: [AutoNameCaseDirective],
  template: `
    <ng-container *ngIf="!session.isAuthenticated() && !isPortal(); else authenticatedApp">
      <main class="auth-shell">
        <section class="auth-card">
          <span class="eyebrow">Secure salon SaaS login</span>
          <h1>Aura Salon OS</h1>
          <p>Sign in with a tenant user before accessing CRM, POS, finance, inventory, reports and admin modules.</p>
          <form [formGroup]="loginForm" (ngSubmit)="login()" class="form-grid">
            <label class="field"><span>Tenant ID</span><input formControlName="tenantId" /></label>
            <label class="field"><span>Email / Staff Login ID</span><input formControlName="email" autocomplete="username" /></label>
            <label class="field"><span>Password</span><input formControlName="password" type="password" /></label>
            <label class="field"><span>Branch ID</span><input formControlName="branchId" placeholder="Optional" /></label>
            <label class="field full" *ngIf="requiresTotp()">
              <span>Authenticator or recovery code</span>
              <input formControlName="totpToken" autocomplete="one-time-code" inputmode="numeric" placeholder="6-digit code or recovery code" />
            </label>
            <div class="state error" *ngIf="loginError()">{{ loginError() }}</div>
            <button class="primary-button" type="submit" [disabled]="loginForm.invalid || loginBusy()">
              {{ loginBusy() ? 'Signing in...' : (requiresTotp() ? 'Verify & sign in' : 'Sign in securely') }}
            </button>
          </form>
          <small>Default seeded owner: owner@aurasalon.example. Set DEMO_ADMIN_PASSWORD in production before first run.</small>
        </section>
      </main>
    </ng-container>

    <ng-template #authenticatedApp>
    <ng-container *ngIf="isPortal(); else adminShell">
      <div class="portal-shell">
        <button
          class="ghost-button portal-back-button"
          type="button"
          *ngIf="previousRoute()"
          (click)="goBack()"
          [attr.aria-label]="backButtonLabel()"
          [title]="backButtonLabel()"
        >
          <span aria-hidden="true">&larr;</span>
          <span>Back</span>
        </button>
        <router-outlet></router-outlet>
      </div>
    </ng-container>

    <ng-template #adminShell>
    <div class="app-shell" [class.sidebar-is-compact]="sidebarCompact()">
      <aside class="sidebar enterprise-sidebar" [class.sidebar-compact]="sidebarCompact()">
        <div class="sidebar-brand-row">
          <a class="brand" routerLink="/dashboard" aria-label="Aura dashboard">
            <span class="brand-mark">A</span>
            <span>
              <strong>Aura Salon</strong>
              <small>CRM / POS suite</small>
            </span>
          </a>
          <button class="sidebar-toggle" type="button" (click)="toggleSidebarCompact()" [attr.aria-pressed]="sidebarCompact()" [title]="sidebarCompact() ? 'Expand sidebar' : 'Collapse sidebar'">
            {{ sidebarCompact() ? '>>' : '<<' }}
          </button>
        </div>

        <label class="sidebar-search" *ngIf="!sidebarCompact()">
          <span>{{ i18n.t('shell.findModule', 'Find module') }}</span>
          <input [ngModel]="navQuery()" (ngModelChange)="navQuery.set($event)" [placeholder]="i18n.t('shell.searchPlaceholder', 'Search POS, staff, reports')" />
          <button class="sidebar-search-clear" type="button" *ngIf="navQuery()" (click)="navQuery.set('')">Clear</button>
        </label>

        <nav class="nav-list nav-accordion" aria-label="Primary navigation">
          <section class="nav-section" *ngFor="let group of visibleNavGroups()" [class.active-section]="isGroupActive(group)" [class.expanded]="isGroupExpanded(group)">
            <button class="nav-section-trigger" type="button" (click)="openNavGroup(group)" [attr.aria-expanded]="isGroupExpanded(group)" [title]="group.label">
              <span class="nav-icon" aria-hidden="true">{{ group.icon }}</span>
              <span class="nav-section-copy">
                <strong>{{ group.label }}</strong>
                <small>{{ navLeafCount(group.items) }} {{ i18n.t('shell.modules', 'modules') }}</small>
              </span>
              <span class="nav-count">{{ navLeafCount(group.items) }}</span>
            </button>
            <div class="nav-section-items" *ngIf="!sidebarCompact() && (navQuery() || isGroupExpanded(group))">
              <ng-container *ngFor="let item of group.items">
                <div class="nav-subgroup" *ngIf="item.children?.length; else singleNavItem">
                  <a
                    class="nav-subgroup-title"
                    [routerLink]="item.path"
                    routerLinkActive="active"
                    (click)="rememberNavGroup(group.id)"
                  >
                    <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                    <small>{{ item.children?.length }}</small>
                  </a>
                  <a
                    *ngFor="let child of item.children"
                    class="nav-subitem nested"
                    [routerLink]="child.path"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: child.path === '/dashboard' }"
                    (click)="rememberNavGroup(group.id)"
                  >
                    <span class="nav-icon" aria-hidden="true">{{ child.icon }}</span>
                    <span>{{ child.label }}</span>
                  </a>
                </div>
                <ng-template #singleNavItem>
                  <a
                    class="nav-subitem"
                    [routerLink]="item.path"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: item.path === '/dashboard' }"
                    (click)="rememberNavGroup(group.id)"
                  >
                    <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                  </a>
                </ng-template>
              </ng-container>
            </div>
          </section>
          <div class="nav-empty" *ngIf="!visibleNavGroups().length && !sidebarCompact()">
            <strong>{{ i18n.t('shell.noModule', 'No module found') }}</strong>
            <button class="ghost-button mini" type="button" (click)="navQuery.set('')">{{ i18n.t('shell.resetSearch', 'Reset search') }}</button>
          </div>
        </nav>

        <section class="sidebar-callout">
          <span class="eyebrow">{{ i18n.t('shell.sidebarTenant', 'SaaS tenant') }}</span>
          <strong>{{ state.tenantScopeLabel() }}</strong>
          <p>{{ i18n.t('shell.scopeCopy', 'Tenant, branch and role headers scope every API call.') }}</p>
        </section>
      </aside>

      <main class="workspace" id="main-content">
        <header class="topbar">
          <div class="topbar-brand-title">
            <span class="eyebrow">{{ i18n.t('shell.workspace', 'Enterprise command workspace') }}</span>
            <h1>Aurashine OS</h1>
            <div class="topbar-signal-row" aria-label="Current workspace context">
              <span>{{ activePageLabel() }}</span>
              <span>{{ state.tenantScopeLabel() }}</span>
              <span>{{ state.userRole() }}</span>
            </div>
          </div>
          <div class="topbar-actions">
            <button
              class="ghost-button back-button"
              type="button"
              (click)="goBack()"
              [attr.aria-label]="backButtonLabel()"
              [title]="backButtonLabel()"
            >
              <span aria-hidden="true">&larr;</span>
              <span>Back</span>
            </button>
            <label class="select-label country-scope">
              <span>{{ i18n.t('shell.country', 'Country') }}</span>
              <select [ngModel]="i18n.countryCode()" (ngModelChange)="selectCountry($event)">
                <option *ngFor="let country of i18n.countries" [value]="country.code">{{ country.label }}</option>
              </select>
            </label>
            <label class="select-label language-scope">
              <span>{{ i18n.t('shell.language', 'Language') }}</span>
              <select [ngModel]="i18n.languageCode()" (ngModelChange)="selectLanguage($event)">
                <option *ngFor="let language of i18n.languages" [value]="language.code">{{ language.label }}</option>
              </select>
            </label>
            <label class="select-label tenant-scope">
              <span>{{ i18n.t('shell.tenant', 'Tenant') }}</span>
              <select [ngModel]="state.selectedTenantId()" (ngModelChange)="selectTenant($event)">
                <option *ngFor="let tenant of tenants()" [value]="tenant.id">{{ tenant.name || tenant.id }}</option>
              </select>
            </label>
            <label class="select-label branch-scope">
              <span>{{ i18n.t('shell.branch', 'Branch') }}</span>
              <select [ngModel]="state.selectedBranchId()" (ngModelChange)="selectBranch($event)">
                <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
              </select>
            </label>
            <label class="select-label role-scope">
              <span>{{ i18n.t('shell.role', 'Role') }}</span>
              <select [ngModel]="state.userRole()" (ngModelChange)="selectRole($event)">
                <option value="owner">Owner</option>
                <option value="superAdmin">Super admin</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="receptionist">Receptionist</option>
                <option value="frontDesk">Front desk</option>
                <option value="staff">Staff</option>
                <option value="accountant">Accountant</option>
                <option value="inventoryManager">Inventory manager</option>
                <option value="analyst">Analyst</option>
                <option value="customMarketingLead">Custom marketing lead</option>
              </select>
            </label>
            <a class="dark-button" routerLink="/pos">{{ i18n.t('shell.fastPos', 'Fast POS') }}</a>
            <button class="ghost-button" type="button" (click)="logout()">{{ i18n.t('shell.logout', 'Logout') }}</button>
          </div>
        </header>
        <div class="state error" *ngIf="globalError()">
          {{ globalError() }}
          <button class="ghost-button mini" type="button" (click)="globalError.set('')">{{ i18n.t('shell.dismiss', 'Dismiss') }}</button>
        </div>

        <router-outlet></router-outlet>
      </main>
    </div>
    </ng-template>
    </ng-template>
  `
})
export class AppComponent {
  private readonly fb = inject(FormBuilder);
  readonly branches = signal<ApiRecord[]>([]);
  readonly tenants = signal<ApiRecord[]>([]);
  readonly isPortal = signal(false);
  readonly globalError = signal('');
  readonly loginBusy = signal(false);
  readonly loginError = signal('');
  readonly requiresTotp = signal(false);
  readonly loginForm = this.fb.group({
    tenantId: ['tenant_aura', Validators.required],
    email: ['owner@aurasalon.example', Validators.required],
    password: ['', Validators.required],
    branchId: [''],
    totpToken: ['']
  });

  readonly navQuery = signal('');
  readonly activeRoute = signal('');
  readonly previousRoute = signal('');
  readonly sidebarCompact = signal(this.readInitialSidebarCompact());
  readonly expandedGroupIds = signal<string[]>(this.readExpandedGroups());
  private loadedLocalizationTenantId = '';

  readonly favoriteNavItems: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'D', keywords: 'home kpi overview' },
    { path: '/apps', label: 'All Apps', icon: 'AP', keywords: 'launchpad modules full suite apps' },
    { path: '/growth-rank-bot', label: 'AI Rank Bot', icon: 'RB', keywords: 'instagram facebook google rank local seo ai growth bot' },
    { path: '/appointments', label: 'Calendar', icon: 'C', keywords: 'booking appointment schedule enterprise scheduler staff calendar' },
    { path: '/appointment-activity', label: 'Appt Activity', icon: 'AA', keywords: 'appointment audit cancellation reschedule no show reliability' },
    { path: '/salon-3d', label: '3D Salon', icon: '3D', keywords: 'public salon website three dimensional booking' },
    { path: '/clients', label: 'Clients', icon: 'CL', keywords: 'crm guest customer' },
    { path: '/pos', label: 'POS', icon: 'P', keywords: 'billing checkout' },
    { path: '/pos/invoices', label: 'Invoices', icon: 'IN', keywords: 'invoice receipt due paid' },
    { path: '/reports/invoices', label: 'Invoice Reports', icon: 'IR', keywords: 'invoice reports gst staff discount product membership due wallet' },
    { path: '/memberships', label: 'Memberships', icon: 'MB', keywords: 'membership loyalty packages credits renewal' },
    { path: '/suppliers', label: 'Suppliers', icon: 'SP', keywords: 'vendor purchase gst' },
    { path: '/reports', label: 'Reports', icon: 'R', keywords: 'analytics sales report' },
    { path: '/staff-os/staff-list', label: 'Staff', icon: 'T', keywords: 'employee team payroll' },
    { path: '/staff/my-work', label: 'My Work', icon: 'MW', keywords: 'staff own report live appointments' }
  ];

  readonly navGroups: NavGroup[] = [
    {
      id: 'command',
      label: 'Command',
      icon: 'CM',
      primaryPath: '/dashboard',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: 'D', keywords: 'home overview kpi owner' },
        { path: '/apps', label: 'All Apps', icon: 'AP', keywords: 'launchpad modules full suite salon apps' },
        { path: '/command-center', label: 'Command Center', icon: 'CC', keywords: 'control tower enterprise' },
        { path: '/command-center/engagement', label: 'Engagement', icon: 'EC', keywords: 'hyperconnect unified inbox whatsapp client engagement' },
        { path: '/analytics', label: 'Analytics', icon: 'AN', keywords: 'metrics insight kpi' },
        { path: '/reports', label: 'Reports', icon: 'R', keywords: 'sales business reports' },
        { path: '/reports/invoices', label: 'Invoice Reports', icon: 'IR', keywords: 'invoice staff discount gst product membership wallet due audit reports' },
        { path: '/kpi-monitoring', label: 'KPI Monitor', icon: 'KM', keywords: 'monitor alerts targets' },
        { path: '/data-warehouse', label: 'Warehouse', icon: 'DW', keywords: 'data warehouse snapshots' },
        { path: '/predictive-forecasting', label: 'Forecast AI', icon: 'PF', keywords: 'forecast prediction revenue' }
      ]
    },
    {
      id: 'frontdesk',
      label: 'Front Desk',
      icon: 'FD',
      primaryPath: '/appointments',
      items: [
        { path: '/appointments', label: 'Calendar', icon: 'C', keywords: 'appointments booking schedule enterprise scheduler zenoti dingg fresha boulevard staff multi service booking' },
        { path: '/appointment-activity', label: 'Activity Center', icon: 'AC', keywords: 'appointment audit cancellation reschedule no show reliability' },
        { path: '/appointment-deposits', label: 'Deposit Report', icon: 'DP', keywords: 'appointment advance payment deposit report no show cancellation' },
        { path: '/smart-booking', label: 'Smart Booking', icon: 'SB', keywords: 'ai booking slot' },
        { path: '/salon-3d', label: '3D Salon Website', icon: '3D', keywords: 'public website three dimensional salon landing booking' },
        { path: '/book', label: 'Booking Site', icon: 'OB', keywords: 'online booking portal' },
        { path: '/queue-system', label: 'Queue TV', icon: 'QT', keywords: 'walkin queue display' },
        { path: '/customer-360', label: 'Customer 360', icon: '360', keywords: 'customer intelligence guest' },
        { path: '/clients', label: 'Client CRM', icon: 'CL', keywords: 'client guest crm' },
        { path: '/client-masters', label: 'Client Masters', icon: 'CM', keywords: 'flexi client masters category source consultation feedback preferences' }
      ]
    },
    {
      id: 'pos',
      label: 'POS',
      icon: 'POS',
      primaryPath: '/pos',
      items: [
        { path: '/pos', label: 'POS Billing', icon: 'P', keywords: 'checkout bill billing' },
        { path: '/pos/invoices', label: 'POS Invoices', icon: 'IN', keywords: 'invoice paid due received' },
        { path: '/pos/holds', label: 'Hold Invoices', icon: 'HI', keywords: 'hold pending invoice' },
        { path: '/pos/tips', label: 'Tip Register', icon: 'TP', keywords: 'tips staff tip' },
        { path: '/pos/payment-modes', label: 'Payment Modes', icon: 'PM', keywords: 'cash card upi payment' },
        { path: '/memberships', label: 'Membership Sales', icon: 'MS', keywords: 'membership sale pos loyalty credits redemption' },
        { path: '/packages', label: 'Packages', icon: 'PK', keywords: 'package prepaid credits bundle' }
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: 'INV',
      primaryPath: '/inventory',
      items: [
        { path: '/inventory', label: 'Inventory', icon: 'I', keywords: 'stock products inventory' },
        { path: '/inventory/purchase-bill-drafts', label: 'AI Bill Drafts', icon: 'AI', keywords: 'ai purchase bill scanner draft invoice receiving' },
        { path: '/inventory/purchase-orders', label: 'Purchase Orders', icon: 'PO', keywords: 'purchase order po vendor' },
        { path: '/inventory/reorder', label: 'AI Reorder', icon: 'AR', keywords: 'low stock reorder purchase prediction approval' },
        { path: '/suppliers', label: 'Suppliers', icon: 'SP', keywords: 'supplier vendor gst purchase' },
        { path: '/services', label: 'Services', icon: 'S', keywords: 'service menu catalog' },
        { path: '/inventory/recipes', label: 'Service Recipes', icon: 'BOM', keywords: 'bom recipe service consumption' },
        { path: '/inventory/fifo', label: 'FIFO Batches', icon: 'FF', keywords: 'fifo batch expiry next stock consume' },
        { path: '/inventory/product-consume', label: 'Product Consume', icon: 'PC', keywords: 'invoice service recipe product consume stock deduction cogs' },
        { path: '/inventory/stock-audit', label: 'Stock Audit', icon: 'SA', keywords: 'audit count stock' },
        { path: '/inventory/financial', label: 'Inventory Finance', icon: 'IF', keywords: 'cogs cash margin dead stock financial' },
        { path: '/inventory/reports', label: 'Inventory Reports', icon: 'IR', keywords: 'cogs margin expiry report' },
        { path: '/inventory/scanner', label: 'Inventory Scanner', icon: 'QR', keywords: 'barcode scanner qr' }
      ]
    },
    {
      id: 'staff',
      label: 'Staff',
      icon: 'ST',
      primaryPath: '/staff-os/staff-list',
      items: [
        { path: '/staff-os/staff-list', label: 'Staff List', icon: 'SL', keywords: 'employee list staff directory active inactive' },
        { path: '/staff-os/staff-categories', label: 'Staff Categories', icon: 'SC', keywords: 'staff category designation role operator admin' },
        { path: '/staff-os/staff-profile', label: 'Staff Profile', icon: 'SP', keywords: 'staff profile documents skills login' },
        { path: '/staff-os/bulk-employee-update', label: 'Bulk Employee Update', icon: 'BU', keywords: 'bulk master update employee pan aadhar statutory flexi' },
        { path: '/staff-os/attendance-dashboard', label: 'Attendance', icon: 'AT', keywords: 'attendance dashboard biometric present absent late' },
        { path: '/staff-os/face-punch', label: 'Face Punch', icon: 'FP', keywords: 'face punch camera attendance check in checkout' },
        { path: '/staff-os/attendance-master', label: 'Attendance Master', icon: 'AM', keywords: 'attendance master absent present holiday day count paid unpaid' },
        { path: '/staff-os/attendance-category', label: 'Attendance Category', icon: 'AC', keywords: 'attendance category late mark overtime shift slabs' },
        { path: '/staff-os/shift-master', label: 'Shift Master', icon: 'SM', keywords: 'shift master start time end time weekly off holiday leave' },
        { path: '/staff-os/roster-calendar', label: 'Roster Calendar', icon: 'RC', keywords: 'roster schedule shift calendar availability' },
        { path: '/staff-os/leave-management', label: 'Leave Management', icon: 'LM', keywords: 'leave request approval balance calendar' },
        { path: '/staff-os/leave-master', label: 'Leave Master', icon: 'LV', keywords: 'leave master casual paid sick quota monthly yearly' },
        { path: '/staff-os/payroll-dashboard', label: 'Payroll Dashboard', icon: 'PD', keywords: 'payroll export salary payout statutory' },
        { path: '/staff-os/payroll-rules', label: 'Payroll Rules', icon: 'PR', keywords: 'payroll rules overtime week off salary formula' },
        { path: '/staff-os/payroll-salary-structure', label: 'Salary Structure', icon: 'SS', keywords: 'payroll salary structure pf pt esic tds statutory flexi' },
        { path: '/staff-os/salary-generate', label: 'Salary Generate', icon: 'SG', keywords: 'generate salary payroll preview commission attendance leave' },
        { path: '/staff-os/fines-penalties', label: 'Fines / Penalty', icon: 'FN', keywords: 'fine penalty master payroll flexi' },
        { path: '/staff-os/allowance-deduction', label: 'Allowance / Deduction', icon: 'AD', keywords: 'allowance deduction payroll master flexi' },
        { path: '/staff-os/commission-dashboard', label: 'Commission Dashboard', icon: 'CD', keywords: 'commission rules payout incentive' },
        { path: '/staff-os/target-incentives/service', label: 'Service Incentives', icon: 'SI', keywords: 'service target incentive slabs flexi commission' },
        { path: '/staff-os/target-incentives/product', label: 'Product Incentives', icon: 'PI', keywords: 'product target incentive commission retail' },
        { path: '/staff-os/target-incentives/membership', label: 'Membership Incentives', icon: 'MI', keywords: 'membership target incentive sales' },
        { path: '/staff-os/target-incentives/branch-admin', label: 'Branch Incentives', icon: 'BI', keywords: 'branch admin target incentive' },
        { path: '/staff-os/target-incentives/admin', label: 'Admin Incentives', icon: 'AI', keywords: 'admin target incentive master' },
        { path: '/staff-os/target-incentives/all-transaction', label: 'All Transaction Incentives', icon: 'TI', keywords: 'all transaction target incentive' },
        { path: '/staff-os/service-assignment', label: 'Service Assignment', icon: 'SA', keywords: 'employee wise service assign operator admin flexi' },
        { path: '/staff-os/performance-dashboard', label: 'Performance Dashboard', icon: 'PF', keywords: 'performance productivity staff ranking' },
        { path: '/staff-os/leaderboard', label: 'Leaderboard', icon: 'LB', keywords: 'leaderboard staff ranking gamification' },
        { path: '/staff-os/training-center', label: 'Training Center', icon: 'TC', keywords: 'training staff lessons certification' },
        { path: '/staff-os/task-board', label: 'Task Board', icon: 'TB', keywords: 'staff task board task assignment followup' },
        { path: '/staff-os/mobile-preview', label: 'Mobile Preview', icon: 'MP', keywords: 'mobile staff dashboard preview app' },
        { path: '/staff-os/heatmaps/roster', label: 'Roster Heatmap', icon: 'RH', keywords: 'roster heatmap coverage demand' },
        { path: '/staff-os/heatmaps/attendance', label: 'Attendance Heatmap', icon: 'AH', keywords: 'attendance heatmap late absent present' },
        { path: '/staff-os/heatmaps/utilization', label: 'Utilization Heatmap', icon: 'UH', keywords: 'utilization heatmap performance productivity' },
        { path: '/staff-os/heatmaps/payroll-cost', label: 'Payroll Cost Heatmap', icon: 'PH', keywords: 'payroll cost heatmap salary overtime' },
        { path: '/staff-os/heatmaps/leave-calendar', label: 'Leave Calendar Heatmap', icon: 'LH', keywords: 'leave calendar heatmap coverage' },
        { path: '/staff/my-work', label: 'My Work', icon: 'MW', keywords: 'staff login live appointments own work report' }
      ]
    },
    {
      id: 'finance',
      label: 'Finance',
      icon: 'FN',
      primaryPath: '/finance',
      items: [
        { path: '/finance', label: 'Finance', icon: 'FN', keywords: 'cash expense finance' },
        { path: '/account-master', label: 'Account Master', icon: 'AM', keywords: 'ledger accounts chart' },
        { path: '/reports/account-ledger', label: 'Account Ledger', icon: 'AL', keywords: 'account ledger debit credit journal drilldown' },
        { path: '/balance-sheet', label: 'Balance Sheet', icon: 'BS', keywords: 'balance sheet trial balance ledger working capital accounting' },
        { path: '/transactions/outgoing-funds', label: 'Outgoing Fund', icon: 'OF', keywords: 'outgoing funds payments expense cash bank balance sheet' },
        { path: '/compliance', label: 'Compliance', icon: 'AC', keywords: 'statutory pf esi tax' }
      ]
    },
    {
      id: 'ai-rank-bot',
      label: 'AI Rank Bot',
      icon: 'RB',
      primaryPath: '/growth-rank-bot',
      items: [
        { path: '/growth-rank-bot', label: 'AI Rank Bot', icon: 'RB', keywords: 'instagram facebook google rank local seo dhanda ai growth bot reviews' }
      ]
    },
    {
      id: 'marketing',
      label: 'Marketing',
      icon: 'MK',
      primaryPath: '/marketing',
      items: [
        { path: '/marketing', label: 'Marketing', icon: 'W', keywords: 'campaign marketing automation' },
        { path: '/engagement', label: 'Engagement Center', icon: 'EC', keywords: 'unified inbox hyperconnect client engagement whatsapp email calls' },
        { path: '/whatsapp', label: 'WhatsApp', icon: 'WA', keywords: 'whatsapp campaign chat' },
        { path: '/message-logs', label: 'Messages', icon: 'ML', keywords: 'message logs communication' },
        { path: '/reputation', label: 'Reviews', icon: 'RV', keywords: 'reviews reputation google' },
        { path: '/growth-advisor', label: 'Growth AI', icon: 'GA', keywords: 'growth advisor ai' },
        { path: '/smart-forms', label: 'Smart Forms', icon: 'SF', keywords: 'forms consent smart' },
        { path: '/recommendation-engine', label: 'Recommend AI', icon: 'RE', keywords: 'recommendation upsell ai' },
        { path: '/notification-center', label: 'Notify Center', icon: 'NC', keywords: 'notifications alerts' }
      ]
    },
    {
      id: 'admin',
      label: 'Admin',
      icon: 'AD',
      primaryPath: '/settings',
      items: [
        { path: '/super-admin', label: 'Super Admin', icon: 'SA', keywords: 'tenant admin platform' },
        { path: '/saas', label: 'SaaS', icon: 'X', keywords: 'saas onboarding tenant' },
        { path: '/branches', label: 'Branches', icon: 'B', keywords: 'branch location' },
        { path: '/settings', label: 'Settings', icon: 'G', keywords: 'settings configuration' },
        { path: '/permissions', label: 'Permissions', icon: 'PM', keywords: 'role rbac permission' },
        { path: '/security', label: 'Security', icon: 'SL', keywords: 'security auth sessions' },
        { path: '/enterprise-security-shield', label: 'Security Shield', icon: 'ES', keywords: 'enterprise security shield detect alert block audit recover' },
        { path: '/security-alerts', label: 'Security Alerts', icon: 'SA', keywords: 'security alerts intrusion threat critical warning' },
        { path: '/security-blocklist', label: 'Security Blocklist', icon: 'BL', keywords: 'security blocklist ip block active defense' },
        { path: '/security-policy-center', label: 'Policy Center', icon: 'PC', keywords: 'security policy center device trust pin export field audit' },
        { path: '/two-factor', label: 'Two-Factor Auth', icon: '2F', keywords: 'security 2fa totp authenticator recovery code' },
        { path: '/audit-logs', label: 'Audit Logs', icon: 'AL', keywords: 'audit logs activity' },
        { path: '/business-details', label: 'Business Details', icon: 'BD', keywords: 'business profile details' },
        { path: '/data-migration', label: 'Data Migration', icon: 'DM', keywords: 'import migration data' },
        { path: '/deployment', label: 'Deployment', icon: 'DP', keywords: 'deployment release' },
        {
          path: '/offline',
          label: 'Offline Command',
          icon: 'OF',
          keywords: 'offline sync pos resilience command center',
          children: [
            { path: '/offline', label: 'Command Center', icon: 'OC', keywords: 'offline resilience command center overview' },
            { path: '/offline/readiness', label: 'Readiness Score', icon: 'RS', keywords: 'offline readiness score cache branch device risk' },
            { path: '/offline/devices', label: 'Device Health', icon: 'DH', keywords: 'offline device sync health terminal tablet' },
            { path: '/offline/sync-queue', label: 'Sync Queue', icon: 'SQ', keywords: 'offline smart sync queue retry force conflict' },
            { path: '/offline/conflicts', label: 'Conflict Center', icon: 'CR', keywords: 'offline conflict resolution server device merge' },
            { path: '/offline/billing', label: 'Offline Billing', icon: 'OB', keywords: 'offline billing protection invoice cash drawer duplicate' },
            { path: '/offline/appointments', label: 'Offline Appointments', icon: 'OA', keywords: 'offline appointment protection slot staff duplicate' },
            { path: '/offline/risk-alerts', label: 'Risk Alerts', icon: 'RA', keywords: 'offline risk alerts stale cache failed sync' }
          ]
        },
        { path: '/offline/readiness', label: 'Offline Readiness', icon: 'RS', keywords: 'offline readiness score cache branch device risk' },
        { path: '/offline/devices', label: 'Device Sync Health', icon: 'DH', keywords: 'offline device sync health terminal tablet' },
        { path: '/offline/sync-queue', label: 'Smart Sync Queue', icon: 'SQ', keywords: 'offline smart sync queue retry force conflict' },
        { path: '/offline/conflicts', label: 'Conflict Center', icon: 'CR', keywords: 'offline conflict resolution server device merge' },
        { path: '/offline/billing', label: 'Offline Billing', icon: 'OB', keywords: 'offline billing protection invoice cash drawer duplicate' },
        { path: '/offline/appointments', label: 'Offline Appointments', icon: 'OA', keywords: 'offline appointment protection slot staff duplicate' },
        { path: '/offline/risk-alerts', label: 'Offline Risk Alerts', icon: 'RA', keywords: 'offline risk alerts stale cache failed sync' },
        { path: '/white-label', label: 'White Label', icon: 'WL', keywords: 'brand theme white label' },
        { path: '/quality', label: 'Quality', icon: 'QA', keywords: 'quality checks qa' }
      ]
    },
    {
      id: 'ai-platform',
      label: 'AI Platform',
      icon: 'AI',
      primaryPath: '/ai',
      items: [
        { path: '/ai', label: 'AI Assistant', icon: 'A', keywords: 'assistant ai' },
        { path: '/future-features', label: 'Future AI', icon: 'F', keywords: 'future features ai' },
        { path: '/workflows', label: 'Workflows', icon: 'WF', keywords: 'workflow automation' },
        { path: '/voice-receptionist', label: 'Voice AI', icon: 'VR', keywords: 'voice receptionist ai' },
        { path: '/dynamic-pricing', label: 'Pricing AI', icon: 'DP', keywords: 'dynamic pricing ai' },
        { path: '/franchise', label: 'Franchise', icon: 'FR', keywords: 'franchise expansion' },
        { path: '/image-analysis', label: 'Image AI', icon: 'IA', keywords: 'image analysis ai' },
        { path: '/marketplace-integrations', label: 'Integrations', icon: 'IN', keywords: 'integrations marketplace' },
        { path: '/gamification', label: 'Gamification', icon: 'GM', keywords: 'points badges gamification' },
        { path: '/fraud-detection', label: 'Fraud AI', icon: 'FD', keywords: 'fraud detection risk' },
        { path: '/appointment-optimization', label: 'Appt Optimize', icon: 'AO', keywords: 'appointment optimization ai' },
        { path: '/developer-api', label: 'API Platform', icon: 'API', keywords: 'api platform developer' },
        { path: '/webhooks', label: 'Webhooks', icon: 'WH', keywords: 'webhooks api events' },
        { path: '/knowledge-base', label: 'Knowledge', icon: 'KB', keywords: 'knowledge base ai' },
        { path: '/plugins', label: 'Plugins', icon: 'PL', keywords: 'plugins extension' },
        { path: '/app-marketplace', label: 'Marketplace', icon: 'AM', keywords: 'marketplace apps' },
        { path: '/localization', label: 'Countries', icon: 'LC', keywords: 'localization countries tax' },
        { path: '/design-system', label: 'Design', icon: 'DS', keywords: 'design system ui' },
        { path: '/prd', label: 'PRD', icon: 'P', keywords: 'product requirements prd' }
      ]
    }
  ];

  readonly visibleNavGroups = computed(() => {
    const term = this.navQuery().trim().toLowerCase();
    if (!term) return this.navGroups;
    return this.navGroups
      .map((group) => {
        const groupMatches = `${group.label} ${group.id}`.toLowerCase().includes(term);
        const items = groupMatches ? group.items : group.items
          .map((item) => this.filterNavItem(item, group, term))
          .filter((item): item is NavItem => Boolean(item));
        return { ...group, items };
      })
      .filter((group) => group.items.length);
  });
  readonly activePageLabel = computed(() => {
    return this.pageLabelForUrl(this.activeRoute()) || 'Command workspace';
  });
  readonly backButtonLabel = computed(() => {
    const previous = this.previousRoute();
    if (previous && previous !== this.activeRoute()) {
      return `Back to ${this.pageLabelForUrl(previous) || 'previous page'}`;
    }
    return 'Back to Dashboard';
  });

  constructor(
    readonly api: ApiService,
    readonly state: AppStateService,
    readonly session: AuthSessionService,
    readonly i18n: I18nService,
    private readonly router: Router
  ) {
    delete document.documentElement.dataset.theme;
    this.isPortal.set(this.isPortalUrl(this.router.url));
    this.activeRoute.set(this.router.url);
    this.ensureActiveGroupExpanded(this.router.url);
    window.addEventListener('aura:app-error', (event) => {
      this.globalError.set(this.readGlobalError((event as CustomEvent<{ message: unknown }>).detail?.message));
    });
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const url = (event as NavigationEnd).urlAfterRedirects;
      const current = this.activeRoute();
      if (url !== current && this.isBackHistoryCandidate(current)) {
        this.previousRoute.set(current);
      }
      this.isPortal.set(this.isPortalUrl(url));
      this.activeRoute.set(url);
      this.ensureActiveGroupExpanded(url);
    });
    effect(() => {
      this.state.selectedTenantId();
      this.session.session();
      if (this.session.isAuthenticated()) {
        this.loadTenants();
        this.loadBranches();
        this.loadLocalizationPreference(this.state.selectedTenantId());
      }
    });
  }

  login(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loginBusy.set(true);
    this.loginError.set('');
    const raw = this.loginForm.getRawValue() as { tenantId: string; email: string; password: string; branchId?: string; totpToken?: string };
    const payload = { ...raw, totpToken: (raw.totpToken || '').trim() || undefined };
    this.session.login(payload).subscribe({
      next: (session) => {
        this.state.setTenant(session.tenant.id);
        this.state.setRole(session.user.role as UserRole);
        this.state.setBranch(session.user.branchId || '');
        this.loginBusy.set(false);
        this.requiresTotp.set(false);
        this.loginForm.controls.totpToken.setValue('');
        this.loadTenants();
        this.loadBranches();
      },
      error: (error) => {
        if (AuthSessionService.requiresTotp(error)) {
          this.requiresTotp.set(true);
          this.loginError.set(this.loginForm.value.totpToken ? 'Invalid authenticator or recovery code. Try again.' : 'Enter your authenticator or recovery code.');
          this.loginBusy.set(false);
          return;
        }
        this.loginError.set(error?.error?.error?.message || error?.error?.error || error?.message || 'Unable to sign in');
        this.loginBusy.set(false);
      }
    });
  }

  logout(): void {
    this.session.logout();
  }

  goBack(): void {
    const current = this.activeRoute();
    const previous = this.previousRoute();
    if (previous && previous !== current) {
      this.router.navigateByUrl(previous);
      return;
    }
    if (current !== '/dashboard') {
      this.router.navigateByUrl('/dashboard');
    }
  }

  loadBranches(): void {
    this.api.list<ApiRecord[]>('branches').subscribe({
      next: (branches) => {
        const rows = (branches || []).filter((branch) => branch && branch.id);
        this.branches.set(rows);
        const selectedBranchId = this.state.selectedBranchId();
        const selectedExists = rows.some((branch) => branch.id === selectedBranchId);
        if (rows.length && (!selectedBranchId || !selectedExists)) {
          this.state.setBranch(rows[0].id);
        }
      },
      error: () => this.branches.set([])
    });
  }

  loadTenants(): void {
    this.api.list<ApiRecord[]>('tenants', { limit: 1000 }).subscribe({
      next: (tenants) => {
        const safeTenants = (tenants || []).filter((tenant) => tenant && tenant.id);
        const businessTenants = safeTenants.filter((tenant) => !this.isGeneratedTestTenant(tenant.id));
        const tenantOptions = businessTenants.length ? businessTenants : safeTenants;
        const orderedTenants = [...tenantOptions].sort((left, right) => {
          if (left.id === 'tenant_aura') return -1;
          if (right.id === 'tenant_aura') return 1;
          return String(left.name || left.id).localeCompare(String(right.name || right.id));
        });
        this.tenants.set(orderedTenants);
        const selectedTenant = this.state.selectedTenantId();
        if (orderedTenants.length && !orderedTenants.some((tenant) => tenant.id === selectedTenant)) {
          this.state.setTenant(orderedTenants.find((tenant) => tenant.id === 'tenant_aura')?.id || orderedTenants[0].id);
          this.loadBranches();
        }
      },
      error: () => this.tenants.set([])
    });
  }

  selectTenant(tenantId: string): void {
    this.state.setTenant(tenantId);
  }

  selectBranch(branchId: string): void {
    this.state.setBranch(branchId);
  }

  selectRole(role: UserRole): void {
    this.state.setRole(role);
  }

  selectCountry(countryCode: string): void {
    this.i18n.setCountry(countryCode);
    this.saveLocalizationPreference();
  }

  selectLanguage(languageCode: string): void {
    this.i18n.setLanguage(languageCode);
    this.saveLocalizationPreference();
  }

  private loadLocalizationPreference(tenantId: string): void {
    if (!tenantId || this.loadedLocalizationTenantId === tenantId) return;
    this.loadedLocalizationTenantId = tenantId;
    this.api.list<{ preference?: LocalePreference }>('localization/preference', { includeAllBranches: true }).subscribe({
      next: (result) => {
        if (result?.preference) this.i18n.setPreference(result.preference);
      },
      error: () => {
        this.loadedLocalizationTenantId = '';
      }
    });
  }

  private saveLocalizationPreference(): void {
    if (!this.session.isAuthenticated()) return;
    this.api.put<{ preference?: LocalePreference }>('localization/preference', this.i18n.preference()).subscribe({
      next: (result) => {
        if (result?.preference) this.i18n.setPreference(result.preference);
      },
      error: (error) => {
        const message = this.api.errorText(error, 'Unable to save language preference');
        if (error?.status === 404 || /Route not found/i.test(message)) return;
        this.globalError.set(message);
      }
    });
  }

  openNavGroup(group: NavGroup): void {
    if (this.sidebarCompact()) {
      this.router.navigateByUrl(group.primaryPath);
      return;
    }
    const current = new Set(this.expandedGroupIds());
    if (current.has(group.id)) current.delete(group.id);
    else current.add(group.id);
    this.expandedGroupIds.set([...current]);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify([...current]));
  }

  rememberNavGroup(groupId: string): void {
    const current = new Set(this.expandedGroupIds());
    current.add(groupId);
    this.expandedGroupIds.set([...current]);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify([...current]));
  }

  toggleSidebarCompact(): void {
    const next = !this.sidebarCompact();
    this.sidebarCompact.set(next);
    localStorage.setItem('aura.sidebarCompact', next ? '1' : '0');
  }

  isGroupExpanded(group: NavGroup): boolean {
    return Boolean(this.navQuery()) || this.expandedGroupIds().includes(group.id);
  }

  isGroupActive(group: NavGroup): boolean {
    const url = this.activeRoute();
    return this.navLeaves(group.items).some((item) => this.isRouteActive(url, item.path));
  }

  private ensureActiveGroupExpanded(url: string): void {
    const group = this.navGroups.find((item) => this.navLeaves(item.items).some((navItem) => this.isRouteActive(url, navItem.path)));
    if (!group || this.expandedGroupIds().includes(group.id)) return;
    const next = [...this.expandedGroupIds(), group.id];
    this.expandedGroupIds.set(next);
    localStorage.setItem('aura.expandedNavGroups', JSON.stringify(next));
  }

  private navItemText(item: NavItem, group: NavGroup): string {
    const childText = (item.children || []).map((child) => `${child.label} ${child.path} ${child.icon} ${child.keywords || ''}`).join(' ');
    return `${item.label} ${item.path} ${item.icon} ${item.keywords || ''} ${childText} ${group.label}`.toLowerCase();
  }

  navLeafCount(items: NavItem[]): number {
    return this.navLeaves(items).length;
  }

  private navLeaves(items: NavItem[]): NavItem[] {
    return items.flatMap((item) => item.children?.length ? item.children : [item]);
  }

  private filterNavItem(item: NavItem, group: NavGroup, term: string): NavItem | null {
    if (!item.children?.length) return this.navItemText(item, group).includes(term) ? item : null;
    const children = item.children.filter((child) => this.navItemText(child, group).includes(term));
    if (children.length) return { ...item, children };
    return this.navItemText({ ...item, children: [] }, group).includes(term) ? item : null;
  }

  private isRouteActive(url: string, path: string): boolean {
    const cleanUrl = this.routePath(url);
    return cleanUrl === path || cleanUrl.startsWith(`${path}/`);
  }

  private pageLabelForUrl(url: string): string {
    return this.navGroups
      .flatMap((group) => this.navLeaves(group.items))
      .find((item) => this.isRouteActive(url, item.path))?.label || '';
  }

  private routePath(url: string): string {
    return (url || '/').split(/[?#]/)[0] || '/';
  }

  private isBackHistoryCandidate(url: string): boolean {
    const path = this.routePath(url);
    return Boolean(path && path !== '/' && !this.isPortalUrl(path) && !path.startsWith('/auth'));
  }

  private isPortalUrl(url: string): boolean {
    const path = this.routePath(url);
    return path.startsWith('/book') || path.startsWith('/salon-3d') || path.startsWith('/cash-drawer-approval');
  }

  private isGeneratedTestTenant(tenantId: unknown): boolean {
    return /^tenant_(ai|import)_/i.test(String(tenantId || ''));
  }

  private readExpandedGroups(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem('aura.expandedNavGroups') || '[]');
      const groups = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : ['frontdesk', 'pos', 'inventory'];
      return groups.includes('command') ? groups : ['command', ...groups];
    } catch {
      return ['command', 'frontdesk', 'pos', 'inventory'];
    }
  }

  private readInitialSidebarCompact(): boolean {
    try {
      const restoreKey = 'aura.sidebarMorningRestore.v1';
      if (localStorage.getItem(restoreKey) !== '1') {
        localStorage.setItem(restoreKey, '1');
        localStorage.setItem('aura.sidebarCompact', '1');
        return true;
      }
      return localStorage.getItem('aura.sidebarCompact') !== '0';
    } catch {
      return true;
    }
  }

  private readGlobalError(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message && typeof message === 'object') {
      const value = message as { message?: unknown; code?: unknown };
      if (typeof value.message === 'string') return value.message;
      if (typeof value.code === 'string') return value.code;
    }
    return 'Unexpected application error';
  }
}
